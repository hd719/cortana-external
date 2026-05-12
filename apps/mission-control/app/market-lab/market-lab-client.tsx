"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, FlaskConical, MessageSquareText, Play, RefreshCw, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type RunSummary = {
  run_id: string;
  symbol: string;
  requested_at: string;
  status: string;
  trust_verdict?: "trusted" | "uncertain" | "blocked" | null;
  verdict_reasons: string[];
};

type RunDetail = {
  run: RunSummary;
  review: {
    trust_verdict: "trusted" | "uncertain" | "blocked";
    verdict_reasons: string[];
    interpretation?: { summary?: string; bullish_points?: string[]; bearish_points?: string[] };
    price_facts?: { price?: number; timestamp?: string; source?: string; price_basis?: string } | null;
    spy_facts?: { price?: number; timestamp?: string; source?: string; price_basis?: string } | null;
    tradingagents?: { status?: string; summary?: string };
    codex_review?: { status?: string; summary?: string; output_path?: string | null; session_id?: string | null } | null;
    artifact_paths?: {
      review?: string;
      events?: string;
      logs?: string;
      tradingagents?: string | null;
      codex_packet?: string | null;
      codex_review?: string | null;
    };
    checks?: Array<{ code?: string; severity?: string; message?: string }>;
    settlements?: Array<Record<string, unknown>>;
  } | null;
  settlements: Array<Record<string, unknown>>;
};

const badgeClass = (verdict?: string | null) =>
  cn(
    "uppercase tracking-wide",
    verdict === "trusted" && "border-emerald-300 bg-emerald-50 text-emerald-700",
    verdict === "uncertain" && "border-amber-300 bg-amber-50 text-amber-700",
    verdict === "blocked" && "border-red-300 bg-red-50 text-red-700",
  );

const asMoney = (value?: number) =>
  typeof value === "number" ? `$${value.toFixed(2)}` : "n/a";

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

export function MarketLabClient() {
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

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 md:px-6">
      <section className="flex flex-col gap-3 border-b pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FlaskConical className="h-4 w-4" />
            <span>Market Lab</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-normal">Forward-looking trust reviews</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={symbol}
            onChange={(event) => setSymbol(event.target.value.toUpperCase())}
            className="h-9 w-32 rounded-md border bg-background px-3 text-sm font-medium"
            aria-label="Symbol"
          />
          <Button onClick={startRun} disabled={loading}>
            <Play className="h-4 w-4" />
            Run
          </Button>
          <Button variant="outline" onClick={() => loadRuns()} disabled={loading}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </section>

      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      {codexStatus ? <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-700">{codexStatus}</div> : null}

      <section className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="text-base">Recent runs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {runs.length === 0 ? <p className="text-sm text-muted-foreground">No Market Lab runs yet.</p> : null}
            {runs.map((run) => (
              <button
                key={run.run_id}
                type="button"
                onClick={() => setSelectedRunId(run.run_id)}
                className={cn(
                  "w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted",
                  selectedRunId === run.run_id && "border-primary bg-primary/5",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{run.symbol}</span>
                  <Badge variant="outline" className={badgeClass(run.trust_verdict)}>
                    {run.trust_verdict ?? run.status}
                  </Badge>
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">{run.run_id}</div>
              </button>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="rounded-lg">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">{selectedRun?.symbol ?? "No run selected"}</CardTitle>
                <div className="flex items-center gap-2">
                  {review ? (
                    <Badge variant="outline" className={badgeClass(review.trust_verdict)}>
                      {review.trust_verdict}
                    </Badge>
                  ) : null}
                  <Button variant="outline" size="sm" onClick={settleRun} disabled={!selectedRunId || loading}>
                    Settle
                  </Button>
                  <Button variant="outline" size="sm" onClick={askCodex} disabled={!selectedRunId || loading}>
                    <MessageSquareText className="h-4 w-4" />
                    Ask Codex
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <div>
                <div className="text-xs uppercase text-muted-foreground">Verdict Summary</div>
                <p className="mt-1 text-sm">{review?.interpretation?.summary ?? "Select or run a review."}</p>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">{selectedRun?.symbol ?? "Symbol"} Facts</div>
                <p className="mt-1 text-sm font-medium">{asMoney(review?.price_facts?.price)}</p>
                <p className="text-xs text-muted-foreground">{review?.price_facts?.source ?? "n/a"} · {review?.price_facts?.price_basis ?? "n/a"}</p>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">SPY Reference</div>
                <p className="mt-1 text-sm font-medium">{asMoney(review?.spy_facts?.price)}</p>
                <p className="text-xs text-muted-foreground">{review?.spy_facts?.source ?? "n/a"}</p>
              </div>
            </CardContent>
          </Card>

          <section className="grid gap-4 xl:grid-cols-2">
            <Card className="rounded-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="h-4 w-4" />
                  Timeline
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {events.length === 0 ? <p className="text-sm text-muted-foreground">No events loaded.</p> : null}
                {events.map((event, index) => (
                  <div key={`${event.event}-${index}`} className="rounded-md border px-3 py-2 text-sm">
                    <div className="font-medium">{String(event.event ?? "event")}</div>
                    <div className="text-muted-foreground">{String(event.message ?? "")}</div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="rounded-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Terminal className="h-4 w-4" />
                  Checks and settlement
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {review?.tradingagents ? (
                  <div className="rounded-md border px-3 py-2 text-sm">
                    <div className="text-xs uppercase text-muted-foreground">TradingAgents</div>
                    <div className="font-medium">{review.tradingagents.status}</div>
                    <div className="text-muted-foreground">{review.tradingagents.summary}</div>
                  </div>
                ) : null}
                {review?.codex_review ? (
                  <div className="rounded-md border px-3 py-2 text-sm">
                    <div className="text-xs uppercase text-muted-foreground">Codex Review</div>
                    <div className="font-medium">{review.codex_review.status}</div>
                    <div className="text-muted-foreground">{review.codex_review.summary}</div>
                    {review.codex_review.session_id ? (
                      <div className="mt-1 text-xs text-muted-foreground">session: {review.codex_review.session_id}</div>
                    ) : null}
                  </div>
                ) : null}
                <div className="space-y-2">
                  {(review?.checks ?? []).map((check) => (
                    <div key={check.code} className="rounded-md border px-3 py-2 text-sm">
                      <span className="font-medium">{check.code}</span>
                      <span className="ml-2 text-muted-foreground">{check.message}</span>
                    </div>
                  ))}
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(review?.settlements ?? detail?.settlements ?? []).map((settlement) => (
                    <div key={String(settlement.window)} className="rounded-md border px-3 py-2 text-sm">
                      <div className="font-medium">{String(settlement.window).toUpperCase()}</div>
                      <div className="text-muted-foreground">{String(settlement.status)}</div>
                      {settlement.alpha_vs_spy_pct != null ? (
                        <div>{Number(settlement.alpha_vs_spy_pct).toFixed(2)}% alpha</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>

          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="text-base">Artifact paths</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
              <div className="truncate">review: {review?.artifact_paths?.review ?? selectedRun?.run_id ?? "n/a"}</div>
              <div className="truncate">events: {review?.artifact_paths?.events ?? "n/a"}</div>
              <div className="truncate">logs: {review?.artifact_paths?.logs ?? "n/a"}</div>
              <div className="truncate">tradingagents: {review?.artifact_paths?.tradingagents ?? "n/a"}</div>
              <div className="truncate">codex packet: {review?.artifact_paths?.codex_packet ?? "n/a"}</div>
              <div className="truncate">codex review: {review?.artifact_paths?.codex_review ?? "n/a"}</div>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
