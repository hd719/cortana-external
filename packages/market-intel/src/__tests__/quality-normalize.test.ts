import { describe, expect, it } from "vitest";

import { normalizeCandidate } from "../normalize.js";
import { buildQualityAssessment } from "../quality.js";

const registryEntry = {
  id: "fed-easing",
  title: "Fed easing odds",
  category: "macro-rates",
  theme: "rates",
  equityRelevance: "high" as const,
  sectorTags: ["tech"],
  watchTickers: ["QQQ", "NVDA"],
  confidenceWeight: 0.92,
  minLiquidity: 250000,
  active: true,
  impactModel: "fed_easing" as const,
  selectors: { marketSlugs: [], eventSlugs: [], keywords: ["fed cut"] },
};

describe("quality and normalization", () => {
  it("normalizes a candidate into the stable snapshot shape", () => {
    const snapshot = normalizeCandidate({
      candidate: {
        selectionSource: "keyword_fallback",
        event: { id: "evt-1", slug: "fed-event", title: "Fed cut by June?" },
        market: {
          id: "mkt-1",
          slug: "fed-cut-june",
          question: "Fed cut by June?",
          description:
            "This market resolves to Yes if the Fed cuts rates by June. Otherwise it resolves to No. The primary resolution source is official FOMC reporting.",
          lastTradePrice: 0.64,
          oneHourPriceChange: 0.02,
          oneDayPriceChange: 0.08,
          liquidityNum: 600000,
          volume24hr: 250000,
          spread: 0.01,
          active: true,
          acceptingOrders: true,
          updatedAt: "2026-03-13T10:00:00.000Z",
        },
      },
      registryEntry,
      fetchedAt: "2026-03-13T12:00:00.000Z",
      now: new Date("2026-03-13T12:00:00.000Z"),
      change4h: 0.04,
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.marketId).toBe("mkt-1");
    expect(snapshot?.probability).toBe(0.64);
    expect(snapshot?.impact.regimeEffect).toBe("risk_on");
    expect(snapshot?.quality.tier).toBe("high");
    expect(snapshot?.displayScore).toBeGreaterThan(0);
  });

  it("supports inverted probability mode for semantically opposite contracts", () => {
    const snapshot = normalizeCandidate({
      candidate: {
        selectionSource: "market_slug",
        event: { id: "evt-1", slug: "fed-event", title: "How many Fed rate cuts in 2026?" },
        market: {
          id: "mkt-2",
          slug: "will-no-fed-rate-cuts-happen-in-2026",
          question: "Will no Fed rate cuts happen in 2026?",
          description:
            "This market resolves according to the exact amount of cuts in 2026. The resolution source is official FOMC reporting.",
          lastTradePrice: 0.23,
          oneHourPriceChange: -0.01,
          oneDayPriceChange: -0.03,
          liquidityNum: 500000,
          volume24hr: 300000,
          spread: 0.01,
          active: true,
          acceptingOrders: true,
          updatedAt: "2026-03-13T10:00:00.000Z",
        },
      },
      registryEntry: {
        ...registryEntry,
        probabilityMode: "invert",
      },
      fetchedAt: "2026-03-13T12:00:00.000Z",
      now: new Date("2026-03-13T12:00:00.000Z"),
      change4h: -0.02,
    });

    expect(snapshot?.probability).toBe(0.77);
    expect(snapshot?.change24h).toBe(0.03);
    expect(snapshot?.change4h).toBe(0.02);
  });

  it("downgrades low-quality markets so they do not drive output", () => {
    const assessment = buildQualityAssessment({
      liquidity: 1000,
      volume24h: 50,
      spread: 0.2,
      active: false,
      acceptingOrders: false,
      updatedAt: "2026-03-10T12:00:00.000Z",
      description: "Vague market.",
      registryEntry: {
        confidenceWeight: 0.7,
        minLiquidity: 100000,
      },
      now: new Date("2026-03-13T12:00:00.000Z"),
    });

    expect(assessment.tier).toBe("ignore");
    expect(assessment.reasons.join(" ")).toContain("liquidity below floor");
  });
});
