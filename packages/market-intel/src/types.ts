export type QualityTier = "high" | "medium" | "low" | "ignore";
export type EquityRelevance = "high" | "medium" | "low";
export type RegimeLabel =
  | "confirmed_uptrend"
  | "uptrend_under_pressure"
  | "correction"
  | "rally_attempt";
export type OverlayAlignment =
  | "confirms"
  | "conflicts"
  | "mixed"
  | "neutral"
  | "insufficient_data";
export type RegimeEffect = "risk_on" | "risk_off" | "mixed" | "neutral";
export type SignalDirection = "rising" | "falling" | "steady";
export type SignalSeverity = "minor" | "notable" | "major";
export type PersistenceState =
  | "one_off"
  | "persistent"
  | "accelerating"
  | "reversing";
export type ConvictionState = "supportive" | "neutral" | "conflicting";
export type AggressionDial =
  | "lean_more_aggressive"
  | "no_change"
  | "lean_more_selective";
export type DivergenceState = "none" | "watch" | "persistent";
export type AssetClass = "stock" | "crypto" | "crypto_proxy" | "etf";
export type ImpactModel =
  | "fed_easing"
  | "recession_risk"
  | "inflation_upside"
  | "tariff_risk"
  | "geopolitical_escalation"
  | "crypto_policy_support";
export type MarketBias =
  | "bullish_growth"
  | "bullish_defensive"
  | "bearish_risk"
  | "bullish_energy_defense"
  | "bullish_crypto"
  | "mixed_macro"
  | "neutral";
export type SelectionSource = "market_slug" | "event_slug" | "keyword_fallback";

export interface RegistrySelectors {
  marketSlugs: string[];
  eventSlugs: string[];
  keywords: string[];
  includeKeywords?: string[];
  excludeKeywords?: string[];
}

export interface RegistryEntry {
  id: string;
  title: string;
  category: string;
  theme: string;
  required?: boolean;
  equityRelevance: EquityRelevance;
  sectorTags: string[];
  watchTickers: string[];
  confidenceWeight: number;
  minLiquidity: number;
  active: boolean;
  impactModel: ImpactModel;
  probabilityMode?: "direct" | "invert";
  notes?: string;
  selectors: RegistrySelectors;
}

export interface Registry {
  schemaVersion: number;
  updatedAt: string;
  entries: RegistryEntry[];
}

export interface PolymarketRawEvent {
  id?: string | number;
  slug?: string;
  title?: string;
  description?: string;
  liquidity?: number | string;
  volume24hr?: number;
  markets?: PolymarketRawMarket[];
}

export interface PolymarketRawMarket {
  id?: string | number;
  question?: string;
  slug?: string;
  description?: string;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  liquidity?: number | string;
  liquidityNum?: number;
  liquidityClob?: number;
  volume?: number | string;
  volumeNum?: number;
  volume24hr?: number;
  volume24hrClob?: number;
  spread?: number;
  oneHourPriceChange?: number;
  oneDayPriceChange?: number;
  lastTradePrice?: number;
  bestBid?: number;
  bestAsk?: number;
  active?: boolean;
  closed?: boolean;
  acceptingOrders?: boolean;
  updatedAt?: string;
  endDate?: string;
  resolutionSource?: string;
  events?: PolymarketRawEvent[];
}

export interface QualityInputs {
  liquidity: number;
  volume24h: number;
  spread: number | null;
  active: boolean;
  acceptingOrders: boolean;
  recencyHours: number | null;
  resolutionClarity: number;
  confidenceWeight: number;
  duplicatePenalty: number;
}

export interface QualityAssessment {
  score: number;
  tier: QualityTier;
  reasons: string[];
  inputs: QualityInputs;
}

export interface EquityImpact {
  model: ImpactModel;
  marketBias: MarketBias;
  regimeEffect: RegimeEffect;
  sectorImplications: string[];
  tickerWatchImplications: string[];
  caveats: string[];
}

export interface ThemePersistenceAssessment {
  state: PersistenceState;
  score: number;
  observedRuns: number;
  summary: string;
  latestPriorProbability: number | null;
}

export interface MarketSignal {
  direction: SignalDirection;
  magnitude: number;
  severity: SignalSeverity;
  thresholdCrossings: string[];
  persistence: ThemePersistenceAssessment;
}

export interface NormalizedMarketSnapshot {
  source: "polymarket";
  fetchedAt: string;
  registryEntryId: string;
  selectionSource: SelectionSource;
  eventId: string | null;
  eventSlug: string | null;
  marketId: string;
  slug: string;
  displayTitle: string;
  title: string;
  description: string;
  category: string;
  theme: string;
  probability: number;
  change1h: number | null;
  change4h: number | null;
  change24h: number | null;
  volume24h: number;
  liquidity: number;
  spread: number | null;
  active: boolean;
  acceptingOrders: boolean;
  updatedAt: string | null;
  quality: QualityAssessment;
  equityRelevance: EquityRelevance;
  sectorTags: string[];
  watchTickers: string[];
  confidenceWeight: number;
  impact: EquityImpact;
  displayScore: number;
  signal: MarketSignal;
}

