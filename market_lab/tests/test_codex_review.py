from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from market_lab.codex_review import CODEX_SCHEMA, build_codex_packet, codex_prompt_for_packet
from market_lab.models import (
    ArtifactPaths,
    CheckResult,
    CheckSeverity,
    Interpretation,
    OptionalEvidence,
    PriceFacts,
    PortfolioAccount,
    PortfolioContext,
    PortfolioPosition,
    ReviewArtifact,
    RunRecord,
    RunStatus,
    TradingAgentsReview,
    TrustVerdict,
    SentimentSnapshot,
    SentimentSourceResult,
)


def make_artifact() -> ReviewArtifact:
    now = datetime.now(UTC)
    run_dir = Path("/tmp/mlab_test_AAPL")
    return ReviewArtifact(
        run_id="mlab_test_AAPL",
        symbol="AAPL",
        requested_at=now,
        completed_at=now,
        status=RunStatus.DONE,
        trust_verdict=TrustVerdict.TRUSTED,
        verdict_reasons=["all_required_evidence_passed"],
        price_facts=PriceFacts(symbol="AAPL", price=100, timestamp=now, source="schwab_streamer"),
        spy_facts=PriceFacts(symbol="SPY", price=500, timestamp=now, source="schwab_streamer"),
        checks=[
            CheckResult(code="price_present", severity=CheckSeverity.INFO, message="AAPL price is available."),
            CheckResult(code="news_missing", severity=CheckSeverity.WARNING, message="Optional news evidence is missing."),
        ],
        optional_evidence=OptionalEvidence(
            history_status="available",
            fundamentals_status="missing",
            news_status="missing",
            sentiment_status="missing",
            notes=["news and sentiment are not wired in v0"],
        ),
        interpretation=Interpretation(summary="Review is trusted."),
        tradingagents=TradingAgentsReview(status="skipped", summary="Codex review available."),
        artifact_paths=ArtifactPaths(
            review=str(run_dir / "review.json"),
            events=str(run_dir / "events.jsonl"),
            logs=str(run_dir / "logs.txt"),
            codex_packet=str(run_dir / "codex-review-packet.md"),
            codex_review=str(run_dir / "codex-review.md"),
        ),
    )


def test_codex_packet_requires_v1_schema_and_roles():
    packet = build_codex_packet(make_artifact())

    assert f"```json {CODEX_SCHEMA}" in packet
    for role in ["price_action", "fundamentals", "news_sentiment", "risk", "final_judge"]:
        assert f'"role": "{role}"' in packet
    assert "confidence" in packet
    assert "evidence_used" in packet


def test_codex_packet_explains_context_and_missing_fact_rules():
    packet = build_codex_packet(make_artifact())

    assert "SPY is the benchmark" in packet
    assert "Alpha versus SPY" in packet
    assert "Do not infer unavailable facts" in packet
    assert "Missing context: fundamentals, news, sentiment" in packet


def test_codex_packet_retires_old_markdown_as_primary_contract():
    packet = build_codex_packet(make_artifact())

    assert "The old free-form `Summary / Bull Case / Bear Case / Decision` shape is not the primary contract." in packet
    assert "Summary:\n..." not in packet
    assert "Bull Case:\n- ..." not in packet


def test_codex_packet_includes_prior_run_settlement_context():
    now = datetime.now(UTC)
    prior = RunRecord(
        run_id="mlab_prior_AAPL",
        symbol="AAPL",
        requested_at=now,
        status=RunStatus.DONE,
        trust_verdict=TrustVerdict.TRUSTED,
        run_dir="/tmp/mlab_prior_AAPL",
        review_path="/tmp/mlab_prior_AAPL/review.json",
        events_path="/tmp/mlab_prior_AAPL/events.jsonl",
        logs_path="/tmp/mlab_prior_AAPL/logs.txt",
        created_at=now,
        updated_at=now,
    )

    packet = build_codex_packet(
        make_artifact(),
        prior_runs=[prior],
        prior_settlements={
            "mlab_prior_AAPL": [
                {"window": "1d", "status": "settled", "score": "success", "alpha_vs_spy_pct": 2.5},
            ],
        },
    )

    assert "mlab_prior_AAPL" in packet
    assert "settlements=1d:settled, score=success, alpha_vs_spy=2.50%" in packet


def test_codex_prompt_does_not_send_codex_to_full_review_artifact():
    prompt = codex_prompt_for_packet("/tmp/mlab_test_AAPL/codex-review-packet.md")

    assert "Use the packet as the review source of truth." in prompt
    assert "Read the Market Lab review artifact" not in prompt
    assert "Do not open the full review.json" in prompt


def test_deep_codex_packet_redacts_portfolio_context():
    artifact = make_artifact().model_copy(
        update={
            "portfolio_context": PortfolioContext(
                status="available",
                source="schwab",
                generated_at=datetime.now(UTC),
                accounts=[
                    PortfolioAccount(
                        account_hash="secret-account-hash",
                        display_name="Brokerage",
                        liquidation_value=1000,
                    )
                ],
                positions=[
                    PortfolioPosition(
                        account_hash="secret-account-hash",
                        symbol="AAPL",
                        quantity=2,
                        current_price=100,
                        market_value=200,
                    ),
                    PortfolioPosition(
                        account_hash="secret-account-hash",
                        symbol="MSFT",
                        quantity=1,
                        current_price=400,
                        market_value=400,
                    ),
                ],
                exposure_notes=["2 positions across 1 account(s)."],
                overlap_notes=["AAPL is already owned; current market value $200.00."],
            )
        }
    )

    packet = build_codex_packet(artifact, mode="deep")

    assert "Redacted Portfolio Context" in packet
    assert "secret-account-hash" not in packet
    assert '"accounts_count": 1' in packet
    assert '"positions_count": 2' in packet
    assert '"holds_symbol": true' in packet
    assert '"symbol": "AAPL"' in packet
    assert '"symbol": "MSFT"' not in packet


def test_quick_codex_packet_includes_compact_sentiment_sources():
    artifact = make_artifact().model_copy(
        update={
            "sentiment_snapshot": SentimentSnapshot(
                status="available",
                sources=[
                    SentimentSourceResult(
                        source="yahoo_finance_news",
                        status="available",
                        fetched_at=datetime.now(UTC),
                        sample_count=4,
                        fetch_method="yahoo_finance_rss",
                        summary="Recent AAPL headlines are available.",
                    )
                ],
            )
        }
    )

    packet = build_codex_packet(artifact)

    assert "Sentiment Sources Summary" in packet
    assert "yahoo_finance_news" in packet
    assert "Recent AAPL headlines are available." in packet
    assert "yahoo_finance_rss" in packet
