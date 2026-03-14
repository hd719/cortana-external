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
          displayTitle: "Fed easing odds",
          title: "Will no Fed rate cuts happen in 2026?",
          theme: "rates",
          probability: 0.77,
          displayScore: 0.2,
          change1h: null,
          change4h: null,
          change24h: 0.03,
          quality: { tier: "medium" },
          impact: { sectorImplications: [], tickerWatchImplications: [] },
          watchTickers: ["QQQ", "NVDA"],
        },
      ],
      watchlist: ["QQQ", "NVDA"],
      overlay: { alignment: "insufficient_data", summary: "n/a", reason: "n/a", dominantEffects: [] },
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
      topMarkets: [
        {
          displayTitle: "Fed easing odds",
          title: "Will no Fed rate cuts happen in 2026?",
          theme: "rates",
          probability: 0.77,
          displayScore: 0.2,
          change1h: null,
          change4h: null,
          change24h: 0.03,
          quality: { tier: "medium" },
          impact: { sectorImplications: [], tickerWatchImplications: [] },
          watchTickers: ["QQQ", "NVDA"],
        },
        {
          displayTitle: "US recession odds",
          title: "US recession by end of 2026?",
          theme: "recession",
          probability: 0.34,
          displayScore: 0.15,
          change1h: null,
          change4h: null,
          change24h: -0.01,
          quality: { tier: "high" },
          impact: { sectorImplications: [], tickerWatchImplications: [] },
          watchTickers: ["QQQ", "XLU"],
        },
      ],
      overlay: { alignment: "mixed" },
    } as never);

    const qqq = payload.tickers.find((item) => item.symbol == "QQQ");
    expect(qqq).toBeDefined();
    expect(qqq?.themes).toEqual(expect.arrayContaining(["rates", "recession"]));
  });
});
