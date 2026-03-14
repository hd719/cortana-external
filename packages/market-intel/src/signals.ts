import type {
  MarketSignal,
  NormalizedMarketSnapshot,
  ThemePersistenceAssessment,
} from "./types.js";

const THRESHOLDS = [0.4, 0.5, 0.6];

export function buildMarketSignal(args: {
  market: Omit<NormalizedMarketSnapshot, "signal">;
  persistence: ThemePersistenceAssessment;
}): MarketSignal {
  const magnitude = round(
    Math.max(
      Math.abs(args.market.change1h ?? 0),
      Math.abs(args.market.change4h ?? 0),
      Math.abs(args.market.change24h ?? 0),
    ),
    4,
  );
  const primaryChange =
    selectStrongestChange(args.market.change1h, args.market.change4h, args.market.change24h) ?? 0;
  const direction = primaryChange > 0 ? "rising" : primaryChange < 0 ? "falling" : "steady";
  const thresholdCrossings = buildThresholdCrossings(
    args.persistence.latestPriorProbability,
    args.market.probability,
  );

  let severity: MarketSignal["severity"] = "minor";
  if (
    magnitude >= 0.08 ||
    thresholdCrossings.some((crossing) => crossing.endsWith("50") || crossing.endsWith("60"))
  ) {
    severity = "major";
  } else if (magnitude >= 0.04 || thresholdCrossings.length > 0) {
    severity = "notable";
  }

  return {
    direction,
    magnitude,
    severity,
    thresholdCrossings,
    persistence: args.persistence,
  };
}

function selectStrongestChange(...values: Array<number | null>): number | null {
  return values
    .filter((value): value is number => value != null)
    .sort((left, right) => Math.abs(right) - Math.abs(left))[0] ?? null;
}

function buildThresholdCrossings(
  previousProbability: number | null,
  currentProbability: number,
): string[] {
  if (previousProbability == null) return [];

  const crossings: string[] = [];
  for (const threshold of THRESHOLDS) {
    const level = Math.round(threshold * 100);
    if (previousProbability < threshold && currentProbability >= threshold) {
      crossings.push(`up_${level}`);
    } else if (previousProbability > threshold && currentProbability <= threshold) {
      crossings.push(`down_${level}`);
    }
  }

  return crossings;
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}
