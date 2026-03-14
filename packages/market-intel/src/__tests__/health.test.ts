import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { assessArtifactHealth, auditRegistryHealth } from "../health.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("health", () => {
  it("audits registry entries and suggests fallback replacements when exact selectors fail", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "market-intel-health-"));
    tempDirs.push(dir);
    const registryPath = path.join(dir, "registry.json");

    await writeFile(
      registryPath,
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: "2026-03-13T00:00:00Z",
        entries: [
          {
            id: "healthy",
            title: "Healthy entry",
            category: "macro",
            theme: "rates",
            equityRelevance: "high",
            sectorTags: [],
            watchTickers: [],
            confidenceWeight: 0.9,
            minLiquidity: 100,
            active: true,
            impactModel: "fed_easing",
            selectors: { marketSlugs: ["healthy-slug"], eventSlugs: [], keywords: ["fed cut"] },
          },
          {
            id: "fallback",
            title: "Fallback entry",
            category: "macro",
            theme: "inflation",
            equityRelevance: "high",
            sectorTags: [],
            watchTickers: [],
            confidenceWeight: 0.9,
            minLiquidity: 100,
            active: true,
            impactModel: "inflation_upside",
            selectors: { marketSlugs: ["missing-slug"], eventSlugs: [], keywords: ["inflation"] },
          },
          {
            id: "broken",
            title: "Broken entry",
            category: "macro",
            theme: "tariffs",
            equityRelevance: "medium",
            sectorTags: [],
            watchTickers: [],
            confidenceWeight: 0.8,
            minLiquidity: 100,
            active: true,
            impactModel: "tariff_risk",
            selectors: { marketSlugs: ["still-missing"], eventSlugs: [], keywords: ["tariff"] },
          },
        ],
      }),
      "utf8",
    );

    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === "string" ? new URL(input) : new URL(input.url);
      if (url.pathname === "/markets") {
        const slug = url.searchParams.get("slug");
        if (slug === "healthy-slug") {
          return new Response(
            JSON.stringify([{ id: "1", slug: "healthy-slug", question: "Healthy exact market" }]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.pathname === "/events") {
        return new Response(
          JSON.stringify([
            {
              id: "event-1",
              slug: "macro-event",
              title: "Inflation event",
              markets: [
                {
                  id: "2",
                  slug: "inflation-upside-live",
                  question: "Will inflation reaccelerate in 2026?",
                  liquidityNum: 420000,
                  volume24hr: 120000,
                },
              ],
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      throw new Error(`unexpected path ${url.pathname}`);
    };

    const report = await auditRegistryHealth({
      registryPath,
      fetchImpl,
      now: new Date("2026-03-13T12:00:00.000Z"),
    });

    expect(report.healthy).toBe(1);
    expect(report.fallbackOnly).toBe(1);
    expect(report.broken).toBe(1);
    expect(report.entries.find((entry) => entry.entryId === "fallback")?.suggestions[0]?.slug).toBe(
      "inflation-upside-live",
    );
  });

  it("detects stale or missing artifacts", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "market-intel-artifact-health-"));
    tempDirs.push(dir);
    const reportPath = path.join(dir, "latest-report.json");
    const compactPath = path.join(dir, "latest-compact.txt");
    const watchlistPath = path.join(dir, "polymarket_watchlist.json");

    await writeFile(
      reportPath,
      JSON.stringify({
        metadata: { generatedAt: "2026-03-13T00:00:00.000Z" },
        topMarkets: [],
        overlay: { alignment: "insufficient_data" },
      }),
      "utf8",
    );
    await writeFile(compactPath, "", "utf8");
    await writeFile(watchlistPath, JSON.stringify({ tickers: [] }), "utf8");

    const report = await assessArtifactHealth({
      reportJsonPath: reportPath,
      compactReportPath: compactPath,
      watchlistJsonPath: watchlistPath,
      maxAgeHours: 4,
      minTopMarkets: 1,
      minWatchlistCount: 1,
      now: new Date("2026-03-13T12:00:00.000Z"),
    });

    expect(report.ok).toBe(false);
    expect(report.stale).toBe(true);
    expect(report.failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining("stale"),
        expect.stringContaining("top market count 0"),
        expect.stringContaining("watchlist count 0"),
      ]),
    );
  });
});
