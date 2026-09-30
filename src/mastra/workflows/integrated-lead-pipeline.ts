import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { rawLeadSchema, searchLeads } from "../tools/lead-generation-tool";
import { researchContext, researchSchema } from "../tools/lead-research-tool";
import {
  contactInfoSchema,
  enrichFromWebsite,
  enrichmentStatusOf,
  resolveLogo,
} from "../tools/company-enrichment-tool";
import { exportLeadsToCsv } from "../tools/csv-export-tool";
import { sendLeadReport } from "../tools/email-tool";
import { recordSecurityEvent } from "../security/events";
import { asUntrustedData, scanForInjection } from "../security/prompt-injection";
import { checkEmailRecipient, summarisePii } from "../security/egress-policy";
import { approvalTimeoutMs, requestApproval } from "../security/approval";
import { leadResearchAgent } from "../agents/lead-research-agent";
import { byScoreDescending, scoreLead } from "./score-lead";
import {
  buildSummary,
  csvExportSchema,
  pipelineInputSchema,
  pipelineOutputSchema,
  processedLeadSchema,
  summarySchema,
  type ProcessedLead,
} from "./schemas";

/** Run per-lead work concurrently - the pipeline is entirely I/O bound. */
const mapLeads = <T, R>(leads: T[], fn: (lead: T) => Promise<R>) => Promise.all(leads.map(fn));

const researchedLeadSchema = rawLeadSchema.extend(researchSchema.shape);

const enrichedLeadSchema = researchedLeadSchema.extend({
  logoUrl: z.string(),
  enrichmentStatus: z.string(),
  contactInfo: contactInfoSchema,
});

const UNKNOWN_RESEARCH = {
  industry: "Unknown",
  estimatedSize: "Unknown",
  businessModel: "Unknown",
};

/** 1. Find candidate companies with Exa neural search. */
const generateLeads = createStep({
  id: "generate-leads",
  inputSchema: pipelineInputSchema,
  outputSchema: z.object({ leads: z.array(rawLeadSchema) }),
  execute: async ({ inputData }) => {
    const leads = await searchLeads(inputData.searchQuery, inputData.limit ?? 3);
    if (leads.length === 0) {
      throw new Error(
        `No companies found for "${inputData.searchQuery}". Try a broader query.`
      );
    }
    return { leads };
  },
});

/** 2. Classify industry, size and business model from the best available background. */
const researchLeads = createStep({
  id: "research-leads",
  inputSchema: z.object({ leads: z.array(rawLeadSchema) }),
  outputSchema: z.object({ leads: z.array(researchedLeadSchema) }),
  execute: async ({ inputData, runId }) => {
    const leads = await mapLeads(inputData.leads, async (lead) => {
      const rawContext = await researchContext(lead.companyName, lead.domain, lead.summary);

      // Everything in rawContext came off the public internet. Scan and defang
      // it before it is allowed anywhere near the model.
      const scan = scanForInjection(rawContext);
      recordSecurityEvent(runId, {
        control: "prompt-injection",
        verdict: scan.clean ? "pass" : "sanitized",
        severity: scan.findings.some((f) => f.severity === "critical")
          ? "critical"
          : scan.clean
            ? "info"
            : "warning",
        subject: `scraped content · ${lead.domain}`,
        detail: scan.clean
          ? "No injection patterns in scraped background; fenced as untrusted data."
          : `Neutralised ${scan.findings.length} injection pattern(s) before prompting.`,
        evidence: scan.findings.map((f) => `${f.rule}: ${f.match}`),
      });

      const context = scan.safeText;

      try {
        const response = await leadResearchAgent.generate(
          [
            {
              role: "user",
              content: [
                "Classify this company.",
                "",
                `Name: ${lead.companyName}`,
                `Domain: ${lead.domain}`,
                "",
                context
                  ? asUntrustedData(lead.domain, context)
                  : "(no background found)",
              ].join("\n"),
            },
          ],
          { structuredOutput: { schema: researchSchema } }
        );

        const object = (response as { object?: z.infer<typeof researchSchema> }).object;
        if (object) return { ...lead, ...object };
      } catch (error) {
        console.warn(
          `[research-leads] research agent failed for ${lead.companyName}, falling back to Unknown:`,
          error instanceof Error ? error.message : error
        );
      }

      return { ...lead, ...UNKNOWN_RESEARCH, description: context.slice(0, 400) };
    });

    return { leads };
  },
});

/** 3. Attach a logo and scrape reachable contact details. */
const enrichLeads = createStep({
  id: "enrich-leads",
  inputSchema: z.object({ leads: z.array(researchedLeadSchema) }),
  outputSchema: z.object({ leads: z.array(enrichedLeadSchema) }),
  execute: async ({ inputData }) => {
    const leads = await mapLeads(inputData.leads, async (lead) => {
      const [logoUrl, contactInfo] = await Promise.all([
        resolveLogo(lead.domain),
        enrichFromWebsite(lead.domain),
      ]);

      return {
        ...lead,
        logoUrl,
        contactInfo,
        enrichmentStatus: enrichmentStatusOf(contactInfo),
      };
    });

    return { leads };
  },
});

