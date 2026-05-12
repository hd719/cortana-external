from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


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


class CodexReview(Model):
    status: Literal["pending", "attached"]
    summary: str
    output_path: str | None = None
    session_id: str | None = None


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
