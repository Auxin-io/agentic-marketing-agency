import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { rawLeadSchema, searchLeads } from "../tools/lead-generation-tool";
import { pipelineInputSchema } from "./schemas";

/**
 * Search-only workflow: useful on its own when you just want a list of
 * candidate companies without the research/enrichment/scoring passes.
 */
const generateLeads = createStep({
  id: "generate-leads",
  inputSchema: pipelineInputSchema,
  outputSchema: z.object({ leads: z.array(rawLeadSchema) }),
  execute: async ({ inputData }) => ({
    leads: await searchLeads(inputData.searchQuery, inputData.limit ?? 3),
  }),
});

export const leadGenerationWorkflow = createWorkflow({
  id: "leadGenerationWorkflow",
  inputSchema: pipelineInputSchema,
  outputSchema: z.object({ leads: z.array(rawLeadSchema) }),
})
  .then(generateLeads)
  .commit();
