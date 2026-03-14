import type { QualityAssessment, QualityInputs, QualityTier, RegistryEntry } from "./types.js";

const HOURS_PER_MS = 1000 * 60 * 60;

export function buildQualityAssessment(args: {
  liquidity: number;
  volume24h: number;
  spread: number | null;
  active: boolean;
  acceptingOrders: boolean;
  updatedAt: string | null;
  description: string;
  registryEntry: Pick<RegistryEntry, "confidenceWeight" | "minLiquidity">;
  duplicatePenalty?: number;
  now: Date;
}): QualityAssessment {
  const recencyHours = args.updatedAt
    ? Math.max((args.now.getTime() - new Date(args.updatedAt).getTime()) / HOURS_PER_MS, 0)
    : null;
  const resolutionClarity = estimateResolutionClarity(args.description);
  const duplicatePenalty = args.duplicatePenalty ?? 0;
  const liquidityScore = clamp01(args.liquidity / Math.max(args.registryEntry.minLiquidity * 1.5, 1));
  const volumeScore = clamp01(args.volume24h / Math.max(args.registryEntry.minLiquidity * 0.6, 1));
  const spreadScore =
    args.spread == null ? 0.55 : args.spread <= 0.02 ? 1 : args.spread <= 0.05 ? 0.7 : args.spread <= 0.12 ? 0.4 : 0.1;
  const recencyScore =
    recencyHours == null ? 0.45 : recencyHours <= 3 ? 1 : recencyHours <= 12 ? 0.8 : recencyHours <= 24 ? 0.55 : 0.25;
  const activeScore = args.active ? 1 : 0;
  const orderScore = args.acceptingOrders ? 1 : 0.3;
  const confidenceScore = args.registryEntry.confidenceWeight;

  const score = clamp01(
    liquidityScore * 0.24 +
      volumeScore * 0.18 +
      spreadScore * 0.12 +
      recencyScore * 0.12 +
      activeScore * 0.14 +
      orderScore * 0.08 +
      resolutionClarity * 0.07 +
      confidenceScore * 0.1 -
      duplicatePenalty,
  );

  const reasons: string[] = [];
  if (args.liquidity < args.registryEntry.minLiquidity) {
    reasons.push(`liquidity below floor (${Math.round(args.liquidity)} < ${Math.round(args.registryEntry.minLiquidity)})`);
  }
  if (args.volume24h < args.registryEntry.minLiquidity * 0.1) {
    reasons.push("24h volume is thin");
  }
  if (!args.active) reasons.push("market is inactive");
  if (!args.acceptingOrders) reasons.push("orders not currently accepted");
  if (args.spread != null && args.spread > 0.05) reasons.push("spread is wide");
  if (recencyHours != null && recencyHours > 24) reasons.push("market update is stale");
  if (resolutionClarity < 0.5) reasons.push("resolution language is weak");

  let tier: QualityTier;
  if (!args.active || score < 0.25) {
    tier = "ignore";
  } else if (score >= 0.75) {
    tier = "high";
  } else if (score >= 0.5) {
    tier = "medium";
  } else {
    tier = "low";
  }

  const inputs: QualityInputs = {
    liquidity: args.liquidity,
    volume24h: args.volume24h,
    spread: args.spread,
    active: args.active,
    acceptingOrders: args.acceptingOrders,
    recencyHours,
    resolutionClarity,
    confidenceWeight: args.registryEntry.confidenceWeight,
    duplicatePenalty,
  };

  return { score, tier, reasons, inputs };
}

function estimateResolutionClarity(description: string): number {
  const text = description.toLowerCase();
  let score = 0.25;
  if (text.includes("resolve")) score += 0.25;
  if (text.includes("otherwise")) score += 0.15;
  if (text.includes("primary resolution source")) score += 0.15;
  if (text.length > 120) score += 0.1;
  if (text.includes("credible reporting")) score += 0.1;
  return clamp01(score);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
