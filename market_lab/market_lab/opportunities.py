from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path

from .checks import evaluate_optional_evidence, evaluate_price_facts
from .evidence import build_evidence_snapshot
from .market_data import MarketDataClient, MarketDataError
from .memory import build_outcome_memory_summary
from .models import (
    CheckResult,
    CheckSeverity,
    OpportunityBoardArtifact,
    OpportunityCandidate,
    OpportunityScoringConfig,
)
from .storage import MarketLabStore, default_cache_dir
from .watchlists import load_watchlist, normalize_symbols

ENV_MAP = {
    "fresh_price_spy_points": "MARKET_LAB_OPP_FRESH_PRICE_SPY_POINTS",
    "no_hard_blockers_points": "MARKET_LAB_OPP_NO_HARD_BLOCKERS_POINTS",
    "momentum_min_points": "MARKET_LAB_OPP_MOMENTUM_MIN_POINTS",
    "momentum_max_points": "MARKET_LAB_OPP_MOMENTUM_MAX_POINTS",
    "outcome_memory_min_points": "MARKET_LAB_OPP_OUTCOME_MEMORY_MIN_POINTS",
    "outcome_memory_max_points": "MARKET_LAB_OPP_OUTCOME_MEMORY_MAX_POINTS",
    "missing_context_max_penalty": "MARKET_LAB_OPP_MISSING_CONTEXT_MAX_PENALTY",
    "risk_flags_max_penalty": "MARKET_LAB_OPP_RISK_FLAGS_MAX_PENALTY",
    "high_threshold": "MARKET_LAB_OPP_HIGH_THRESHOLD",
    "medium_threshold": "MARKET_LAB_OPP_MEDIUM_THRESHOLD",
    "low_threshold": "MARKET_LAB_OPP_LOW_THRESHOLD",
}


def load_scoring_config() -> OpportunityScoringConfig:
    defaults = OpportunityScoringConfig()
    values = defaults.model_dump()
    warnings: list[str] = []
    for field, env_name in ENV_MAP.items():
        raw = os.getenv(env_name)
        if raw is None:
            continue
        try:
            values[field] = float(raw)
        except ValueError:
            warnings.append(f"{env_name}={raw!r} is invalid; using default {getattr(defaults, field)}")
    values["warnings"] = warnings
    return OpportunityScoringConfig.model_validate(values)


