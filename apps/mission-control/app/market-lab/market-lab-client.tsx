"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Beaker,
  CheckCircle2,
  Clock3,
  FileJson2,
  MessageSquareText,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RunSummary = {
  run_id: string;
  symbol: string;
  requested_at: string;
  status: string;
  trust_verdict?: "trusted" | "uncertain" | "blocked" | null;
  verdict_reasons: string[];
};

type Settlement = Record<string, unknown> & {
  window?: string;
  status?: string;
  alpha_vs_spy_pct?: number;
  return_pct?: number;
};

type RunDetail = {
  run: RunSummary;
  review: {
    trust_verdict: "trusted" | "uncertain" | "blocked";
    verdict_reasons: string[];
    interpretation?: { summary?: string; bullish_points?: string[]; bearish_points?: string[] };
    price_facts?: { price?: number; timestamp?: string; source?: string; price_basis?: string } | null;
    spy_facts?: { price?: number; timestamp?: string; source?: string; price_basis?: string } | null;
    codex_review?: {
      status?: string;
      summary?: string;
      verdict?: "trusted" | "uncertain" | "blocked" | null;
      output_path?: string | null;
      session_id?: string | null;
    } | null;
    artifact_paths?: {
      review?: string;
      events?: string;
      logs?: string;
      codex_packet?: string | null;
      codex_review?: string | null;
    };
    checks?: Array<{ code?: string; severity?: string; message?: string }>;
    settlements?: Settlement[];
  } | null;
  settlements: Settlement[];
};

const verdictMeta = {
  trusted: {
    label: "Trusted",
    icon: ShieldCheck,
    badge: "border-emerald-300 bg-emerald-50 text-emerald-700",
    rail: "border-l-emerald-500 bg-emerald-50/50",
    accent: "text-emerald-700",
    halo: "ring-emerald-500/20",
  },
  uncertain: {
    label: "Uncertain",
    icon: ShieldQuestion,
    badge: "border-amber-300 bg-amber-50 text-amber-700",
    rail: "border-l-amber-500 bg-amber-50/50",
    accent: "text-amber-700",
    halo: "ring-amber-500/20",
  },
  blocked: {
    label: "Blocked",
    icon: ShieldAlert,
    badge: "border-red-300 bg-red-50 text-red-700",
    rail: "border-l-red-500 bg-red-50/50",
    accent: "text-red-700",
    halo: "ring-red-500/20",
  },
} as const;

const asMoney = (value?: number) =>
  typeof value === "number" ? `$${value.toFixed(2)}` : "n/a";

