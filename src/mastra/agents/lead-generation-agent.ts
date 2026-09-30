import { Agent } from "@mastra/core/agent";
import { leadGenerationTool } from "../tools/lead-generation-tool";
import { DEFAULT_MODEL } from "./model";

export const leadGenerationAgent = new Agent({
  name: "leadGenerationAgent",
  instructions: `You find companies that match a prospecting brief.

Use the lead-generation tool to search. Always report the company name, domain
and URL for every lead you return. Never invent a company that the search did
not return, and never invent a domain.`,
  model: DEFAULT_MODEL,
  tools: { leadGenerationTool },
});
