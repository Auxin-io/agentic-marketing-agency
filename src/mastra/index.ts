import { Mastra } from "@mastra/core";
import { PinoLogger } from "@mastra/loggers";

import { leadGenerationAgent } from "./agents/lead-generation-agent";
import { leadResearchAgent } from "./agents/lead-research-agent";
import { companyEnrichmentAgent } from "./agents/company-enrichment-agent";
import { leadScoringAgent } from "./agents/lead-scoring-agent";
import { csvExportAgent } from "./agents/csv-export-agent";
import { emailAgent } from "./agents/email-agent";
import { simpleAssistantAgent } from "./agents/simple-assistant-agent";

import { integratedLeadPipeline } from "./workflows/integrated-lead-pipeline";
import { leadGenerationWorkflow } from "./workflows/lead-generation-workflow";
import { leadQualificationWorkflow } from "./workflows/lead-qualification-workflow";

export const mastra = new Mastra({
  agents: {
    leadGenerationAgent,
    leadResearchAgent,
    companyEnrichmentAgent,
    leadScoringAgent,
    csvExportAgent,
    emailAgent,
    simpleAssistantAgent,
  },
  workflows: {
    integratedLeadPipeline,
    leadGenerationWorkflow,
    leadQualificationWorkflow,
  },
  logger: new PinoLogger({
    name: "marketing-agency",
    // The MCP server speaks JSON-RPC on stdio, so keep logging quiet there.
    level: process.env.MCP_MODE === "1" ? "silent" : "info",
  }),
});

export * from "./workflows/schemas";
