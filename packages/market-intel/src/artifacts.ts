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
  const bySymbol = new Map<
    string,
    {
      symbol: string;
      themes: string[];
      source_titles: string[];
      max_probability: number;
      max_display_score: number;
    }
  >();

  for (const market of report.topMarkets) {
    for (const symbol of market.watchTickers) {
      const existing = bySymbol.get(symbol);
      if (!existing) {
        bySymbol.set(symbol, {
          symbol,
          themes: [market.theme],
          source_titles: [market.displayTitle],
          max_probability: market.probability,
          max_display_score: market.displayScore,
        });
        continue;
      }

      if (!existing.themes.includes(market.theme)) existing.themes.push(market.theme);
      if (!existing.source_titles.includes(market.displayTitle)) {
        existing.source_titles.push(market.displayTitle);
      }
      existing.max_probability = Math.max(existing.max_probability, market.probability);
      existing.max_display_score = Math.max(existing.max_display_score, market.displayScore);
    }
  }

  const tickers = Array.from(bySymbol.values())
    .sort((left, right) => right.max_display_score - left.max_display_score || left.symbol.localeCompare(right.symbol))
    .map((item) => ({
      symbol: item.symbol,
      themes: item.themes,
      source_titles: item.source_titles,
      probability: item.max_probability,
      score: item.max_display_score,
    }));

  return {
    updated_at: report.metadata.generatedAt,
    source: "polymarket_market_intel",
    overlay: report.overlay.alignment,
    tickers,
  };
}

async function writeAtomic(filePath: string, contents: string): Promise<void> {
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, contents, "utf8");
  await rename(tempPath, filePath);
}
