import type { MarketDataComparison, MarketDataResponse, MarketDataStatus } from "./types.js";

export function normalizeMarketSymbol(rawSymbol: string): string {
  return String(rawSymbol).trim().toUpperCase();
}

export function normalizeAlpacaDataUrl(rawUrl: string): string {
  return rawUrl.trim().replace(/\/+$/, "") || "https://data.alpaca.markets";
}

export function normalizeAlpacaBarLimit(period: string): number {
  const candidate = period.trim().toLowerCase();
  const mapping: Record<string, number> = {
    "5d": 5,
    "1mo": 22,
    "3mo": 66,
    "6mo": 132,
    "1y": 252,
    "2y": 504,
    "5y": 1000,
  };
  return mapping[candidate] ?? 252;
}

export function resolveQuery(url: string, key: string, defaultValue: string): string {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get(key) ?? defaultValue;
  } catch {
    return defaultValue;
  }
}

export function parseBatchSymbols(url: string): string[] {
  const raw = resolveQuery(url, "symbols", "");
  return [
    ...new Set(
      raw
        .split(",")
        .map((value) => normalizeMarketSymbol(value))
        .filter(Boolean),
    ),
  ];
}

export function marketDataErrorResponse<T>(
  message: string,
  status: MarketDataStatus,
  options: { reason: string },
): MarketDataResponse<T> {
  return {
    source: "service",
    status,
    degradedReason: message,
    stalenessSeconds: null,
    data: { error: options.reason } as T,
  };
}

export function buildUnavailableCompare(source: string, message: string): MarketDataComparison {
  return {
    source,
    available: false,
    mismatchSummary: message,
    stalenessSeconds: null,
  };
}
