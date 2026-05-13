import type {
  ArtifactState,
  TradingOpsLiveData,
  TradingOpsPolymarketData,
  TradingOpsPolymarketLiveData,
} from "@/lib/trading-ops-contract";
import {
  isPolymarketLiveLoading,
  isTransientPolymarketLoadingMessage,
  newestTimestamp,
  summarizeArtifactStates,
} from "./polymarket-helpers";

export type LiveExecutionGateOverview = {
  verdictLabel: string;
  buyCount: number;
  freshBuyCount: number;
  watchCount: number;
  degradedWatchCount: number;
  staleWatchCount: number;
  actionItems: string[];
};

export function buildLiveExecutionGateArtifact(
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

export function buildLiveArtifact(
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

export function buildPolymarketStatusArtifact(
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

export function buildPolymarketLiveArtifact(
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

export function buildPendingArtifact<T>(label: string, error: string | null): ArtifactState<T> {
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

export function buildWarmupArtifact<T>(label: string, message: string, source: string): ArtifactState<T> {
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
