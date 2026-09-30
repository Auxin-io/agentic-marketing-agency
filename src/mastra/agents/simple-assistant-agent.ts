import { Agent } from "@mastra/core/agent";
import { DEFAULT_MODEL } from "./model";

/**
 * Answers the free-form questions the UI routes here when the query does not
 * look like a lead-generation brief.
 */
export const simpleAssistantAgent = new Agent({
  name: "simpleAssistantAgent",
  instructions: `You are the assistant for a marketing agency demo.

Answer concisely in a short paragraph. If the user seems to want leads, tell them
to phrase it as a prospecting brief - for example "B2B SaaS companies in North
America" - so the full lead pipeline runs.`,
  model: DEFAULT_MODEL,
});
