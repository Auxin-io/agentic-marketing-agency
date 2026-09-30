import { createTool } from "@mastra/core/tools";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ProcessedLead } from "../workflows/schemas";

/** Column header paired with how to read that value off a scored lead. */
const CSV_COLUMNS: ReadonlyArray<readonly [string, (lead: ProcessedLead) => unknown]> = [
  ["Company Name", (lead) => lead.companyName],
  ["Domain", (lead) => lead.domain],
  ["URL", (lead) => lead.url],
  ["Industry", (lead) => lead.industry],
  ["Company Size", (lead) => lead.estimatedSize],
  ["Logo URL", (lead) => lead.logoUrl],
  ["Emails", (lead) => lead.contactInfo.emails.join("; ")],
  ["Phones", (lead) => lead.contactInfo.phones.join("; ")],
  ["LinkedIn", (lead) => lead.contactInfo.socialMedia.linkedin],
  ["Twitter", (lead) => lead.contactInfo.socialMedia.twitter],
  ["Score Total", (lead) => lead.overallScore],
  ["Score Category", (lead) => lead.qualification],
  ["Budget Score", (lead) => lead.scoreBreakdown.budget],
  ["Authority Score", (lead) => lead.scoreBreakdown.authority],
  ["Need Score", (lead) => lead.scoreBreakdown.need],
  ["Timeline Score", (lead) => lead.scoreBreakdown.timeline],
  ["Reasoning", (lead) => lead.scoreBreakdown.reasoning],
];

/** RFC-4180 quoting: wrap in quotes and double any embedded quote. */
const cell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
};

export const buildCsv = (leads: ProcessedLead[]) =>
  [
    CSV_COLUMNS.map(([header]) => cell(header)).join(","),
    ...leads.map((lead) => CSV_COLUMNS.map(([, read]) => cell(read(lead))).join(",")),
  ].join("\n");

/** Exports land in <project root>/output, overridable with LEAD_OUTPUT_DIR. */
const outputDirectory = () =>
  process.env.LEAD_OUTPUT_DIR || path.join(process.cwd(), "output");

export const exportLeadsToCsv = async (leads: ProcessedLead[]) => {
  const outputDir = outputDirectory();
  await mkdir(outputDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filepath = path.join(outputDir, `leads-${stamp}.csv`);
  await writeFile(filepath, buildCsv(leads), "utf8");

  return {
    success: true,
    filepath,
    rowCount: leads.length,
    message: `Exported ${leads.length} lead(s) to ${filepath}`,
  };
};

export const csvExportTool = createTool({
  id: "csv-export",
  description: "Export scored leads to a timestamped CSV file in the project output/ directory.",
  inputSchema: z.object({ leads: z.array(z.unknown()) }),
  outputSchema: z.object({
    success: z.boolean(),
    filepath: z.string(),
    rowCount: z.number(),
    message: z.string(),
  }),
  execute: async ({ context }) => exportLeadsToCsv(context.leads as ProcessedLead[]),
});
