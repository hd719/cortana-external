import { summarizeNetEffect } from "./impact-map.js";
import type { NormalizedMarketSnapshot, OverlayAssessment, RegimeContext } from "./types.js";

export function analyzeOverlay(
  regime: RegimeContext | null,
  markets: NormalizedMarketSnapshot[],
): OverlayAssessment {
  const dominantEffects = markets
    .slice(0, 3)
    .filter((market) => market.quality.tier !== "ignore")
    .map((market) => market.impact.regimeEffect);
  const netEffect = summarizeNetEffect(dominantEffects);

  if (!regime) {
    return {
      alignment: "insufficient_data",
      summary: "Overlay unavailable",
      reason: "No market regime context was provided.",
      dominantEffects,
    };
  }

  if (dominantEffects.length === 0) {
    return {
      alignment: "neutral",
      summary: "No strong overlay",
      reason: "No markets cleared the display threshold.",
      dominantEffects,
    };
  }

  if (netEffect === "mixed") {
    return {
      alignment: "mixed",
      summary: "Mixed overlay",
      reason: "Top Polymarket themes are pulling in different directions.",
      dominantEffects,
    };
  }

  if (netEffect === "neutral") {
    return {
      alignment: "neutral",
      summary: "Neutral overlay",
      reason: "Polymarket signals are not directional enough to lean risk-on or risk-off.",
      dominantEffects,
    };
  }

  const weakRegime =
    regime.regime === "correction" ||
    regime.regime === "uptrend_under_pressure" ||
    regime.status === "degraded";

  if (netEffect === "risk_on") {
    if (regime.regime === "confirmed_uptrend") {
      return {
        alignment: "confirms",
        summary: "Risk-on confirmation",
        reason: "Polymarket leans risk-on and the equity regime is already healthy.",
        dominantEffects,
      };
    }

    return {
      alignment: weakRegime ? "conflicts" : "neutral",
      summary: weakRegime ? "Risk-on conflict" : "Cautious support",
      reason: weakRegime
        ? "Polymarket is leaning risk-on, but the current equity regime is not fully supportive."
        : "Polymarket leans risk-on, but regime confirmation is incomplete.",
      dominantEffects,
    };
  }

  if (weakRegime) {
    return {
      alignment: "confirms",
      summary: "Risk-off confirmation",
      reason: "Polymarket risk-off signals align with a weak or degraded market regime.",
      dominantEffects,
    };
  }

  return {
    alignment: "conflicts",
    summary: "Risk-off conflict",
    reason: "Polymarket is leaning risk-off while the equity regime remains comparatively constructive.",
    dominantEffects,
  };
}
