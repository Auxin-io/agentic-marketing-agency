import { z } from "zod";
import { contactInfoSchema } from "../tools/company-enrichment-tool";
import { bantSchema } from "../tools/lead-scoring-tool";

export const pipelineInputSchema = z.object({
  searchQuery: z.string(),
  limit: z.number().default(3),
});

export const processedLeadSchema = z.object({
  companyName: z.string(),
  domain: z.string(),
  url: z.string(),
  summary: z.string().default(""),
  industry: z.string(),
  estimatedSize: z.string(),
  businessModel: z.string(),
  description: z.string(),
  logoUrl: z.string(),
  enrichmentStatus: z.string(),
  contactInfo: contactInfoSchema,
  overallScore: z.number(),
  qualification: z.enum(["Hot", "Warm", "Cold"]),
  recommendation: z.string(),
  scoreBreakdown: bantSchema,
});

export type ProcessedLead = z.infer<typeof processedLeadSchema>;

export const summarySchema = z.object({
  totalFound: z.number(),
  hotLeads: z.number(),
  warmLeads: z.number(),
  coldLeads: z.number(),
});

export const csvExportSchema = z.object({
  success: z.boolean(),
  filepath: z.string(),
  rowCount: z.number(),
  message: z.string(),
});

export const emailResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  emailsSent: z.number(),
});

/** The shape the UI renders. */
export const pipelineOutputSchema = z.object({
  processedLeads: z.array(processedLeadSchema),
  summary: summarySchema,
  csvExport: csvExportSchema,
  emailResult: emailResultSchema,
});

export const buildSummary = (leads: Array<Pick<ProcessedLead, "qualification">>) => ({
  totalFound: leads.length,
  hotLeads: leads.filter((l) => l.qualification === "Hot").length,
  warmLeads: leads.filter((l) => l.qualification === "Warm").length,
  coldLeads: leads.filter((l) => l.qualification === "Cold").length,
});
