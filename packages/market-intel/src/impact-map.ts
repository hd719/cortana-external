import type { EquityImpact, ImpactModel, RegimeEffect } from "./types.js";

export function deriveEquityImpact(args: {
  model: ImpactModel;
  probability: number;
  change24h: number | null;
}): EquityImpact {
  const rising = (args.change24h ?? 0) >= 0;

  switch (args.model) {
    case "fed_easing":
      return {
        model: args.model,
        marketBias: "bullish_growth",
        regimeEffect: args.probability >= 0.55 && rising ? "risk_on" : "mixed",
        sectorImplications: [
          "supports long-duration growth if price action confirms",
          "improves odds for semis, software, and small-cap beta",
        ],
        tickerWatchImplications: [
          "Watch QQQ, IWM, NVDA, AMD, MSFT for relative-strength confirmation",
        ],
        caveats: [
          "Easing driven by stress can still be bearish for equities",
          "Do not override a correction regime on easing odds alone",
        ],
      };
    case "recession_risk":
      return {
        model: args.model,
        marketBias: "bullish_defensive",
        regimeEffect: args.probability >= 0.4 && rising ? "risk_off" : "mixed",
        sectorImplications: [
          "leans toward defensives over cyclicals",
          "caps aggression in small caps and fragile beta",
        ],
        tickerWatchImplications: [
          "Watch XLU, XLV, COST and treat IWM, airlines, and cyclicals more carefully",
        ],
        caveats: [
          "Recession odds are context, not timing tools",
          "Growth can still outperform if easing expectations dominate",
        ],
      };
    case "inflation_upside":
      return {
        model: args.model,
        marketBias: "bearish_risk",
        regimeEffect: args.probability >= 0.45 && rising ? "risk_off" : "mixed",
        sectorImplications: [
          "pressures long-duration tech and other multiple-sensitive assets",
          "supports inflation beneficiaries selectively, including energy",
        ],
        tickerWatchImplications: [
          "Watch XLE, XOM, CVX for relative strength and QQQ/ARKK for pressure",
        ],
        caveats: [
          "Short-term market reactions can invert around already-priced inflation expectations",
        ],
      };
    case "tariff_risk":
      return {
        model: args.model,
        marketBias: "bearish_risk",
        regimeEffect: args.probability >= 0.35 && rising ? "risk_off" : "mixed",
        sectorImplications: [
          "raises caution on global cyclicals, import-sensitive retail, and semis",
          "can support domestic defensives and selective industrial reshoring themes",
        ],
        tickerWatchImplications: [
          "Watch NVDA, AMD, AAPL, NKE for pressure and CAT/PWR for relative resilience",
        ],
        caveats: [
          "Tariff headlines can be noisy and politically cyclical",
        ],
      };
    case "geopolitical_escalation":
      return {
        model: args.model,
        marketBias: "bullish_energy_defense",
        regimeEffect: args.probability >= 0.3 && rising ? "risk_off" : "mixed",
        sectorImplications: [
          "supports energy and defense relative strength",
          "pressures airlines, high-beta risk assets, and broad cyclicals",
        ],
        tickerWatchImplications: [
          "Watch XOM, CVX, LMT, NOC for strength and airlines/high beta for weakness",
        ],
        caveats: [
          "Event markets can reverse quickly on diplomacy headlines",
        ],
      };
    case "crypto_policy_support":
      return {
        model: args.model,
        marketBias: "bullish_crypto",
        regimeEffect: args.probability >= 0.5 && rising ? "risk_on" : "mixed",
        sectorImplications: [
          "supports crypto proxies and high-beta retail trading platforms",
          "can spill over into risk appetite if broad tape is already healthy",
        ],
        tickerWatchImplications: [
          "Watch BTC, ETH, SOL plus COIN, HOOD, MARA, MSTR and crypto beta proxies",
        ],
        caveats: [
          "Crypto policy strength does not imply broad equity confirmation",
        ],
      };
  }
}

export function summarizeNetEffect(effects: RegimeEffect[]): RegimeEffect {
  const positive = effects.filter((effect) => effect === "risk_on").length;
  const negative = effects.filter((effect) => effect === "risk_off").length;

  if (positive > 0 && negative > 0) return "mixed";
  if (positive > 0) return "risk_on";
  if (negative > 0) return "risk_off";
  return "neutral";
}
