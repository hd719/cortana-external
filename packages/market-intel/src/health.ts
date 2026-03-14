import { readFile } from "node:fs/promises";

import {
  DEFAULT_COMPACT_REPORT_PATH,
  DEFAULT_REGISTRY_PATH,
  DEFAULT_REPORT_JSON_PATH,
  DEFAULT_WATCHLIST_JSON_PATH,
} from "./paths.js";
import { PolymarketClient } from "./polymarket-client.js";
import { loadRegistry, matchesSelectorFilters } from "./registry.js";
import type {
  ArtifactFileHealth,
  ArtifactHealthReport,
  MarketIntelLogger,
  RegistryEntry,
  RegistryEntryHealth,
  RegistryHealthReport,
  RegistryReplacementSuggestion,
} from "./types.js";

export async function auditRegistryHealth(options: {
  registryPath?: string;
  fetchImpl?: typeof fetch;
  logger?: MarketIntelLogger;
  now?: Date;
} = {}): Promise<RegistryHealthReport> {
  const registryPath = options.registryPath ?? DEFAULT_REGISTRY_PATH;
  const checkedAt = (options.now ?? new Date()).toISOString();
  const registry = await loadRegistry(registryPath);
  const client = new PolymarketClient({
    fetchImpl: options.fetchImpl,
    logger: options.logger,
  });

  const entries = await Promise.all(
    registry.entries.map(async (entry) => inspectRegistryEntry(entry, client)),
  );

  return {
    checkedAt,
    registryPath,
    healthy: entries.filter((entry) => entry.status === "healthy").length,
    fallbackOnly: entries.filter((entry) => entry.status === "fallback_only").length,
    broken: entries.filter((entry) => entry.status === "broken").length,
    requiredBroken: entries.filter((entry) => entry.status === "broken" && entry.required).length,
    optionalBroken: entries.filter((entry) => entry.status === "broken" && !entry.required).length,
    entries,
  };
}

export async function assessArtifactHealth(options: {
  reportJsonPath?: string;
  compactReportPath?: string;
  watchlistJsonPath?: string;
  maxAgeHours?: number;
  minTopMarkets?: number;
  minWatchlistCount?: number;
  now?: Date;
} = {}): Promise<ArtifactHealthReport> {
  const reportJsonPath = options.reportJsonPath ?? DEFAULT_REPORT_JSON_PATH;
  const compactReportPath = options.compactReportPath ?? DEFAULT_COMPACT_REPORT_PATH;
  const watchlistJsonPath = options.watchlistJsonPath ?? DEFAULT_WATCHLIST_JSON_PATH;
  const maxAgeHours = options.maxAgeHours ?? 8;
  const minTopMarkets = options.minTopMarkets ?? 1;
  const minWatchlistCount = options.minWatchlistCount ?? 1;
  const now = options.now ?? new Date();
  const failures: string[] = [];

  const [reportFile, compactFile, watchlistFile] = await Promise.all([
    readTextFile(reportJsonPath),
    readTextFile(compactReportPath),
    readTextFile(watchlistJsonPath),
  ]);

  const reportJsonHealth = buildFileHealth(reportJsonPath, reportFile);
  const compactTextHealth = buildFileHealth(compactReportPath, compactFile);
  const watchlistJsonHealth = buildFileHealth(watchlistJsonPath, watchlistFile);

  let generatedAt: string | null = null;
  let ageHours: number | null = null;
  let topMarkets = 0;
  let watchlistCount = 0;
  let overlay: string | null = null;

  if (!reportFile.exists) failures.push("latest report JSON is missing");
  if (!compactFile.exists) failures.push("latest compact report is missing");
  if (!watchlistFile.exists) failures.push("watchlist export is missing");

  if (reportFile.contents != null) {
    try {
      const payload = JSON.parse(reportFile.contents) as {
        metadata?: { generatedAt?: string };
        topMarkets?: unknown[];
        overlay?: { alignment?: string };
      };
      generatedAt = payload.metadata?.generatedAt ?? null;
      topMarkets = Array.isArray(payload.topMarkets) ? payload.topMarkets.length : 0;
      overlay = payload.overlay?.alignment ?? null;

      if (!generatedAt) {
        failures.push("latest report JSON is missing metadata.generatedAt");
      } else {
        ageHours = (now.getTime() - new Date(generatedAt).getTime()) / 3_600_000;
        if (!Number.isFinite(ageHours)) {
          failures.push("latest report JSON has an invalid generatedAt timestamp");
          ageHours = null;
        } else if (ageHours > maxAgeHours) {
          failures.push(`report artifacts are stale (${ageHours.toFixed(2)}h old)`);
          reportJsonHealth.fresh = false;
          compactTextHealth.fresh = false;
          watchlistJsonHealth.fresh = false;
        }
      }

      if (topMarkets < minTopMarkets) {
        failures.push(`top market count ${topMarkets} is below threshold ${minTopMarkets}`);
      }
    } catch {
      failures.push("latest report JSON is invalid");
      reportJsonHealth.detail = "invalid JSON";
    }
  }

  if (watchlistFile.contents != null) {
    try {
      const payload = JSON.parse(watchlistFile.contents) as {
        tickers?: unknown[];
      };
      watchlistCount = Array.isArray(payload.tickers) ? payload.tickers.length : 0;
      if (watchlistCount < minWatchlistCount) {
        failures.push(`watchlist count ${watchlistCount} is below threshold ${minWatchlistCount}`);
      }
    } catch {
      failures.push("watchlist export JSON is invalid");
      watchlistJsonHealth.detail = "invalid JSON";
    }
  }

  if (compactFile.contents != null && compactFile.contents.trim().length === 0) {
    failures.push("latest compact report is empty");
    compactTextHealth.detail = "empty file";
  }

  const ok = failures.length === 0;

  return {
    checkedAt: now.toISOString(),
    ok,
    stale: failures.some((failure) => failure.includes("stale")),
    generatedAt,
    ageHours: ageHours == null ? null : round(ageHours, 2),
    topMarkets,
    watchlistCount,
    overlay,
    files: {
      reportJson: reportJsonHealth,
      compactText: compactTextHealth,
      watchlistJson: watchlistJsonHealth,
    },
    failures,
  };
}

