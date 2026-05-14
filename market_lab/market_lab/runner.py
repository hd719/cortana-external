from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from .checks import evaluate_optional_evidence, evaluate_price_facts
from .codex_review import build_codex_packet
from .evidence import build_evidence_snapshot
from .market_data import MarketDataClient, MarketDataError
from .memory import build_outcome_memory_summary
from .models import (
    ArtifactPaths,
    CheckResult,
    CheckSeverity,
    EvidenceSnapshot,
    Interpretation,
    OptionalEvidence,
    OutcomeMemorySummary,
    PriceFacts,
    PortfolioContext,
    ReviewArtifact,
    RunStatus,
    SentimentSnapshot,
    TradingAgentsReview,
)
from .portfolio_context import PortfolioContextService
from .sentiment_sources import SentimentSourceClient
from .settlement import build_pending_windows
from .storage import MarketLabStore
from .token_budget import build_token_budget
from .verdict import decide_trust_verdict


class ReviewRunner:
    def __init__(
        self,
        *,
        store: MarketLabStore | None = None,
        market_data: MarketDataClient | None = None,
        sentiment_sources: SentimentSourceClient | None = None,
        portfolio_context: PortfolioContextService | None = None,
    ):
        self.store = store or MarketLabStore()
        self.market_data = market_data or MarketDataClient()
        self.sentiment_sources = sentiment_sources or SentimentSourceClient()
        self.portfolio_context = portfolio_context or PortfolioContextService()

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
        sentiment_snapshot: SentimentSnapshot | None = None
        evidence_snapshot: EvidenceSnapshot | None = None
        outcome_memory: OutcomeMemorySummary | None = None
        portfolio_context: PortfolioContext | None = None
        checks: list[CheckResult] = []
        trading_review = TradingAgentsReview(
            status="skipped",
            summary="Codex-assisted review is available from Mission Control.",
        )

        try:
            price_facts = self.market_data.get_quote(run.symbol)
            spy_facts = self.market_data.get_quote("SPY")
            optional_evidence = self.market_data.get_optional_evidence(run.symbol)
            if optional_evidence.news_status != "available" or optional_evidence.sentiment_status != "available":
                self.store.append_event(
                    run.run_id,
                    "sentiment_started",
                    "Checking Yahoo Finance news, StockTwits, and Reddit.",
                )
                sentiment_snapshot = self.sentiment_sources.fetch(run.symbol)
                yahoo_available = any(
                    item.source == "yahoo_finance_news" and item.status == "available"
                    for item in sentiment_snapshot.sources
                )
                social_available = any(
                    item.source in {"stocktwits", "reddit"} and item.status == "available"
                    for item in sentiment_snapshot.sources
                )
                optional_evidence = optional_evidence.model_copy(
                    update={
                        "news_status": "available" if yahoo_available else optional_evidence.news_status,
                        "sentiment_status": "available" if social_available else optional_evidence.sentiment_status,
                        "notes": [*optional_evidence.notes, *sentiment_snapshot.notes],
                    },
                )
                source_summary = ", ".join(f"{item.source}:{item.status}" for item in sentiment_snapshot.sources)
                self.store.append_event(
                    run.run_id,
                    "sentiment_checked",
                    f"Sentiment sources {sentiment_snapshot.status}: {source_summary}.",
                )
            checks.extend(evaluate_price_facts(price_facts))
            checks.extend(evaluate_optional_evidence(optional_evidence))
            self.store.append_event(run.run_id, "facts_collected", "Market facts collected.")
        except MarketDataError as exc:
            message = str(exc)
            checks.append(CheckResult(code="market_data_error", severity=CheckSeverity.BLOCKER, message=message))
            self.store.append_event(run.run_id, "market_data_error", message)
            self.store.append_log(run.run_id, message)

        verdict, reasons = decide_trust_verdict(checks, trading_review, optional_evidence)
        now = datetime.now(UTC)
        interpretation = Interpretation(
            summary=_summary(verdict, reasons),
            bullish_points=[] if verdict != "trusted" else ["Required evidence passed."],
            bearish_points=[check.message for check in checks if check.severity == CheckSeverity.BLOCKER],
            actionability="review_only",
        )
        prior_runs = [
            item
            for item in self.store.list_runs(limit=25)
            if item.symbol == run.symbol and item.run_id != run.run_id
        ]
        prior_settlements = {item.run_id: self.store.list_settlements(item.run_id) for item in prior_runs[:5]}
        evidence_snapshot = build_evidence_snapshot(
            symbol=run.symbol,
            price_facts=price_facts,
            spy_facts=spy_facts,
            checks=checks,
            optional_evidence=optional_evidence,
            sentiment_snapshot=sentiment_snapshot,
        )
        evidence_snapshot = evidence_snapshot.model_copy(update={"environment": self.store.artifact_environment})
        outcome_memory = build_outcome_memory_summary(
            symbol=run.symbol,
            prior_runs=prior_runs,
            prior_settlements=prior_settlements,
        )
        outcome_memory = outcome_memory.model_copy(update={"environment": self.store.artifact_environment})
        if sentiment_snapshot is not None:
            sentiment_snapshot = sentiment_snapshot.model_copy(update={"environment": self.store.artifact_environment})
        portfolio_context = self.portfolio_context.context_for_symbol(run.symbol)
        portfolio_context = portfolio_context.model_copy(update={"environment": self.store.artifact_environment})
        evidence_path = run_dir / "evidence-snapshot.json"
        outcome_memory_path = run_dir / "outcome-memory.json"
        portfolio_context_path = run_dir / "portfolio-context.json"
        artifact_paths = ArtifactPaths(
            review=str(run_dir / "review.json"),
            events=run.events_path,
            logs=run.logs_path,
            tradingagents=trading_review.output_path,
            codex_packet=str(run_dir / "codex-review-packet.md"),
            codex_review=str(run_dir / "codex-review.md"),
            evidence_snapshot=str(evidence_path),
            outcome_memory=str(outcome_memory_path),
            portfolio_context=str(portfolio_context_path),
        )
        settlements = build_pending_windows(
            requested_at=requested_at,
            symbol_entry_price=price_facts.price if price_facts else None,
            spy_entry_price=spy_facts.price if spy_facts else None,
        )
        artifact = ReviewArtifact(
            environment=self.store.artifact_environment,
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
            evidence_snapshot=evidence_snapshot,
            outcome_memory=outcome_memory,
            sentiment_snapshot=sentiment_snapshot,
            portfolio_context=portfolio_context,
            settlements=settlements,
            artifact_paths=artifact_paths,
        )
        self.store.write_json_atomic(evidence_path, evidence_snapshot.model_dump(mode="json"))
        self.store.write_json_atomic(outcome_memory_path, outcome_memory.model_dump(mode="json"))
        self.store.write_json_atomic(portfolio_context_path, portfolio_context.model_dump(mode="json"))
        self.store.write_review(artifact)
        packet = build_codex_packet(
            artifact,
            prior_runs=prior_runs,
            prior_settlements=prior_settlements,
            mode="quick",
        )
        token_budget = build_token_budget("quick", packet, artifact)
        artifact = artifact.model_copy(update={"token_budget": token_budget})
        self.store.write_review(artifact)
        self.store.write_codex_packet(
            run.run_id,
            build_codex_packet(
                artifact,
                prior_runs=prior_runs,
                prior_settlements=prior_settlements,
                mode="quick",
            ),
        )
        self.store.append_event(run.run_id, "codex_packet_written", "Codex review packet written.")
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
