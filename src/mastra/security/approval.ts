/**
 * Human-in-the-loop approval for irreversible actions.
 *
 * The agent proposes; a person disposes. The pipeline blocks here until someone
 * decides, and if nobody does, the request expires DENIED - the control fails
 * closed. An approval gate that times out into "allow" is not a control.
 *
 * Scope: approvals live in this process's memory, so a restart loses anything
 * pending (it will simply have been denied). A production system would persist
 * the request and use the workflow engine's own suspend/resume so an approval
 * survives a deploy, and would record who approved it against an identity.
 */

export type ApprovalAction = {
  /** Machine name of the action, e.g. "send_email". */
  action: string;
  /** Where the effect lands. */
  target: string;
  /** Operator-facing lines describing exactly what will happen. */
  facts: string[];
  risk: "low" | "medium" | "high";
  /** Policy notes evaluated before the human was asked. */
  policy?: string;
};

export type ApprovalDecision = {
  approved: boolean;
  /** "human" when a person decided, "timeout" when it failed closed. */
  decidedBy: "human" | "timeout";
  reason: string;
};

type Pending = {
  runId: string;
  action: ApprovalAction;
  resolve: (decision: ApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pending = new Map<string, Pending>();

/** Long enough to read the prompt on stage, short enough not to hang a demo. */
const DEFAULT_TIMEOUT_MS = Number(process.env.APPROVAL_TIMEOUT_MS ?? 120_000);

export const approvalTimeoutMs = () => DEFAULT_TIMEOUT_MS;

/**
 * Block until a human decides, or until the request expires (denied).
 * Only one approval may be outstanding per run.
 */
export const requestApproval = (
  runId: string,
  action: ApprovalAction,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<ApprovalDecision> => {
  // A second request for the same run replaces the first, which is denied, so
  // a stale prompt can never be used to approve a newer action.
  settle(runId, {
    approved: false,
    decidedBy: "timeout",
    reason: "Superseded by a newer approval request.",
  });

  return new Promise<ApprovalDecision>((resolve) => {
    const timer = setTimeout(() => {
      settle(runId, {
        approved: false,
        decidedBy: "timeout",
        reason: `No response within ${Math.round(timeoutMs / 1000)}s - denied by default.`,
      });
    }, timeoutMs);

    // Do not hold the process open purely for a pending approval.
    timer.unref?.();

    pending.set(runId, { runId, action, resolve, timer });
  });
};

const settle = (runId: string, decision: ApprovalDecision) => {
  const request = pending.get(runId);
  if (!request) return false;

  clearTimeout(request.timer);
  pending.delete(runId);
  request.resolve(decision);
  return true;
};

/** Called by the approve/deny API route. Returns false if nothing was waiting. */
export const resolveApproval = (runId: string, approved: boolean, reason?: string) =>
  settle(runId, {
    approved,
    decidedBy: "human",
    reason: reason ?? (approved ? "Approved by operator." : "Denied by operator."),
  });

export const pendingApproval = (runId: string) => pending.get(runId)?.action;