export function formatRegistryHealthReport(report: RegistryHealthReport): string {
  const lines = [
    `Registry audit: ${report.healthy} healthy, ${report.fallbackOnly} fallback-only, ${report.broken} broken (${report.requiredBroken} required, ${report.optionalBroken} optional)`,
  ];

  for (const entry of report.entries) {
    lines.push(
      `- ${entry.title}: ${entry.status}${entry.required ? "" : " (optional)"} | exact ${entry.exactMatchCount} | fallback ${entry.fallbackMatchCount} | ${entry.reason}`,
    );
    if (entry.suggestions.length > 0) {
      lines.push(
        `  suggestions: ${entry.suggestions
          .map((suggestion) => `${suggestion.slug} (${Math.round(suggestion.liquidity)}/liq)`)
          .join(", ")}`,
      );
    }
  }

  return lines.join("\n");
}

export function formatArtifactHealthReport(report: ArtifactHealthReport): string {
  const lines = [
    `Artifact watchdog: ${report.ok ? "ok" : "failed"}`,
    `- generatedAt: ${report.generatedAt ?? "missing"}`,
    `- ageHours: ${report.ageHours == null ? "unknown" : report.ageHours}`,
    `- topMarkets: ${report.topMarkets}`,
    `- watchlistCount: ${report.watchlistCount}`,
  ];

  if (report.failures.length > 0) {
    for (const failure of report.failures) {
      lines.push(`- failure: ${failure}`);
    }
  }

  return lines.join("\n");
}

async function inspectRegistryEntry(
  entry: RegistryEntry,
  client: PolymarketClient,
): Promise<RegistryEntryHealth> {
  const exact = dedupeBySlug(
    [
      ...(await client.fetchByMarketSlugs(entry.selectors.marketSlugs)),
      ...(await client.fetchByEventSlugs(entry.selectors.eventSlugs)),
    ].filter((candidate) =>
      matchesSelectorFilters(entry, haystack(candidate.event?.title, candidate.event?.slug, candidate.market.question, candidate.market.slug, candidate.market.description)),
    ),
  );
  const fallback = entry.selectors.keywords.length > 0
    ? dedupeBySlug(await client.fetchByKeywords(entry))
    : [];
  const selected = dedupeBySlug([...exact, ...fallback]);

  if (exact.length > 0) {
    return {
      entryId: entry.id,
      title: entry.title,
      required: entry.required !== false,
      status: "healthy",
      exactMatchCount: exact.length,
      fallbackMatchCount: fallback.length,
      selectedCandidateCount: selected.length,
      suggestions: [],
      reason: "exact selector matches are available",
    };
  }

  if (fallback.length > 0) {
    return {
      entryId: entry.id,
      title: entry.title,
      required: entry.required !== false,
      status: "fallback_only",
      exactMatchCount: 0,
      fallbackMatchCount: fallback.length,
      selectedCandidateCount: selected.length,
      suggestions: buildSuggestions(fallback),
      reason: "exact selectors did not match; keyword fallback still found candidates",
    };
  }

  return {
    entryId: entry.id,
    title: entry.title,
    required: entry.required !== false,
    status: "broken",
    exactMatchCount: 0,
    fallbackMatchCount: 0,
    selectedCandidateCount: 0,
    suggestions: [],
    reason: "no exact or fallback candidates were found",
  };
}

function buildSuggestions(
  candidates: Awaited<ReturnType<PolymarketClient["fetchByKeywords"]>>,
): RegistryReplacementSuggestion[] {
  return candidates
    .map((candidate) => ({
      slug: String(candidate.market.slug ?? candidate.event?.slug ?? "unknown"),
      title: String(candidate.market.question ?? candidate.event?.title ?? "Unknown market"),
      selectionSource: candidate.selectionSource,
      liquidity: readNumeric(
        candidate.market.liquidityNum,
        candidate.market.liquidityClob,
        candidate.market.liquidity,
        candidate.event?.liquidity,
      ),
      volume24h: readNumeric(
        candidate.market.volume24hr,
        candidate.market.volume24hrClob,
        candidate.market.volumeNum,
        candidate.market.volume,
        candidate.event?.volume24hr,
      ),
    }))
    .sort((left, right) => right.liquidity - left.liquidity || right.volume24h - left.volume24h)
    .slice(0, 3);
}

function dedupeBySlug<T extends { market: { slug?: string; id?: string | number } }>(candidates: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const candidate of candidates) {
    const key = String(candidate.market.id ?? candidate.market.slug ?? "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }

  return result;
}

function haystack(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function readNumeric(...values: Array<number | string | undefined>): number {
  for (const value of values) {
    const parsed = typeof value === "string" ? Number(value) : value;
    if (typeof parsed === "number" && Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

async function readTextFile(filePath: string): Promise<{
  exists: boolean;
  contents: string | null;
}> {
  try {
    return {
      exists: true,
      contents: await readFile(filePath, "utf8"),
    };
  } catch {
    return {
      exists: false,
      contents: null,
    };
  }
}

function buildFileHealth(
  filePath: string,
  file: { exists: boolean; contents: string | null },
): ArtifactFileHealth {
  return {
    path: filePath,
    exists: file.exists,
    fresh: file.exists,
    detail: file.exists ? "ok" : "missing",
  };
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}
