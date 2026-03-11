from types import SimpleNamespace
from unittest.mock import MagicMock

import pandas as pd

from advisor import TradingAdvisor
from data.market_regime import MarketRegime


def _history(closes: list[float], volumes: list[float] | None = None) -> pd.DataFrame:
    idx = pd.date_range("2026-01-02", periods=len(closes), freq="B")
    volumes = volumes or [1_000_000.0] * len(closes)
    return pd.DataFrame(
        {
            "Open": closes,
            "High": [price * 1.01 for price in closes],
            "Low": [price * 0.99 for price in closes],
            "Close": closes,
            "Volume": volumes,
        },
        index=idx,
    )


def _market(regime: MarketRegime = MarketRegime.CONFIRMED_UPTREND):
    return SimpleNamespace(regime=regime, position_sizing=1.0, notes="trend intact")


def test_analyze_stock_attaches_wave2_scores_and_buys_supportive_setup():
    advisor = TradingAdvisor()
    closes = [100 + i * 0.5 for i in range(50)] + [126, 127, 128, 129, 130, 131, 132, 133, 134, 135]
    volumes = [1_000_000.0] * 50 + [1_500_000.0] * 10
    history = _history(closes, volumes)
    sector_history = _history([100 + i * 0.25 for i in range(80)], [900_000.0] * 80)

    advisor.market_data.get_history = MagicMock(
        side_effect=[
            SimpleNamespace(frame=history, source="test", staleness_seconds=0.0, status="ok"),
            SimpleNamespace(frame=sector_history, source="test", staleness_seconds=0.0, status="ok"),
        ]
    )
    advisor.fundamentals.get_fundamentals = MagicMock(
        return_value={
            "eps_growth": 30,
            "revenue_growth": 25,
            "sector": "Technology",
            "earnings_event_window": [{"date": "2026-03-10"}],
        }
    )
    advisor.fundamentals.score_canslim_fundamentals = MagicMock(return_value={"C": 2, "A": 2, "I": 1, "S": 1})
    advisor.get_market_status = MagicMock(return_value=_market())
    advisor.headline_sentiment.analyze = MagicMock(
        return_value={"sentiment": "BULLISH", "article_count": 3, "bullish_pct": 66.7, "bearish_pct": 0.0}
    )
    advisor.x_sentiment.analyze = MagicMock(
        return_value={"sentiment": "BULLISH", "tweet_count": 8, "bullish_pct": 62.5, "bearish_pct": 12.5}
    )

    analysis = advisor.analyze_stock("NVDA", quiet=True)

    assert analysis["recommendation"]["action"] == "BUY"
    assert analysis["breakout_follow_through"]["score"] >= 4
    assert analysis["sentiment_overlay"]["score"] > 0
    assert analysis["exit_risk"]["score"] <= 1
    assert analysis["sector_context"]["score"] > 0
    assert analysis["catalyst_weighting"]["score"] > 0
    assert analysis["rank_score"] > analysis["total_score"]
    assert analysis["recommendation"]["confidence"] >= 80
    assert analysis["recommendation"]["position_size_pct"] > 10.0


def test_analyze_stock_watch_when_sentiment_overlay_vetoes_setup():
    advisor = TradingAdvisor()
    closes = [100 + i * 0.5 for i in range(50)] + [126, 127, 128, 129, 130, 131, 132, 133, 134, 135]
    history = _history(closes, [1_300_000.0] * 60)

    advisor.market_data.get_history = MagicMock(
        return_value=SimpleNamespace(frame=history, source="test", staleness_seconds=0.0, status="ok")
    )
    advisor.fundamentals.get_fundamentals = MagicMock(return_value={"eps_growth": 30, "revenue_growth": 25})
    advisor.fundamentals.score_canslim_fundamentals = MagicMock(return_value={"C": 2, "A": 2, "I": 1, "S": 1})
    advisor.get_market_status = MagicMock(return_value=_market())
    advisor.headline_sentiment.analyze = MagicMock(
        return_value={"sentiment": "VERY_BEARISH", "article_count": 4, "bearish_pct": 75.0, "bullish_pct": 0.0}
    )
    advisor.x_sentiment.analyze = MagicMock(
        return_value={"sentiment": "VERY_BEARISH", "tweet_count": 9, "bearish_pct": 80.0, "bullish_pct": 0.0}
    )

    analysis = advisor.analyze_stock("TSLA", quiet=True)

    assert analysis["recommendation"]["action"] == "WATCH"
    assert "Sentiment overlay veto" in analysis["recommendation"]["reason"]


def test_scan_for_opportunities_sorts_by_wave2_rank_score():
    advisor = TradingAdvisor()
    advisor.get_market_status = MagicMock(return_value=_market())
    advisor.screener.screen = MagicMock(
        return_value=pd.DataFrame(
            [
                {"symbol": "AAA", "technical_score": 4, "N_score": 2, "L_score": 2},
                {"symbol": "BBB", "technical_score": 4, "N_score": 2, "L_score": 2},
            ]
        )
    )

    def _analysis(symbol: str, quiet: bool = False):
        if symbol == "AAA":
            return {
                "total_score": 8,
                "rank_score": 8.5,
                "fundamental_scores": {"C": 2, "A": 2, "I": 1, "S": 1},
                "breakout_follow_through": {"score": 2},
                "sentiment_overlay": {"score": 0},
                "exit_risk": {"score": 1},
                "recommendation": {"action": "BUY", "confidence": 68},
            }
        return {
            "total_score": 7,
            "rank_score": 10.0,
            "fundamental_scores": {"C": 2, "A": 2, "I": 1, "S": 0},
            "breakout_follow_through": {"score": 5},
            "sentiment_overlay": {"score": 2},
            "exit_risk": {"score": 0},
            "recommendation": {"action": "BUY", "confidence": 82},
        }

    advisor.analyze_stock = _analysis

    df = advisor.scan_for_opportunities(quick=True, min_score=6)

    assert list(df["symbol"]) == ["BBB", "AAA"]
    assert list(df["rank_score"]) == [10.0, 8.5]
