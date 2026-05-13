"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  PolymarketAccountOverview,
  PolymarketResultsOverview,
  PolymarketSignalOverview,
  PolymarketWatchlistOverview,
  TradingOpsDashboardData,
  TradingOpsPolymarketData,
  TradingOpsPolymarketLiveData,
} from "@/lib/trading-ops-contract";
import {
  buildLiveArtifact,
  buildPendingArtifact,
  buildPolymarketLiveArtifact,
  buildPolymarketStatusArtifact,
  buildWarmupArtifact,
} from "@/lib/trading-ops/artifacts";
import {
  collectTradingRunSymbols,
  isPolymarketAggregateHandoffPending,
  shouldKeepPolymarketNeutral,
} from "@/lib/trading-ops/polymarket-helpers";
import { useLiveTape } from "@/hooks/trading-ops/use-live-tape";
import { usePolymarketStatus } from "@/hooks/trading-ops/use-polymarket-status";
import { usePolymarketLive } from "@/hooks/trading-ops/use-polymarket-live";
import { TerminalHeader } from "./trading-ops/terminal-header";
import { AlertBanner } from "./trading-ops/alert-banner";
import { OverviewTab } from "./trading-ops/tabs/overview-tab";
import { LiveTab } from "./trading-ops/tabs/live-tab";
import { WatchlistsTab } from "./trading-ops/tabs/watchlists-tab";
import { PolymarketTab } from "./trading-ops/tabs/polymarket-tab";
import { SystemHealthTab } from "./trading-ops/tabs/system-health-tab";
import { MarketLabClient } from "@/app/market-lab/market-lab-client";

const POLYMARKET_HANDOFF_RETRY_MS = 1_000;
const POLYMARKET_HANDOFF_MAX_RETRIES = 3;

/* ── main component ── */

type TradingOpsDashboardProps = {
  data: TradingOpsDashboardData;
};

