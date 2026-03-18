export interface Keys {
  key_id: string;
  secret_key: string;
  base_url: string;
  data_url: string;
}

export interface Account {
  id: string;
  account_number: string;
  status: string;
  currency: string;
  cash: string;
  portfolio_value: string;
  buying_power: string;
  equity: string;
  last_equity: string;
  daytrade_count: number;
  pattern_day_trader: boolean;
}

export interface Position {
  symbol: string;
  qty: string;
  side: string;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  current_price: string;
  avg_entry_price: string;
  change_today: string;
}

export interface LatestTrade {
  p: number;
  t: string;
}

export interface LatestQuote {
  bp: number;
  ap: number;
  t: string;
}

export interface TradeRecord {
  id?: number;
  timestamp?: string;
  symbol: string;
  side: string;
  qty?: number | null;
  notional?: number | null;
  entry_price?: number | null;
  target_price?: number | null;
  stop_loss?: number | null;
  thesis?: string;
  signal_source?: string;
  status: string;
  exit_price?: number | null;
  exit_timestamp?: string | null;
  pnl?: number | null;
  pnl_pct?: number | null;
  outcome?: string;
  metadata?: unknown;
}

export interface RecordTradeRequest {
  symbol: string;
  side: string;
  qty?: number;
  notional?: number;
  thesis?: string;
  signal_source?: string;
  target_price?: number;
  stop_loss?: number;
  order_type?: string;
  time_in_force?: string;
  limit_price?: number;
  stop_price?: number;
  extended_hours?: boolean;
}

export interface UpdateTradeRequest {
  status?: string;
  exit_price?: number;
  outcome?: string;
}

export interface EarningsResult {
  symbol: string;
  earnings_date?: string;
  confirmed: boolean;
  source: string;
  days_until?: number;
  note?: string;
}