export interface RegimeContext {
  source: string;
  asOf: string | null;
  regime: RegimeLabel;
  status: "ok" | "degraded";
  positionSizing: number;
  notes: string;
  regimeScore: number;
  drawdownPct: number;
  recentReturnPct: number;
}

export interface OverlayAssessment {
  alignment: OverlayAlignment;
  summary: string;
  reason: string;
  dominantEffects: RegimeEffect[];
}

export interface ThemeHighlight {
  registryEntryId: string;
  title: string;
  theme: string;
  probability: number;
  direction: SignalDirection;
  severity: SignalSeverity;
  persistence: PersistenceState;
  regimeEffect: RegimeEffect;
  watchTickers: string[];
}

export interface DivergenceSummary {
  state: DivergenceState;
  summary: string;
  reason: string;
  themes: string[];
}

export interface ReportSummary {
  conviction: ConvictionState;
  aggressionDial: AggressionDial;
  divergence: DivergenceSummary;
  focusSectors: string[];
  cryptoFocus: string[];
  themeHighlights: ThemeHighlight[];
}

export interface WatchlistEntry {
  symbol: string;
  assetClass: AssetClass;
  themes: string[];
  sourceTitles: string[];
  probability: number;
  score: number;
  severity: SignalSeverity;
  persistence: PersistenceState;
}

export interface WatchlistBuckets {
  stocks: WatchlistEntry[];
  crypto: WatchlistEntry[];
  cryptoProxies: WatchlistEntry[];
  funds: WatchlistEntry[];
}

export interface SuppressedMarket {
  registryEntryId: string;
  title: string;
  slug: string;
  reason: string;
}

export interface MarketIntelMetadata {
  registryPath: string;
  historyDir: string;
  latestPath: string;
  regimePath: string | null;
  generatedAt: string;
  persisted: boolean;
}

export interface MarketIntelReport {
  metadata: MarketIntelMetadata;
  regime: RegimeContext | null;
  markets: NormalizedMarketSnapshot[];
  topMarkets: NormalizedMarketSnapshot[];
  watchlist: string[];
  watchlistBuckets: WatchlistBuckets;
  overlay: OverlayAssessment;
  summary: ReportSummary;
  warnings: string[];
  suppressedMarkets: SuppressedMarket[];
}

export interface BuildPolymarketIntelReportOptions {
  registryPath?: string;
  latestPath?: string;
  historyDir?: string;
  regimeInput?: string | Partial<RegimeContext> | null;
  maxMarkets?: number;
  persistHistory?: boolean;
  historyMaxSnapshots?: number;
  historyMaxAgeDays?: number;
  fetchImpl?: typeof fetch;
  now?: Date;
  logger?: MarketIntelLogger;
}

export interface MarketIntelLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface HistorySnapshotRecord {
  generatedAt: string;
  markets: Array<{
    marketId: string;
    registryEntryId?: string;
    theme?: string;
    slug: string;
    probability: number;
  }>;
}

export interface HistoryPruneResult {
  deletedFiles: string[];
  keptFiles: string[];
}

export type RegistryHealthStatus = "healthy" | "fallback_only" | "broken";

export interface RegistryReplacementSuggestion {
  slug: string;
  title: string;
  selectionSource: SelectionSource;
  liquidity: number;
  volume24h: number;
}

export interface RegistryEntryHealth {
  entryId: string;
  title: string;
  required: boolean;
  status: RegistryHealthStatus;
  exactMatchCount: number;
  fallbackMatchCount: number;
  selectedCandidateCount: number;
  suggestions: RegistryReplacementSuggestion[];
  reason: string;
}

export interface RegistryHealthReport {
  checkedAt: string;
  registryPath: string;
  healthy: number;
  fallbackOnly: number;
  broken: number;
  requiredBroken: number;
  optionalBroken: number;
  entries: RegistryEntryHealth[];
}

export interface ArtifactFileHealth {
  path: string;
  exists: boolean;
  fresh: boolean;
  detail: string;
}

export interface ArtifactHealthReport {
  checkedAt: string;
  ok: boolean;
  stale: boolean;
  generatedAt: string | null;
  regimeGeneratedAt: string | null;
  ageHours: number | null;
  regimeAgeHours: number | null;
  topMarkets: number;
  watchlistCount: number;
  overlay: string | null;
  files: {
    regimeJson: ArtifactFileHealth;
    reportJson: ArtifactFileHealth;
    compactText: ArtifactFileHealth;
    watchlistJson: ArtifactFileHealth;
  };
  failures: string[];
}