/** 4. Score with BANT and classify Hot/Warm/Cold. */
const scoreLeads = createStep({
  id: "score-leads",
  inputSchema: z.object({ leads: z.array(enrichedLeadSchema) }),
  outputSchema: z.object({
    processedLeads: z.array(processedLeadSchema),
    summary: summarySchema,
  }),
  execute: async ({ inputData }) => {
    const processedLeads: ProcessedLead[] = await mapLeads(inputData.leads, async (lead) => ({
      ...lead,
      ...(await scoreLead(lead)),
    }));

    processedLeads.sort(byScoreDescending);

    return { processedLeads, summary: buildSummary(processedLeads) };
  },
});

/** 5. Write the CSV to output/. */
const exportToCsv = createStep({
  id: "export-to-csv",
  inputSchema: z.object({
    processedLeads: z.array(processedLeadSchema),
    summary: summarySchema,
  }),
  outputSchema: z.object({
    processedLeads: z.array(processedLeadSchema),
    summary: summarySchema,
    csvExport: csvExportSchema,
  }),
  execute: async ({ inputData }) => {
    try {
      return { ...inputData, csvExport: await exportLeadsToCsv(inputData.processedLeads) };
    } catch (error) {
      return {
        ...inputData,
        csvExport: {
          success: false,
          filepath: "",
          rowCount: 0,
          message: `CSV export failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      };
    }
  },
});

/**
 * 6. Mail the CSV - the only irreversible, outward-facing action in the run, so
 * it is the only step gated. Two layers, in order: policy decides whether this
 * recipient is sanctioned at all, and a human approves what policy allows.
 * Never fails the run - the CSV on disk is the deliverable.
 */
const sendEmailWithCsv = createStep({
  id: "send-email-with-csv",
  inputSchema: z.object({
    processedLeads: z.array(processedLeadSchema),
    summary: summarySchema,
    csvExport: csvExportSchema,
  }),
  outputSchema: pipelineOutputSchema,
  execute: async ({ inputData, getInitData, runId }) => {
    if (!inputData.csvExport.success) {
      return {
        ...inputData,
        emailResult: {
          success: false,
          message: "Skipped email - the CSV export did not succeed.",
          emailsSent: 0,
        },
      };
    }

    const init = getInitData<typeof pipelineInputSchema>();
    const recipient = process.env.LEAD_REPORT_EMAIL || process.env.SMTP_USER || "";

    // Layer 1: policy. An unsanctioned recipient is rejected outright rather
    // than becoming one more dialog for a human to wave through.
    const policy = checkEmailRecipient(recipient);
    recordSecurityEvent(runId, {
      control: "egress-policy",
      verdict: policy.allowed ? "pass" : "blocked",
      severity: policy.allowed ? "info" : "critical",
      subject: `send_email → ${recipient || "(unset)"}`,
      detail: `${policy.policy}: ${policy.reason}`,
    });

    if (!policy.allowed) {
      return {
        ...inputData,
        emailResult: {
          success: false,
          message: `Blocked by policy ${policy.policy}. ${policy.reason}`,
          emailsSent: 0,
        },
      };
    }

    // Layer 2: a human sees exactly what leaves the building, including how
    // much personal data rides along, and decides. Fails closed on timeout.
    const pii = summarisePii(inputData.processedLeads);
    const facts = [
      `Recipient: ${recipient}`,
      `Attachment: ${inputData.csvExport.filepath.split(/[\\/]/).pop() ?? "leads.csv"} (${inputData.csvExport.rowCount} rows)`,
      `Leads: ${inputData.summary.totalFound} total · ${inputData.summary.hotLeads} hot`,
      `Personal data: ${pii.emails} email address(es), ${pii.phones} phone number(s)`,
      `Search: ${init?.searchQuery ?? "(unknown)"}`,
    ];

    // Announce the pause before blocking on it, so the UI can render the
    // prompt while the step waits.
    recordSecurityEvent(runId, {
      control: "human-approval",
      verdict: "awaiting-approval",
      severity: "warning",
      subject: `send_email → ${recipient}`,
      detail: `Irreversible action held for human approval (auto-denies in ${Math.round(
        approvalTimeoutMs() / 1000
      )}s).`,
      evidence: facts,
    });

    const decision = await requestApproval(runId, {
      action: "send_email",
      target: recipient,
      risk: pii.total > 0 ? "high" : "medium",
      policy: `${policy.policy}: ${policy.reason}`,
      facts,
    });

    recordSecurityEvent(runId, {
      control: "human-approval",
      verdict: decision.approved ? "approved" : "denied",
      severity: decision.approved ? "info" : "warning",
      subject: `send_email → ${recipient}`,
      detail: decision.reason,
    });

    if (!decision.approved) {
      return {
        ...inputData,
        emailResult: {
          success: false,
          message: `Email not sent - ${decision.reason}`,
          emailsSent: 0,
        },
      };
    }

    const emailResult = await sendLeadReport(
      inputData.csvExport.filepath,
      inputData.summary,
      init?.searchQuery ?? ""
    );

    return { ...inputData, emailResult };
  },
});

export const integratedLeadPipeline = createWorkflow({
  id: "integratedLeadPipeline",
  inputSchema: pipelineInputSchema,
  outputSchema: pipelineOutputSchema,
})
  .then(generateLeads)
  .then(researchLeads)
  .then(enrichLeads)
  .then(scoreLeads)
  .then(exportToCsv)
  .then(sendEmailWithCsv)
  .commit();
