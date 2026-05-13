"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Gauge, Landmark, Radar, ShieldCheck } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type {
  ArtifactState,
  FinancialServiceHealthRow,
  PolymarketAccountOverview,
  PolymarketResultRow,
  PolymarketResultsOverview,
  TradingOpsPolymarketLiveData,
  PolymarketSignalOverview,
  PolymarketWatchlistOverview,
  TradingOpsDashboardData,
  TradingOpsLiveData,
  TradingOpsPolymarketData,
} from "@/lib/trading-ops-contract";
import { formatCurrency as formatMoney, formatOperatorTimestamp, formatPercentDecimal as formatPercent } from "@/lib/format-utils";
import { Metric, StageChip, StrategyWatchlistSection, ArtifactPanel } from "./trading-ops/shared";
import { TerminalHeader } from "./trading-ops/terminal-header";
import { TerminalCell } from "./trading-ops/terminal-cell";
import { AlertBanner } from "./trading-ops/alert-banner";
import { CompactTapeStrip, LiveTapeGrid, LiveWatchlistGroup, useAnimatedValue, useFlashClass } from "./trading-ops/animated-quote";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarketLabClient } from "@/app/market-lab/market-lab-client";

const LIVE_POLL_MS = 15_000;
const LIVE_STREAM_RETRY_MS = 2_000;
const POLYMARKET_POLL_MS = 30_000;
const POLYMARKET_LIVE_POLL_MS = 15_000;
const POLYMARKET_LIVE_STREAM_RETRY_MS = 2_000;
const POLYMARKET_STARTUP_GRACE_MS = 12_000;
const POLYMARKET_HANDOFF_RETRY_MS = 1_000;
const POLYMARKET_HANDOFF_MAX_RETRIES = 3;
const COMPACT_TAPE_ORDER = ["SPY", "QQQ", "IWM", "DOW", "NASDAQ"];
const TRANSIENT_POLYMARKET_LOADING_PATTERNS = [
  /abort(?:ed)?/iu,
  /timed?\s*out/iu,
  /timeout/iu,
  /failed to fetch/iu,
  /network(?:\s+request)?\s+failed/iu,
  /stream not ready/iu,
  /reconnect/iu,
  /waiting for first/iu,
];

/* ── main component ── */

type TradingOpsDashboardProps = {
  data: TradingOpsDashboardData;
};

