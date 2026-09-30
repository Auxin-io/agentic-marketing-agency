import { mastra } from "./src/mastra/index.js";
import type { ProcessedLead, pipelineOutputSchema } from "./src/mastra/workflows/schemas.js";
import type { z } from "zod";

type PipelineResult = z.infer<typeof pipelineOutputSchema>;

const workflow = mastra.getWorkflow("integratedLeadPipeline");
const run = await workflow.createRunAsync();

const result = await run.start({
  inputData: { searchQuery: "B2B SaaS companies in North America", limit: 2 },
});

console.log("STATUS:", result.status);

if (result.status === "success") {
  const output = result.result as PipelineResult;

  console.log("SUMMARY:", JSON.stringify(output.summary));
  console.log("CSV:", JSON.stringify(output.csvExport));
  console.log("EMAIL:", JSON.stringify(output.emailResult));

  for (const lead of output.processedLeads as ProcessedLead[]) {
    console.log(
      `- ${lead.companyName} (${lead.domain}) ${lead.industry} | ${lead.estimatedSize} | ` +
        `score ${lead.overallScore} ${lead.qualification} | logo:${lead.logoUrl ? "y" : "n"} | ` +
        `emails:${lead.contactInfo.emails.length} phones:${lead.contactInfo.phones.length} | ` +
        lead.enrichmentStatus
    );
  }
} else {
  console.log("FAILED:", JSON.stringify(result, null, 2).slice(0, 3000));
}
