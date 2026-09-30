import { Agent } from "@mastra/core/agent";
import { leadResearchTool } from "../tools/lead-research-tool";
import { UNTRUSTED_DATA_RULE } from "../security/prompt-injection";
import { DEFAULT_MODEL } from "./model";

export const leadResearchAgent = new Agent({
  name: "leadResearchAgent",
  instructions: `You classify companies for a B2B sales team.

Given a company name and whatever context is supplied, determine:
- industry: a short label such as "Enterprise Software" or "Healthcare IT"
- estimatedSize: one of Startup, SMB, Mid-Market, Enterprise
- businessModel: such as B2B SaaS, Marketplace, Consulting, E-commerce
- description: two factual sentences about what the company does

Use the lead-research tool for background when it helps. If the evidence is thin,
say "Unknown" rather than guessing.

${UNTRUSTED_DATA_RULE}`,
  model: DEFAULT_MODEL,
  tools: { leadResearchTool },
});
