import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { contactInfoSchema } from "../tools/company-enrichment-tool";
import { bantSchema } from "../tools/lead-scoring-tool";
import { byScoreDescending, scoreLead } from "./score-lead";
import { buildSummary, summarySchema } from "./schemas";

/**
 * Scoring-only workflow for leads you already have. Takes a minimal lead record
 * so it can be pointed at a CRM export rather than the generation step.
 */
const inputLeadSchema = z.object({
  companyName: z.string(),
  domain: z.string().default(""),
  industry: z.string().default("Unknown"),
  estimatedSize: z.string().default("Unknown"),
  businessModel: z.string().default("Unknown"),
  description: z.string().default(""),
  contactInfo: contactInfoSchema.optional(),
});

const qualifiedLeadSchema = inputLeadSchema.extend({
  overallScore: z.number(),
  qualification: z.enum(["Hot", "Warm", "Cold"]),
  recommendation: z.string(),
  scoreBreakdown: bantSchema,
});

const scoreLeads = createStep({
  id: "score-leads",
  inputSchema: z.object({ leads: z.array(inputLeadSchema) }),
  outputSchema: z.object({
    qualifiedLeads: z.array(qualifiedLeadSchema),
    summary: summarySchema,
  }),
  execute: async ({ inputData }) => {
    const qualifiedLeads = await Promise.all(
      inputData.leads.map(async (lead) => ({ ...lead, ...(await scoreLead(lead)) }))
    );

    qualifiedLeads.sort(byScoreDescending);

    return { qualifiedLeads, summary: buildSummary(qualifiedLeads) };
  },
});

export const leadQualificationWorkflow = createWorkflow({
  id: "leadQualificationWorkflow",
  inputSchema: z.object({ leads: z.array(inputLeadSchema) }),
  outputSchema: z.object({
    qualifiedLeads: z.array(qualifiedLeadSchema),
    summary: summarySchema,
  }),
})
  .then(scoreLeads)
  .commit();
