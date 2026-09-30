"use client";

import { useEffect, useState } from "react";

type SecurityEvent = {
  id: string;
  at: string;
  control: "prompt-injection" | "egress-policy" | "human-approval" | "grounding";
  verdict:
    | "pass"
    | "sanitized"
    | "blocked"
    | "awaiting-approval"
    | "approved"
    | "denied";
  severity: "info" | "warning" | "critical";
  subject: string;
  detail: string;
  evidence?: string[];
};

const CONTROL_LABELS: Record<SecurityEvent["control"], string> = {
  "prompt-injection": "Prompt injection",
  "egress-policy": "Egress policy",
  "human-approval": "Human approval",
  grounding: "Grounding",
};

const VERDICT_STYLES: Record<SecurityEvent["verdict"], string> = {
  pass: "bg-emerald-500/15 text-emerald-300",
  sanitized: "bg-amber-500/20 text-amber-200",
  blocked: "bg-rose-500/20 text-rose-200",
  "awaiting-approval": "bg-sky-500/20 text-sky-200",
  approved: "bg-emerald-500/15 text-emerald-300",
  denied: "bg-rose-500/20 text-rose-200",
};

export default function Home() {
  const [searchQuery, setSearchQuery] = useState(
    "B2B SaaS companies in North America"
  );
  const [limit, setLimit] = useState(3);
  const [isRunning, setIsRunning] = useState(false);
  const [nextAllowedAt, setNextAllowedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [stepStatus, setStepStatus] = useState<Record<string, string>>({});
  const [stepDetails, setStepDetails] = useState<Record<string, string>>({});
  const [runId, setRunId] = useState<string | null>(null);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);
  const [approval, setApproval] = useState<SecurityEvent | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [result, setResult] = useState<null | {
    mode?: "simple" | "workflow";
    text?: string;
    processedLeads?: Array<{
      companyName: string;
      domain: string;
      url: string;
      summary?: string;
      industry: string;
      estimatedSize: string;
      businessModel: string;
      description: string;
      logoUrl: string;
      enrichmentStatus: string;
      contactInfo: {
        emails: string[];
        phones: string[];
        website: string;
        socialMedia: {
          linkedin: string;
          twitter: string;
          facebook: string;
          instagram: string;
        };
        address: string;
      };
      overallScore: number;
      qualification: "Hot" | "Warm" | "Cold";
      recommendation: string;
    }>;
    summary?: {
      totalFound: number;
      hotLeads: number;
      warmLeads: number;
      coldLeads: number;
    };
    csvExport?: {
      success: boolean;
      filepath: string;
      rowCount: number;
      message: string;
    };
    emailResult?: {
      success: boolean;
      message: string;
      emailsSent: number;
    };
  }>(null);
  const handleRunDemo = async () => {
    if (nextAllowedAt && Date.now() < nextAllowedAt) {
      return;
    }
    setIsRunning(true);
    setError(null);
    setResult(null);
    setStepStatus({});
    setStepDetails({});
    setSecurityEvents([]);
    setApproval(null);
    setRunId(null);

    try {
      const response = await fetch("/api/run-pipeline-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ searchQuery, limit }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to generate leads");
      }

      if (!response.body) {
        throw new Error("No response body from server");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          const json = line.replace(/^data:\s*/, "");
          const message = JSON.parse(json);

          if (message.type === "event" && message.payload?.type) {
            const payload = message.payload;
            if (payload.type === "workflow-step-start") {
              setStepStatus((prev) => ({
                ...prev,
                [payload.payload.id]: "running",
              }));
            }
            if (payload.type === "workflow-step-result") {
              setStepStatus((prev) => ({
                ...prev,
                [payload.payload.id]: payload.payload.status,
              }));
              if (payload.payload.output !== undefined) {
                const detail = formatOutput(payload.payload.output);
                if (detail) {
                  setStepDetails((prev) => ({
                    ...prev,
                    [payload.payload.id]: detail,
                  }));
                }
              }
            }
          }

          if (message.type === "run") {
            setRunId(message.payload?.runId ?? null);
          }

          if (message.type === "security") {
            const event = message.payload as SecurityEvent;
            setSecurityEvents((prev) => [...prev, event]);

            // A held action needs a decision; anything later clears the prompt.
            if (event.control === "human-approval") {
              setApproval(event.verdict === "awaiting-approval" ? event : null);
            }
          }

          if (message.type === "result") {
            const payloadResult = message.payload?.result;
            setResult(payloadResult?.result ?? payloadResult ?? null);
            setApproval(null);
            setNextAllowedAt(Date.now() + 5 * 60 * 1000);
          }

          if (message.type === "error") {
            setError(message.payload.message || "Unexpected error");
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setIsRunning(false);
    }
  };

  const handleDecision = async (approved: boolean) => {
    if (!runId) return;
    setApprovalBusy(true);
    try {
      const response = await fetch("/api/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, approved }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error || "Could not record the decision");
      }
      // The pipeline reports the outcome as a security event; clear the prompt.
      setApproval(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the decision");
    } finally {
      setApprovalBusy(false);
    }
  };

  useEffect(() => {
    if (!nextAllowedAt) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [nextAllowedAt]);

  const cooldownRemainingMs = nextAllowedAt ? Math.max(nextAllowedAt - now, 0) : 0;
  const cooldownActive = cooldownRemainingMs > 0;
  const cooldownMinutes = Math.floor(cooldownRemainingMs / 60000);
  const cooldownSeconds = Math.floor((cooldownRemainingMs % 60000) / 1000);
  const cooldownLabel = cooldownActive
    ? `${cooldownMinutes}:${String(cooldownSeconds).padStart(2, "0")}`
    : "";

  const formatOutput = (output: unknown) => {
    try {
      if (output === null || output === undefined) return "";
      const text =
        typeof output === "string" ? output : JSON.stringify(output);
      if (!text) return "";
      return text.length > 220 ? `${text.slice(0, 220)}…` : text;
    } catch {
      return "";
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-white/5 bg-slate-950/80 backdrop-blur">
        <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 via-cyan-400 to-indigo-500 text-lg font-semibold text-slate-950">
              M
            </div>
            <div>
              <p className="text-sm font-semibold">Marketing Agency</p>
              <p className="text-xs text-slate-400">Marketing agency powered by agentic AI</p>
            </div>
          </div>
          <div className="flex flex-col items-end">
            <button
              onClick={handleRunDemo}
              disabled={isRunning || cooldownActive}
              className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-slate-950 transition disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isRunning ? "Generating..." : "Generate Leads"}
            </button>
            {cooldownActive ? (
              <span className="mt-2 text-xs text-slate-400">
                Next run in {cooldownLabel}
              </span>
            ) : null}
          </div>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 py-12">
        <section className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300">
            Marketing Agency
          </p>
          <h1 className="text-3xl font-semibold md:text-4xl">
            Run the marketing agency demo powered by agentic AI.
          </h1>
          <p className="max-w-2xl text-slate-300">
            Use this UI to run lead generation, research, enrichment, scoring, CSV export, and email delivery powered by agentic AI.
          </p>
        </section>

        <section id="demo" className="mt-10">
          <div className="grid items-start gap-10 md:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
            <div className="self-start space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300">
                Live demo
              </p>
              <h2 className="text-3xl font-semibold">
                Run the marketing agency workflow powered by agentic AI.
              </h2>
              <p className="text-slate-300">
                Trigger lead generation, research, enrichment, scoring, and CSV export in one click. Results will appear below in seconds.
              </p>
              <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
                <div className="space-y-4">
                  <div>
                    <label className="text-xs uppercase tracking-[0.3em] text-slate-400">
                      Search query
                    </label>
                    <input
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white placeholder:text-slate-500"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="e.g. AI healthcare startups in Europe"
                    />
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <label className="text-xs uppercase tracking-[0.3em] text-slate-400">
                        Lead limit
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white placeholder:text-slate-500"
                        value={limit}
                        onChange={(event) =>
                          setLimit(Number(event.target.value || 1))
                        }
                      />
                    </div>
                    <div className="flex items-end">
                      <div className="w-full">
                        <button
                          onClick={handleRunDemo}
                          disabled={isRunning || cooldownActive}
                          className="w-full rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-950 transition disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {isRunning ? "Generating leads..." : "Generate Leads"}
                        </button>
                        {cooldownActive ? (
                          <p className="mt-2 text-xs text-slate-400">
                            Next run available in {cooldownLabel}.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  {error ? (
                    <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
                      {error}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="space-y-6">
              <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                  Live progress
                </p>
                {result?.mode === "simple" ? (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-300">
                    Simple response generated.
                  </div>
                ) : (
                  <div className="mt-4 space-y-3 text-sm text-slate-300">
                    {[
                      { id: "generate-leads", label: "Generate leads" },
                      { id: "research-leads", label: "Research leads" },
                      { id: "enrich-leads", label: "Enrich leads" },
                      { id: "score-leads", label: "Score leads" },
                      { id: "export-to-csv", label: "Export CSV" },
                      { id: "send-email-with-csv", label: "Send email" },
                    ].map((step) => {
                      const status = stepStatus[step.id] || (isRunning ? "pending" : "idle");
                      const detail = stepDetails[step.id];
                      const badgeStyle =
                        status === "success"
                          ? "bg-emerald-500/20 text-emerald-200"
                          : status === "failed"
                            ? "bg-rose-500/20 text-rose-200"
                            : status === "running"
                              ? "bg-sky-500/20 text-sky-200"
                              : status === "waiting"
                                ? "bg-amber-500/20 text-amber-200"
                                : "bg-white/10 text-slate-300";

                      return (
                        <div
                          key={step.id}
                          className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3"
                        >
                          <div className="flex items-center justify-between">
                            <span>{step.label}</span>
                            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badgeStyle}`}>
                              {status}
                            </span>
                          </div>
                          {detail ? (
                            <p className="mt-2 text-xs text-slate-400 break-words">
                              {detail}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                    Security controls
                  </p>
                  {securityEvents.length > 0 ? (
                    <span className="text-xs text-slate-500">
                      {securityEvents.length} event
                      {securityEvents.length === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </div>

                {approval ? (
                  <div className="mt-4 rounded-2xl border border-sky-400/40 bg-sky-500/10 p-4">
                    <p className="text-sm font-semibold text-sky-200">
                      Approval required before an irreversible action
                    </p>
                    <p className="mt-1 text-xs text-slate-300">{approval.detail}</p>
                    <ul className="mt-3 space-y-1 text-xs text-slate-300">
                      {(approval.evidence ?? []).map((fact) => (
                        <li key={fact} className="break-words">
                          · {fact}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-4 flex gap-3">
                      <button
                        onClick={() => handleDecision(true)}
                        disabled={approvalBusy}
                        className="rounded-full bg-emerald-400 px-4 py-2 text-xs font-semibold text-slate-950 transition disabled:opacity-60"
                      >
                        Approve &amp; send
                      </button>
                      <button
                        onClick={() => handleDecision(false)}
                        disabled={approvalBusy}
                        className="rounded-full border border-rose-400/50 px-4 py-2 text-xs font-semibold text-rose-200 transition disabled:opacity-60"
                      >
                        Deny
                      </button>
                    </div>
                  </div>
                ) : null}

                {securityEvents.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-400">
                    Controls report here as the pipeline runs: untrusted input is
                    scanned for prompt injection, and outbound email is gated by
                    policy and human approval.
                  </p>
                ) : (
                  <div className="mt-4 space-y-3 text-sm">
                    {securityEvents.map((event) => (
                      <div
                        key={event.id}
                        className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-slate-200">
                            {CONTROL_LABELS[event.control]}
                          </span>
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${VERDICT_STYLES[event.verdict]}`}
                          >
                            {event.verdict}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500 break-words">
                          {event.subject}
                        </p>
                        <p className="mt-2 text-xs text-slate-300 break-words">
                          {event.detail}
                        </p>
                        {event.evidence && event.evidence.length > 0 &&
                        event.verdict !== "awaiting-approval" ? (
                          <ul className="mt-2 space-y-1">
                            {event.evidence.map((item) => (
                              <li
                                key={item}
                                className="rounded-lg bg-rose-500/10 px-2 py-1 font-mono text-[11px] text-rose-200 break-words"
                              >
                                {item}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                  Output summary
                </p>
                {result?.mode === "simple" ? (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-300 whitespace-pre-wrap">
                    {result.text || "No response available."}
                  </div>
                ) : result?.summary ? (
                  <div className="mt-4 grid gap-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                          Total leads
                        </p>
                        <p className="mt-2 text-2xl font-semibold text-white">
                          {result.summary.totalFound}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                          Hot leads
                        </p>
                        <p className="mt-2 text-2xl font-semibold text-emerald-200">
                          {result.summary.hotLeads}
                        </p>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-300">
                      <p>
                        CSV Export: {result.csvExport?.message ?? "Not available"}
                        {typeof result.csvExport?.rowCount === "number"
                          ? ` (${result.csvExport.rowCount} rows)`
                          : ""}
                      </p>
                      <p className="mt-2">Email: {result.emailResult?.message ?? "Not available"}</p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-slate-400">
                    Generate leads to see results, scoring, and export status.
                  </p>
                )}
              </div>
              {result?.mode !== "simple" && result?.processedLeads ? (
                <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                    Top leads
                  </p>
                  <div className="mt-4 space-y-4">
                    {result.processedLeads.map((lead) => (
                      <div
                        key={lead.domain}
                        className="rounded-2xl border border-white/10 bg-slate-950/60 p-4"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-white">
                              {lead.companyName}
                            </p>
                            <p className="text-xs text-slate-400">
                              {lead.domain} · {lead.industry}
                            </p>
                          </div>
                          <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-200">
                            {lead.qualification} · {lead.overallScore}
                          </span>
                        </div>
                        <p className="mt-3 text-xs text-slate-300">
                          {lead.recommendation}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>

      </main>

      <footer className="border-t border-white/5 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-6 text-xs text-slate-500">
          <p>© 2026 Marketing Agency Demo. All rights reserved.</p>
          <p>Powered by Mastra multi-agent workflows.</p>
        </div>
      </footer>
    </div>
  );
}
