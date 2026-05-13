import type {
  ArtifactState,
  PolymarketResultRow,
  TradingOpsDashboardData,
  TradingOpsPolymarketData,
  TradingOpsPolymarketLiveData,
} from "@/lib/trading-ops-contract";

export const TRANSIENT_POLYMARKET_LOADING_PATTERNS = [
  /abort(?:ed)?/iu,
  /timed?\s*out/iu,
  /timeout/iu,
  /failed to fetch/iu,
  /network(?:\s+request)?\s+failed/iu,
  /stream not ready/iu,
  /reconnect/iu,
  /waiting for first/iu,
];

export function isTransientPolymarketLoadingMessage(message: string | null | undefined): boolean {
  if (typeof message !== "string") {
    return false;
  }

  return TRANSIENT_POLYMARKET_LOADING_PATTERNS.some((pattern) => pattern.test(message));
}

export function isLoadingArtifact(artifact: ArtifactState<unknown> | null | undefined): boolean {
  if (!artifact || artifact.state !== "missing") {
    return false;
  }

  if (artifact.badgeText === "loading") {
    return true;
  }

  return /waiting for/i.test(artifact.message) || /loading/i.test(artifact.label);
}

export function isPolymarketLiveReady(data: TradingOpsPolymarketLiveData | null): boolean {
  if (!data) {
    return false;
  }

  return data.streamer.marketsConnected && data.streamer.privateConnected;
}

export function isPolymarketLiveLoading(
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

export function shouldKeepPolymarketNeutral(options: {
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

export function isPolymarketAggregateHandoffPending(options: {
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

export function summarizeArtifactStates(states: Array<TradingOpsPolymarketData["account"]["state"]>): TradingOpsPolymarketData["account"]["state"] {
  if (states.includes("error")) return "error";
  if (states.includes("degraded")) return "degraded";
  if (states.includes("ok")) return "ok";
  return "missing";
}

export function newestTimestamp(values: Array<string | null | undefined>): string | null {
  const timestamps = values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => ({ value, time: Date.parse(value) }))
    .filter((entry) => !Number.isNaN(entry.time))
    .sort((left, right) => right.time - left.time);

  return timestamps[0]?.value ?? null;
}

export function collectTradingRunSymbols(data: TradingOpsDashboardData): Set<string> {
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

export function derivePinnedCurrentValue(
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

export function preferredFlashMark(values: {
  bid: number | null;
  ask: number | null;
  last: number | null;
  spread: number | null;
}): number | null {
  if (values.last != null) return values.last;
  if (values.bid != null && values.ask != null) return (values.bid + values.ask) / 2;
  return values.bid ?? values.ask ?? values.spread;
}

export function describePolymarketBoardEmptyState(options: {
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

export function isPolymarketPayload(value: unknown): value is TradingOpsPolymarketData {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Boolean(record.account && record.signal && record.watchlist && record.results);
}

export function isPolymarketLivePayload(value: unknown): value is TradingOpsPolymarketLiveData {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Boolean(record.streamer && record.account && Array.isArray(record.markets));
}