export function TradingOpsDashboard({ data }: TradingOpsDashboardProps) {
  const hasIncidents = (data.runtime.data?.incidents.length ?? 0) > 0;
  const hasErrors = [data.market, data.runtime, data.workflow, data.canary, data.financialServices, data.tradingRun].some((a) => a.state === "error");
  const hasTradingRunFallback = data.tradingRun.badgeText === "fallback";
  const [liveData, setLiveData] = useState<TradingOpsLiveData | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [lastSuccessfulAt, setLastSuccessfulAt] = useState<string | null>(null);
  const [polymarketData, setPolymarketData] = useState<TradingOpsPolymarketData | null>(null);
  const [polymarketError, setPolymarketError] = useState<string | null>(null);
  const [polymarketLiveData, setPolymarketLiveData] = useState<TradingOpsPolymarketLiveData | null>(null);
  const [polymarketLiveError, setPolymarketLiveError] = useState<string | null>(null);
  const [lastPolymarketLiveAt, setLastPolymarketLiveAt] = useState<string | null>(null);
  const [polymarketPinPendingSlugs, setPolymarketPinPendingSlugs] = useState<string[]>([]);
  const [polymarketWarmupComplete, setPolymarketWarmupComplete] = useState(false);
  const [polymarketHandoffRetries, setPolymarketHandoffRetries] = useState(0);

  const applyLiveData = useCallback((payload: TradingOpsLiveData) => {
    setLiveData(payload);
    setLiveError(null);
    setLastSuccessfulAt(payload.generatedAt);
  }, []);

  const fetchLiveData = useCallback(async () => {
    try {
      const response = await fetch("/api/trading-ops/live", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Live route failed (${response.status})`);
      }

      const payload = (await response.json()) as TradingOpsLiveData;
      applyLiveData(payload);
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "Live route failed");
    }
  }, [applyLiveData]);

  const applyPolymarketData = useCallback((payload: TradingOpsPolymarketData) => {
    setPolymarketData(payload);
    setPolymarketError(null);
  }, []);

  const applyPolymarketLiveData = useCallback((payload: TradingOpsPolymarketLiveData) => {
    setPolymarketLiveData(payload);
    setPolymarketLiveError(null);
    setLastPolymarketLiveAt(payload.generatedAt);
    if (isPolymarketLiveReady(payload)) {
      setPolymarketWarmupComplete(true);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setPolymarketWarmupComplete(true);
    }, POLYMARKET_STARTUP_GRACE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  const fetchPolymarketData = useCallback(async () => {
    try {
      const response = await fetch("/api/trading-ops/polymarket", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Polymarket route failed (${response.status})`);
      }

      const payload = (await response.json()) as unknown;
      if (!isPolymarketPayload(payload)) {
        throw new Error("Polymarket route returned an invalid payload");
      }
      applyPolymarketData(payload);
    } catch (error) {
      setPolymarketError(error instanceof Error ? error.message : "Polymarket route failed");
    }
  }, [applyPolymarketData]);

  const fetchPolymarketLiveData = useCallback(async () => {
    try {
      const response = await fetch("/api/trading-ops/polymarket/live", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Polymarket live route failed (${response.status})`);
      }

      const payload = (await response.json()) as unknown;
      if (!isPolymarketLivePayload(payload)) {
        throw new Error("Polymarket live route returned an invalid payload");
      }
      applyPolymarketLiveData(payload);
    } catch (error) {
      setPolymarketLiveError(error instanceof Error ? error.message : "Polymarket live route failed");
    }
  }, [applyPolymarketLiveData]);

  const mutatePolymarketPin = useCallback(async (
    market: TradingOpsPolymarketLiveData["markets"][number],
    action: "pin" | "remove",
  ) => {
    try {
      setPolymarketPinPendingSlugs((current) => (
        current.includes(market.slug) ? current : [...current, market.slug]
      ));
      const response = await fetch(
        action === "pin"
          ? "/api/trading-ops/polymarket/pins"
          : `/api/trading-ops/polymarket/pins/${encodeURIComponent(market.slug)}`,
        {
          method: action === "pin" ? "POST" : "DELETE",
          headers: action === "pin" ? { "content-type": "application/json" } : undefined,
          body:
            action === "pin"
              ? JSON.stringify({
                  marketSlug: market.slug,
                  bucket: market.bucket,
                  title: market.title || "Untitled market",
                  eventTitle: market.eventTitle,
                  league: market.league,
                })
              : undefined,
        },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `Polymarket ${action} failed (${response.status})`);
      }

      await fetchPolymarketLiveData();
    } catch (error) {
      setPolymarketLiveError(error instanceof Error ? error.message : `Polymarket ${action} failed`);
    } finally {
      setPolymarketPinPendingSlugs((current) => current.filter((slug) => slug !== market.slug));
    }
  }, [fetchPolymarketLiveData]);

  useEffect(() => {
    let stopped = false;
    let source: EventSource | null = null;
    let fallbackInterval: number | null = null;
    let reconnectTimeout: number | null = null;

    const disconnect = () => {
      source?.close();
      source = null;
    };

    const stopFallback = () => {
      if (fallbackInterval !== null) {
        window.clearInterval(fallbackInterval);
        fallbackInterval = null;
      }
    };

    const startFallback = () => {
      if (fallbackInterval !== null || document.hidden) return;
      fallbackInterval = window.setInterval(() => {
        void fetchLiveData();
      }, LIVE_POLL_MS);
    };

    const scheduleReconnect = () => {
      if (stopped || reconnectTimeout !== null || document.hidden) return;
      reconnectTimeout = window.setTimeout(() => {
        reconnectTimeout = null;
        connect();
      }, LIVE_STREAM_RETRY_MS);
    };

    const connect = () => {
      if (stopped || source || document.hidden || typeof EventSource === "undefined") return;

      try {
        source = new EventSource("/api/trading-ops/live/stream");
        source.addEventListener("snapshot", (event) => {
          try {
            const payload = JSON.parse((event as MessageEvent).data) as TradingOpsLiveData;
            applyLiveData(payload);
            stopFallback();
          } catch {
            setLiveError("Live stream payload could not be parsed.");
          }
        });
        source.addEventListener("warning", (event) => {
          try {
            const payload = JSON.parse((event as MessageEvent).data) as { message?: string };
            setLiveError(payload.message ?? "Live stream warning");
          } catch {
            setLiveError("Live stream warning");
          }
        });
        source.onerror = () => {
          disconnect();
          setLiveError((current) => current ?? "Live stream reconnecting. Falling back to snapshots.");
          void fetchLiveData();
          startFallback();
          scheduleReconnect();
        };
      } catch {
        startFallback();
      }
    };

    void fetchLiveData();
    connect();

    const handleVisibility = () => {
      if (!document.hidden) {
        stopFallback();
        void fetchLiveData();
        connect();
        return;
      }

      disconnect();
      stopFallback();
      if (reconnectTimeout !== null) {
        window.clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stopped = true;
      disconnect();
      stopFallback();
      if (reconnectTimeout !== null) {
        window.clearTimeout(reconnectTimeout);
      }
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [applyLiveData, fetchLiveData]);

  useEffect(() => {
    let intervalId: number | null = null;

    const run = () => {
      if (document.hidden) return;
      void fetchPolymarketData();
    };

    run();
    intervalId = window.setInterval(run, POLYMARKET_POLL_MS);
    const handleVisibility = () => {
      if (!document.hidden) {
        run();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchPolymarketData]);

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
      void fetchPolymarketData();
    }, POLYMARKET_HANDOFF_RETRY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [fetchPolymarketData, polymarketHandoffRetries, polymarketNeedsHandoff]);

  useEffect(() => {
    let stopped = false;
    let source: EventSource | null = null;
    let fallbackInterval: number | null = null;
    let reconnectTimeout: number | null = null;

    const disconnect = () => {
      source?.close();
      source = null;
    };

    const stopFallback = () => {
      if (fallbackInterval !== null) {
        window.clearInterval(fallbackInterval);
        fallbackInterval = null;
      }
    };

    const startFallback = () => {
      if (fallbackInterval !== null || document.hidden) return;
      fallbackInterval = window.setInterval(() => {
        void fetchPolymarketLiveData();
      }, POLYMARKET_LIVE_POLL_MS);
    };

    const scheduleReconnect = () => {
      if (stopped || reconnectTimeout !== null || document.hidden) return;
      reconnectTimeout = window.setTimeout(() => {
        reconnectTimeout = null;
        connect();
      }, POLYMARKET_LIVE_STREAM_RETRY_MS);
    };

    const connect = () => {
      if (stopped || source || document.hidden || typeof EventSource === "undefined") return;

      try {
        source = new EventSource("/api/trading-ops/polymarket/live/stream");
        source.addEventListener("snapshot", (event) => {
          try {
            const payload = JSON.parse((event as MessageEvent).data) as TradingOpsPolymarketLiveData;
            applyPolymarketLiveData(payload);
            stopFallback();
          } catch {
            setPolymarketLiveError("Polymarket live stream payload could not be parsed.");
          }
        });
        source.addEventListener("warning", (event) => {
          try {
            const payload = JSON.parse((event as MessageEvent).data) as { message?: string };
            setPolymarketLiveError(payload.message ?? "Polymarket live stream warning");
          } catch {
            setPolymarketLiveError("Polymarket live stream warning");
          }
        });
        source.onerror = () => {
          disconnect();
          setPolymarketLiveError((current) => current ?? "Polymarket live stream reconnecting. Falling back to snapshots.");
          void fetchPolymarketLiveData();
          startFallback();
          scheduleReconnect();
        };
      } catch {
        startFallback();
      }
    };

    void fetchPolymarketLiveData();
    connect();

    const handleVisibility = () => {
      if (!document.hidden) {
        stopFallback();
        void fetchPolymarketLiveData();
        connect();
        return;
      }

      disconnect();
      stopFallback();
      if (reconnectTimeout !== null) {
        window.clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stopped = true;
      disconnect();
      stopFallback();
      if (reconnectTimeout !== null) {
        window.clearTimeout(reconnectTimeout);
      }
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [applyPolymarketLiveData, fetchPolymarketLiveData]);

  const liveArtifact = buildLiveArtifact(liveData, liveError, lastSuccessfulAt);
  const liveExecutionGateArtifact = buildLiveExecutionGateArtifact(liveData, liveError, lastSuccessfulAt);
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
  const alertDeliveryArtifact = data.alertDelivery ?? {
    state: "missing" as const,
    label: "No alert delivery receipts",
    message: "Watchdog has not written alert delivery receipts yet.",
    data: null,
    warnings: [],
  };
  const scheduleRegistryArtifact = data.scheduleRegistry ?? {
    state: "missing" as const,
    label: "No schedule registry",
    message: "Schedule registry has not been generated yet.",
    data: null,
    warnings: [],
  };

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
          <ArtifactPanel title="Schwab live now" artifact={liveArtifact}>
            {liveData ? (
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={badgeVariantForStreamer(liveData.streamer)} className="text-[10px]">
                    {liveData.streamer.connected ? "Streamer connected" : "Streamer disconnected"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {liveData.tape.freshnessMessage}
                  </span>
                </div>
                <CompactTapeStrip rows={liveData.tape.rows.filter((row) => COMPACT_TAPE_ORDER.includes(row.symbol))} />
                <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <Metric label="Decision" value={liveData.meta.decision ?? "No decision yet"} />
                  <Metric label="Focus" value={liveData.meta.focusTicker ?? "No focus ticker"} />
                  <Metric label="Mode" value={liveData.meta.isAfterHours ? "After hours" : "Market hours"} />
                  <Metric label="Last refresh" value={lastSuccessfulAt ? formatOperatorTimestamp(lastSuccessfulAt) : "Waiting for first poll"} />
                </dl>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Waiting for the first Schwab live quote poll.
              </p>
            )}
          </ArtifactPanel>

          <ArtifactPanel title="Polymarket status" artifact={polymarketStatusArtifact}>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
                <Metric
                  label="Account"
                  value={
                    displayPolymarketData?.account.data
                      ? `${displayPolymarketData.account.data.positionCount} positions · ${displayPolymarketData.account.data.openOrdersCount} orders`
                      : "Waiting for account read"
                  }
                />
                <Metric
                  label="Overlay"
                  value={displayPolymarketData?.signal.data?.overlaySummary ?? displayPolymarketData?.signal.data?.alignment ?? "Loading"}
                />
                <Metric label="Linked symbols" value={String(displayPolymarketData?.watchlist.data?.totalCount ?? 0)} />
                <Metric
                  label="Pinned"
                  value={displayPolymarketLiveData ? String(polymarketPinnedRows.length) : "Waiting"}
                />
                <Metric
                  label="Stream"
                  value={
                    displayPolymarketLiveData
                      ? displayPolymarketLiveData.streamer.marketsConnected && displayPolymarketLiveData.streamer.privateConnected
                        ? `${displayPolymarketLiveData.markets.length} live markets`
                        : formatLabel(displayPolymarketLiveData.streamer.operatorState)
                      : "Waiting for stream"
                  }
                />
              </div>
              {displayPolymarketData?.signal.data?.compactLines[0] ? (
                <p className="rounded-md border border-border/50 bg-muted/30 px-2 py-1.5 text-xs">
                  {displayPolymarketData.signal.data.compactLines[0]}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Waiting for the Polymarket overlay snapshot.
                </p>
              )}
            </div>
          </ArtifactPanel>
        </TabsContent>

        {/* ── Live ── */}
        <TabsContent value="live" className="space-y-3">
          <ArtifactPanel title="Live tape" artifact={liveArtifact}>
            {liveData ? (
              <div className="space-y-3">
                <LiveTapeGrid rows={liveData.tape.rows} />
              </div>
            ) : null}
          </ArtifactPanel>

          <section className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <div className="space-y-3">
              <ArtifactPanel title="Streamer status" artifact={liveArtifact}>
                {liveData ? (
                  <div className="space-y-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={badgeVariantForStreamer(liveData.streamer)} className="text-[10px]">
                        {liveData.streamer.connected ? "Connected" : "Disconnected"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {liveData.streamer.operatorState.replaceAll("_", " ")}
                      </span>
                    </div>
                    <dl className="grid grid-cols-2 gap-2">
                      <Metric label="Last login" value={formatOperatorTimestamp(liveData.streamer.lastLoginAt)} />
                      <Metric label="Equity subs" value={String(liveData.streamer.activeEquitySubscriptions)} />
                      <Metric label="Acct activity" value={String(liveData.streamer.activeAcctActivitySubscriptions)} />
                      <Metric
                        label="Last refresh"
                        value={lastSuccessfulAt ? formatOperatorTimestamp(lastSuccessfulAt) : "—"}
                      />
                    </dl>
                    {liveData.streamer.cooldownSummary ? (
                      <p className="rounded-md border border-border/50 bg-muted/30 px-2 py-1.5 text-xs">
                        {liveData.streamer.cooldownSummary}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </ArtifactPanel>


            </div>

          </section>
        </TabsContent>

        {/* ── Market Lab ── */}
        <TabsContent value="market-lab" className="space-y-3">
          <MarketLabClient embedded />
        </TabsContent>

        {/* ── Watchlists ── */}
        <TabsContent value="watchlists" className="space-y-3">
          <ArtifactPanel title="Latest trading run watchlists" artifact={data.tradingRun}>
            {data.tradingRun.data ? (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  <StrategyWatchlistSection
                    strategy="Dip Buyer"
                    buy={data.tradingRun.data.dipBuyerBuy}
                    watch={data.tradingRun.data.dipBuyerWatch}
                    noBuy={data.tradingRun.data.dipBuyerNoBuy}
                  />
                  <StrategyWatchlistSection
                    strategy="CANSLIM"
                    buy={data.tradingRun.data.canslimBuy}
                    watch={data.tradingRun.data.canslimWatch}
                    noBuy={data.tradingRun.data.canslimNoBuy}
                  />
                </div>
              </div>
            ) : null}
          </ArtifactPanel>
        </TabsContent>

        {/* ── Polymarket ── */}
        <TabsContent value="polymarket" className="space-y-3">
          <section className="space-y-3">
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
                  <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
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
          </section>

          <section className="grid grid-cols-1 gap-3 xl:grid-cols-3">
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
        </TabsContent>

        {/* ── System Health ── */}
        <TabsContent value="health" className="space-y-3">
          <ArtifactPanel title="Financial services health" artifact={data.financialServices}>
            {data.financialServices.data ? (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Metric label="Healthy" value={String(data.financialServices.data.healthyCount)} />
                  <Metric label="Degraded" value={String(data.financialServices.data.degradedCount)} />
                  <Metric label="Needs attention" value={String(data.financialServices.data.errorCount)} />
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {data.financialServices.data.rows.map((row) => (
                    <FinancialServiceCard key={row.label} row={row} />
                  ))}
                </div>
              </div>
            ) : null}
          </ArtifactPanel>

          <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <ArtifactPanel title="Pre-open readiness check" artifact={data.canary}>
              {data.canary.data ? (
                <div className="space-y-2 text-sm">
                  <dl className="grid grid-cols-2 gap-2">
                    <Metric label="Ready for open" value={String(data.canary.data.readyForOpen ?? false)} />
                    <Metric label="Warnings" value={String(data.canary.data.warningCount)} />
                    <Metric label="Checked" value={data.canary.data.checkedAt ? formatOperatorTimestamp(data.canary.data.checkedAt) : "—"} />
                    <Metric label="Freshness" value={data.canary.data.freshness} />
                  </dl>
                  <div className="space-y-1">
                    {data.canary.data.checks.map((check) => (
                      <div key={check.name} className="flex items-center justify-between rounded-md border border-border/50 px-2 py-1.5 text-xs">
                        <span className="font-mono">{check.name}</span>
                        <Badge variant={check.result === "ok" ? "success" : "warning"} className="text-[10px]">{check.result}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </ArtifactPanel>

            <ArtifactPanel title="Runtime health" artifact={data.runtime}>
              {data.runtime.data ? (
                <div className="space-y-2 text-sm">
                  <Metric label="Operator action" value={data.runtime.data.operatorAction} />
                  <Metric label="Pre-open gate" value={data.runtime.data.preOpenGateStatus ?? "Not reported"} />
                  {data.runtime.data.cooldownSummary ? (
                    <Metric label="Cooldown summary" value={data.runtime.data.cooldownSummary} />
                  ) : null}
                  {data.runtime.data.preOpenGateFreshness ? (
                    <Metric label="Readiness freshness" value={data.runtime.data.preOpenGateFreshness} />
                  ) : null}
                  {data.runtime.data.preOpenGateDetail ? (
                    <p className="text-xs text-muted-foreground">{data.runtime.data.preOpenGateDetail}</p>
                  ) : null}
                  {data.runtime.data.incidents.length > 0 ? (
                    <div className="space-y-1.5">
                      {data.runtime.data.incidents.map((incident) => (
                        <div key={`health-${incident.incidentType}-${incident.severity}`} className="terminal-alert-warning flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          <span>{incident.incidentType} · {incident.severity} — {incident.operatorAction}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No active runtime incidents.</p>
                  )}
                </div>
              ) : null}
            </ArtifactPanel>

            <ArtifactPanel title="Alert delivery" artifact={alertDeliveryArtifact}>
              {alertDeliveryArtifact.data ? (
                <div className="space-y-2 text-sm">
                  <Metric label="Sent / failed" value={`${alertDeliveryArtifact.data.sentCount} / ${alertDeliveryArtifact.data.failedCount}`} />
                  <Metric label="Last channel" value={alertDeliveryArtifact.data.lastChannel ?? "unknown"} />
                  <Metric label="Last status" value={alertDeliveryArtifact.data.lastStatus ?? "unknown"} />
                  <Metric label="Last key" value={alertDeliveryArtifact.data.lastDedupeKey ?? "unknown"} />
                  {alertDeliveryArtifact.data.rows.slice(0, 3).map((row) => (
                    <p key={`${row.sentAt}-${row.messageHash}`} className="rounded-md border border-border/50 bg-muted/30 px-2 py-1.5 text-xs">
                      {row.channel} · {row.status} · {row.dedupeKey}
                    </p>
                  ))}
                </div>
              ) : null}
            </ArtifactPanel>

            <ArtifactPanel title="Schedule registry" artifact={scheduleRegistryArtifact}>
              {scheduleRegistryArtifact.data ? (
                <div className="space-y-2 text-sm">
                  <Metric label="Total" value={String(scheduleRegistryArtifact.data.scheduleCount)} />
                  <Metric
                    label="Launchd / artifacts"
                    value={`${scheduleRegistryArtifact.data.launchdCount} / ${scheduleRegistryArtifact.data.artifactCount}`}
                  />
                  <Metric label="Cron registries" value={String(scheduleRegistryArtifact.data.cronRegistryCount)} />
                  {scheduleRegistryArtifact.data.rows.slice(0, 4).map((row) => (
                    <p key={`${row.kind}-${row.name}`} className="rounded-md border border-border/50 bg-muted/30 px-2 py-1.5 text-xs">
                      {row.name} · {row.kind} · {row.owner}
                    </p>
                  ))}
                </div>
              ) : null}
            </ArtifactPanel>
          </section>
        </TabsContent>

      </Tabs>
    </div>
  );
}

function FinancialServiceCard({ row }: { row: FinancialServiceHealthRow }) {
  return (
    <div className="rounded-md border border-border/50 bg-muted/20 p-3 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{row.label}</p>
          <p className="text-muted-foreground">{row.summary}</p>
        </div>
        <Badge variant={badgeVariantForServiceHealth(row.state)} className="text-[10px]">
          {row.badgeText ?? row.state}
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Metric label="Detail" value={row.detail} />
        <Metric label="Updated" value={row.updatedAt ? formatOperatorTimestamp(row.updatedAt) : "—"} />
      </div>
      <p className="mt-2 truncate text-[10px] text-muted-foreground">Source: {row.source}</p>
    </div>
  );
}


type LiveExecutionGateOverview = {
  verdictLabel: string;
  buyCount: number;
  freshBuyCount: number;
  watchCount: number;
  degradedWatchCount: number;
  staleWatchCount: number;
  actionItems: string[];
};

function buildLiveExecutionGateArtifact(
  liveData: TradingOpsLiveData | null,
  liveError: string | null,
  lastSuccessfulAt: string | null,
): ArtifactState<LiveExecutionGateOverview> {
  if (!liveData) {
    return {
      state: liveError ? "error" : "missing",
      label: liveError ? "Gate unavailable" : "Waiting for live gate",
      message: liveError ?? "Need a live snapshot before judging execution safety.",
      data: null,
      updatedAt: lastSuccessfulAt,
      source: "/api/trading-ops/live/stream",
      warnings: liveError ? [liveError] : [],
    };
  }

  const buyRows = [...liveData.watchlists.dipBuyer.buy, ...liveData.watchlists.canslim.buy];
  const watchRows = [...liveData.watchlists.dipBuyer.watch, ...liveData.watchlists.canslim.watch];
  const freshBuyCount = buyRows.filter((row) => row.state === "ok").length;
  const degradedWatchCount = watchRows.filter((row) => row.state !== "ok").length;
  const staleWatchCount = watchRows.filter((row) => (row.stalenessSeconds ?? 0) > 60).length;
  const blocked =
    !liveData.streamer.connected ||
    freshBuyCount < buyRows.length ||
    (watchRows.length > 0 && degradedWatchCount / watchRows.length >= 0.5);
  const actionItems = blocked
    ? [
        !liveData.streamer.connected
          ? "Streamer is not fully live, so this watchlist should not drive entries."
          : `At least one BUY quote is degraded or missing (${freshBuyCount}/${buyRows.length} fresh).`,
        watchRows.length > 0
          ? `${degradedWatchCount}/${watchRows.length} WATCH names are degraded, and ${staleWatchCount} are older than 60s.`
          : "No WATCH names are active right now.",
      ]
    : [
        "BUY rows are fresh enough to review.",
        "WATCH rows are mostly current, but still confirm the exact ticker before acting.",
      ];

  return {
    state: blocked ? "degraded" : "ok",
    label: blocked ? "Blocked" : "Pass",
    message: blocked
      ? "Live quotes are not clean enough to treat BUY/WATCH as execution-grade right now."
      : "Live quotes are fresh enough for a manual execution review.",
    data: {
      verdictLabel: blocked ? "Blocked" : "Pass",
      buyCount: buyRows.length,
      freshBuyCount,
      watchCount: watchRows.length,
      degradedWatchCount,
      staleWatchCount,
      actionItems,
    },
    updatedAt: lastSuccessfulAt ?? liveData.generatedAt,
    source: "/api/trading-ops/live/stream",
    warnings: actionItems,
    badgeText: blocked ? "blocked" : "pass",
  };
}

function formatSignedPercentLabel(value: number | null | undefined): string {
  if (value == null) return "n/a";
  return `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(2)}%`;
}

function compactValue(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === "string" && part.length > 0).join(" · ") || "n/a";
}

function buildLiveArtifact(
  liveData: TradingOpsLiveData | null,
  liveError: string | null,
  lastSuccessfulAt: string | null,
): ArtifactState<TradingOpsLiveData> {
  if (!liveData) {
    return {
      state: liveError ? "error" : "missing",
      label: liveError ? "Live unavailable" : "Loading live data",
      message: liveError ?? "Streaming live tape and streamer health.",
      data: null,
      updatedAt: lastSuccessfulAt,
      source: "/api/trading-ops/live/stream",
      warnings: liveError ? [liveError] : [],
    };
  }

  const hasProblems =
    liveData.streamer.operatorState !== "healthy" ||
    liveData.tape.rows.some((row) => row.state !== "ok");
  const hasUsableLiveRows = liveData.tape.rows.some((row) => row.price != null);

  return {
    state: hasProblems ? "degraded" : "ok",
    label: liveData.streamer.connected ? "Live stream" : hasUsableLiveRows ? "Stale live data" : "Live unavailable",
    message: liveError
      ? `${liveData.tape.freshnessMessage} Last request error: ${liveError}`
      : liveData.tape.freshnessMessage,
    data: liveData,
    updatedAt: lastSuccessfulAt ?? liveData.generatedAt,
    source: "/api/trading-ops/live/stream",
    warnings: liveError ? [liveError, ...liveData.warnings] : liveData.warnings,
  };
}

function badgeVariantForStreamer(streamer: TradingOpsLiveData["streamer"]) {
  if (streamer.connected && streamer.operatorState === "healthy") return "success" as const;
  if (streamer.connected) return "warning" as const;
  return "info" as const;
}

function badgeVariantForServiceHealth(state: FinancialServiceHealthRow["state"]) {
  if (state === "ok") return "success" as const;
  if (state === "degraded") return "warning" as const;
  if (state === "error") return "destructive" as const;
  return "outline" as const;
}

function buildPolymarketStatusArtifact(
  data: TradingOpsPolymarketData | null,
  error: string | null,
): ArtifactState<TradingOpsPolymarketData> {
  if (!data) {
    return buildPendingArtifact<TradingOpsPolymarketData>("Loading Polymarket status", error);
  }

  const artifacts = [data.account, data.signal, data.watchlist];
  const state = summarizeArtifactStates(artifacts.map((artifact) => artifact.state));
  const updatedAt = newestTimestamp(artifacts.map((artifact) => artifact.updatedAt ?? null));
  const warnings = artifacts.flatMap((artifact) => artifact.warnings);
  const suppressTransientError = state === "missing" && isTransientPolymarketLoadingMessage(error);

  return {
    state,
    label: "Polymarket status",
    message: [data.account.message, data.signal.data?.overlaySummary].filter(Boolean).join(" ") || "Polymarket status is loaded.",
    data,
    updatedAt,
    source: "/api/trading-ops/polymarket",
    warnings: error && !suppressTransientError ? [error, ...warnings] : warnings,
    badgeText: data.signal.data?.alignment ?? (state === "missing" ? data.account.badgeText ?? "loading" : data.account.badgeText),
  };
}

function buildPolymarketLiveArtifact(
  data: TradingOpsPolymarketLiveData | null,
  error: string | null,
  lastSuccessfulAt: string | null,
): ArtifactState<TradingOpsPolymarketLiveData> {
  if (!data) {
    return {
      state: "missing",
      label: "Loading Polymarket live",
      message: "Waiting for first Polymarket live snapshot.",
      data: null,
      updatedAt: lastSuccessfulAt,
      source: "/api/trading-ops/polymarket/live/stream",
      warnings: error && !isTransientPolymarketLoadingMessage(error) ? [error] : [],
      badgeText: "loading",
    };
  }

  if (isPolymarketLiveLoading(data, error)) {
    return {
      state: "missing",
      label: "Loading Polymarket live",
      message: "Waiting for the first Polymarket live snapshot.",
      data,
      updatedAt: lastSuccessfulAt ?? data.generatedAt,
      source: "/api/trading-ops/polymarket/live/stream",
      warnings: [],
      badgeText: "loading",
    };
  }

  const hasProblems =
    data.streamer.operatorState !== "healthy" ||
    data.markets.some((market) => market.state !== "ok");

  return {
    state: hasProblems ? "degraded" : "ok",
    label: data.streamer.marketsConnected ? "Polymarket live stream" : "Polymarket fallback snapshots",
    message: error
      ? `Live Polymarket stream is running with warnings. Last request error: ${error}`
      : "Live Polymarket market and account updates are flowing.",
    data,
    updatedAt: lastSuccessfulAt ?? data.generatedAt,
    source: "/api/trading-ops/polymarket/live/stream",
    warnings: error ? [error, ...data.warnings] : data.warnings,
  };
}

function buildPendingArtifact<T>(label: string, error: string | null): ArtifactState<T> {
  return {
    state: "missing",
    label,
    message: error ? "Waiting for first Polymarket snapshot." : `${label}.`,
    data: null,
    updatedAt: null,
    source: "/api/trading-ops/polymarket",
    warnings: error && !isTransientPolymarketLoadingMessage(error) ? [error] : [],
    badgeText: "loading",
  };
}

function buildWarmupArtifact<T>(label: string, message: string, source: string): ArtifactState<T> {
  return {
    state: "missing",
    label,
    message,
    data: null,
    updatedAt: null,
    source,
    warnings: [],
    badgeText: "loading",
  };
}

function isPolymarketLiveReady(data: TradingOpsPolymarketLiveData | null): boolean {
  if (!data) {
    return false;
  }

  return data.streamer.marketsConnected && data.streamer.privateConnected;
}

function shouldKeepPolymarketNeutral(options: {
  warmupComplete: boolean;
  data: TradingOpsPolymarketData | null;
  dataError: string | null;
  liveData: TradingOpsPolymarketLiveData | null;
  liveError: string | null;
  handoffPending: boolean;
}): boolean {
  if (!options.warmupComplete && !isPolymarketLiveReady(options.liveData)) {
    return true;
  }

  if (options.handoffPending) {
    return true;
  }

  if (isPolymarketLiveLoading(options.liveData, options.liveError)) {
    return true;
  }

  if (!options.data && isTransientPolymarketLoadingMessage(options.dataError)) {
    return true;
  }

  return [options.data?.account, options.data?.signal, options.data?.watchlist].every((artifact) => isLoadingArtifact(artifact));
}

function isPolymarketAggregateHandoffPending(options: {
  data: TradingOpsPolymarketData | null;
  liveData: TradingOpsPolymarketLiveData | null;
}): boolean {
  if (!options.data || !options.liveData) {
    return false;
  }

  const liveBoardReady =
    options.liveData.streamer.marketsConnected ||
    options.liveData.streamer.trackedMarketCount > 0 ||
    options.liveData.markets.length > 0;
  const livePrivateReady =
    options.liveData.streamer.privateConnected ||
    options.liveData.streamer.lastPrivateMessageAt != null ||
    options.liveData.account.lastBalanceUpdateAt != null;

  const accountPending = livePrivateReady && (options.data.account.state === "missing" || options.data.account.state === "error");
  const signalPending = liveBoardReady && isLoadingArtifact(options.data.signal);
  const watchlistPending = liveBoardReady && isLoadingArtifact(options.data.watchlist);

  return accountPending || signalPending || watchlistPending;
}

function isLoadingArtifact(artifact: ArtifactState<unknown> | null | undefined): boolean {
  if (!artifact || artifact.state !== "missing") {
    return false;
  }

  if (artifact.badgeText === "loading") {
    return true;
  }

  return /waiting for/i.test(artifact.message) || /loading/i.test(artifact.label);
}

function isPolymarketLiveLoading(
  data: TradingOpsPolymarketLiveData | null,
  error: string | null,
): boolean {
  if (!data) {
    return isTransientPolymarketLoadingMessage(error);
  }

  if (data.streamer.marketsConnected || data.streamer.privateConnected) {
    return false;
  }

  if (data.streamer.lastMarketMessageAt || data.streamer.lastPrivateMessageAt) {
    return false;
  }

  if (data.markets.length > 0) {
    return false;
  }

  const startupSignals = [
    data.streamer.operatorState,
    data.streamer.lastError,
    error,
    ...data.warnings,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  return startupSignals.length === 0 || startupSignals.every((value) => isTransientPolymarketLoadingMessage(value));
}

function isTransientPolymarketLoadingMessage(message: string | null | undefined): boolean {
  if (typeof message !== "string") {
    return false;
  }

  return TRANSIENT_POLYMARKET_LOADING_PATTERNS.some((pattern) => pattern.test(message));
}

function summarizeArtifactStates(states: Array<TradingOpsPolymarketData["account"]["state"]>): TradingOpsPolymarketData["account"]["state"] {
  if (states.includes("error")) return "error";
  if (states.includes("degraded")) return "degraded";
  if (states.includes("ok")) return "ok";
  return "missing";
}

function newestTimestamp(values: Array<string | null | undefined>): string | null {
  const timestamps = values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => ({ value, time: Date.parse(value) }))
    .filter((entry) => !Number.isNaN(entry.time))
    .sort((left, right) => right.time - left.time);

  return timestamps[0]?.value ?? null;
}

function collectTradingRunSymbols(data: TradingOpsDashboardData): Set<string> {
  const tradingRun = data.tradingRun.data;
  if (!tradingRun) return new Set<string>();

  return new Set(
    [
      ...tradingRun.dipBuyerBuy,
      ...tradingRun.dipBuyerWatch,
      ...tradingRun.dipBuyerNoBuy,
      ...tradingRun.canslimBuy,
      ...tradingRun.canslimWatch,
      ...tradingRun.canslimNoBuy,
    ].map((symbol) => symbol.toUpperCase()),
  );
}

function formatLabel(value: string | null | undefined): string {
  if (!value) return "n/a";
  return value.replaceAll("_", " ");
}

function formatProbability(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return `${Math.round(value * 100)}%`;
}

function formatProbabilityDelta(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "24h n/a";
  const points = Math.round(value * 100);
  const sign = points > 0 ? "+" : "";
  return `${sign}${points} pts/24h`;
}

function badgeVariantForMarketSeverity(severity: string) {
  if (severity === "major") return "warning" as const;
  if (severity === "notable") return "info" as const;
  return "outline" as const;
}

function badgeVariantForPolymarketStreamer(data: TradingOpsPolymarketLiveData) {
  if (data.streamer.marketsConnected && data.streamer.privateConnected) return "success" as const;
  if (data.streamer.marketsConnected || data.streamer.privateConnected) return "warning" as const;
  return "outline" as const;
}

function formatMarketPrice(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return `$${value.toFixed(value >= 1 ? 3 : 4)}`;
}

function formatMarketQuantity(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return value >= 1000 ? value.toLocaleString() : String(Number(value.toFixed(2)));
}

function renderPolymarketMarketCard(
  market: TradingOpsPolymarketLiveData["markets"][number],
  options: { pending: boolean; result: PolymarketResultRow | null; rosterNew?: boolean; onToggle: () => void },
) {
  return <PolymarketMarketCard key={market.slug} market={market} options={options} />;
}

function PolymarketMarketCard({
  market,
  options,
}: {
  market: TradingOpsPolymarketLiveData["markets"][number];
  options: { pending: boolean; result: PolymarketResultRow | null; rosterNew?: boolean; onToggle: () => void };
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

function RosterMetric({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-border/50 bg-muted/20 px-2 py-1.5 transition-[background-color,border-color,box-shadow] duration-700",
        highlight && "border-amber-300/60 bg-amber-50/60 shadow-[0_0_0_1px_rgba(245,158,11,0.18)]",
      )}
    >
      <p className="terminal-metric-label">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-medium leading-tight">{value}</p>
    </div>
  );
}

function RosterChangeSummary({
  state,
}: {
  state: ReturnType<typeof usePolymarketRosterState>;
}) {
  if (!state.badgeLabel && !state.updatedAt) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {state.badgeLabel ? (
        <Badge
          variant="outline"
          className="border-amber-300/70 bg-amber-100/80 text-[10px] text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/15 dark:text-amber-200"
        >
          {state.badgeLabel}
        </Badge>
      ) : null}
      {state.updatedAt ? (
        <p className="text-amber-800/90 dark:text-amber-200/90">
          Roster updated {formatOperatorTimestamp(state.updatedAt)}.
        </p>
      ) : null}
    </div>
  );
}

function formatDetailedMoney(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatSignedDetailedMoney(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatDetailedMoney(Math.abs(value))}`;
}

function signedValueTextClass(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "text-foreground";
  if (value > 0) return "text-emerald-600 dark:text-emerald-400";
  if (value < 0) return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

function derivePinnedCurrentValue(
  market: TradingOpsPolymarketLiveData["markets"][number],
  result: PolymarketResultRow | null,
): number | null {
  if (!result) {
    return null;
  }

  if (result.currentValue != null) {
    return result.currentValue;
  }

  if (result.netPosition == null) {
    return null;
  }

  const mark =
    market.lastTrade ??
    (market.bestBid != null && market.bestAsk != null ? (market.bestBid + market.bestAsk) / 2 : null) ??
    market.bestBid ??
    market.bestAsk;

  return mark == null ? null : Number((mark * result.netPosition).toFixed(4));
}

function usePolymarketFlashClass(values: {
  bid: number | null;
  ask: number | null;
  last: number | null;
  spread: number | null;
}): string {
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prevRef = useRef(values);
  const timerRef = useRef(0);

  useEffect(() => {
    const previous = prevRef.current;
    prevRef.current = values;
    if (!previous) return;

    const currentMark = preferredFlashMark(values);
    const previousMark = preferredFlashMark(previous);
    if (currentMark == null || previousMark == null || currentMark === previousMark) {
      if (
        previous.bid !== values.bid ||
        previous.ask !== values.ask ||
        previous.last !== values.last ||
        previous.spread !== values.spread
      ) {
        setFlash("up");
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => setFlash(null), 1100);
      }
      return;
    }

    setFlash(currentMark > previousMark ? "up" : "down");
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setFlash(null), 1100);
  }, [values]);

  if (flash === "up") return "bg-emerald-500/14 border-emerald-500/40 shadow-[0_0_0_1px_rgba(16,185,129,0.22)]";
  if (flash === "down") return "bg-red-500/12 border-red-500/35 shadow-[0_0_0_1px_rgba(239,68,68,0.18)]";
  return "";
}

function preferredFlashMark(values: {
  bid: number | null;
  ask: number | null;
  last: number | null;
  spread: number | null;
}): number | null {
  if (values.last != null) return values.last;
  if (values.bid != null && values.ask != null) return (values.bid + values.ask) / 2;
  return values.bid ?? values.ask ?? values.spread;
}

function usePolymarketRosterState(
  rows: TradingOpsPolymarketLiveData["markets"],
  updatedAt: string | null,
) {
  const [newSlugs, setNewSlugs] = useState<string[]>([]);
  const [badgeLabel, setBadgeLabel] = useState<string | null>(null);
  const [highlightedUpdatedAt, setHighlightedUpdatedAt] = useState<string | null>(null);
  const [leaderChanged, setLeaderChanged] = useState(false);
  const previousSlugsRef = useRef<string[] | null>(null);
  const previousLeaderRef = useRef<string | null>(null);
  const newTimerRef = useRef(0);
  const badgeTimerRef = useRef(0);

  useEffect(() => {
    return () => {
      window.clearTimeout(newTimerRef.current);
      window.clearTimeout(badgeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const currentSlugs = rows.map((row) => row.slug);
    const currentLeader = rows[0]?.slug ?? null;
    const previousSlugs = previousSlugsRef.current;
    const previousLeader = previousLeaderRef.current;

    previousSlugsRef.current = currentSlugs;
    previousLeaderRef.current = currentLeader;

    if (!previousSlugs) return;

    const previousSet = new Set(previousSlugs);
    const currentSet = new Set(currentSlugs);
    const entering = currentSlugs.filter((slug) => !previousSet.has(slug));
    const leaving = previousSlugs.filter((slug) => !currentSet.has(slug));
    const membershipChanged = entering.length > 0 || leaving.length > 0;
    const hasLeaderChange = Boolean(previousLeader && currentLeader && previousLeader !== currentLeader);

    if (!membershipChanged && !hasLeaderChange) {
      return;
    }

    if (entering.length > 0) {
      setNewSlugs((current) => Array.from(new Set([...current, ...entering])));
      window.clearTimeout(newTimerRef.current);
      newTimerRef.current = window.setTimeout(() => setNewSlugs([]), 10_000);
    }

    setLeaderChanged(hasLeaderChange);
    setHighlightedUpdatedAt(updatedAt);
    setBadgeLabel(entering.length > 0 ? `${entering.length} new` : "updated");
    window.clearTimeout(badgeTimerRef.current);
    badgeTimerRef.current = window.setTimeout(() => {
      setBadgeLabel(null);
      setHighlightedUpdatedAt(null);
      setLeaderChanged(false);
    }, 8_000);
  }, [rows, updatedAt]);

  return {
    newSlugs: new Set(newSlugs),
    badgeLabel,
    updatedAt: highlightedUpdatedAt,
    leaderChanged,
  };
}

function describePolymarketBoardEmptyState(options: {
  bucket: "events" | "sports";
  visibleCount: number;
  pinnedCount: number;
  candidateCount: number;
  warnings: string[];
}): { kind: "active" | "exhausted" | "warning" | "waiting"; message: string; detail: string } {
  if (options.visibleCount > 0) {
    return { kind: "active", message: "", detail: "" };
  }

  const bucketLabel = options.bucket === "events" ? "event" : "sports";
  if (options.candidateCount > 0 && options.pinnedCount >= options.candidateCount) {
    return {
      kind: "exhausted",
      message: `All current ${bucketLabel} candidates are pinned.`,
      detail: `Remove a pinned ${bucketLabel} market to resume the rotating board.`,
    };
  }

  if (options.warnings.length > 0) {
    return {
      kind: "warning",
      message: `Live ${bucketLabel} roster is temporarily unavailable.`,
      detail: options.warnings[0] ?? `Waiting for the next ${bucketLabel} board refresh.`,
    };
  }

  return {
    kind: "waiting",
    message: `Waiting for live ${bucketLabel} contracts.`,
    detail: `Waiting for the first live ${bucketLabel} rotation.`,
  };
}

function isPolymarketPayload(value: unknown): value is TradingOpsPolymarketData {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Boolean(record.account && record.signal && record.watchlist && record.results);
}

function isPolymarketLivePayload(value: unknown): value is TradingOpsPolymarketLiveData {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Boolean(record.streamer && record.account && Array.isArray(record.markets));
}
