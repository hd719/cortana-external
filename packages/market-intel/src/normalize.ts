import { deriveEquityImpact } from "./impact-map.js";
import { scoreRelevance } from "./registry.js";
import { buildQualityAssessment } from "./quality.js";
import type {
  CandidateMarket,
} from "./polymarket-client.js";
import type {
  NormalizedMarketSnapshot,
  PolymarketRawMarket,
  RegistryEntry,
} from "./types.js";

export function normalizeCandidate(args: {
  candidate: CandidateMarket;
  registryEntry: RegistryEntry;
  fetchedAt: string;
  now: Date;
  change4h: number | null;
  duplicatePenalty?: number;
}): NormalizedMarketSnapshot | null {
  const market = args.candidate.market;
  const rawProbability = deriveProbability(market);
  if (rawProbability == null) return null;

  const title = market.question ?? args.candidate.event?.title ?? args.registryEntry.title;
  const description = market.description ?? args.candidate.event?.description ?? "";
  const liquidity = firstNumber(
    market.liquidityNum,
    market.liquidityClob,
    market.liquidity,
    args.candidate.event?.liquidity,
  );
  const volume24h = firstNumber(market.volume24hr, market.volume24hrClob, args.candidate.event?.volume24hr);
  const spread = deriveSpread(market);
  const active = market.active ?? false;
  const acceptingOrders = market.acceptingOrders ?? false;
  const invert = args.registryEntry.probabilityMode === "invert";
  const probability = invert ? round(1 - rawProbability, 4) : rawProbability;
  const change1h = transformChange(numberOrNull(market.oneHourPriceChange), invert);
  const change24h = transformChange(numberOrNull(market.oneDayPriceChange), invert);
  const change4h = transformChange(args.change4h, invert);
  const quality = buildQualityAssessment({
    liquidity,
    volume24h,
    spread,
    active,
    acceptingOrders,
    updatedAt: market.updatedAt ?? null,
    description,
    registryEntry: args.registryEntry,
    duplicatePenalty: args.duplicatePenalty,
    now: args.now,
  });
  const impact = deriveEquityImpact({
    model: args.registryEntry.impactModel,
    probability,
    change24h,
  });
  const displayScore = calculateDisplayScore({
    relevance: scoreRelevance(args.registryEntry.equityRelevance),
    quality: quality.score,
    probability,
    change1h,
    change4h,
    change24h,
    confidenceWeight: args.registryEntry.confidenceWeight,
  });

  return {
    source: "polymarket",
    fetchedAt: args.fetchedAt,
    registryEntryId: args.registryEntry.id,
    selectionSource: args.candidate.selectionSource,
    eventId: stringOrNull(args.candidate.event?.id),
    eventSlug: args.candidate.event?.slug ?? null,
    marketId: String(market.id ?? market.slug ?? title),
    slug: market.slug ?? slugify(title),
    displayTitle: args.registryEntry.title,
    title,
    description,
    category: args.registryEntry.category,
    theme: args.registryEntry.theme,
    probability,
    change1h,
    change4h,
    change24h,
    volume24h,
    liquidity,
    spread,
    active,
    acceptingOrders,
    updatedAt: market.updatedAt ?? null,
    quality,
    equityRelevance: args.registryEntry.equityRelevance,
    sectorTags: args.registryEntry.sectorTags,
    watchTickers: args.registryEntry.watchTickers,
    confidenceWeight: args.registryEntry.confidenceWeight,
    impact,
    displayScore,
  };
}

function deriveProbability(market: PolymarketRawMarket): number | null {
  const lastTrade = numberOrNull(market.lastTradePrice);
  if (lastTrade != null) return clamp(lastTrade, 0, 1);

  const prices = parseStringArray(market.outcomePrices).map((value) => Number(value));
  if (prices.length > 0 && Number.isFinite(prices[0])) {
    return clamp(prices[0] as number, 0, 1);
  }

  return null;
}

function deriveSpread(market: PolymarketRawMarket): number | null {
  if (typeof market.spread === "number") return market.spread;
  const bestBid = numberOrNull(market.bestBid);
  const bestAsk = numberOrNull(market.bestAsk);
  if (bestBid == null || bestAsk == null) return null;
  return Math.max(bestAsk - bestBid, 0);
}

function calculateDisplayScore(args: {
  relevance: number;
  quality: number;
  probability: number;
  change1h: number | null;
  change4h: number | null;
  change24h: number | null;
  confidenceWeight: number;
}): number {
  const moveMagnitude = Math.max(
    Math.abs(args.change1h ?? 0),
    Math.abs(args.change4h ?? 0),
    Math.abs(args.change24h ?? 0),
  );
  const moveSignificance = clamp(moveMagnitude / 0.12, 0.2, 1);
  const timeliness = args.change1h != null || args.change24h != null ? 1 : 0.6;
  const conviction = 1 - Math.abs(args.probability - 0.5);

  return round(
    args.relevance *
      args.quality *
      moveSignificance *
      timeliness *
      args.confidenceWeight *
      (0.85 + conviction * 0.3),
    4,
  );
}

function parseStringArray(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function transformChange(value: number | null, invert: boolean): number | null {
  if (value == null) return null;
  return invert ? round(-value, 4) : value;
}

function firstNumber(...values: unknown[]): number {
  for (const value of values) {
    const number = numberOrNull(value);
    if (number != null) return number;
  }
  return 0;
}

function stringOrNull(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
