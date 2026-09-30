import { NextResponse } from "next/server";
import { mastra } from "@/mastra/index";
import { recordSecurityEvent, subscribeSecurity } from "@/mastra/security/events";
import { scanForInjection } from "@/mastra/security/prompt-injection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LEAD_QUERY_KEYWORDS = [
  "lead",
  "leads",
  "prospect",
  "prospects",
  "company",
  "companies",
  "b2b",
  "saas",
  "startup",
  "startups",
  "business",
  "businesses",
];

const isLeadGenerationQuery = (query: string) => {
  const normalized = query.toLowerCase();
  return LEAD_QUERY_KEYWORDS.some((keyword) => normalized.includes(keyword));
};

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

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        let unsubscribe: (() => void) | undefined;

        const send = (data: unknown) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        };

        try {
          if (!isLeadGenerationQuery(searchQuery)) {
            const assistant = mastra.getAgent("simpleAssistantAgent");
            const response = await assistant.generate([
              { role: "user", content: searchQuery },
            ]);
            const text =
              typeof response === "string"
                ? response
                : (response as { text?: string })?.text ?? "";
            send({ type: "result", payload: { result: { mode: "simple", text } } });
            controller.close();
            return;
          }

          const workflow = mastra.getWorkflow("integratedLeadPipeline");
          const run = await workflow.createRunAsync();

          // Subscribe before the run starts so no early control event is missed.
          unsubscribe = subscribeSecurity(run.runId, (event) =>
            send({ type: "security", payload: event })
          );

          // The search box is untrusted input too - the operator is the easiest
          // injection vector of all. Scan it before it reaches any agent.
          const queryScan = scanForInjection(searchQuery);
          recordSecurityEvent(run.runId, {
            control: "prompt-injection",
            verdict: queryScan.clean ? "pass" : "sanitized",
            severity: queryScan.findings.some((f) => f.severity === "critical")
              ? "critical"
              : queryScan.clean
                ? "info"
                : "warning",
            subject: "search query (user input)",
            detail: queryScan.clean
              ? "No injection patterns in the operator's query."
              : `Neutralised ${queryScan.findings.length} injection pattern(s) in user input.`,
            evidence: queryScan.findings.map((f) => `${f.rule}: ${f.match}`),
          });

          const output = run.stream({
            inputData: {
              searchQuery: queryScan.safeText,
              limit: Number.isFinite(limitValue) ? limitValue : 3,
            },
          });

          send({ type: "run", payload: { runId: run.runId } });

          const reader = output.fullStream.getReader();
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            send({ type: "event", payload: value });
          }

          const result = await output.result;
          const payload =
            result && "status" in result && result.status === "success"
              ? result.result
              : result;
          send({ type: "result", payload: { result: payload } });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unexpected error";
          send({ type: "error", payload: { message } });
        } finally {
          unsubscribe?.();
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
