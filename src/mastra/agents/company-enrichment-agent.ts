import { Agent } from "@mastra/core/agent";
import { companyEnrichmentTool } from "../tools/company-enrichment-tool";
import { DEFAULT_MODEL } from "./model";

export const companyEnrichmentAgent = new Agent({
  name: "companyEnrichmentAgent",
  instructions: `You enrich company records with a logo and reachable contact details.

Use the company-enrichment tool against the company domain. Report the emails,
phone numbers, social profiles and address exactly as scraped - never fabricate
a contact detail, because sales reps act on these directly.`,
  model: DEFAULT_MODEL,
  tools: { companyEnrichmentTool },
});
