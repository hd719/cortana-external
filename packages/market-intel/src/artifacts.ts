import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { formatCompactReport, formatVerboseReport, toJsonReport } from "./report.js";
import type { MarketIntelReport } from "./types.js";

export interface ArtifactWriteOptions {
  artifactDir: string;
  watchlistExportPath: string;
}

export async function writeIntegrationArtifacts(
  report: MarketIntelReport,
  options: ArtifactWriteOptions,
): Promise<void> {
  await mkdir(options.artifactDir, { recursive: true });
  await mkdir(path.dirname(options.watchlistExportPath), { recursive: true });

  await Promise.all([
    writeAtomic(path.join(options.artifactDir, "latest-report.json"), toJsonReport(report) + "\n"),
    writeAtomic(path.join(options.artifactDir, "latest-compact.txt"), formatCompactReport(report) + "\n"),
    writeAtomic(path.join(options.artifactDir, "latest-verbose.txt"), formatVerboseReport(report) + "\n"),
    writeAtomic(
      path.join(options.artifactDir, "latest-watchlist.json"),
      JSON.stringify(buildWatchlistPayload(report), null, 2) + "\n",
    ),
    writeAtomic(
      options.watchlistExportPath,
      JSON.stringify(buildWatchlistPayload(report), null, 2) + "\n",
    ),
  ]);
}

export function buildWatchlistPayload(report: MarketIntelReport) {
  const tickers = [
    ...report.watchlistBuckets.stocks,
    ...report.watchlistBuckets.cryptoProxies,
    ...report.watchlistBuckets.funds,
    ...report.watchlistBuckets.crypto,
  ].map((item) => ({
    symbol: item.symbol,
    asset_class: item.assetClass,
    themes: item.themes,
    source_titles: item.sourceTitles,
    probability: item.probability,
    score: item.score,
    severity: item.severity,
    persistence: item.persistence,
  }));

  return {
    updated_at: report.metadata.generatedAt,
    source: "polymarket_market_intel",
    overlay: report.overlay.alignment,
    summary: {
      conviction: report.summary.conviction,
      aggression_dial: report.summary.aggressionDial,
      divergence: report.summary.divergence,
      focus_sectors: report.summary.focusSectors,
      crypto_focus: report.summary.cryptoFocus,
      theme_highlights: report.summary.themeHighlights,
    },
    buckets: {
      stocks: report.watchlistBuckets.stocks.map((entry) => entry.symbol),
      crypto: report.watchlistBuckets.crypto.map((entry) => entry.symbol),
      crypto_proxies: report.watchlistBuckets.cryptoProxies.map((entry) => entry.symbol),
      funds: report.watchlistBuckets.funds.map((entry) => entry.symbol),
    },
    tickers,
  };
}

async function writeAtomic(filePath: string, contents: string): Promise<void> {
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, contents, "utf8");
  await rename(tempPath, filePath);
}
