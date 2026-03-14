import { computeFourHourChanges, computeThemePersistence, persistHistory } from "./history.js";
import { buildReportSummary, buildWatchlist, buildWatchlistBuckets, buildWatchlistEntries } from "./insights.js";
import { normalizeCandidate } from "./normalize.js";
import { analyzeOverlay } from "./overlay.js";
import {
  DEFAULT_HISTORY_DIR,
  DEFAULT_LATEST_PATH,
  DEFAULT_REGISTRY_PATH,
  DEFAULT_REGIME_PATH,
} from "./paths.js";
import { PolymarketClient } from "./polymarket-client.js";
import { loadRegistry } from "./registry.js";
import { loadRegimeContext } from "./regime.js";
import { buildMarketSignal } from "./signals.js";
import { createConsoleLogger } from "./logger.js";
import type {
  BuildPolymarketIntelReportOptions,
  MarketIntelReport,
  NormalizedMarketSnapshot,
  SuppressedMarket,
} from "./types.js";

export async function buildPolymarketIntelReport(
  options: BuildPolymarketIntelReportOptions = {},
): Promise<MarketIntelReport> {
  const now = options.now ?? new Date();
  const generatedAt = now.toISOString();
  const registryPath = options.registryPath ?? DEFAULT_REGISTRY_PATH;
  const historyDir = options.historyDir ?? DEFAULT_HISTORY_DIR;
  const latestPath = options.latestPath ?? DEFAULT_LATEST_PATH;
  const regimePath =
    typeof options.regimeInput === "string"
      ? options.regimeInput
      : options.regimeInput
        ? "inline"
        : DEFAULT_REGIME_PATH;
  const warnings: string[] = [];
  const suppressedMarkets: SuppressedMarket[] = [];
  const logger = options.logger ?? createConsoleLogger(false);

  logger.info("market_intel_build_start", {
    registryPath,
    historyDir,
    latestPath,
    regimePath,
  });

  const [registry, regime] = await Promise.all([
    loadRegistry(registryPath),
    loadRegimeContext(options.regimeInput ?? undefined),
  ]);

  const client = new PolymarketClient({ fetchImpl: options.fetchImpl, logger });
  const fetched = await Promise.allSettled(
    registry.entries.map(async (entry) => ({
      entry,
      candidates: await client.fetchRegistryEntryCandidates(entry),
    })),
  );

  const rawMarkets: Array<{ entryIndex: number; marketId: string; probability: number }> = [];
  const candidatesByEntry = new Map<string, Awaited<ReturnType<PolymarketClient["fetchRegistryEntryCandidates"]>>>();

  fetched.forEach((result, index) => {
    const entry = registry.entries[index];
    if (result.status === "rejected") {
      warnings.push(`Polymarket fetch failed for ${entry.title}: ${String(result.reason)}`);
      logger.warn("market_intel_entry_fetch_failed", {
        entryId: entry.id,
        title: entry.title,
        error: String(result.reason),
      });
      return;
    }
    logger.debug("market_intel_entry_fetch_success", {
      entryId: entry.id,
      title: entry.title,
      candidates: result.value.candidates.length,
    });
    candidatesByEntry.set(entry.id, result.value.candidates);
    for (const candidate of result.value.candidates) {
      const probability = deriveCandidateProbability(candidate.market);
      if (probability != null) {
        rawMarkets.push({
          entryIndex: index,
          marketId: String(candidate.market.id ?? candidate.market.slug ?? `${index}`),
          probability,
        });
      }
    }
  });

  const fourHourChanges = await computeFourHourChanges({
    historyDir,
    now,
    markets: rawMarkets.map((market) => ({
      marketId: market.marketId,
      probability: market.probability,
    })),
  });

  const normalized: NormalizedMarketSnapshot[] = [];

  for (const entry of registry.entries) {
    const candidates = candidatesByEntry.get(entry.id) ?? [];
    if (candidates.length === 0) {
      logger.info("market_intel_entry_no_candidates", {
        entryId: entry.id,
        title: entry.title,
      });
      suppressedMarkets.push({
        registryEntryId: entry.id,
        title: entry.title,
        slug: entry.selectors.marketSlugs[0] ?? entry.selectors.eventSlugs[0] ?? entry.theme,
        reason: "no matching markets found",
      });
      continue;
    }

    const normalizedCandidates = candidates
      .map((candidate) =>
        normalizeCandidate({
          candidate,
          registryEntry: entry,
          fetchedAt: generatedAt,
          now,
          change4h: fourHourChanges.get(String(candidate.market.id ?? candidate.market.slug ?? "")) ?? null,
        }),
      )
      .filter((candidate): candidate is NormalizedMarketSnapshot => candidate != null)
      .sort((left, right) => {
        const tierDiff = tierRank(right.quality.tier) - tierRank(left.quality.tier);
        if (tierDiff !== 0) return tierDiff;
        return right.displayScore - left.displayScore;
      });

    const winner = normalizedCandidates[0];
    if (!winner) {
      logger.warn("market_intel_entry_not_normalized", {
        entryId: entry.id,
        title: entry.title,
      });
      suppressedMarkets.push({
        registryEntryId: entry.id,
        title: entry.title,
        slug: entry.theme,
        reason: "matched markets could not be normalized",
      });
      continue;
    }

    normalized.push(winner);

    for (const suppressed of normalizedCandidates.slice(1)) {
      suppressedMarkets.push({
        registryEntryId: entry.id,
        title: suppressed.title,
        slug: suppressed.slug,
        reason: "duplicate candidate suppressed in favor of stronger contract",
      });
    }
  }

  const eligible = normalized
    .filter((market) => market.quality.tier !== "ignore")
    .sort((left, right) => right.displayScore - left.displayScore);

  const persistenceByMarket = await computeThemePersistence({
    historyDir,
    now,
    markets: eligible.map((market) => ({
      marketId: market.marketId,
      registryEntryId: market.registryEntryId,
      probability: market.probability,
    })),
  });

  const enrichedEligible = eligible.map((market) => ({
    ...market,
    signal: buildMarketSignal({
      market,
      persistence:
        persistenceByMarket.get(market.marketId) ?? {
          state: "one_off",
          score: 0.35,
          observedRuns: 1,
          summary: "No local run history yet.",
          latestPriorProbability: null,
        },
    }),
  }));

  for (const market of normalized) {
    if (market.quality.tier === "ignore") {
      suppressedMarkets.push({
        registryEntryId: market.registryEntryId,
        title: market.title,
        slug: market.slug,
        reason: market.quality.reasons.join("; ") || "quality score below threshold",
      });
    }
  }

  const maxMarkets = options.maxMarkets ?? 5;
  const topMarkets = enrichedEligible.slice(0, maxMarkets);
  const overlay = analyzeOverlay(regime, topMarkets);
  const watchlistEntries = buildWatchlistEntries(topMarkets);
  const watchlistBuckets = buildWatchlistBuckets(watchlistEntries);
  const watchlist = buildWatchlist({ watchlistBuckets });
  const summary = buildReportSummary({
    regime,
    overlay,
    topMarkets,
    watchlistBuckets,
  });

  const report: MarketIntelReport = {
    metadata: {
      registryPath,
      historyDir,
      latestPath,
      regimePath,
      generatedAt,
      persisted: Boolean(options.persistHistory),
    },
    regime,
    markets: enrichedEligible,
    topMarkets,
    watchlist,
    watchlistBuckets,
    overlay,
    summary,
    warnings,
    suppressedMarkets,
  };

  if (options.persistHistory) {
    await persistHistory({
      latestPath,
      historyDir,
      generatedAt,
      markets: eligible,
      maxSnapshots: options.historyMaxSnapshots,
      maxAgeDays: options.historyMaxAgeDays,
    });
    logger.info("market_intel_history_persisted", {
      latestPath,
      historyDir,
      markets: eligible.length,
    });
  }

  logger.info("market_intel_build_complete", {
    markets: report.markets.length,
    topMarkets: report.topMarkets.length,
    warnings: report.warnings.length,
    suppressed: report.suppressedMarkets.length,
    overlay: report.overlay.alignment,
    conviction: report.summary.conviction,
  });

  return report;
}

function tierRank(tier: NormalizedMarketSnapshot["quality"]["tier"]): number {
  switch (tier) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    case "ignore":
      return 0;
  }
}

function deriveCandidateProbability(market: { lastTradePrice?: number; outcomePrices?: string | string[] }) {
  if (typeof market.lastTradePrice === "number" && Number.isFinite(market.lastTradePrice)) {
    return market.lastTradePrice;
  }
  if (Array.isArray(market.outcomePrices) && market.outcomePrices.length > 0) {
    const parsed = Number(market.outcomePrices[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof market.outcomePrices === "string") {
    try {
      const parsed = JSON.parse(market.outcomePrices) as string[];
      const first = Number(parsed[0]);
      return Number.isFinite(first) ? first : null;
    } catch {
      return null;
    }
  }
  return null;
}
