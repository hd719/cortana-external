import { describe, expect, it } from "vitest";

import { deriveEquityImpact } from "../impact-map.js";
import { analyzeOverlay } from "../overlay.js";

describe("impact mapping and overlay", () => {
  it("maps easing odds into a risk-on signal", () => {
    const impact = deriveEquityImpact({
      model: "fed_easing",
      probability: 0.67,
      change24h: 0.09,
    });

    expect(impact.regimeEffect).toBe("risk_on");
    expect(impact.tickerWatchImplications[0]).toContain("QQQ");
  });

  it("treats risk-on odds versus a correction regime as conflict", () => {
    const overlay = analyzeOverlay(
      {
        source: "inline",
        asOf: null,
        regime: "correction",
        status: "ok",
        positionSizing: 0,
        notes: "Market regime: correction",
        regimeScore: -3,
        drawdownPct: -10,
        recentReturnPct: -5,
      },
      [
        {
          title: "Fed cut by June?",
          quality: { tier: "high", score: 0.8, reasons: [], inputs: {} as never },
          impact: deriveEquityImpact({
            model: "fed_easing",
            probability: 0.67,
            change24h: 0.09,
          }),
        },
      ] as never,
    );

    expect(overlay.alignment).toBe("conflicts");
  });

  it("treats rising recession odds in a weak regime as confirmation", () => {
    const overlay = analyzeOverlay(
      {
        source: "inline",
        asOf: null,
        regime: "uptrend_under_pressure",
        status: "degraded",
        positionSizing: 0.5,
        notes: "degraded",
        regimeScore: 0,
        drawdownPct: -4,
        recentReturnPct: -1,
      },
      [
        {
          title: "US recession in 2026?",
          quality: { tier: "high", score: 0.75, reasons: [], inputs: {} as never },
          impact: deriveEquityImpact({
            model: "recession_risk",
            probability: 0.44,
            change24h: 0.06,
          }),
        },
      ] as never,
    );

    expect(overlay.alignment).toBe("confirms");
  });
});
