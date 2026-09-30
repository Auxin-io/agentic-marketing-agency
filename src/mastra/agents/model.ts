/**
 * Shared model id for every agent. Mastra's model router resolves the
 * "provider/model" string against OPENAI_API_KEY.
 */
export const DEFAULT_MODEL = process.env.OPENAI_MODEL || "openai/gpt-4o-mini";
