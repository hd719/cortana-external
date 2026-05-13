"use client";

import { useState } from "react";
import { Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Candidate = {
  symbol: string;
  rank: number;
  score: number;
  review_label: string;
  reasons: string[];
  blockers: string[];
  missing_context: string[];
  score_components: Record<string, number>;
};

type Board = {
  board_id: string;
  watchlist: string;
  generated_at: string;
  candidates: Candidate[];
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

export function WatchlistsTab() {
  const [watchlist, setWatchlist] = useState("core");
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    setRunStatus(null);
    try {
      const next = await api<Board>("/api/market-lab/opportunities", {
        method: "POST",
        body: JSON.stringify({ watchlist }),
      });
      setBoard(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to score watchlist");
    } finally {
      setLoading(false);
    }
  };

  const runReview = async (symbol: string) => {
    setLoading(true);
    setError(null);
    setRunStatus(null);
    try {
      const result = await api<{ run_id: string }>("/api/market-lab/runs", {
        method: "POST",
        body: JSON.stringify({ symbol }),
      });
      setRunStatus(`Started Market Lab review for ${symbol}: ${result.run_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start review");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-lg border border-border/70 bg-card/60">
      <header className="flex flex-col gap-3 border-b border-border/50 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Market Lab</div>
          <h2 className="text-sm font-semibold">Watchlists / Opportunity Board</h2>
          <p className="mt-1 font-sans text-xs text-muted-foreground">
            Deterministic review priority. No Codex fanout, no buy/sell signal.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={watchlist}
            onChange={(event) => setWatchlist(event.target.value)}
            className="h-8 rounded-md border border-border/70 bg-background px-2 font-mono text-xs uppercase"
          >
            <option value="core">Core</option>
            <option value="benchmarks">Benchmarks</option>
          </select>
          <Button onClick={generate} disabled={loading} size="sm" className="h-8 gap-1.5 font-mono text-xs uppercase">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Score
          </Button>
        </div>
      </header>
      <div className="space-y-3 p-4">
        {error ? <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}
        {runStatus ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{runStatus}</div> : null}
        {!board ? (
          <p className="font-sans text-sm text-muted-foreground">Score a watchlist to rank symbols for review.</p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
              <span>{board.board_id}</span>
              <span>{board.candidates.length} candidates</span>
            </div>
            <div className="grid gap-2 xl:grid-cols-2">
              {board.candidates.map((candidate) => (
                <article key={candidate.symbol} className="rounded-lg border border-border/70 bg-background/50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">#{candidate.rank}</span>
                        <h3 className="text-lg font-bold">{candidate.symbol}</h3>
                        <span className="rounded border border-border/70 px-1.5 py-px text-[10px] uppercase tracking-wider">
                          {candidate.review_label}
                        </span>
                      </div>
                      <div className="mt-1 text-sm font-semibold">{candidate.score.toFixed(1)}</div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={loading || candidate.blockers.length > 0}
                      onClick={() => runReview(candidate.symbol)}
                      className="h-7 gap-1.5 font-mono text-[11px] uppercase"
                    >
                      <Play className="h-3 w-3" />
                      Run Review
                    </Button>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <InfoList title="Reasons" items={candidate.reasons} />
                    <InfoList title="Missing / blockers" items={[...candidate.blockers, ...candidate.missing_context]} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {Object.entries(candidate.score_components).map(([key, value]) => (
                      <span key={key} className="rounded border border-border/60 px-1.5 py-px text-[10px] text-muted-foreground">
                        {key}: {value}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function InfoList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{title}</div>
      {items.length ? (
        <ul className="mt-1 space-y-0.5 font-sans text-xs text-muted-foreground">
          {items.map((item) => (
            <li key={item}>· {item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 font-sans text-xs text-muted-foreground">None.</p>
      )}
    </div>
  );
}
