export type MarketDataStatus = "ok" | "degraded" | "error" | "unavailable";

export interface MarketDataComparison {
  source: string;
  available: boolean;
  mismatchSummary?: string;
  timingMs?: number;
  stalenessSeconds?: number | null;
}

export interface MarketDataResponseMetadata {
  source: string;
  status: MarketDataStatus;
  degradedReason?: string | null;
  stalenessSeconds: number | null;
}

export interface MarketDataResponse<T = Record<string, unknown>> extends MarketDataResponseMetadata {
  data: T;
  compare_with?: MarketDataComparison;
}

export interface MarketDataRouteResult<T = Record<string, unknown>> {
  status: number;
  body: MarketDataResponse<T>;
}

export interface MarketDataHistoryPoint {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketDataHistory {
  symbol: string;
  period: string;
  interval: string;
  rows: MarketDataHistoryPoint[];
  comparisonHint?: string;
}

export interface MarketDataQuote {
  symbol: string;
  price?: number;
  change?: number;
  changePercent?: number;
  timestamp?: string;
  currency?: string;
  volume?: number;
  week52High?: number;
  week52Low?: number;
  securityStatus?: string;
}

export interface MarketDataFuturesQuote extends MarketDataQuote {
  rootSymbol: string;
}

export interface SchwabAccountActivityEvent {
  service: "ACCT_ACTIVITY";
  receivedAt: string;
  eventTime: string;
  eventType: string | null;
  accountNumber: string | null;
  symbol: string | null;
  description: string | null;
  quantity: number | null;
  price: number | null;
}

export interface MarketDataSnapshot {
  symbol: string;
  quote?: Record<string, unknown>;
  fundamentals?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface MarketDataGenericPayload {
  symbol: string;
  payload: Record<string, unknown>;
}

export interface MarketDataUniverse {
  symbols: string[];
  source: string;
  updatedAt: string | null;
}

export interface MarketDataRiskSnapshot {
  snapshotDate: string;
  mFactor?: number;
  vix?: number;
  putCall?: number;
  hySpread?: number;
  fearGreed?: number;
  hySpreadSource?: string;
  hySpreadFallback?: boolean;
  hySpreadWarning?: string;
  warnings: string[];
}

export interface MarketDataRiskHistoryPoint {
  date: string;
  value: number;
}

export interface MarketDataRiskHistory {
  rows: Array<Record<string, unknown>>;
}
