import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildWatchlistPayload, writeIntegrationArtifacts } from "../artifacts.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("artifacts", () => {
  it("writes report artifacts and backtester watchlist export", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "market-intel-artifacts-"));
    tempDirs.push(dir);
    const artifactDir = path.join(dir, "artifacts");
    const watchlistPath = path.join(dir, "polymarket_watchlist.json");

    const report = {
      metadata: {
        registryPath: "registry.json",
        historyDir: "history",
        latestPath: "latest.json",
        regimePath: null,
        generatedAt: "2026-03-14T01:00:00.000Z",
        persisted: true,
      },
      regime: null,
      markets: [],
      topMarkets: [
        {
          registryEntryId: "fed-easing",
          displayTitle: "Fed easing odds",
          title: "Will no Fed rate cuts happen in 2026?",
          theme: "rates",
          probability: 0.77,
          displayScore: 0.2,
          change1h: null,
          change4h: null,
          change24h: 0.03,
          quality: { tier: "medium" },
          impact: { regimeEffect: "risk_on", sectorImplications: [], tickerWatchImplications: [] },
          watchTickers: ["QQQ", "NVDA"],
          signal: {
            direction: "rising",
            magnitude: 0.03,
            severity: "notable",
            thresholdCrossings: [],
            persistence: {
              state: "persistent",
              score: 0.72,
              observedRuns: 3,
              summary: "Theme has kept building across multiple local runs.",
              latestPriorProbability: 0.74,
            },
          },
        },
      ],
      watchlist: ["QQQ", "NVDA"],
      watchlistBuckets: {
        stocks: [
          {
            symbol: "NVDA",
            assetClass: "stock",
            themes: ["rates"],
            sourceTitles: ["Fed easing odds"],
            probability: 0.77,
            score: 0.2,
            severity: "notable",
            persistence: "persistent",
          },
        ],
        crypto: [],
        cryptoProxies: [],
        funds: [
          {
            symbol: "QQQ",
            assetClass: "etf",
            themes: ["rates"],
            sourceTitles: ["Fed easing odds"],
            probability: 0.77,
            score: 0.2,
            severity: "notable",
            persistence: "persistent",
          },
        ],
      },
      overlay: { alignment: "insufficient_data", summary: "n/a", reason: "n/a", dominantEffects: [] },
      summary: {
        conviction: "neutral",
        aggressionDial: "no_change",
        divergence: { state: "none", summary: "No major divergence", reason: "n/a", themes: [] },
        focusSectors: ["tech"],
        cryptoFocus: [],
        themeHighlights: [],
      },
      warnings: [],
      suppressedMarkets: [],
    } as never;

    await writeIntegrationArtifacts(report, {
      artifactDir,
      watchlistExportPath: watchlistPath,
    });

    const compact = await readFile(path.join(artifactDir, "latest-compact.txt"), "utf8");
    const exported = JSON.parse(await readFile(watchlistPath, "utf8"));

    expect(compact).toContain("Fed easing odds");
    expect(exported.tickers.map((item: { symbol: string }) => item.symbol)).toEqual(
      expect.arrayContaining(["QQQ", "NVDA"]),
    );
  });

  it("builds a stable watchlist payload", () => {
    const payload = buildWatchlistPayload({
      metadata: { generatedAt: "2026-03-14T01:00:00.000Z" },
      watchlistBuckets: {
        stocks: [
          {
            symbol: "NVDA",
            assetClass: "stock",
            themes: ["rates"],
            sourceTitles: ["Fed easing odds"],
            probability: 0.77,
            score: 0.2,
            severity: "notable",
            persistence: "persistent",
          },
        ],
        crypto: [],
        cryptoProxies: [],
        funds: [
          {
            symbol: "QQQ",
            assetClass: "etf",
            themes: ["rates", "recession"],
            sourceTitles: ["Fed easing odds", "US recession odds"],
            probability: 0.77,
            score: 0.2,
            severity: "notable",
            persistence: "persistent",
          },
          {
            symbol: "XLU",
            assetClass: "etf",
            themes: ["recession"],
            sourceTitles: ["US recession odds"],
            probability: 0.34,
            score: 0.15,
            severity: "minor",
            persistence: "one_off",
          },
        ],
      },
      summary: {
        conviction: "neutral",
        aggressionDial: "no_change",
        divergence: { state: "watch", summary: "Mixed theme watch", reason: "n/a", themes: [] },
        focusSectors: ["tech"],
        cryptoFocus: [],
        themeHighlights: [],
      },
      overlay: { alignment: "mixed" },
    } as never);

    const qqq = payload.tickers.find((item) => item.symbol == "QQQ");
    expect(qqq).toBeDefined();
    expect(qqq?.themes).toEqual(expect.arrayContaining(["rates", "recession"]));
    expect(qqq?.asset_class).toBe("etf");
  });
});
