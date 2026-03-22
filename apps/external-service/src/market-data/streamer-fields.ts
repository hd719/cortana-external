import type { MarketDataFuturesQuote, MarketDataQuote, SchwabAccountActivityEvent } from "./types.js";
import type { StreamerChartEquityPoint } from "./streamer.js";

export const STREAMER_SERVICES = {
  LEVELONE_EQUITIES: "LEVELONE_EQUITIES",
  LEVELONE_FUTURES: "LEVELONE_FUTURES",
  CHART_EQUITY: "CHART_EQUITY",
  ACCT_ACTIVITY: "ACCT_ACTIVITY",
} as const;

export type StreamerServiceName = (typeof STREAMER_SERVICES)[keyof typeof STREAMER_SERVICES];

export const LEVELONE_EQUITIES_FIELDS = {
  symbol: ["key", "symbol"],
  price: ["3", "2", "1"],
  volume: ["8"],
  week52High: ["19"],
  week52Low: ["20"],
  securityStatus: ["32"],
  changePercent: ["42"],
  timestamp: ["34", "35", "37"],
} as const;

export const LEVELONE_FUTURES_FIELDS = {
  symbol: ["key", "symbol"],
  price: ["3", "2", "1"],
  volume: ["8"],
  week52High: ["19"],
  week52Low: ["20"],
  securityStatus: ["32"],
  changePercent: ["42"],
  timestamp: ["34", "35", "37"],
} as const;

export const CHART_EQUITY_FIELDS = {
  symbol: ["0", "key"],
  open: ["1"],
  high: ["2"],
  low: ["3"],
  close: ["4"],
  volume: ["5"],
  sequence: ["6"],
  chartTime: ["7"],
} as const;

export const ACCT_ACTIVITY_FIELDS = {
  eventType: ["0", "eventType", "type", "messageType"],
  accountNumber: ["1", "accountNumber", "account", "acct"],
  symbol: ["2", "symbol", "underlyingSymbol"],
  description: ["3", "description", "message", "text", "details"],
  quantity: ["4", "quantity", "qty", "shares"],
  price: ["5", "price", "fillPrice", "tradePrice"],
  timestamp: ["6", "timestamp", "eventTime", "time", "datetime"],
} as const;

const FUTURES_ROOT_SYMBOLS = new Set(["ES", "NQ", "YM", "RTY"]);

export function normalizeStreamerEquityQuote(
  row: Record<string, unknown>,
  fallbackTimestamp: number,
): MarketDataQuote | null {
  const symbol = firstString(row, LEVELONE_EQUITIES_FIELDS.symbol)?.trim().toUpperCase() ?? "";
  if (!symbol) {
    return null;
  }
  const price = firstNumber(row, LEVELONE_EQUITIES_FIELDS.price);
  if (price == null) {
    return null;
  }
  const timestampMs = firstNumber(row, LEVELONE_EQUITIES_FIELDS.timestamp) ?? fallbackTimestamp;
  return {
    symbol,
    price,
    volume: firstNumber(row, LEVELONE_EQUITIES_FIELDS.volume) ?? undefined,
    week52High: firstNumber(row, LEVELONE_EQUITIES_FIELDS.week52High) ?? undefined,
    week52Low: firstNumber(row, LEVELONE_EQUITIES_FIELDS.week52Low) ?? undefined,
    securityStatus: firstString(row, LEVELONE_EQUITIES_FIELDS.securityStatus),
    changePercent: firstNumber(row, LEVELONE_EQUITIES_FIELDS.changePercent) ?? undefined,
    timestamp: new Date(timestampMs).toISOString(),
    currency: "USD",
  };
}

