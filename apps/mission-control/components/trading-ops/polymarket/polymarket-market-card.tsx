"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  PolymarketResultRow,
  TradingOpsPolymarketLiveData,
} from "@/lib/trading-ops-contract";
import { formatOperatorTimestamp } from "@/lib/format-utils";
import {
  formatDetailedMoney,
  formatMarketPrice,
  formatMarketQuantity,
  formatSignedDetailedMoney,
  formatLabel,
  signedValueTextClass,
} from "@/lib/trading-ops/format";
import {
  derivePinnedCurrentValue,
  newestTimestamp,
} from "@/lib/trading-ops/polymarket-helpers";
import { useAnimatedValue, useFlashClass } from "../animated-quote";
import { usePolymarketFlashClass } from "./use-polymarket-flash-class";

type MarketRow = TradingOpsPolymarketLiveData["markets"][number];

export type PolymarketMarketCardOptions = {
  pending: boolean;
  result: PolymarketResultRow | null;
  rosterNew?: boolean;
  onToggle: () => void;
};

export function renderPolymarketMarketCard(
  market: MarketRow,
  options: PolymarketMarketCardOptions,
) {
  return <PolymarketMarketCard key={market.slug} market={market} options={options} />;
}

export function PolymarketMarketCard({
  market,
  options,
}: {
  market: MarketRow;
  options: PolymarketMarketCardOptions;
}) {
  const subtitle =
    market.bucket === "sports"
      ? [
          market.eventTitle && market.eventTitle !== market.title ? market.eventTitle : null,
          market.league ? formatLabel(market.league) : null,
        ].filter(Boolean).join(" · ") || "Sports market"
      : market.eventTitle ?? "Polymarket event";
  const currentValue = derivePinnedCurrentValue(market, options.result);
  const unrealizedPnl =
    currentValue != null && options.result?.costBasis != null
      ? Number((currentValue - options.result.costBasis).toFixed(4))
      : options.result?.unrealizedPnl ?? null;
  const hasLiveEconomics = (options.result?.netPosition ?? 0) > 0;
  const flash = usePolymarketFlashClass({
    bid: market.bestBid,
    ask: market.bestAsk,
    last: market.lastTrade,
    spread: market.spread,
  });
  const animatedBid = useAnimatedValue(market.bestBid, 700);
  const animatedAsk = useAnimatedValue(market.bestAsk, 700);
  const animatedLast = useAnimatedValue(market.lastTrade, 700);
  const animatedSpread = useAnimatedValue(market.spread, 700);
  const animatedCurrentValue = useAnimatedValue(currentValue, 700);
  const animatedUnrealizedPnl = useAnimatedValue(unrealizedPnl, 700);
  const animatedCostBasis = useAnimatedValue(options.result?.costBasis ?? null, 700);
  const animatedPosition = useAnimatedValue(options.result?.netPosition ?? null, 700);
  const freshestTimestamp = newestTimestamp([market.updatedAt, market.tradeTime]);

  return (
    <div
      className={cn(
        "rounded-md border border-border/50 bg-muted/20 px-3 py-3 text-xs transition-[background-color,border-color,box-shadow,transform] duration-1000",
        options.rosterNew && "border-amber-300/60 bg-amber-50/50 shadow-[0_0_0_1px_rgba(245,158,11,0.22)] motion-safe:animate-[pulse_1.1s_ease-out_1]",
        flash,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{market.title}</p>
          <p className="text-muted-foreground">{subtitle}</p>
          <p className="font-mono text-muted-foreground">{market.slug}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {options.rosterNew ? (
            <Badge variant="outline" className="border-amber-300/70 bg-amber-100/80 text-[10px] text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/15 dark:text-amber-200">
              NEW
            </Badge>
          ) : null}
          <Badge variant={market.state === "ok" ? "success" : market.state === "degraded" ? "warning" : "outline"} className="text-[10px]">
            {market.state === "ok" ? "live" : market.state}
          </Badge>
          {market.marketState ? (
            <Badge variant="outline" className="text-[10px]">
              {formatLabel(market.marketState)}
            </Badge>
          ) : null}
          <Button
            type="button"
            size="xs"
            variant={market.pinned ? "destructive" : "outline"}
            disabled={options.pending}
            onClick={options.onToggle}
          >
            {options.pending ? "Saving..." : market.pinned ? "Remove" : "Pin"}
          </Button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <AnimatedMetric label="Bid" value={formatMarketPrice(animatedBid)} flashValue={market.bestBid} />
        <AnimatedMetric label="Ask" value={formatMarketPrice(animatedAsk)} flashValue={market.bestAsk} />
        <AnimatedMetric label="Last" value={formatMarketPrice(animatedLast)} flashValue={market.lastTrade} />
        <AnimatedMetric label="Spread" value={formatMarketPrice(animatedSpread)} flashValue={market.spread} />
      </div>
      {hasLiveEconomics ? (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <AnimatedMetric label="Position" value={formatMarketQuantity(animatedPosition)} flashValue={options.result?.netPosition ?? null} />
          <AnimatedMetric label="Basis" value={formatDetailedMoney(animatedCostBasis)} flashValue={options.result?.costBasis ?? null} />
          <AnimatedMetric label="Value" value={formatDetailedMoney(animatedCurrentValue)} flashValue={currentValue} />
          <AnimatedMetric
            label="Unrealized"
            value={formatSignedDetailedMoney(animatedUnrealizedPnl)}
            flashValue={unrealizedPnl}
            valueClassName={signedValueTextClass(animatedUnrealizedPnl)}
          />
        </div>
      ) : null}
      <p className="mt-3 text-muted-foreground">
        Trade {formatMarketPrice(market.tradePrice)} · Qty {formatMarketQuantity(market.tradeQuantity)} · {formatOperatorTimestamp(freshestTimestamp)}
      </p>
    </div>
  );
}

function AnimatedMetric({
  label,
  value,
  flashValue,
  valueClassName,
}: {
  label: string;
  value: string;
  flashValue?: number | null;
  valueClassName?: string;
}) {
  const flash = useFlashClass(flashValue ?? null);
  return (
    <div
      className={cn(
        "rounded-md border border-border/50 bg-background/70 px-2 py-1.5 backdrop-blur-sm transition-[background-color,border-color] duration-700",
        flash && "border-border/70",
        flash,
      )}
    >
      <p className="terminal-metric-label">{label}</p>
      <p className={cn("mt-0.5 font-mono text-sm font-medium leading-tight tabular-nums", valueClassName)}>{value}</p>
    </div>
  );
}
