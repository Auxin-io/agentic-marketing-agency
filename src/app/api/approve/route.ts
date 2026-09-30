import { NextResponse } from "next/server";
import { pendingApproval, resolveApproval } from "@/mastra/security/approval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Records a human decision on a held action. The pipeline step is blocked on
 * this; if nothing is waiting the request is rejected rather than silently
 * accepted, so a replayed or stale click can never approve a later action.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const runId = String(body?.runId || "").trim();
    const approved = body?.approved === true;

    if (!runId) {
      return NextResponse.json({ error: "runId is required" }, { status: 400 });
    }

    const action = pendingApproval(runId);
    if (!action) {
      return NextResponse.json(
        { error: "No approval is pending for this run (it may have already expired)." },
        { status: 409 }
      );
    }

    const settled = resolveApproval(runId, approved);
    return NextResponse.json({ ok: settled, approved, action: action.action });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
