"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatRelativeAge } from "@/lib/format-utils";
import type { MarketLabPortfolioContext } from "@/lib/market-lab";
import { cn } from "@/lib/utils";

type PortfolioResponse = { status: string; data: MarketLabPortfolioContext; error?: string };

const fetchPortfolio = async (refresh = false) => {
  const response = await fetch(refresh ? "/api/market-lab/portfolio/refresh" : "/api/market-lab/portfolio/latest", {
    method: refresh ? "POST" : "GET",
    headers: { "content-type": "application/json" },
  });
  const body = (await response.json()) as PortfolioResponse;
  if (!response.ok || body.status === "error") {
    throw new Error(body.error ?? "Failed to load Schwab portfolio");
  }
  return body.data;
};

const sum = <T,>(items: T[], read: (item: T) => number | null | undefined) =>
  items.reduce((total, item) => total + (read(item) ?? 0), 0);

const formatShares = (value: number | null | undefined) =>
  typeof value === "number" ? value.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—";

const formatPct = (value: number | null | undefined) =>
  typeof value === "number" ? `${value.toFixed(1)}%` : "—";

const formatSignedMoney = (value: number | null | undefined) => {
  if (typeof value !== "number") return "—";
  return `${value >= 0 ? "+" : "-"}${formatCurrency(Math.abs(value))}`;
};

export function PortfolioTab() {
  const [portfolio, setPortfolio] = useState<MarketLabPortfolioContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      setPortfolio(await fetchPortfolio(refresh));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Schwab portfolio");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(false);
  }, []);

  const accounts = portfolio?.accounts ?? [];
  const positions = portfolio?.positions ?? [];
  const totals = useMemo(() => {
    const sorted = [...positions].sort((a, b) => (b.market_value ?? 0) - (a.market_value ?? 0));
    return {
      liquidation: sum(accounts, (account) => account.liquidation_value),
      cash: sum(accounts, (account) => account.cash_value),
      topPositions: sorted.slice(0, 5),
    };
  }, [accounts, positions]);
  const unavailable = portfolio && portfolio.status !== "available";

  return (
    <div className="space-y-3 font-mono">
      <section className="rounded-lg border border-border/70 bg-card/80">
        <div className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Read-only Schwab</div>
            <h2 className="mt-0.5 text-lg font-bold tracking-tight">Portfolio</h2>
            <p className="mt-1 max-w-3xl font-sans text-sm text-muted-foreground">
              Current Schwab holdings used as context for Market Lab reviews. This tab reads positions only.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {portfolio ? (
              <span
                className={cn(
                  "rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-widest",
                  portfolio.status === "available"
                    ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "border-amber-400/60 bg-amber-500/10 text-amber-700 dark:text-amber-300",
                )}
              >
                {portfolio.status}
              </span>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load(true)}
              disabled={loading}
              className="h-8 gap-1.5 px-3 font-mono text-xs uppercase tracking-wider"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              Refresh Schwab
            </Button>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      ) : null}

      {unavailable ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          {portfolio.message ?? "Schwab portfolio is not available yet."}
        </div>
      ) : null}

      <section className="grid gap-3 lg:grid-cols-4">
        <PortfolioMetric label="Accounts" value={String(accounts.length)} />
        <PortfolioMetric label="Positions" value={String(positions.length)} />
        <PortfolioMetric label="Liquidation" value={formatCurrency(totals.liquidation)} />
        <PortfolioMetric label="Cash" value={formatCurrency(totals.cash)} />
      </section>

      <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="overflow-hidden rounded-lg border border-border/70 bg-card/60">
          <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Holdings</div>
              <h3 className="text-sm font-semibold">Positions</h3>
            </div>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {portfolio?.generated_at ? formatRelativeAge(portfolio.generated_at) : "not loaded"}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="border-b border-border/50 text-[10px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Symbol</th>
                  <th className="px-4 py-2 text-right">Qty</th>
                  <th className="px-4 py-2 text-right">Avg cost</th>
                  <th className="px-4 py-2 text-right">Current</th>
                  <th className="px-4 py-2 text-right">Market value</th>
                  <th className="px-4 py-2 text-right">P/L</th>
                  <th className="px-4 py-2 text-right">Weight</th>
                </tr>
              </thead>
              <tbody>
                {positions.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-muted-foreground" colSpan={7}>
                      No positions loaded.
                    </td>
                  </tr>
                ) : (
                  positions.map((position) => (
                    <tr key={`${position.account_hash ?? "acct"}-${position.symbol}`} className="border-b border-border/40 last:border-0">
                      <td className="px-4 py-2 font-semibold">{position.symbol}</td>
                      <td className="px-4 py-2 text-right text-muted-foreground">{formatShares(position.quantity)}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(position.average_price)}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(position.current_price)}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(position.market_value)}</td>
                      <td className={cn("px-4 py-2 text-right", (position.unrealized_pnl ?? 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
                        {formatSignedMoney(position.unrealized_pnl)}
                      </td>
                      <td className="px-4 py-2 text-right text-muted-foreground">{formatPct(position.weight_pct)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-lg border border-border/70 bg-card/60">
            <div className="border-b border-border/50 px-4 py-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Concentration</div>
              <h3 className="text-sm font-semibold">Largest holdings</h3>
            </div>
            <div className="space-y-2 px-4 py-3">
              {totals.topPositions.length === 0 ? (
                <p className="text-xs text-muted-foreground">No holdings loaded.</p>
              ) : (
                totals.topPositions.map((position) => (
                  <div key={`top-${position.symbol}`} className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-2">
                    <span className="text-xs font-semibold">{position.symbol}</span>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-foreground/70" style={{ width: `${Math.min(100, position.weight_pct ?? 0)}%` }} />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{formatPct(position.weight_pct)}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border/70 bg-card/60 px-4 py-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Source</div>
            <div className="mt-1 text-sm font-semibold">{portfolio?.source ?? "schwab"}</div>
            <p className="mt-1 font-sans text-xs text-muted-foreground">
              {portfolio?.generated_at ? `Updated ${formatRelativeAge(portfolio.generated_at)}.` : "No cached Schwab snapshot loaded yet."}
            </p>
            {(portfolio?.exposure_notes ?? []).slice(0, 3).map((note) => (
              <p key={note} className="mt-2 font-sans text-xs text-muted-foreground">{note}</p>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function PortfolioMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/60 px-4 py-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-bold tracking-tight">{value}</div>
    </div>
  );
}
