"use client";

import { Badge } from "@/components/ui/badge";
import { formatCurrency as formatMoney, formatOperatorTimestamp } from "@/lib/format-utils";
import type {
  ArtifactState,
  PolymarketAccountOverview,
  PolymarketResultsOverview,
  PolymarketSignalOverview,
  PolymarketWatchlistOverview,
  TradingOpsPolymarketData,
  TradingOpsPolymarketLiveData,
} from "@/lib/trading-ops-contract";
import {
  badgeVariantForMarketSeverity,
  badgeVariantForPolymarketStreamer,
} from "@/lib/trading-ops/badge-variants";
import {
  formatLabel,
  formatProbability,
  formatProbabilityDelta,
} from "@/lib/trading-ops/format";
import { describePolymarketBoardEmptyState } from "@/lib/trading-ops/polymarket-helpers";
import { renderPolymarketMarketCard } from "../polymarket/polymarket-market-card";
import { RosterChangeSummary } from "../polymarket/roster-change-summary";
import { RosterMetric } from "../polymarket/roster-metric";
import { usePolymarketRosterState } from "../polymarket/use-polymarket-roster-state";
import { Metric, ArtifactPanel } from "../shared";

type MarketRow = TradingOpsPolymarketLiveData["markets"][number];

export function PolymarketTab({
  displayPolymarketData,
  displayPolymarketLiveData,
  polymarketLiveArtifact,
  polymarketAccountArtifact,
  polymarketSignalArtifact,
  polymarketWatchlistArtifact,
  polymarketResultsArtifact,
  lastPolymarketLiveAt,
  polymarketPinPendingSlugs,
  mutatePolymarketPin,
  tradingRunSymbols,
}: {
  displayPolymarketData: TradingOpsPolymarketData | null;
  displayPolymarketLiveData: TradingOpsPolymarketLiveData | null;
  polymarketLiveArtifact: ArtifactState<TradingOpsPolymarketLiveData>;
  polymarketAccountArtifact: ArtifactState<PolymarketAccountOverview>;
  polymarketSignalArtifact: ArtifactState<PolymarketSignalOverview>;
  polymarketWatchlistArtifact: ArtifactState<PolymarketWatchlistOverview>;
  polymarketResultsArtifact: ArtifactState<PolymarketResultsOverview>;
  lastPolymarketLiveAt: string | null;
  polymarketPinPendingSlugs: string[];
  mutatePolymarketPin: (market: MarketRow, action: "pin" | "remove") => Promise<void>;
  tradingRunSymbols: Set<string>;
}) {
  const polymarketOverlap = (displayPolymarketData?.watchlist.data?.symbols ?? [])
    .map((entry) => entry.symbol)
    .filter((symbol) => tradingRunSymbols.has(symbol));
  const polymarketPinnedRows = (displayPolymarketLiveData?.markets ?? []).filter((market) => market.pinned);
  const polymarketPinnedEventRows = polymarketPinnedRows.filter((market) => market.bucket === "events");
  const polymarketPinnedSportsRows = polymarketPinnedRows.filter((market) => market.bucket === "sports");
  const polymarketEventRows = (displayPolymarketLiveData?.markets ?? []).filter((market) => market.bucket === "events" && !market.pinned);
  const polymarketSportsRows = (displayPolymarketLiveData?.markets ?? []).filter((market) => market.bucket === "sports" && !market.pinned);
  const polymarketEventBoardEmptyState = describePolymarketBoardEmptyState({
    bucket: "events",
    visibleCount: polymarketEventRows.length,
    pinnedCount: polymarketPinnedEventRows.length,
    candidateCount: displayPolymarketLiveData?.roster?.candidateEventsCount ?? 0,
    warnings: polymarketLiveArtifact.warnings,
  });
  const polymarketSportsBoardEmptyState = describePolymarketBoardEmptyState({
    bucket: "sports",
    visibleCount: polymarketSportsRows.length,
    pinnedCount: polymarketPinnedSportsRows.length,
    candidateCount: displayPolymarketLiveData?.roster?.candidateSportsCount ?? 0,
    warnings: polymarketLiveArtifact.warnings,
  });
  const polymarketEventRosterState = usePolymarketRosterState(
    polymarketEventRows,
    displayPolymarketLiveData?.streamer.lastMarketMessageAt ?? displayPolymarketLiveData?.generatedAt ?? null,
  );
  const polymarketSportsRosterState = usePolymarketRosterState(
    polymarketSportsRows,
    displayPolymarketLiveData?.streamer.lastMarketMessageAt ?? displayPolymarketLiveData?.generatedAt ?? null,
  );
  const polymarketResultsRows = displayPolymarketData?.results.data?.rows ?? [];
  const polymarketResultsBySlug = new Map(polymarketResultsRows.map((row) => [row.marketSlug, row]));
  const polymarketSettledRows = polymarketResultsRows.filter((row) => row.status === "settled");

  const polymarketStreamCardArtifact = displayPolymarketLiveData
    ? {
        ...polymarketLiveArtifact,
        message: displayPolymarketLiveData.streamer.marketsConnected && displayPolymarketLiveData.streamer.privateConnected
          ? "Market and private streams are live."
          : "One or more Polymarket streams are reconnecting.",
      }
    : polymarketLiveArtifact;
  const polymarketPinnedCardArtifact = displayPolymarketLiveData
    ? {
        ...polymarketLiveArtifact,
        message: polymarketPinnedRows.length > 0
          ? `${polymarketPinnedRows.length} pinned market${polymarketPinnedRows.length === 1 ? "" : "s"} staying on the live board.`
          : "Pin a market to keep it on screen with live pricing and economics.",
        badgeText: String(polymarketPinnedRows.length),
      }
    : polymarketLiveArtifact;
  const polymarketEventsCardArtifact = displayPolymarketLiveData
    ? {
        ...polymarketLiveArtifact,
        message: polymarketEventRows.length > 0
          ? `${polymarketEventRows.length} live event contracts are rotating in the board now.`
          : polymarketEventBoardEmptyState.message,
        badgeText: String(polymarketEventRows.length),
      }
    : polymarketLiveArtifact;
  const polymarketSportsCardArtifact = displayPolymarketLiveData
    ? {
        ...polymarketLiveArtifact,
        message: polymarketSportsRows.length > 0
          ? `${polymarketSportsRows.length} live sports contracts are rotating in the board now.`
          : polymarketSportsBoardEmptyState.message,
        badgeText: String(polymarketSportsRows.length),
      }
    : polymarketLiveArtifact;

  return (
    <>
      <ArtifactPanel title="Live stream" artifact={polymarketStreamCardArtifact}>
        {displayPolymarketLiveData ? (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={badgeVariantForPolymarketStreamer(displayPolymarketLiveData)} className="text-[10px]">
                {displayPolymarketLiveData.streamer.marketsConnected ? "Markets live" : "Markets reconnecting"}
              </Badge>
              <Badge variant={displayPolymarketLiveData.streamer.privateConnected ? "success" : "outline"} className="text-[10px]">
                {displayPolymarketLiveData.streamer.privateConnected ? "Private live" : "Private waiting"}
              </Badge>
              <p className="text-xs text-muted-foreground">
                Last refresh {lastPolymarketLiveAt ? formatOperatorTimestamp(lastPolymarketLiveAt) : "waiting"}.
              </p>
            </div>
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
              <Metric label="Tracked markets" value={String(displayPolymarketLiveData.streamer.trackedMarketCount)} />
              <Metric label="Open orders" value={String(displayPolymarketLiveData.account.openOrdersCount ?? 0)} />
              <Metric label="Positions" value={String(displayPolymarketLiveData.account.positionCount ?? 0)} />
              <Metric label="Buying power" value={formatMoney(displayPolymarketLiveData.account.buyingPower)} />
              <Metric label="Last market msg" value={formatOperatorTimestamp(displayPolymarketLiveData.streamer.lastMarketMessageAt)} />
              <Metric label="Last private msg" value={formatOperatorTimestamp(displayPolymarketLiveData.streamer.lastPrivateMessageAt)} />
            </dl>
          </div>
        ) : null}
      </ArtifactPanel>

      <section className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <ArtifactPanel title="Pinned" artifact={polymarketPinnedCardArtifact}>
          {displayPolymarketLiveData ? (
            <div className="space-y-3 text-sm">
              <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Metric label="Pinned count" value={String(polymarketPinnedRows.length)} />
                <Metric label="Open live" value={String(displayPolymarketData?.results.data?.openPositionCount ?? 0)} />
                <Metric label="Settled" value={String(displayPolymarketData?.results.data?.settledCount ?? 0)} />
              </dl>
              {polymarketPinnedRows.length > 0 ? (
                <div className="space-y-1.5">
                  {polymarketPinnedRows.map((market) => renderPolymarketMarketCard(market, {
                    pending: polymarketPinPendingSlugs.includes(market.slug),
                    result: polymarketResultsBySlug.get(market.slug) ?? null,
                    onToggle: () => void mutatePolymarketPin(market, "remove"),
                  }))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Pin a market from the event or sports boards to keep it here with live pricing and economics.
                </p>
              )}
            </div>
          ) : null}
        </ArtifactPanel>

        <ArtifactPanel title="Top events" artifact={polymarketEventsCardArtifact}>
          {displayPolymarketLiveData ? (
            <div className="space-y-3 text-sm">
              {polymarketEventBoardEmptyState.kind !== "exhausted" ? (
                <RosterChangeSummary state={polymarketEventRosterState} />
              ) : null}
              <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <RosterMetric label="Contracts" value={String(polymarketEventRows.length)} />
                <RosterMetric
                  label="Leader"
                  value={polymarketEventRows[0]?.title ?? (polymarketEventBoardEmptyState.kind === "exhausted" ? "Pinned all available" : "Waiting")}
                  highlight={polymarketEventRosterState.leaderChanged}
                />
                <RosterMetric label="Updated" value={formatOperatorTimestamp(displayPolymarketLiveData.streamer.lastMarketMessageAt)} />
              </dl>
              {polymarketEventRows.length > 0 ? (
                <div className="space-y-1.5">
                  {polymarketEventRows.map((market) => renderPolymarketMarketCard(market, {
                    pending: polymarketPinPendingSlugs.includes(market.slug),
                    result: polymarketResultsBySlug.get(market.slug) ?? null,
                    rosterNew: polymarketEventRosterState.newSlugs.has(market.slug),
                    onToggle: () => void mutatePolymarketPin(market, "pin"),
                  }))}
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">{polymarketEventBoardEmptyState.message}</p>
                  <p className="text-xs text-muted-foreground">{polymarketEventBoardEmptyState.detail}</p>
                </div>
              )}
            </div>
          ) : null}
        </ArtifactPanel>

        <ArtifactPanel title="Top sports" artifact={polymarketSportsCardArtifact}>
          {displayPolymarketLiveData ? (
            <div className="space-y-3 text-sm">
              {polymarketSportsBoardEmptyState.kind !== "exhausted" ? (
                <RosterChangeSummary state={polymarketSportsRosterState} />
              ) : null}
              <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <RosterMetric label="Contracts" value={String(polymarketSportsRows.length)} />
                <RosterMetric
                  label="Leader"
                  value={polymarketSportsRows[0]?.title ?? (polymarketSportsBoardEmptyState.kind === "exhausted" ? "Pinned all available" : "Waiting")}
                  highlight={polymarketSportsRosterState.leaderChanged}
                />
                <RosterMetric label="Updated" value={formatOperatorTimestamp(displayPolymarketLiveData.streamer.lastMarketMessageAt)} />
              </dl>
              {polymarketSportsRows.length > 0 ? (
                <div className="space-y-1.5">
                  {polymarketSportsRows.map((market) => renderPolymarketMarketCard(market, {
                    pending: polymarketPinPendingSlugs.includes(market.slug),
                    result: polymarketResultsBySlug.get(market.slug) ?? null,
                    rosterNew: polymarketSportsRosterState.newSlugs.has(market.slug),
                    onToggle: () => void mutatePolymarketPin(market, "pin"),
                  }))}
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">{polymarketSportsBoardEmptyState.message}</p>
                  <p className="text-xs text-muted-foreground">{polymarketSportsBoardEmptyState.detail}</p>
                </div>
              )}
            </div>
          ) : null}
        </ArtifactPanel>
      </section>

      <section className="grid grid-cols-1 gap-3 xl:grid-cols-4">
        <ArtifactPanel title="Account" artifact={polymarketAccountArtifact}>
          {displayPolymarketData?.account.data ? (
            <div className="space-y-2 text-sm">
              <dl className="grid grid-cols-2 gap-2">
                <Metric label="Status" value={formatLabel(displayPolymarketData.account.data.status)} />
                <Metric
                  label="Key"
                  value={displayPolymarketData.account.data.keyIdSuffix ? `...${displayPolymarketData.account.data.keyIdSuffix}` : "Not exposed"}
                />
                <Metric label="Balances" value={String(displayPolymarketData.account.data.balanceCount)} />
                <Metric label="Positions" value={String(displayPolymarketData.account.data.positionCount)} />
                <Metric label="Open orders" value={String(displayPolymarketData.account.data.openOrdersCount)} />
              </dl>
              {displayPolymarketData.account.data.balances.length > 0 ? (
                <div className="space-y-1.5">
                  {displayPolymarketData.account.data.balances.map((balance) => (
                    <div key={balance.currency} className="flex items-center justify-between rounded-md border border-border/50 px-2 py-1.5 text-xs">
                      <span className="font-mono">{balance.currency}</span>
                      <span>
                        {formatMoney(balance.currentBalance)} current
                        {" · "}
                        {formatMoney(balance.buyingPower)} buying power
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No funded balances or settled buying power yet.</p>
              )}
            </div>
          ) : null}
        </ArtifactPanel>

        <ArtifactPanel title="Signal overlay" artifact={polymarketSignalArtifact}>
          {displayPolymarketData?.signal.data ? (
            <div className="space-y-3 text-sm">
              <div className="rounded-md border border-border/50 bg-muted/30 p-2">
                <p className="terminal-metric-label">Overlay summary</p>
                <p className="mt-1 font-medium">
                  {displayPolymarketData.signal.data.overlaySummary ?? "No overlay summary yet"}
                </p>
                {displayPolymarketData.signal.data.overlayDetail ? (
                  <p className="mt-1 text-xs text-muted-foreground">{displayPolymarketData.signal.data.overlayDetail}</p>
                ) : null}
              </div>
              <dl className="grid grid-cols-2 gap-2">
                <Metric label="Alignment" value={formatLabel(displayPolymarketData.signal.data.alignment)} />
                <Metric label="Conviction" value={formatLabel(displayPolymarketData.signal.data.conviction)} />
                <Metric label="Aggression" value={formatLabel(displayPolymarketData.signal.data.aggressionDial)} />
                <Metric label="Divergence" value={displayPolymarketData.signal.data.divergenceSummary ?? "None flagged"} />
              </dl>
              {displayPolymarketData.signal.data.topMarkets.length > 0 ? (
                <div className="space-y-2">
                  {displayPolymarketData.signal.data.topMarkets.map((market) => (
                    <div key={`${market.theme}-${market.title}`} className="rounded-md border border-border/50 bg-muted/20 p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">{market.title}</p>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant={badgeVariantForMarketSeverity(market.severity)} className="text-[10px]">
                            {market.severity}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {formatProbability(market.probability)}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {formatProbabilityDelta(market.change24h)}
                          </Badge>
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatLabel(market.theme)}
                        {" · "}
                        persistence {formatLabel(market.persistence)}
                        {market.regimeEffect ? ` · regime ${formatLabel(market.regimeEffect)}` : ""}
                      </p>
                      {market.watchTickers.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {market.watchTickers.slice(0, 6).map((ticker) => (
                            <Badge key={`${market.title}-${ticker}`} variant="outline" className="font-mono text-[10px]">
                              {ticker}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </ArtifactPanel>

        <ArtifactPanel title="Linked watchlist" artifact={polymarketWatchlistArtifact}>
          {displayPolymarketData?.watchlist.data ? (
            <div className="space-y-3 text-sm">
              <dl className="grid grid-cols-2 gap-2">
                <Metric label="Stocks" value={String(displayPolymarketData.watchlist.data.buckets.stocks.length)} />
                <Metric label="Funds" value={String(displayPolymarketData.watchlist.data.buckets.funds.length)} />
                <Metric label="Crypto proxies" value={String(displayPolymarketData.watchlist.data.buckets.cryptoProxies.length)} />
                <Metric label="Trading Ops overlap" value={polymarketOverlap.length > 0 ? String(polymarketOverlap.length) : "0"} />
              </dl>
              {polymarketOverlap.length > 0 ? (
                <div className="rounded-md border border-border/50 bg-muted/30 p-2">
                  <p className="terminal-metric-label">Current run overlap</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {polymarketOverlap.slice(0, 8).map((symbol) => (
                      <Badge key={symbol} variant="info" className="font-mono text-[10px]">
                        {symbol}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="space-y-1.5">
                {displayPolymarketData.watchlist.data.symbols.slice(0, 10).map((symbol) => (
                  <div key={symbol.symbol} className="flex items-start justify-between gap-3 rounded-md border border-border/50 px-2 py-1.5 text-xs">
                    <div>
                      <p className="font-mono font-medium">{symbol.symbol}</p>
                      <p className="text-muted-foreground">
                        {formatLabel(symbol.assetClass)}
                        {symbol.themes.length > 0 ? ` · ${symbol.themes.map(formatLabel).join(", ")}` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p>{formatProbability(symbol.probability)}</p>
                      <p className="text-muted-foreground">{symbol.sourceTitles.slice(0, 2).join(" · ") || "No source title"}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </ArtifactPanel>

        <ArtifactPanel title="Results" artifact={polymarketResultsArtifact}>
          {displayPolymarketData?.results.data ? (
            <div className="space-y-3 text-sm">
              <dl className="grid grid-cols-2 gap-2">
                <Metric label="Settled" value={String(displayPolymarketData.results.data.settledCount)} />
                <Metric label="With P&L" value={String(displayPolymarketData.results.data.tradedCount)} />
                <Metric label="Open live" value={String(displayPolymarketData.results.data.openPositionCount)} />
              </dl>
              {polymarketSettledRows.length > 0 ? (
                <div className="space-y-1.5">
                  {polymarketSettledRows.map((row) => (
                    <div key={`result-${row.marketSlug}`} className="rounded-md border border-border/50 px-2 py-2 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">{row.title}</p>
                          <p className="text-muted-foreground">
                            {[row.eventTitle, row.league ? formatLabel(row.league) : null].filter(Boolean).join(" · ") || "Pinned result"}
                          </p>
                        </div>
                        <Badge variant={row.traded ? "success" : "outline"} className="text-[10px]">
                          {row.traded ? "P&L tracked" : "Result only"}
                        </Badge>
                      </div>
                      <p className="mt-2">{row.resultLabel}</p>
                      <p className="mt-1 text-muted-foreground">
                        Settled {formatOperatorTimestamp(row.settledAt)}
                        {row.outcome ? ` · Outcome ${row.outcome}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Pinned markets will move here after they settle. Open pinned positions now show live economics directly in the pinned cards.
                </p>
              )}
            </div>
          ) : null}
        </ArtifactPanel>
      </section>
    </>
  );
}