export function TradingOpsDashboard({ data }: TradingOpsDashboardProps) {
  const hasIncidents = (data.runtime.data?.incidents.length ?? 0) > 0;
  const hasErrors = [data.market, data.runtime, data.workflow, data.canary, data.financialServices, data.tradingRun].some((a) => a.state === "error");
  const hasTradingRunFallback = data.tradingRun.badgeText === "fallback";
  const {
    data: liveData,
    error: liveError,
    lastSuccessfulAt,
  } = useLiveTape();
  const {
    data: polymarketData,
    error: polymarketError,
    refetch: refetchPolymarketData,
  } = usePolymarketStatus();
  const {
    data: polymarketLiveData,
    error: polymarketLiveError,
    lastSuccessfulAt: lastPolymarketLiveAt,
    warmupComplete: polymarketWarmupComplete,
    pinPendingSlugs: polymarketPinPendingSlugs,
    mutatePin: mutatePolymarketPin,
  } = usePolymarketLive();

  const [polymarketHandoffRetries, setPolymarketHandoffRetries] = useState(0);
  const polymarketNeedsHandoff = isPolymarketAggregateHandoffPending({
    data: polymarketData,
    liveData: polymarketLiveData,
  });

  useEffect(() => {
    if (!polymarketNeedsHandoff) {
      setPolymarketHandoffRetries(0);
      return;
    }

    if (polymarketHandoffRetries >= POLYMARKET_HANDOFF_MAX_RETRIES) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setPolymarketHandoffRetries((current) => current + 1);
      void refetchPolymarketData();
    }, POLYMARKET_HANDOFF_RETRY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [refetchPolymarketData, polymarketHandoffRetries, polymarketNeedsHandoff]);

  const liveArtifact = buildLiveArtifact(liveData, liveError, lastSuccessfulAt);
  const polymarketWarmupActive = shouldKeepPolymarketNeutral({
    warmupComplete: polymarketWarmupComplete,
    data: polymarketData,
    dataError: polymarketError,
    liveData: polymarketLiveData,
    liveError: polymarketLiveError,
    handoffPending: polymarketNeedsHandoff && polymarketHandoffRetries < POLYMARKET_HANDOFF_MAX_RETRIES,
  });
  const displayPolymarketData = polymarketWarmupActive ? null : polymarketData;
  const displayPolymarketLiveData = polymarketWarmupActive ? null : polymarketLiveData;
  const polymarketStatusArtifact = polymarketWarmupActive
    ? buildWarmupArtifact<TradingOpsPolymarketData>(
        "Loading Polymarket status",
        "Waiting for Polymarket services to settle after page load.",
        "/api/trading-ops/polymarket",
      )
    : buildPolymarketStatusArtifact(polymarketData, polymarketError);
  const polymarketLiveArtifact = polymarketWarmupActive
    ? buildWarmupArtifact<TradingOpsPolymarketLiveData>(
        "Loading Polymarket live",
        "Waiting for Polymarket live streams to settle after page load.",
        "/api/trading-ops/polymarket/live/stream",
      )
    : buildPolymarketLiveArtifact(
        polymarketLiveData,
        polymarketLiveError,
        lastPolymarketLiveAt,
      );
  const polymarketAccountArtifact =
    polymarketWarmupActive
      ? buildWarmupArtifact<PolymarketAccountOverview>("Loading account", "Waiting for Polymarket account state.", "/api/trading-ops/polymarket")
      : polymarketData?.account ?? buildPendingArtifact<PolymarketAccountOverview>("Loading account", polymarketError);
  const polymarketSignalArtifact =
    polymarketWarmupActive
      ? buildWarmupArtifact<PolymarketSignalOverview>("Loading overlay", "Waiting for Polymarket signal state.", "/api/trading-ops/polymarket")
      : polymarketData?.signal ?? buildPendingArtifact<PolymarketSignalOverview>("Loading overlay", polymarketError);
  const polymarketWatchlistArtifact =
    polymarketWarmupActive
      ? buildWarmupArtifact<PolymarketWatchlistOverview>("Loading watchlist", "Waiting for Polymarket linked watchlist.", "/api/trading-ops/polymarket")
      : polymarketData?.watchlist ?? buildPendingArtifact<PolymarketWatchlistOverview>("Loading watchlist", polymarketError);
  const polymarketResultsArtifact =
    polymarketWarmupActive
      ? buildWarmupArtifact<PolymarketResultsOverview>("Loading results", "Waiting for pinned market state.", "/api/trading-ops/polymarket")
      : polymarketData?.results ?? buildPendingArtifact<PolymarketResultsOverview>("Loading results", polymarketError);
  const tradingRunSymbols = collectTradingRunSymbols(data);
  const polymarketPinnedRows = (displayPolymarketLiveData?.markets ?? []).filter((market) => market.pinned);

  return (
    <div className="min-w-0 space-y-3 overflow-x-hidden">
      {/* ── Zone A: Terminal Header Bar ── */}
      <TerminalHeader data={data} liveData={liveData} />

      {/* ── Zone B: Alert Banner (conditional) ── */}
      {(hasIncidents || hasErrors || hasTradingRunFallback) && <AlertBanner data={data} />}

      {/* ── Zone E: Tabs ── */}
      <Tabs defaultValue="overview" className="space-y-3">
        <TabsList className="w-full justify-start overflow-x-auto font-mono text-xs uppercase tracking-wide">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="live">Live</TabsTrigger>
          <TabsTrigger value="market-lab">Market Lab</TabsTrigger>
          <TabsTrigger value="watchlists">Watchlists</TabsTrigger>
          <TabsTrigger value="polymarket">Polymarket</TabsTrigger>
          <TabsTrigger value="health">System Health</TabsTrigger>
        </TabsList>

        {/* ── Overview ── */}
        <TabsContent value="overview" className="space-y-3">
          <OverviewTab
            liveData={liveData}
            liveArtifact={liveArtifact}
            lastSuccessfulAt={lastSuccessfulAt}
            displayPolymarketData={displayPolymarketData}
            displayPolymarketLiveData={displayPolymarketLiveData}
            polymarketStatusArtifact={polymarketStatusArtifact}
            polymarketPinnedCount={polymarketPinnedRows.length}
          />
        </TabsContent>

        {/* ── Live ── */}
        <TabsContent value="live" className="space-y-3">
          <LiveTab
            liveData={liveData}
            liveArtifact={liveArtifact}
            lastSuccessfulAt={lastSuccessfulAt}
          />
        </TabsContent>

        {/* ── Market Lab ── */}
        <TabsContent value="market-lab" className="space-y-3">
          <MarketLabClient embedded />
        </TabsContent>

        {/* ── Watchlists ── */}
        <TabsContent value="watchlists" className="space-y-3">
          <WatchlistsTab />
        </TabsContent>

        {/* ── Polymarket ── */}
        <TabsContent value="polymarket" className="space-y-3">
          <PolymarketTab
            displayPolymarketData={displayPolymarketData}
            displayPolymarketLiveData={displayPolymarketLiveData}
            polymarketLiveArtifact={polymarketLiveArtifact}
            polymarketAccountArtifact={polymarketAccountArtifact}
            polymarketSignalArtifact={polymarketSignalArtifact}
            polymarketWatchlistArtifact={polymarketWatchlistArtifact}
            polymarketResultsArtifact={polymarketResultsArtifact}
            lastPolymarketLiveAt={lastPolymarketLiveAt}
            polymarketPinPendingSlugs={polymarketPinPendingSlugs}
            mutatePolymarketPin={mutatePolymarketPin}
            tradingRunSymbols={tradingRunSymbols}
          />
        </TabsContent>

        {/* ── System Health ── */}
        <TabsContent value="health" className="space-y-3">
          <SystemHealthTab financialServices={data.financialServices} />
        </TabsContent>

      </Tabs>
    </div>
  );
}

