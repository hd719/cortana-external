from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from .checks import evaluate_optional_evidence, evaluate_price_facts
from .codex_review import build_codex_packet
from .market_data import MarketDataClient, MarketDataError
from .models import (
    ArtifactPaths,
    CheckResult,
    CheckSeverity,
    Interpretation,
    OptionalEvidence,
    PriceFacts,
    ReviewArtifact,
    RunStatus,
    TradingAgentsReview,
)
from .settlement import build_pending_windows
from .storage import MarketLabStore
from .tradingagents_adapter import TradingAgentsAdapter
from .verdict import decide_trust_verdict


class ReviewRunner:
    def __init__(
        self,
        *,
        store: MarketLabStore | None = None,
        market_data: MarketDataClient | None = None,
        tradingagents: TradingAgentsAdapter | None = None,
    ):
        self.store = store or MarketLabStore()
        self.market_data = market_data or MarketDataClient()
        self.tradingagents = tradingagents or TradingAgentsAdapter()

    def run(self, symbol: str) -> ReviewArtifact:
        run = self.store.create_run(symbol)
        requested_at = run.requested_at
        run_dir = Path(run.run_dir)
        self.store.append_event(run.run_id, "queued", f"Market Lab review queued for {run.symbol}.")
        self.store.update_run(run.run_id, status=RunStatus.RUNNING)
        self.store.append_event(run.run_id, "running", "Collecting market facts.")

        price_facts: PriceFacts | None = None
        spy_facts: PriceFacts | None = None
        optional_evidence = OptionalEvidence()
        checks: list[CheckResult] = []
        trading_review = TradingAgentsReview(status="skipped", summary="TradingAgents was not run.")

        try:
            price_facts = self.market_data.get_quote(run.symbol)
            spy_facts = self.market_data.get_quote("SPY")
            optional_evidence = self.market_data.get_optional_evidence(run.symbol)
            checks.extend(evaluate_price_facts(price_facts))
            checks.extend(evaluate_optional_evidence(optional_evidence))
            self.store.append_event(run.run_id, "facts_collected", "Market facts collected.")
        except MarketDataError as exc:
            message = str(exc)
            checks.append(CheckResult(code="market_data_error", severity=CheckSeverity.BLOCKER, message=message))
            self.store.append_event(run.run_id, "market_data_error", message)
            self.store.append_log(run.run_id, message)

        has_blocker = any(check.severity == CheckSeverity.BLOCKER for check in checks)
        if not has_blocker:
            self.store.append_event(run.run_id, "tradingagents_started", "Starting TradingAgents second-opinion review.")
            trading_review = self.tradingagents.review(run.symbol, run_dir=run_dir)
            self.store.append_event(run.run_id, "tradingagents_done", trading_review.summary)
        else:
            self.store.append_event(run.run_id, "tradingagents_skipped", "Skipped TradingAgents because hard blockers exist.")

        verdict, reasons = decide_trust_verdict(checks, trading_review, optional_evidence)
        now = datetime.now(UTC)
        interpretation = Interpretation(
            summary=_summary(verdict, reasons),
            bullish_points=[] if verdict != "trusted" else ["Required evidence passed."],
            bearish_points=[check.message for check in checks if check.severity == CheckSeverity.BLOCKER],
            actionability="review_only",
        )
        artifact_paths = ArtifactPaths(
            review=str(run_dir / "review.json"),
            events=run.events_path,
            logs=run.logs_path,
            tradingagents=trading_review.output_path,
            codex_packet=str(run_dir / "codex-review-packet.md"),
            codex_review=str(run_dir / "codex-review.md"),
        )
        settlements = build_pending_windows(
            requested_at=requested_at,
            symbol_entry_price=price_facts.price if price_facts else None,
            spy_entry_price=spy_facts.price if spy_facts else None,
        )
        artifact = ReviewArtifact(
            run_id=run.run_id,
            symbol=run.symbol,
            requested_at=requested_at,
            completed_at=now,
            status=RunStatus.DONE,
            trust_verdict=verdict,
            verdict_reasons=reasons,
            price_facts=price_facts,
            spy_facts=spy_facts,
            checks=checks,
            optional_evidence=optional_evidence,
            interpretation=interpretation,
            tradingagents=trading_review,
            settlements=settlements,
            artifact_paths=artifact_paths,
        )
        self.store.write_review(artifact)
        self.store.write_codex_packet(run.run_id, build_codex_packet(artifact))
        for window in settlements:
            self.store.upsert_settlement(
                run.run_id,
                window.window,
                {
                    "status": window.status,
                    "due_at": window.due_at.isoformat(),
                    "symbol_entry_price": window.symbol_entry_price,
                    "spy_entry_price": window.spy_entry_price,
                },
            )
        self.store.append_event(run.run_id, "artifact_written", "Review artifact written.")
        self.store.append_event(run.run_id, "done", f"Review completed with verdict {verdict}.")
        return artifact


def _summary(verdict: str, reasons: list[str]) -> str:
    if verdict == "trusted":
        return "Market Lab trusts this review for future alert consideration."
    if verdict == "blocked":
        return f"Market Lab blocked this review: {', '.join(reasons)}."
    return f"Market Lab is uncertain: {', '.join(reasons)}."
