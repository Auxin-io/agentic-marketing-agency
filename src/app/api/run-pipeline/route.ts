import { NextResponse } from "next/server";
import { mastra } from "@/mastra/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const searchQuery = String(body?.searchQuery || "").trim();
    const limitValue = Number(body?.limit ?? 3);

    if (!searchQuery) {
      return NextResponse.json(
        { error: "searchQuery is required" },
        { status: 400 }
      );
    }

    const workflow = mastra.getWorkflow("integratedLeadPipeline");
    const run = await workflow.createRunAsync();

    const result = await run.start({
      inputData: {
        searchQuery,
        limit: Number.isFinite(limitValue) ? limitValue : 3,
      },
    });

    if (result.status !== "success") {
      return NextResponse.json(
        {
          error: "Workflow did not complete successfully",
          status: result.status,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ result: result.result, runId: run.runId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
