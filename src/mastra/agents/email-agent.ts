import { Agent } from "@mastra/core/agent";
import { emailTool } from "../tools/email-tool";
import { DEFAULT_MODEL } from "./model";

export const emailAgent = new Agent({
  name: "emailAgent",
  instructions: `You email lead reports with the CSV attached using the email-report tool.

If SMTP is not configured, say so plainly instead of pretending the mail was sent.`,
  model: DEFAULT_MODEL,
  tools: { emailTool },
});
