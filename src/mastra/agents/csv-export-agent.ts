import { Agent } from "@mastra/core/agent";
import { csvExportTool } from "../tools/csv-export-tool";
import { DEFAULT_MODEL } from "./model";

export const csvExportAgent = new Agent({
  name: "csvExportAgent",
  instructions: `You export scored leads to CSV using the csv-export tool.

Report the file path and row count back to the user once the export completes.`,
  model: DEFAULT_MODEL,
  tools: { csvExportTool },
});
