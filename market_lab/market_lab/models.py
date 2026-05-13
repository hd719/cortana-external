from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class RunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class TrustVerdict(StrEnum):
    TRUSTED = "trusted"
    UNCERTAIN = "uncertain"
    BLOCKED = "blocked"


class CheckSeverity(StrEnum):
    BLOCKER = "blocker"
    WARNING = "warning"
    INFO = "info"


class SettlementStatus(StrEnum):
    PENDING = "pending"
    SETTLED = "settled"
    FAILED = "failed"
    NOT_DUE = "not_due"


class SettlementScore(StrEnum):
    SUCCESS = "success"
    FAILURE = "failure"
    GOOD_AVOID = "good_avoid"
    BAD_AVOID = "bad_avoid"


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", use_enum_values=True)


class PriceFacts(Model):
    symbol: str
    price: float
    timestamp: datetime
    source: str = "unknown"
    provider_mode: str | None = None
    price_basis: str = "live"
    volume: float | None = None
    raw_payload: dict[str, Any] = Field(default_factory=dict)

    @field_validator("symbol")
    @classmethod
    def normalize_symbol(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not normalized:
            raise ValueError("symbol is required")
        return normalized


class OptionalEvidence(Model):
    history_status: Literal["available", "missing", "error"] = "missing"
    fundamentals_status: Literal["available", "missing", "error"] = "missing"
    news_status: Literal["available", "missing", "error"] = "missing"
    sentiment_status: Literal["available", "missing", "error"] = "missing"
    notes: list[str] = Field(default_factory=list)


class CheckResult(Model):
    code: str
    severity: CheckSeverity
    message: str


class Interpretation(Model):
    summary: str
    bullish_points: list[str] = Field(default_factory=list)
    bearish_points: list[str] = Field(default_factory=list)
    actionability: str = "review"


class TradingAgentsReview(Model):
    status: Literal["ok", "failed", "skipped"]
    summary: str
    output_path: str | None = None
    error_message: str | None = None


CODEX_REVIEW_ROLES = {"price_action", "fundamentals", "news_sentiment", "risk", "final_judge"}


class CodexRoleReview(Model):
    role: Literal["price_action", "fundamentals", "news_sentiment", "risk", "final_judge"]
    stance: Literal["bullish", "bearish", "neutral", "mixed"]
    confidence: float = Field(ge=0, le=1)
    summary: str
    evidence_used: list[str] = Field(default_factory=list)
    bull_points: list[str] = Field(default_factory=list)
    bear_points: list[str] = Field(default_factory=list)
    missing_evidence: list[str] = Field(default_factory=list)


class CodexStructuredReview(Model):
    schema_version: Literal["market-lab-codex-review/v1"] = "market-lab-codex-review/v1"
    verdict: TrustVerdict
    confidence: float = Field(ge=0, le=1)
    horizon: Literal["1d", "5d", "20d", "mixed"]
    summary: str
    hard_gate_assessment: str
    context_quality: str
    missing_context: list[str] = Field(default_factory=list)
    roles: list[CodexRoleReview] = Field(default_factory=list)
    what_would_change_verdict: list[str] = Field(default_factory=list)
    operator_note: str

    @model_validator(mode="after")
    def require_all_roles(self) -> "CodexStructuredReview":
        roles = {item.role for item in self.roles}
        missing = sorted(CODEX_REVIEW_ROLES - roles)
        if missing:
            raise ValueError(f"missing Codex review roles: {', '.join(missing)}")
        return self


class CodexReview(Model):
    status: Literal["pending", "attached"]
    summary: str
    verdict: TrustVerdict | None = None
    structured: CodexStructuredReview | None = None
    output_path: str | None = None
    session_id: str | None = None


class CodexReviewStructured(Model):
    schema_version: str | None = None
    verdict: TrustVerdict | str | None = None
    summary: str | None = None
    analyst_reviews: dict[str, Any] = Field(default_factory=dict)
    confidence: float | None = None
    notes: list[str] = Field(default_factory=list)
    raw_payload: dict[str, Any] = Field(default_factory=dict)


class SentimentSourceResult(Model):
    source: Literal["yahoo_finance_news", "stocktwits", "reddit"]
    status: Literal["available", "empty", "missing", "rate_limited", "error"]
    fetched_at: datetime
    sample_count: int = 0
    fetch_method: str
    request_url: str | None = None
    summary: str | None = None
    samples: list[str] = Field(default_factory=list)
    raw_artifact_path: str | None = None
    error_message: str | None = None


class SentimentSnapshot(Model):
    status: Literal["available", "partial", "missing", "error"]
    sources: list[SentimentSourceResult] = Field(default_factory=list)
    missing_sources: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class EvidenceSnapshot(Model):
    symbol: str
    generated_at: datetime
    price_summary: dict[str, Any]
    benchmark_summary: dict[str, Any]
    momentum_summary: dict[str, Any] | None = None
    fundamentals_summary: dict[str, Any] | None = None
    news_summary: dict[str, Any] | None = None
    sentiment_summary: dict[str, Any] | None = None
    risk_flags: list[str] = Field(default_factory=list)
    missing_context: list[str] = Field(default_factory=list)
    check_summary: list[dict[str, Any]] = Field(default_factory=list)

    @field_validator("symbol")
    @classmethod
    def normalize_evidence_symbol(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not normalized:
            raise ValueError("symbol is required")
        return normalized


class OutcomeMemorySummary(Model):
    symbol: str
    lookback_runs: int
    evidence_ready_count: int
    needs_more_context_count: int
    blocked_count: int
    settled_count: int
    evidence_ready_success_rate: float | None = None
    evidence_ready_avg_alpha_vs_spy_pct: float | None = None
    common_missing_context: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class TokenBudgetSummary(Model):
    mode: Literal["quick", "deep"]
    estimated_input_tokens: int | None = None
    max_input_tokens: int
    included_sections: list[str] = Field(default_factory=list)
    omitted_sections: list[str] = Field(default_factory=list)


class WatchlistDefinition(Model):
    name: str
    symbols: list[str]
    description: str | None = None

    @field_validator("symbols")
    @classmethod
    def normalize_watchlist_symbols(cls, value: list[str]) -> list[str]:
        return [item.strip().upper() for item in value if item.strip()]


class OpportunityScoringConfig(Model):
    fresh_price_spy_points: float = 20
    no_hard_blockers_points: float = 10
    momentum_min_points: float = -10
    momentum_max_points: float = 25
    outcome_memory_min_points: float = -10
    outcome_memory_max_points: float = 20
    missing_context_max_penalty: float = 15
    risk_flags_max_penalty: float = 30
    high_threshold: float = 80
    medium_threshold: float = 60
    low_threshold: float = 40
    warnings: list[str] = Field(default_factory=list)


class OpportunityCandidate(Model):
    symbol: str
    rank: int
    score: float
    score_components: dict[str, float] = Field(default_factory=dict)
    review_label: str
    reasons: list[str] = Field(default_factory=list)
    blockers: list[str] = Field(default_factory=list)
    missing_context: list[str] = Field(default_factory=list)
    evidence_snapshot_path: str | None = None
    outcome_memory_summary: dict[str, Any] | None = None


class OpportunityBoardArtifact(Model):
    schema_version: str = "market-lab-opportunity-board/v1"
    board_id: str
    watchlist: str
    generated_at: datetime
    candidates: list[OpportunityCandidate]
    scoring_config: OpportunityScoringConfig
    artifact_path: str | None = None


class PortfolioPosition(Model):
    account_hash: str | None = None
    symbol: str
    asset_type: str | None = None
    quantity: float | None = None
    average_price: float | None = None
    current_price: float | None = None
    day_change: float | None = None
    day_change_pct: float | None = None
    quote_source: str | None = None
    quote_status: str | None = None
    quote_timestamp: datetime | None = None
    cost_basis: float | None = None
    unrealized_pnl: float | None = None
    market_value: float | None = None
    weight_pct: float | None = None
    sector: str | None = None
    themes: list[str] = Field(default_factory=list)

    @field_validator("symbol")
    @classmethod
    def normalize_position_symbol(cls, value: str) -> str:
        return value.strip().upper()


class PortfolioAccount(Model):
    account_hash: str
    display_name: str | None = None
    account_type: str | None = None
    cash_value: float | None = None
    liquidation_value: float | None = None


class PortfolioContext(Model):
    status: Literal["available", "unavailable", "reauth_required", "error"]
    source: str
    generated_at: datetime
    accounts: list[PortfolioAccount] = Field(default_factory=list)
    positions: list[PortfolioPosition] = Field(default_factory=list)
    exposure_notes: list[str] = Field(default_factory=list)
    overlap_notes: list[str] = Field(default_factory=list)
    message: str | None = None
    artifact_path: str | None = None


class ApprovalRecord(Model):
    operator: str
    decided_at: datetime
    decision: Literal["approved", "rejected"]
    note: str | None = None


class ExecutionIntent(Model):
    intent_id: str
    symbol: str
    created_at: datetime
    expires_at: datetime
    source_review_id: str
    evidence_snapshot_path: str
    portfolio_context_path: str | None = None
    proposed_action: Literal["buy", "sell", "hold"]
    proposed_notional: float | None = None
    status: Literal["draft", "approved", "rejected", "expired", "submitted"]
    approval: ApprovalRecord | None = None
    artifact_path: str | None = None

    @field_validator("symbol")
    @classmethod
    def normalize_intent_symbol(cls, value: str) -> str:
        return value.strip().upper()


class BrokerValidationResult(Model):
    intent_id: str
    checked_at: datetime
    status: Literal["valid", "blocked", "needs_refresh"]
    reasons: list[str] = Field(default_factory=list)
    evidence_fresh: bool
    price_fresh: bool
    portfolio_fresh: bool
    account_available: bool
    duplicate_order_detected: bool


class BrokerOrderPreview(Model):
    intent_id: str
    preview_id: str
    created_at: datetime
    expires_at: datetime
    symbol: str
    side: Literal["buy", "sell"]
    quote_price: float
    quote_as_of: datetime
    estimated_quantity: float | None = None
    estimated_notional: float | None = None
    estimated_cost: float | None = None
    max_price_age_seconds: int
    max_slippage_pct: float
    warnings: list[str] = Field(default_factory=list)


class SettlementWindow(Model):
    window: Literal["1d", "5d", "20d"]
    status: SettlementStatus
    due_at: datetime
    symbol_entry_price: float | None = None
    spy_entry_price: float | None = None
    symbol_settlement_price: float | None = None
    spy_settlement_price: float | None = None
    raw_return_pct: float | None = None
    spy_return_pct: float | None = None
    alpha_vs_spy_pct: float | None = None
    score: SettlementScore | None = None
    settled_at: datetime | None = None
    error_message: str | None = None


class ArtifactPaths(Model):
    review: str
    events: str
    logs: str
    tradingagents: str | None = None
    codex_packet: str | None = None
    codex_review: str | None = None
    evidence_snapshot: str | None = None
    outcome_memory: str | None = None
    portfolio_context: str | None = None


class ReviewArtifact(Model):
    schema_version: str = "market-lab-review/v0"
    run_id: str
    symbol: str
    requested_at: datetime
    completed_at: datetime | None = None
    status: RunStatus
    trust_verdict: TrustVerdict
    verdict_reasons: list[str]
    price_facts: PriceFacts | None = None
    spy_facts: PriceFacts | None = None
    checks: list[CheckResult] = Field(default_factory=list)
    optional_evidence: OptionalEvidence = Field(default_factory=OptionalEvidence)
    interpretation: Interpretation
    tradingagents: TradingAgentsReview
    codex_review: CodexReview | None = None
    codex_review_structured: CodexReviewStructured | dict[str, Any] | None = None
    evidence_snapshot: EvidenceSnapshot | None = None
    outcome_memory: OutcomeMemorySummary | None = None
    token_budget: TokenBudgetSummary | None = None
    sentiment_snapshot: SentimentSnapshot | None = None
    portfolio_context: PortfolioContext | None = None
    settlements: list[SettlementWindow] = Field(default_factory=list)
    artifact_paths: ArtifactPaths

    @field_validator("symbol")
    @classmethod
    def normalize_symbol(cls, value: str) -> str:
        return value.strip().upper()


class TimelineEvent(Model):
    run_id: str
    timestamp: datetime
    event: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class RunRecord(Model):
    run_id: str
    symbol: str
    requested_at: datetime
    status: RunStatus
    trust_verdict: TrustVerdict | None = None
    verdict_reasons: list[str] = Field(default_factory=list)
    run_dir: str
    review_path: str | None = None
    events_path: str
    logs_path: str
    tradingagents_path: str | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime


def model_to_json(model: BaseModel) -> str:
    return model.model_dump_json(indent=2)


def path_as_str(path: Path | str | None) -> str | None:
    return str(path) if path is not None else None
