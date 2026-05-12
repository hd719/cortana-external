from __future__ import annotations

from datetime import UTC, datetime

from market_lab.models import OptionalEvidence, PriceFacts, TradingAgentsReview, TrustVerdict
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


class FakeTradingAgents:
    def review(self, symbol: str, *, run_dir):
        path = run_dir / "tradingagents.md"
        path.write_text("fake review\n", encoding="utf-8")
        return TradingAgentsReview(status="ok", summary="fake review complete", output_path=str(path))


def test_runner_writes_artifact_and_events(tmp_path):
    store = MarketLabStore(tmp_path)
    artifact = ReviewRunner(store=store, market_data=FakeMarketData(), tradingagents=FakeTradingAgents()).run("AAPL")

    assert artifact.trust_verdict == TrustVerdict.TRUSTED
    assert store.read_review(artifact.run_id)["trust_verdict"] == "trusted"
    events = store.read_events(artifact.run_id)
    assert [event["event"] for event in events][-1] == "done"
    assert len(artifact.settlements) == 3
    assert artifact.artifact_paths.codex_packet
    assert "Market Lab Codex Review Packet" in (tmp_path / "runs" / artifact.run_id / "codex-review-packet.md").read_text(
        encoding="utf-8",
    )
