import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseArgs, renderOutput } from "../cli.js";
import { createConsoleLogger } from "../logger.js";
import { formatCompactReport, formatVerboseReport } from "../report.js";
import { buildPolymarketIntelReport } from "../service.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("service, reports, and cli helpers", () => {
  it("builds a useful report from curated fallback markets", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "market-intel-service-"));
    tempDirs.push(dir);

    const registryPath = path.join(dir, "registry.json");
    const historyDir = path.join(dir, "history");
    const latestPath = path.join(dir, "latest.json");
    await mkdir(historyDir, { recursive: true });

    await writeFile(
      registryPath,
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: "2026-03-13T00:00:00Z",
        entries: [
          {
            id: "fed-easing",
            title: "Fed easing odds",
            category: "macro-rates",
            theme: "rates",
            equityRelevance: "high",
            sectorTags: ["tech", "growth"],
            watchTickers: ["QQQ", "NVDA"],
            confidenceWeight: 0.92,
            minLiquidity: 250000,
            active: true,
            impactModel: "fed_easing",
            selectors: { marketSlugs: [], eventSlugs: [], keywords: ["fed cut"] },
          },
          {
            id: "recession-risk",
            title: "US recession odds",
            category: "macro-growth",
            theme: "recession",
            equityRelevance: "high",
            sectorTags: ["defensive"],
            watchTickers: ["XLU", "IWM"],
            confidenceWeight: 0.9,
            minLiquidity: 100000,
            active: true,
            impactModel: "recession_risk",
            selectors: { marketSlugs: [], eventSlugs: [], keywords: ["recession"] },
          },
        ],
      }),
      "utf8",
    );

    await writeFile(
      path.join(historyDir, "2026-03-13T08-00-00-000Z.json"),
      JSON.stringify({
        generatedAt: "2026-03-13T08:00:00.000Z",
        markets: [
          { marketId: "fed-mkt", slug: "fed-cut-june", probability: 0.56 },
          { marketId: "rec-mkt", slug: "us-recession", probability: 0.39 },
        ],
      }),
      "utf8",
    );

    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === "string" ? new URL(input) : new URL(input.url);
      if (url.pathname !== "/events") {
        throw new Error(`Unexpected path ${url.pathname}`);
      }

      return new Response(
        JSON.stringify([
          {
            id: "evt-fed",
            slug: "fed-event",
            title: "Fed cut by June?",
            description: "Macro rates event",
            markets: [
              {
                id: "fed-mkt",
                slug: "fed-cut-june",
                question: "Will the Fed cut rates by June?",
                description:
                  "This market resolves to Yes if the Fed cuts rates by June. Otherwise it resolves to No. The primary resolution source is the FOMC statement.",
                lastTradePrice: 0.64,
                oneHourPriceChange: 0.02,
                oneDayPriceChange: 0.08,
                liquidityNum: 500000,
                volume24hr: 250000,
                spread: 0.01,
                active: true,
                acceptingOrders: true,
                updatedAt: "2026-03-13T11:20:00.000Z",
              },
            ],
          },
          {
            id: "evt-rec",
            slug: "recession-event",
            title: "US recession in 2026?",
            description: "Macro growth event",
            markets: [
              {
                id: "rec-mkt",
                slug: "us-recession",
                question: "US recession in 2026?",
                description:
                  "This market resolves to Yes if the US enters recession in 2026. Otherwise it resolves to No. The primary resolution source is official economic data and credible reporting.",
                lastTradePrice: 0.46,
                oneHourPriceChange: 0.01,
                oneDayPriceChange: 0.06,
                liquidityNum: 300000,
                volume24hr: 120000,
                spread: 0.015,
                active: true,
                acceptingOrders: true,
                updatedAt: "2026-03-13T11:05:00.000Z",
              },
            ],
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const report = await buildPolymarketIntelReport({
      registryPath,
      historyDir,
      latestPath,
      fetchImpl,
      persistHistory: true,
      logger: createConsoleLogger(false),
      now: new Date("2026-03-13T12:00:00.000Z"),
      regimeInput: {
        regime: "correction",
        status: "ok",
        source: "inline",
        asOf: null,
        positionSizing: 0,
        notes: "Market regime: correction",
        regimeScore: -3,
        drawdownPct: -8,
        recentReturnPct: -3,
      },
    });

    expect(report.topMarkets).toHaveLength(2);
    expect(report.watchlist).toContain("QQQ");
    expect(report.overlay.alignment).toBe("mixed");
    expect(report.summary.divergence.state).toBe("watch");
    expect(report.watchlistBuckets.stocks.map((entry) => entry.symbol)).toContain("NVDA");

    const compact = formatCompactReport(report);
    const verbose = formatVerboseReport(report);

    expect(compact).toContain("Polymarket:");
    expect(compact).toContain("Posture:");
    expect(compact).toContain("Watchlist:");
    expect(verbose).toContain("Watchlist Buckets");
    expect(renderOutput(report, "compact")).toContain("Overlay:");
  });

  it("degrades safely when Polymarket requests fail", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "market-intel-fallback-"));
    tempDirs.push(dir);
    const registryPath = path.join(dir, "registry.json");

    await writeFile(
      registryPath,
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: "2026-03-13T00:00:00Z",
        entries: [
          {
            id: "fed-easing",
            title: "Fed easing odds",
            category: "macro-rates",
            theme: "rates",
            equityRelevance: "high",
            sectorTags: [],
            watchTickers: ["QQQ"],
            confidenceWeight: 0.92,
            minLiquidity: 250000,
            active: true,
            impactModel: "fed_easing",
            selectors: { marketSlugs: [], eventSlugs: [], keywords: ["fed cut"] },
          },
        ],
      }),
      "utf8",
    );

    const report = await buildPolymarketIntelReport({
      registryPath,
      historyDir: path.join(dir, "history"),
      latestPath: path.join(dir, "latest.json"),
      fetchImpl: async () => {
        throw new Error("network down");
      },
      logger: createConsoleLogger(false),
      now: new Date("2026-03-13T12:00:00.000Z"),
    });

    expect(report.topMarkets).toHaveLength(0);
    expect(report.warnings[0]).toContain("Polymarket fetch failed");
  });

  it("parses CLI flags for manual runs", () => {
    const parsed = parseArgs([
      "--output",
      "compact",
      "--registry",
      "/tmp/registry.json",
      "--max-markets",
      "2",
      "--persist",
    ]);

    expect(parsed.output).toBe("compact");
    expect(parsed.registryPath).toBe("/tmp/registry.json");
    expect(parsed.maxMarkets).toBe(2);
    expect(parsed.persistHistory).toBe(true);
  });

  it("caps compact watchlist output while keeping the line readable", () => {
    const compact = formatCompactReport({
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
      topMarkets: [],
      watchlist: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"],
      watchlistBuckets: {
        stocks: [
          { symbol: "A", assetClass: "stock", themes: [], sourceTitles: [], probability: 0.5, score: 1, severity: "major", persistence: "persistent" },
          { symbol: "B", assetClass: "stock", themes: [], sourceTitles: [], probability: 0.5, score: 1, severity: "notable", persistence: "persistent" },
          { symbol: "C", assetClass: "stock", themes: [], sourceTitles: [], probability: 0.5, score: 1, severity: "notable", persistence: "one_off" },
        ],
        crypto: [
          { symbol: "D", assetClass: "crypto", themes: [], sourceTitles: [], probability: 0.5, score: 1, severity: "notable", persistence: "persistent" },
          { symbol: "E", assetClass: "crypto", themes: [], sourceTitles: [], probability: 0.5, score: 1, severity: "minor", persistence: "one_off" },
        ],
        cryptoProxies: [
          { symbol: "F", assetClass: "crypto_proxy", themes: [], sourceTitles: [], probability: 0.5, score: 1, severity: "minor", persistence: "one_off" },
        ],
        funds: [
          { symbol: "G", assetClass: "etf", themes: [], sourceTitles: [], probability: 0.5, score: 1, severity: "minor", persistence: "one_off" },
          { symbol: "H", assetClass: "etf", themes: [], sourceTitles: [], probability: 0.5, score: 1, severity: "minor", persistence: "one_off" },
          { symbol: "I", assetClass: "etf", themes: [], sourceTitles: [], probability: 0.5, score: 1, severity: "minor", persistence: "one_off" },
          { symbol: "J", assetClass: "etf", themes: [], sourceTitles: [], probability: 0.5, score: 1, severity: "minor", persistence: "one_off" },
        ],
      },
      overlay: {
        alignment: "insufficient_data",
        summary: "Overlay unavailable",
        reason: "No market regime context was provided.",
        dominantEffects: [],
      },
      summary: {
        conviction: "neutral",
        aggressionDial: "no_change",
        divergence: {
          state: "none",
          summary: "No major divergence",
          reason: "No market regime context was provided.",
          themes: [],
        },
        focusSectors: [],
        cryptoFocus: ["D", "E"],
        themeHighlights: [],
      },
      warnings: [],
      suppressedMarkets: [],
    } as never);

    expect(compact).toContain("Watchlist: A, B, C, F, D (+5 more)");
  });
});
