import { randomUUID } from "node:crypto";

/**
 * Security telemetry for one pipeline run.
 *
 * Every control in `src/mastra/security` reports here rather than logging
 * directly, so the UI, the audit trail and the server log all see the same
 * decisions. Controls are expected to report when they *pass* as well as when
 * they block - a panel that only lights up on failure tells an operator
 * nothing about whether the control ran at all.
 */

export type SecurityControl =
  | "prompt-injection"
  | "egress-policy"
  | "human-approval"
  | "grounding";

export type SecurityVerdict =
  | "pass"
  | "sanitized"
  | "blocked"
  | "awaiting-approval"
  | "approved"
  | "denied";

export type SecuritySeverity = "info" | "warning" | "critical";

export type SecurityEvent = {
  id: string;
  at: string;
  control: SecurityControl;
  verdict: SecurityVerdict;
  severity: SecuritySeverity;
  /** What the control was applied to, e.g. "search query" or "proposify.com". */
  subject: string;
  /** One line an operator can act on. */
  detail: string;
  /** Redacted evidence: the matched span, never the whole document. */
  evidence?: string[];
};

type Listener = (event: SecurityEvent) => void;

const listeners = new Map<string, Set<Listener>>();
const history = new Map<string, SecurityEvent[]>();

/** Keeps a long-lived process from accumulating runs forever. */
const MAX_RUNS_RETAINED = 50;

const trimHistory = () => {
  while (history.size > MAX_RUNS_RETAINED) {
    const oldest = history.keys().next().value;
    if (oldest === undefined) break;
    history.delete(oldest);
  }
};

export const recordSecurityEvent = (
  runId: string,
  event: Omit<SecurityEvent, "id" | "at">
): SecurityEvent => {
  const full: SecurityEvent = { ...event, id: randomUUID(), at: new Date().toISOString() };

  const existing = history.get(runId) ?? [];
  existing.push(full);
  history.set(runId, existing);
  trimHistory();

  for (const listener of listeners.get(runId) ?? []) {
    try {
      listener(full);
    } catch {
      // A broken consumer must never break the control that reported to it.
    }
  }

  return full;
};

/** Subscribe before starting the run so no early event is missed. */
export const subscribeSecurity = (runId: string, listener: Listener) => {
  const set = listeners.get(runId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(runId, set);

  // Replay anything already recorded for this run.
  for (const event of history.get(runId) ?? []) listener(event);

  return () => {
    const current = listeners.get(runId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(runId);
  };
};

export const securityHistory = (runId: string): SecurityEvent[] => history.get(runId) ?? [];