export function normalizeStreamerFuturesQuote(
  row: Record<string, unknown>,
  fallbackTimestamp: number,
): MarketDataFuturesQuote | null {
  const symbol = normalizeFuturesSymbol(firstString(row, LEVELONE_FUTURES_FIELDS.symbol)?.trim().toUpperCase() ?? "");
  if (!symbol) {
    return null;
  }
  const price = firstNumber(row, LEVELONE_FUTURES_FIELDS.price);
  if (price == null) {
    return null;
  }
  const timestampMs = firstNumber(row, LEVELONE_FUTURES_FIELDS.timestamp) ?? fallbackTimestamp;
  return {
    symbol,
    rootSymbol: symbol.slice(1),
    price,
    volume: firstNumber(row, LEVELONE_FUTURES_FIELDS.volume) ?? undefined,
    week52High: firstNumber(row, LEVELONE_FUTURES_FIELDS.week52High) ?? undefined,
    week52Low: firstNumber(row, LEVELONE_FUTURES_FIELDS.week52Low) ?? undefined,
    securityStatus: firstString(row, LEVELONE_FUTURES_FIELDS.securityStatus),
    changePercent: firstNumber(row, LEVELONE_FUTURES_FIELDS.changePercent) ?? undefined,
    timestamp: new Date(timestampMs).toISOString(),
    currency: "USD",
  };
}

export function normalizeStreamerChartEquity(row: Record<string, unknown>): StreamerChartEquityPoint | null {
  const symbol = firstString(row, CHART_EQUITY_FIELDS.symbol)?.trim().toUpperCase() ?? "";
  const open = firstNumber(row, CHART_EQUITY_FIELDS.open);
  const high = firstNumber(row, CHART_EQUITY_FIELDS.high);
  const low = firstNumber(row, CHART_EQUITY_FIELDS.low);
  const close = firstNumber(row, CHART_EQUITY_FIELDS.close);
  const volume = firstNumber(row, CHART_EQUITY_FIELDS.volume);
  const chartTimeMs = firstNumber(row, CHART_EQUITY_FIELDS.chartTime);
  if (!symbol || open == null || high == null || low == null || close == null || volume == null || chartTimeMs == null) {
    return null;
  }
  return {
    symbol,
    open,
    high,
    low,
    close,
    volume,
    sequence: firstNumber(row, CHART_EQUITY_FIELDS.sequence),
    chartTime: new Date(chartTimeMs).toISOString(),
  };
}

export function normalizeFuturesSymbol(symbol: string): string | null {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  const compact = normalized.startsWith("/") ? normalized.slice(1) : normalized;
  if (!FUTURES_ROOT_SYMBOLS.has(compact)) {
    return null;
  }
  return `/${compact}`;
}

export function isSupportedFuturesSymbol(symbol: string): boolean {
  return normalizeFuturesSymbol(symbol) != null;
}

export function normalizeStreamerAccountActivityEvent(
  row: Record<string, unknown>,
  fallbackTimestamp: number,
): SchwabAccountActivityEvent | null {
  const eventTimeMs = firstNumber(row, ACCT_ACTIVITY_FIELDS.timestamp) ?? fallbackTimestamp;
  const eventType = firstText(row, ACCT_ACTIVITY_FIELDS.eventType);
  const accountNumber = firstText(row, ACCT_ACTIVITY_FIELDS.accountNumber);
  const symbol = firstString(row, ACCT_ACTIVITY_FIELDS.symbol)?.trim().toUpperCase() ?? null;
  const description = firstString(row, ACCT_ACTIVITY_FIELDS.description);
  const quantity = firstNumber(row, ACCT_ACTIVITY_FIELDS.quantity);
  const price = firstNumber(row, ACCT_ACTIVITY_FIELDS.price);

  if (!eventType && !accountNumber && !symbol && !description && quantity == null && price == null) {
    return null;
  }

  return {
    service: STREAMER_SERVICES.ACCT_ACTIVITY,
    receivedAt: new Date(fallbackTimestamp).toISOString(),
    eventTime: new Date(eventTimeMs).toISOString(),
    eventType: eventType ?? null,
    accountNumber: accountNumber ?? null,
    symbol,
    description: description ?? null,
    quantity: quantity ?? null,
    price: price ?? null,
  };
}

function firstNumber(row: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function firstText(row: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

function firstString(row: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}
