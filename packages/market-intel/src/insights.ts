import { classifySymbol } from "./assets.js";
import type {
  MarketIntelReport,
  NormalizedMarketSnapshot,
  OverlayAssessment,
  RegimeContext,
  ReportSummary,
  ThemeHighlight,
  WatchlistBuckets,
  WatchlistEntry,
} from "./types.js";

const WATCHLIST_ENTRY_LIMIT = 6;

export function buildWatchlistEntries(markets: NormalizedMarketSnapshot[]): WatchlistEntry[] {
  const bySymbol = new Map<string, WatchlistEntry>();

  for (const market of markets) {
    for (const symbol of market.watchTickers.filter(Boolean)) {
      const assetClass = classifySymbol(symbol);
      const existing = bySymbol.get(symbol);

      if (!existing) {
        bySymbol.set(symbol, {
          symbol,
          assetClass,
          themes: [market.theme],
          sourceTitles: [market.displayTitle],
          probability: market.probability,
          score: market.displayScore,
          severity: market.signal.severity,
          persistence: market.signal.persistence.state,
        });
        continue;
      }

      if (!existing.themes.includes(market.theme)) existing.themes.push(market.theme);
      if (!existing.sourceTitles.includes(market.displayTitle)) {
        existing.sourceTitles.push(market.displayTitle);
      }
      existing.probability = Math.max(existing.probability, market.probability);
      existing.score = Math.max(existing.score, market.displayScore);
      existing.severity = strongerSeverity(existing.severity, market.signal.severity);
      existing.persistence = strongerPersistence(existing.persistence, market.signal.persistence.state);
    }
  }

  return Array.from(bySymbol.values()).sort(
    (left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol),
  );
}

export function buildWatchlistBuckets(entries: WatchlistEntry[]): WatchlistBuckets {
  return {
    stocks: entries.filter((entry) => entry.assetClass === "stock").slice(0, WATCHLIST_ENTRY_LIMIT),
    crypto: entries.filter((entry) => entry.assetClass === "crypto").slice(0, WATCHLIST_ENTRY_LIMIT),
    cryptoProxies: entries
      .filter((entry) => entry.assetClass === "crypto_proxy")
      .slice(0, WATCHLIST_ENTRY_LIMIT),
    funds: entries.filter((entry) => entry.assetClass === "etf").slice(0, WATCHLIST_ENTRY_LIMIT),
  };
}

export function buildReportSummary(args: {
  regime: RegimeContext | null;
  overlay: OverlayAssessment;
  topMarkets: NormalizedMarketSnapshot[];
  watchlistBuckets: WatchlistBuckets;
}): ReportSummary {
  const conviction =
    args.overlay.alignment === "confirms"
      ? "supportive"
      : args.overlay.alignment === "conflicts"
        ? "conflicting"
        : "neutral";

  const majorOrNotable = args.topMarkets.filter((market) => market.signal.severity !== "minor");
  const persistentThemes = args.topMarkets.filter((market) =>
    ["persistent", "accelerating", "reversing"].includes(market.signal.persistence.state),
  );

  const divergence = buildDivergenceSummary(args.overlay, persistentThemes);
  const aggressionDial = buildAggressionDial(args.regime, args.overlay, majorOrNotable);
  const focusSectors = unique(
    args.topMarkets
      .filter((market) => market.signal.severity !== "minor" || market.signal.persistence.state !== "one_off")
      .flatMap((market) => market.sectorTags),
  ).slice(0, 5);
  const cryptoFocus = unique([
    ...args.watchlistBuckets.crypto.map((entry) => entry.symbol),
    ...args.watchlistBuckets.cryptoProxies.map((entry) => entry.symbol),
  ]).slice(0, 6);
  const themeHighlights = args.topMarkets.slice(0, 4).map(buildThemeHighlight);

  return {
    conviction,
    aggressionDial,
    divergence,
    focusSectors,
    cryptoFocus,
    themeHighlights,
  };
}

export function buildWatchlist(report: Pick<MarketIntelReport, "watchlistBuckets">): string[] {
  return [
    ...report.watchlistBuckets.stocks,
    ...report.watchlistBuckets.cryptoProxies,
    ...report.watchlistBuckets.funds,
    ...report.watchlistBuckets.crypto,
  ]
    .slice(0, 10)
    .map((entry) => entry.symbol);
}

function buildDivergenceSummary(
  overlay: OverlayAssessment,
  persistentThemes: NormalizedMarketSnapshot[],
): ReportSummary["divergence"] {
  if (overlay.alignment === "conflicts") {
    if (
      persistentThemes.some(
        (market) =>
          market.signal.severity !== "minor" &&
          ["persistent", "accelerating"].includes(market.signal.persistence.state),
      )
    ) {
      return {
        state: "persistent",
        summary: "Persistent divergence",
        reason: "Polymarket is still leaning away from the equity tape across multiple runs.",
        themes: persistentThemes.slice(0, 3).map((market) => market.displayTitle),
      };
    }
    return {
      state: "watch",
      summary: "Divergence watch",
      reason: "Prediction-market context is conflicting with the current regime.",
      themes: persistentThemes.slice(0, 3).map((market) => market.displayTitle),
    };
  }

  if (overlay.alignment === "mixed") {
    return {
      state: "watch",
      summary: "Mixed theme watch",
      reason: "Macro/event themes are split, so treat follow-through with more care.",
      themes: persistentThemes.slice(0, 3).map((market) => market.displayTitle),
    };
  }

  return {
    state: "none",
    summary: "No major divergence",
    reason: "No sustained conflict between Polymarket context and the base regime is currently flagged.",
    themes: [],
  };
}

function buildAggressionDial(
  regime: RegimeContext | null,
  overlay: OverlayAssessment,
  majorOrNotable: NormalizedMarketSnapshot[],
): ReportSummary["aggressionDial"] {
  const hasActionableContext = majorOrNotable.length > 0;
  const weakRegime =
    !regime ||
    regime.regime === "correction" ||
    regime.regime === "uptrend_under_pressure" ||
    regime.status === "degraded";

  if (overlay.alignment === "conflicts" || (overlay.alignment === "confirms" && weakRegime)) {
    return "lean_more_selective";
  }

  if (overlay.alignment === "confirms" && hasActionableContext && !weakRegime) {
    return "lean_more_aggressive";
  }

  return "no_change";
}

function buildThemeHighlight(market: NormalizedMarketSnapshot): ThemeHighlight {
  return {
    registryEntryId: market.registryEntryId,
    title: market.displayTitle,
    theme: market.theme,
    probability: market.probability,
    direction: market.signal.direction,
    severity: market.signal.severity,
    persistence: market.signal.persistence.state,
    regimeEffect: market.impact.regimeEffect,
    watchTickers: market.watchTickers,
  };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function strongerSeverity(
  left: WatchlistEntry["severity"],
  right: WatchlistEntry["severity"],
): WatchlistEntry["severity"] {
  return severityRank(right) > severityRank(left) ? right : left;
}

function strongerPersistence(
  left: WatchlistEntry["persistence"],
  right: WatchlistEntry["persistence"],
): WatchlistEntry["persistence"] {
  return persistenceRank(right) > persistenceRank(left) ? right : left;
}

function severityRank(value: WatchlistEntry["severity"]): number {
  switch (value) {
    case "major":
      return 3;
    case "notable":
      return 2;
    case "minor":
      return 1;
  }
}

function persistenceRank(value: WatchlistEntry["persistence"]): number {
  switch (value) {
    case "accelerating":
      return 4;
    case "persistent":
      return 3;
    case "reversing":
      return 2;
    case "one_off":
      return 1;
  }
}
