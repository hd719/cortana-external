from __future__ import annotations

from datetime import UTC, datetime

from market_lab.models import OptionalEvidence, PriceFacts
from market_lab.opportunities import OpportunityBoardService, OpportunityScoringConfig
from market_lab.storage import MarketLabStore


class FakeMarketData:
    def get_quote(self, symbol: str) -> PriceFacts:
        return PriceFacts(symbol=symbol, price=100 if symbol != "SPY" else 500, timestamp=datetime.now(UTC), source="fake")

    def get_optional_evidence(self, symbol: str) -> OptionalEvidence:
        return OptionalEvidence(history_status="available", fundamentals_status="available")


def test_opportunity_board_scores_ad_hoc_symbols_without_codex(tmp_path):
    board = OpportunityBoardService(
        store=MarketLabStore(tmp_path / "store"),
        market_data=FakeMarketData(),
        cache_dir=tmp_path / "boards",
        scoring_config=OpportunityScoringConfig(),
    ).generate(symbols="AAPL,MSFT")

    assert board.watchlist == "ad-hoc"
    assert [item.rank for item in board.candidates] == [1, 2]
    assert board.candidates[0].score_components["fresh_price_spy"] == 20
    assert board.artifact_path
