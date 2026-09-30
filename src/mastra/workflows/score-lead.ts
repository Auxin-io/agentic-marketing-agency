import type { z } from "zod";
import { leadScoringAgent } from "../agents/lead-scoring-agent";
import type { ContactInfo } from "../tools/company-enrichment-tool";
import { bantSchema, heuristicScore, qualify, totalScore } from "../tools/lead-scoring-tool";

/** The minimum a lead needs for BANT scoring; both workflows satisfy it. */
export type ScorableLead = {
  companyName: string;
  industry?: string;
  estimatedSize?: string;
  businessModel?: string;
  description?: string;
  contactInfo?: Pick<ContactInfo, "emails" | "phones" | "socialMedia">;
};

export type LeadScore = {
  overallScore: number;
  qualification: "Hot" | "Warm" | "Cold";
  recommendation: string;
  scoreBreakdown: z.infer<typeof bantSchema>;
};

const scoringPrompt = (lead: ScorableLead) =>
  [
    "Score this lead with BANT.",
    "",
    `Company: ${lead.companyName}`,
    `Industry: ${lead.industry || "Unknown"}`,
    `Size: ${lead.estimatedSize || "Unknown"}`,
    `Business model: ${lead.businessModel || "Unknown"}`,
    `Description: ${lead.description || "(none)"}`,
    `Emails found: ${lead.contactInfo?.emails.length ?? 0}`,
    `Phones found: ${lead.contactInfo?.phones.length ?? 0}`,
    `LinkedIn: ${lead.contactInfo?.socialMedia.linkedin || "none"}`,
  ].join("\n");

/**
 * Score one lead with the scoring agent, falling back to the deterministic
 * heuristic if the agent is unreachable. Shared by the full pipeline and the
 * scoring-only workflow so both produce identical, comparable scores.
 */
export const scoreLead = async (lead: ScorableLead): Promise<LeadScore> => {
  let breakdown: z.infer<typeof bantSchema> | undefined;

  try {
    const response = await leadScoringAgent.generate(
      [{ role: "user", content: scoringPrompt(lead) }],
      { structuredOutput: { schema: bantSchema } }
    );
    breakdown = (response as { object?: z.infer<typeof bantSchema> }).object;
  } catch (error) {
    // Never silent: a fallback score is a degraded result, not a normal one.
    console.warn(
      `[score-leads] scoring agent failed for ${lead.companyName}, using heuristic:`,
      error instanceof Error ? error.message : error
    );
  }

  const scoreBreakdown = breakdown ?? heuristicScore(lead);
  const overallScore = totalScore(scoreBreakdown);

  return {
    overallScore,
    qualification: qualify(overallScore),
    recommendation: scoreBreakdown.recommendation,
    scoreBreakdown,
  };
};

/** Hottest first, so the UI and CSV both lead with the best prospects. */
export const byScoreDescending = <T extends { overallScore: number }>(a: T, b: T) =>
  b.overallScore - a.overallScore;
