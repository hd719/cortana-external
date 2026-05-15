from __future__ import annotations

from datetime import UTC, datetime

from market_lab.models import OptionalEvidence, PriceFacts, SentimentSnapshot, SentimentSourceResult, TrustVerdict
from market_lab.runner import ReviewRunner
from market_lab.storage import MarketLabStore


class FakeMarketData:
    def get_quote(self, symbol: str) -> PriceFacts:
        price = 500.0 if symbol.upper() == "SPY" else 200.0
        return PriceFacts(symbol=symbol, price=price, timestamp=datetime.now(UTC), source="fake", price_basis="latest_close")

    def get_optional_evidence(self, symbol: str) -> OptionalEvidence:
        return OptionalEvidence(
            history_status="available",
            fundamentals_status="available",
            news_status="available",
            sentiment_status="available",
        )


class FakeMarketDataMissingSentiment(FakeMarketData):
    def get_optional_evidence(self, symbol: str) -> OptionalEvidence:
        return OptionalEvidence(history_status="available", fundamentals_status="available")


class FakeSentimentSources:
    def fetch(self, symbol: str) -> SentimentSnapshot:
        return SentimentSnapshot(
            status="available",
            sources=[
                SentimentSourceResult(
                    source="yahoo_finance_news",
                    status="available",
                    fetched_at=datetime.now(UTC),
                    sample_count=2,
                    fetch_method="fixture",
                ),
                SentimentSourceResult(
                    source="reddit",
                    status="available",
                    fetched_at=datetime.now(UTC),
                    sample_count=1,
                    fetch_method="fixture",
                ),
            ],
            notes=["fixture sentiment"],
        )


class FakeBearishSentimentSources:
    def fetch(self, symbol: str) -> SentimentSnapshot:
        return SentimentSnapshot(
            status="available",
            sources=[
                SentimentSourceResult(
                    source="stocktwits",
                    status="available",
                    fetched_at=datetime.now(UTC),
                    sample_count=4,
                    fetch_method="fixture",
                    samples=[
                        "Bearish: safety concerns keep weighing on the setup",
                        "Bearish: valuation looks stretched",
                        "Bearish: delivery risk is rising",
                        "Bullish: momentum could rebound",
                    ],
                )
            ],
            notes=["fixture sentiment"],
        )


def test_runner_writes_artifact_and_events(tmp_path):
    store = MarketLabStore(tmp_path)
    artifact = ReviewRunner(store=store, market_data=FakeMarketData()).run("AAPL")

    assert artifact.trust_verdict == TrustVerdict.TRUSTED
    assert store.read_review(artifact.run_id)["trust_verdict"] == "trusted"
    events = store.read_events(artifact.run_id)
    assert [event["event"] for event in events][-1] == "done"
    assert len(artifact.settlements) == 3
    assert artifact.artifact_paths.codex_packet
    assert "Market Lab Codex Review Packet" in (tmp_path / "runs" / artifact.run_id / "codex-review-packet.md").read_text(
        encoding="utf-8",
    )


def test_runner_fetches_sentiment_and_records_timeline_steps(tmp_path):
    store = MarketLabStore(tmp_path)
    artifact = ReviewRunner(
        store=store,
        market_data=FakeMarketDataMissingSentiment(),
        sentiment_sources=FakeSentimentSources(),
    ).run("AAPL")

    assert artifact.optional_evidence.news_status == "available"
    assert artifact.optional_evidence.sentiment_status == "available"
    assert artifact.sentiment_snapshot is not None
    events = [event["event"] for event in store.read_events(artifact.run_id)]
    assert "sentiment_started" in events
    assert "sentiment_checked" in events


def test_runner_downgrades_strong_bearish_sentiment_until_codex_review(tmp_path):
    store = MarketLabStore(tmp_path)
    artifact = ReviewRunner(
        store=store,
        market_data=FakeMarketDataMissingSentiment(),
        sentiment_sources=FakeBearishSentimentSources(),
    ).run("TSLA")

    assert artifact.trust_verdict == TrustVerdict.UNCERTAIN
    assert artifact.verdict_reasons == ["bearish_sentiment_needs_codex_review"]
    assert any(check.code == "bearish_sentiment_needs_codex_review" for check in artifact.checks)