const formatRunTime = (iso?: string) => {
  if (!iso) return "unknown";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const getAge = (iso?: string) => {
  if (!iso) return "unknown age";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown age";
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / (24 * 60))}d ago`;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json();
  if (!response.ok || body.status === "error") {
    throw new Error(body.error ?? "Market Lab request failed");
  }
  return body.data as T;
}

type MarketLabClientProps = {
  embedded?: boolean;
};

export function MarketLabClient({ embedded = false }: MarketLabClientProps = {}) {
  const [symbol, setSymbol] = useState("AAPL");
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codexStatus, setCodexStatus] = useState<string | null>(null);

  const selectedRun = useMemo(
    () => runs.find((run) => run.run_id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );

  const loadRuns = async () => {
    const data = await api<{ runs: RunSummary[] }>("/api/market-lab/runs?limit=25");
    setRuns(data.runs);
    setSelectedRunId((current) => current ?? data.runs[0]?.run_id ?? null);
  };

  const loadRunDetail = async (runId: string) => {
    const [runDetail, eventItems] = await Promise.all([
      api<RunDetail>(`/api/market-lab/runs/${encodeURIComponent(runId)}`),
      api<Array<Record<string, unknown>>>(`/api/market-lab/runs/${encodeURIComponent(runId)}/events`),
    ]);
    setDetail(runDetail);
    setEvents(eventItems);
  };

  useEffect(() => {
    loadRuns().catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!selectedRunId) return;
    loadRunDetail(selectedRunId).catch((err: Error) => setError(err.message));
  }, [selectedRunId]);

  const startRun = async () => {
    setLoading(true);
    setError(null);
    setCodexStatus(null);
    try {
      const result = await api<{ run_id: string }>("/api/market-lab/runs", {
        method: "POST",
        body: JSON.stringify({ symbol }),
      });
      await loadRuns();
      setSelectedRunId(result.run_id);
      await loadRunDetail(result.run_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start run");
    } finally {
      setLoading(false);
    }
  };

  const settleRun = async () => {
    if (!selectedRunId) return;
    setLoading(true);
    setError(null);
    try {
      await api(`/api/market-lab/runs/${encodeURIComponent(selectedRunId)}/settle`, { method: "POST" });
      await loadRunDetail(selectedRunId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to settle run");
    } finally {
      setLoading(false);
    }
  };

  const askCodex = async () => {
    if (!selectedRunId) return;
    setLoading(true);
    setError(null);
    setCodexStatus(null);
    try {
      const result = await api<{ streamId: string; packet_path: string }>(
        `/api/market-lab/runs/${encodeURIComponent(selectedRunId)}/codex-review`,
        { method: "POST" },
      );
      setCodexStatus(`Codex review started: ${result.streamId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start Codex review");
    } finally {
      setLoading(false);
    }
  };

  const review = detail?.review;
  const verdict = review?.trust_verdict ?? selectedRun?.trust_verdict ?? "uncertain";
  const meta = verdictMeta[verdict];
  const VerdictIcon = meta.icon;
  const selectedSymbol = selectedRun?.symbol ?? symbol;
  const checks = review?.checks ?? [];
  const settlements = review?.settlements?.length ? review.settlements : detail?.settlements ?? [];
  const settlementWindows = ["1d", "5d", "20d"].map((window) => {
    const found = settlements.find((settlement) => String(settlement.window).toLowerCase() === window);
    return found ?? { window, status: "pending" };
  });

  return (
    <div className={cn("market-lab-surface w-full", embedded ? "" : "mx-auto max-w-[1500px] px-4 py-6 md:px-6")}>
      <section className="mb-5 flex flex-col gap-4 border-b border-neutral-200/80 pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-neutral-500">
            <Beaker className="h-4 w-4" />
            Market Lab
          </div>
          <h1 className={cn("font-semibold tracking-normal text-neutral-950", embedded ? "text-xl" : "text-3xl")}>
            Forward-looking trust reviews
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="market-lab-symbol">
            Symbol
          </label>
          <input
            id="market-lab-symbol"
            value={symbol}
            onChange={(event) => setSymbol(event.target.value.toUpperCase())}
            className="h-10 w-32 rounded-md border border-neutral-200 bg-white px-3 text-sm font-semibold text-neutral-950 shadow-sm outline-none transition focus:border-neutral-950 focus:ring-2 focus:ring-neutral-950/10"
            aria-label="Symbol"
          />
          <Button onClick={startRun} disabled={loading} className="h-10 gap-2 rounded-md bg-neutral-950 text-white hover:bg-neutral-800">
            <Play className="h-4 w-4" />
            Run
          </Button>
          <Button variant="outline" onClick={() => loadRuns()} disabled={loading} className="h-10 gap-2 rounded-md">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </section>

      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}
      {codexStatus ? (
        <div className="mb-4 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-700">{codexStatus}</div>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="flex max-h-[520px] flex-col self-start rounded-lg border border-neutral-200 bg-white shadow-sm xl:sticky xl:top-3 xl:max-h-[calc(100svh-120px)]">
          <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-neutral-950">Run tape</h2>
              <p className="text-xs text-neutral-500">{runs.length} recent reviews</p>
            </div>
            <Clock3 className="h-4 w-4 text-neutral-400" />
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {runs.length === 0 ? <p className="px-2 py-6 text-sm text-neutral-500">No Market Lab runs yet.</p> : null}
            {runs.map((run) => {
              const runVerdict = run.trust_verdict ?? "uncertain";
              const runMeta = verdictMeta[runVerdict];
              return (
                <button
                  key={run.run_id}
                  type="button"
                  onClick={() => setSelectedRunId(run.run_id)}
                  className={cn(
                    "group w-full rounded-md border border-transparent border-l-4 px-3 py-2.5 text-left transition hover:border-neutral-200 hover:bg-neutral-50",
                    runMeta.rail,
                    selectedRunId === run.run_id && "border-neutral-300 bg-white shadow-sm ring-1 ring-neutral-950/10",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-neutral-950">{run.symbol}</span>
                    <Badge variant="outline" className={cn("rounded-full text-[10px] uppercase tracking-wide", runMeta.badge)}>
                      {run.trust_verdict ?? run.status}
                    </Badge>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-xs text-neutral-500">
                    <span className="truncate">{run.run_id}</span>
                    <span className="shrink-0">{getAge(run.requested_at)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="min-w-0 space-y-5">
          <section className={cn("rounded-lg border border-neutral-200 bg-white p-5 shadow-sm ring-4", meta.halo)}>
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <div className={cn("flex items-center gap-2 text-sm font-semibold", meta.accent)}>
                    <VerdictIcon className="h-5 w-5" />
                    <span>{meta.label}</span>
                  </div>
                  <span className="text-xs uppercase tracking-[0.18em] text-neutral-400">{formatRunTime(selectedRun?.requested_at)}</span>
                </div>
                <h2 className="mt-3 text-4xl font-semibold tracking-normal text-neutral-950 md:text-6xl">{selectedSymbol}</h2>
                <p className="mt-3 max-w-2xl text-base leading-7 text-neutral-700">
                  {review?.interpretation?.summary ?? "Select or run a review to see the trust decision."}
                </p>
              </div>
              <div className="grid min-w-[260px] grid-cols-2 gap-3">
                <Metric label={`${selectedSymbol} price`} value={asMoney(review?.price_facts?.price)} detail={`${review?.price_facts?.source ?? "n/a"} · ${review?.price_facts?.price_basis ?? "n/a"}`} />
                <Metric label="SPY reference" value={asMoney(review?.spy_facts?.price)} detail={review?.spy_facts?.source ?? "n/a"} />
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={cn("rounded-full px-3 py-1 text-xs uppercase tracking-wide", meta.badge)}>
                {verdict}
              </Badge>
              <Button variant="outline" size="sm" onClick={settleRun} disabled={!selectedRunId || loading} className="rounded-md">
                Settle
              </Button>
              <Button variant="outline" size="sm" onClick={askCodex} disabled={!selectedRunId || loading} className="gap-2 rounded-md">
                <MessageSquareText className="h-4 w-4" />
                Ask Codex
              </Button>
            </div>
          </section>

          <section className="grid gap-5 2xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
            <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
              <SectionTitle icon={CheckCircle2} title="Evidence board" eyebrow="Trust inputs" />
              <div className="mt-5 grid gap-2">
                {checks.length === 0 ? (
                  <EvidenceRow code="checks_pending" message="No checks loaded for this run yet." severity="info" />
                ) : (
                  checks.map((check) => (
                    <EvidenceRow key={check.code} code={check.code ?? "check"} message={check.message ?? ""} severity={check.severity} />
                  ))
                )}
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <InsightList title="Bullish points" items={review?.interpretation?.bullish_points ?? []} empty="No bullish points captured." />
                <InsightList title="Bearish points" items={review?.interpretation?.bearish_points ?? []} empty="No bearish points captured." />
              </div>
            </div>

            <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
              <SectionTitle icon={MessageSquareText} title="Codex review" eyebrow="Second opinion" />
              <div className="mt-5 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-500">Status</div>
                <div className="mt-1 text-sm font-semibold text-neutral-950">
                  {review?.codex_review?.verdict ?? review?.codex_review?.status ?? "not requested"}
                </div>
                <p className="mt-2 text-sm leading-6 text-neutral-600">
                  {review?.codex_review?.summary ?? "Use Ask Codex when this run needs an operator-readable critique."}
                </p>
                {review?.codex_review?.session_id ? (
                  <div className="mt-3 truncate text-xs text-neutral-500">session: {review.codex_review.session_id}</div>
                ) : null}
              </div>
            </div>
          </section>

          <section className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_420px]">
            <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
              <SectionTitle icon={Activity} title="Timeline" eyebrow="Run path" />
              <div className="mt-5 grid gap-2">
                {events.length === 0 ? <p className="text-sm text-neutral-500">No events loaded.</p> : null}
                {events.map((event, index) => (
                  <div key={`${event.event}-${index}`} className="grid grid-cols-[24px_1fr] gap-3 rounded-md border border-neutral-200 px-3 py-2.5">
                    <div className="mt-1 h-2 w-2 rounded-full bg-neutral-950" />
                    <div>
                      <div className="text-sm font-semibold text-neutral-950">{String(event.event ?? "event")}</div>
                      <div className="text-sm text-neutral-500">{String(event.message ?? "")}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
              <SectionTitle icon={ArrowUpRight} title="Settlement" eyebrow="Forward score" />
              <div className="mt-5 grid gap-3">
                {settlementWindows.map((settlement) => (
                  <div key={String(settlement.window)} className="rounded-md border border-neutral-200 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-lg font-semibold uppercase text-neutral-950">{String(settlement.window)}</div>
                      <div className="text-sm text-neutral-500">{String(settlement.status ?? "pending")}</div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-neutral-500">
                      <div>Return: {settlement.return_pct != null ? `${Number(settlement.return_pct).toFixed(2)}%` : "pending"}</div>
                      <div>vs SPY: {settlement.alpha_vs_spy_pct != null ? `${Number(settlement.alpha_vs_spy_pct).toFixed(2)}%` : "pending"}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <details className="group rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
              <SectionTitle icon={FileJson2} title="Debug artifacts" eyebrow="Collapsed by default" />
              <span className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400 group-open:hidden">Open</span>
              <span className="hidden text-xs font-medium uppercase tracking-[0.18em] text-neutral-400 group-open:inline">Close</span>
            </summary>
            <div className="mt-5 grid gap-2 text-xs text-neutral-500 md:grid-cols-2">
              <DebugPath label="review" value={review?.artifact_paths?.review ?? selectedRun?.run_id ?? "n/a"} />
              <DebugPath label="events" value={review?.artifact_paths?.events ?? "n/a"} />
              <DebugPath label="logs" value={review?.artifact_paths?.logs ?? "n/a"} />
              <DebugPath label="codex packet" value={review?.artifact_paths?.codex_packet ?? "n/a"} />
              <DebugPath label="codex review" value={review?.artifact_paths?.codex_review ?? "n/a"} />
            </div>
          </details>
        </div>
      </section>
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  title,
  eyebrow,
}: {
  icon: LucideIcon;
  title: string;
  eyebrow: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50">
        <Icon className="h-4 w-4 text-neutral-700" />
      </div>
      <div>
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-500">{eyebrow}</div>
        <h3 className="text-base font-semibold text-neutral-950">{title}</h3>
      </div>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-[0.16em] text-neutral-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-neutral-950">{value}</div>
      <div className="mt-0.5 truncate text-xs text-neutral-500">{detail}</div>
    </div>
  );
}

function EvidenceRow({ code, message, severity }: { code: string; message: string; severity?: string }) {
  const isBlocker = severity === "blocker" || code.includes("stale") || code.includes("missing");
  return (
    <div className="grid gap-2 rounded-md border border-neutral-200 px-4 py-3 sm:grid-cols-[180px_1fr_auto] sm:items-center">
      <div className="font-mono text-sm font-semibold text-neutral-950">{code}</div>
      <div className="text-sm text-neutral-600">{message}</div>
      <Badge
        variant="outline"
        className={cn(
          "w-fit rounded-full text-[10px] uppercase tracking-wide",
          isBlocker ? "border-amber-300 bg-amber-50 text-amber-700" : "border-emerald-300 bg-emerald-50 text-emerald-700",
        )}
      >
        {severity ?? "info"}
      </Badge>
    </div>
  );
}

function InsightList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-[0.16em] text-neutral-500">{title}</div>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm text-neutral-700">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DebugPath({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="truncate rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
      {label}: {value ?? "n/a"}
    </div>
  );
}
