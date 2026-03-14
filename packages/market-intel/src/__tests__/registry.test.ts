import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadRegistry, matchesKeyword, matchesSelectorFilters } from "../registry.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("registry", () => {
  it("loads registry data and filters inactive entries", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "market-intel-registry-"));
    tempDirs.push(dir);
    const registryPath = path.join(dir, "registry.json");

    await writeFile(
      registryPath,
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: "2026-03-13T00:00:00Z",
        entries: [
          {
            id: "active",
            title: "Active",
            category: "macro",
            theme: "rates",
            equityRelevance: "high",
            sectorTags: [],
            watchTickers: [],
            confidenceWeight: 0.9,
            minLiquidity: 100,
            active: true,
            impactModel: "fed_easing",
            selectors: { marketSlugs: [], eventSlugs: [], keywords: ["fed cut"] },
          },
          {
            id: "inactive",
            title: "Inactive",
            category: "macro",
            theme: "rates",
            equityRelevance: "high",
            sectorTags: [],
            watchTickers: [],
            confidenceWeight: 0.9,
            minLiquidity: 100,
            active: false,
            impactModel: "fed_easing",
            selectors: { marketSlugs: [], eventSlugs: [], keywords: [] },
          },
        ],
      }),
      "utf8",
    );

    const registry = await loadRegistry(registryPath);

    expect(registry.entries).toHaveLength(1);
    expect(registry.entries[0]?.id).toBe("active");
  });

  it("matches configured keywords against market text", () => {
    const matched = matchesKeyword(
      {
        id: "fed",
        title: "Fed",
        category: "macro",
        theme: "rates",
        equityRelevance: "high",
        sectorTags: [],
        watchTickers: [],
        confidenceWeight: 1,
        minLiquidity: 1,
        active: true,
        impactModel: "fed_easing",
        selectors: {
          marketSlugs: [],
          eventSlugs: [],
          keywords: ["fed cut", "rate cut"],
        },
      },
      "Will the Fed cut rates by June?",
    );

    expect(matched).toBe(true);
  });

  it("applies include and exclude selector filters", () => {
    const entry = {
      id: "geo",
      title: "Geopolitical",
      category: "geo",
      theme: "geopolitics",
      equityRelevance: "medium" as const,
      sectorTags: [],
      watchTickers: [],
      confidenceWeight: 0.8,
      minLiquidity: 100,
      active: true,
      impactModel: "geopolitical_escalation" as const,
      selectors: {
        marketSlugs: [],
        eventSlugs: [],
        keywords: ["taiwan"],
        includeKeywords: ["taiwan"],
        excludeKeywords: ["world cup", "visit taiwan"],
      },
    };

    expect(matchesSelectorFilters(entry, "Will China invade Taiwan by end of 2026?")).toBe(true);
    expect(matchesSelectorFilters(entry, "Will Spain win the Taiwan world cup?")).toBe(false);
  });
});
