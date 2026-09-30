import { z } from "zod";

export const bantSchema = z.object({
  budget: z.number().min(0).max(25),
  authority: z.number().min(0).max(25),
  need: z.number().min(0).max(25),
  timeline: z.number().min(0).max(25),
  reasoning: z.string(),
  recommendation: z.string(),
});

export type BantScore = z.infer<typeof bantSchema>;

export const qualify = (total: number): "Hot" | "Warm" | "Cold" => {
  if (total >= 70) return "Hot";
  if (total >= 45) return "Warm";
  return "Cold";
};

/** Model output is not guaranteed in range, so clamp before summing. */
const clamp = (value: number) => Math.max(0, Math.min(25, Math.round(Number(value) || 0)));

export const totalScore = (score: Pick<BantScore, "budget" | "authority" | "need" | "timeline">) =>
  clamp(score.budget) + clamp(score.authority) + clamp(score.need) + clamp(score.timeline);

/**
 * Deterministic fallback used when the scoring agent is unavailable, so the
 * pipeline still produces a defensible score rather than failing the run.
 *
 * Deliberately not exposed to the scoring agent as a tool: given the choice the
 * model calls it and echoes these numbers back instead of judging the lead.
 */
export const heuristicScore = (lead: {
  estimatedSize?: string;
  contactInfo?: { emails: string[]; phones: string[] };
  description?: string;
}): BantScore => {
  const size = (lead.estimatedSize || "").toLowerCase();
  const budget = size.includes("enterprise") || size.includes("large") ? 20 : size.includes("mid") ? 14 : 8;
  const contacts = (lead.contactInfo?.emails.length || 0) + (lead.contactInfo?.phones.length || 0);
  const authority = Math.min(25, 6 + contacts * 4);
  const need = lead.description && lead.description.length > 120 ? 15 : 10;
  const timeline = 12;

  return {
    budget,
    authority,
    need,
    timeline,
    reasoning: "Heuristic score derived from company size and available contact channels.",
    recommendation: "Review manually - automated scoring was unavailable for this lead.",
  };
};