class OpportunityBoardService:
    def __init__(
        self,
        *,
        store: MarketLabStore | None = None,
        market_data: MarketDataClient | None = None,
        cache_dir: Path | str | None = None,
        scoring_config: OpportunityScoringConfig | None = None,
    ):
        self.store = store or MarketLabStore()
        self.market_data = market_data or MarketDataClient()
        self.cache_dir = Path(cache_dir).expanduser().resolve() if cache_dir else default_cache_dir() / "opportunities"
        self.scoring_config = scoring_config or load_scoring_config()

    def generate(self, *, watchlist: str | None = None, symbols: list[str] | str | None = None) -> OpportunityBoardArtifact:
        if symbols:
            normalized_symbols = normalize_symbols(symbols)
            source_name = "ad-hoc"
        else:
            definition = load_watchlist(watchlist or "core")
            normalized_symbols = normalize_symbols(definition.symbols)
            source_name = definition.name

        generated_at = datetime.now(UTC)
        board_id = f"mlab_opp_{generated_at.strftime('%Y%m%dT%H%M%SZ')}_{source_name}"
        candidates = [self._score_symbol(symbol) for symbol in normalized_symbols]
        candidates.sort(key=lambda item: item.score, reverse=True)
        ranked = [candidate.model_copy(update={"rank": index + 1}) for index, candidate in enumerate(candidates)]
        board = OpportunityBoardArtifact(
            board_id=board_id,
            watchlist=source_name,
            generated_at=generated_at,
            candidates=ranked,
            scoring_config=self.scoring_config,
        )
        path = self._board_path(board_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        board = board.model_copy(update={"artifact_path": str(path)})
        path.write_text(board.model_dump_json(indent=2), encoding="utf-8")
        return board

    def load(self, board_id: str) -> OpportunityBoardArtifact:
        path = self._board_path(board_id)
        if not path.exists():
            raise KeyError(f"Opportunity board not found: {board_id}")
        return OpportunityBoardArtifact.model_validate(json.loads(path.read_text(encoding="utf-8")))

    def _score_symbol(self, symbol: str) -> OpportunityCandidate:
        checks: list[CheckResult] = []
        price = None
        spy = None
        optional = None
        try:
            price = self.market_data.get_quote(symbol)
            spy = self.market_data.get_quote("SPY")
            optional = self.market_data.get_optional_evidence(symbol)
            checks.extend(evaluate_price_facts(price))
            checks.extend(evaluate_optional_evidence(optional))
        except MarketDataError as exc:
            checks.append(CheckResult(code="market_data_error", severity=CheckSeverity.BLOCKER, message=str(exc)))

        prior_runs = [run for run in self.store.list_runs(limit=25) if run.symbol == symbol]
        prior_settlements = {run.run_id: self.store.list_settlements(run.run_id) for run in prior_runs[:5]}
        outcome_memory = build_outcome_memory_summary(symbol=symbol, prior_runs=prior_runs, prior_settlements=prior_settlements)
        missing_context = []
        if optional:
            missing_context = [
                label
                for label, status in [
                    ("history", optional.history_status),
                    ("fundamentals", optional.fundamentals_status),
                    ("news", optional.news_status),
                    ("sentiment", optional.sentiment_status),
                ]
                if status != "available"
            ]
        blockers = [check.code for check in checks if check.severity == "blocker"]
        evidence = build_evidence_snapshot(
            symbol=symbol,
            price_facts=price,
            spy_facts=spy,
            checks=checks,
            optional_evidence=optional or self._missing_optional(),
        )
        evidence_path = default_cache_dir() / "evidence" / symbol / f"{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}.json"
        evidence_path.parent.mkdir(parents=True, exist_ok=True)
        evidence_path.write_text(evidence.model_dump_json(indent=2), encoding="utf-8")

        components = self._score_components(blockers=blockers, missing_context=missing_context, outcome_memory=outcome_memory)
        score = 0.0 if blockers else max(0.0, min(100.0, sum(components.values())))
        label = self._label(score, bool(blockers))
        reasons = self._reasons(components, outcome_memory)
        return OpportunityCandidate(
            symbol=symbol,
            rank=0,
            score=round(score, 2),
            score_components={key: round(value, 2) for key, value in components.items()},
            review_label=label,
            reasons=reasons,
            blockers=blockers,
            missing_context=missing_context,
            evidence_snapshot_path=str(evidence_path),
            outcome_memory_summary=outcome_memory.model_dump(mode="json"),
        )

    def _score_components(self, *, blockers: list[str], missing_context: list[str], outcome_memory) -> dict[str, float]:
        config = self.scoring_config
        if blockers:
            return {"hard_blocker": -config.risk_flags_max_penalty}
        outcome_points = 0.0
        if outcome_memory.evidence_ready_success_rate is not None:
            span = config.outcome_memory_max_points - config.outcome_memory_min_points
            outcome_points = config.outcome_memory_min_points + span * outcome_memory.evidence_ready_success_rate
        missing_penalty = min(config.missing_context_max_penalty, len(missing_context) * 4.0)
        return {
            "fresh_price_spy": config.fresh_price_spy_points,
            "no_hard_blockers": config.no_hard_blockers_points,
            "momentum": 0.0,
            "outcome_memory": outcome_points,
            "missing_context": -missing_penalty,
            "risk_flags": 0.0,
        }

    def _label(self, score: float, blocked: bool) -> str:
        if blocked:
            return "Blocked"
        if score >= self.scoring_config.high_threshold:
            return "Review Priority High"
        if score >= self.scoring_config.medium_threshold:
            return "Review Priority Medium"
        if score >= self.scoring_config.low_threshold:
            return "Review Priority Low"
        return "Needs More Context"

    def _reasons(self, components: dict[str, float], outcome_memory) -> list[str]:
        reasons = []
        if components.get("fresh_price_spy", 0) > 0:
            reasons.append("fresh price and SPY reference available")
        if components.get("missing_context", 0) < 0:
            reasons.append("optional context missing")
        if outcome_memory.settled_count:
            reasons.append(f"{outcome_memory.settled_count} settled prior windows")
        return reasons or ["scored from deterministic evidence"]

    def _board_path(self, board_id: str) -> Path:
        return self.cache_dir / board_id / "opportunities.json"

    @staticmethod
    def _missing_optional():
        from .models import OptionalEvidence

        return OptionalEvidence()
