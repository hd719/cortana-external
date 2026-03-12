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
    return SimpleNamespace(regime=regime, position_sizing=1.0, notes="trend intact", status="ok", snapshot_age_seconds=0.0)

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
    assert analysis["confidence_assessment"]["effective_confidence_pct"] == analysis["confidence"]
    assert analysis["recommendation"]["confidence_assessment"]["effective_confidence_pct"] == analysis["recommendation"]["confidence"]
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

def test_analyze_stock_uses_uncertainty_abstain_without_breaking_output_shape():
    advisor = TradingAdvisor()
    closes = [100 + i * 0.5 for i in range(60)]
    history = _history(closes, [1_000_000.0] * 60)

    advisor.market_data.get_history = MagicMock(return_value=SimpleNamespace(frame=history, source="cache", staleness_seconds=7200.0, status="degraded"))
    advisor.fundamentals.get_fundamentals = MagicMock(return_value={"eps_growth": 30, "revenue_growth": 25})
    advisor.fundamentals.score_canslim_fundamentals = MagicMock(return_value={"C": 2, "A": 2, "I": 1, "S": 1})
    advisor.get_market_status = MagicMock(
        return_value=SimpleNamespace(
            regime=MarketRegime.CONFIRMED_UPTREND,
            position_sizing=1.0,
            notes="trend intact",
            status="degraded",
            snapshot_age_seconds=3600.0,
        )
    )
    advisor.headline_sentiment.analyze = MagicMock(
        return_value={"sentiment": "UNAVAILABLE", "article_count": 0, "bearish_pct": 0.0, "bullish_pct": 0.0}
    )
    advisor.x_sentiment.analyze = MagicMock(
        return_value={"sentiment": "UNAVAILABLE", "tweet_count": 0, "bearish_pct": 0.0, "bullish_pct": 0.0}
    )

    analysis = advisor.analyze_stock("AMD", quiet=True)

    assert analysis["abstain"] is True
    assert analysis["confidence"] == analysis["effective_confidence"]
    assert analysis["recommendation"]["action"] == "WATCH"
    assert analysis["recommendation"]["abstain"] is True
    assert "Uncertainty too high" in analysis["recommendation"]["reason"]


def test_analyze_stock_preserves_market_correction_gate_with_adverse_regime_layer():
    advisor = TradingAdvisor()
    closes = [100 + i * 0.6 for i in range(50)] + [132, 133, 134, 135, 136, 137, 138, 139, 140, 141]
    volumes = [1_000_000.0] * 50 + [1_400_000.0] * 10
    history = _history(closes, volumes)
    sector_history = _history([100 + i * 0.2 for i in range(80)], [900_000.0] * 80)

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
            "earnings_event_window": [{"date": "2026-03-20"}],
        }
    )
    advisor.fundamentals.score_canslim_fundamentals = MagicMock(return_value={"C": 2, "A": 2, "I": 1, "S": 1})
    advisor.get_market_status = MagicMock(
        return_value=SimpleNamespace(
            regime=MarketRegime.CORRECTION,
            position_sizing=0.0,
            notes="stay defensive",
            status="ok",
            snapshot_age_seconds=0.0,
            distribution_days=6,
            drawdown_pct=-10.5,
            trend_direction="down",
            price_vs_21d_pct=-3.0,
            price_vs_50d_pct=-6.0,
        )
    )
    advisor.headline_sentiment.analyze = MagicMock(
        return_value={"sentiment": "BULLISH", "article_count": 3, "bullish_pct": 66.7, "bearish_pct": 0.0}
    )
    advisor.x_sentiment.analyze = MagicMock(
        return_value={"sentiment": "BULLISH", "tweet_count": 8, "bullish_pct": 62.5, "bearish_pct": 12.5}
    )

    analysis = advisor.analyze_stock("NVDA", quiet=True)

    assert analysis["recommendation"]["action"] == "NO_BUY"
    assert analysis["recommendation"]["reason"] == "Market in correction. No new positions."
    assert analysis["adverse_regime"]["label"] == "severe"

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
    assert list(df["baseline_score"]) == [7.0, 8.0]
    assert list(df["enhanced_score"]) == [10.0, 8.5]
    assert list(df["tactical_score"]) == [10.75, 8.75]

def test_scan_for_opportunities_prioritizes_buyable_candidates_over_abstaining_watchs():
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
                "total_score": 9,
                "rank_score": 12.0,
                "confidence": 44,
                "effective_confidence": 44,
                "uncertainty_pct": 41,
                "abstain": True,
                "abstain_reason_codes": ["symbol_data_stale"],
                "fundamental_scores": {"C": 2, "A": 2, "I": 1, "S": 1},
                "breakout_follow_through": {"score": 5},
                "sentiment_overlay": {"score": 2},
                "exit_risk": {"score": 0},
                "sector_context": {"score": 1},
                "catalyst_weighting": {"score": 1},
                "recommendation": {"action": "WATCH", "confidence": 44, "position_size_pct": 0.0},
            }
        return {
            "total_score": 8,
            "rank_score": 10.0,
            "confidence": 79,
            "effective_confidence": 79,
            "uncertainty_pct": 9,
            "abstain": False,
            "abstain_reason_codes": [],
            "fundamental_scores": {"C": 2, "A": 2, "I": 1, "S": 1},
            "breakout_follow_through": {"score": 4},
            "sentiment_overlay": {"score": 1},
            "exit_risk": {"score": 1},
            "sector_context": {"score": 1},
            "catalyst_weighting": {"score": 0},
            "recommendation": {"action": "BUY", "confidence": 79, "position_size_pct": 9.5},
        }

    advisor.analyze_stock = _analysis

    df = advisor.scan_for_opportunities(quick=True, min_score=6)

    assert list(df["symbol"]) == ["BBB", "AAA"]
    assert list(df["action"]) == ["BUY", "WATCH"]
    assert list(df["abstain"]) == [False, True]

def test_get_recommendations_uses_buy_rows_in_trade_quality_order():
    advisor = TradingAdvisor()
    advisor.scan_for_opportunities = MagicMock(
        return_value=pd.DataFrame(
            [
                {"symbol": "AAA", "action": "BUY", "rank_score": 12.0, "trade_quality_score": 74.0, "effective_confidence": 58, "uncertainty_pct": 24, "total_score": 9},
                {"symbol": "BBB", "action": "BUY", "rank_score": 10.0, "trade_quality_score": 96.0, "effective_confidence": 80, "uncertainty_pct": 8, "total_score": 8},
                {"symbol": "CCC", "action": "WATCH", "rank_score": 13.0, "trade_quality_score": 99.0},
            ]
        )
    )
    advisor.analyze_stock = MagicMock(
        side_effect=[
            {
                "symbol": "BBB",
                "total_score": 8,
                "recommendation": {"action": "BUY", "position_size_pct": 9.5},
            },
            {
                "symbol": "AAA",
                "total_score": 9,
                "recommendation": {"action": "BUY", "position_size_pct": 4.0},
            },
        ]
    )

    recommendations = advisor.get_recommendations(limit=2)

    assert [item["symbol"] for item in recommendations] == ["BBB", "AAA"]
    assert [call.args[0] for call in advisor.analyze_stock.call_args_list] == ["BBB", "AAA"]


def test_get_recommendations_prefers_lower_downside_when_trade_quality_close():
    advisor = TradingAdvisor()
    advisor.scan_for_opportunities = MagicMock(
        return_value=pd.DataFrame(
            [
                {"symbol": "AAA", "action": "BUY", "trade_quality_score": 88.0, "effective_confidence": 78, "uncertainty_pct": 8, "downside_penalty": 14.0, "churn_penalty": 4.0, "total_score": 9},
                {"symbol": "BBB", "action": "BUY", "trade_quality_score": 87.0, "effective_confidence": 77, "uncertainty_pct": 8, "downside_penalty": 4.0, "churn_penalty": 2.0, "total_score": 8},
            ]
        )
    )
    advisor.analyze_stock = MagicMock(
        side_effect=[
            {"symbol": "BBB", "total_score": 8, "recommendation": {"action": "BUY", "position_size_pct": 7.0}},
            {"symbol": "AAA", "total_score": 9, "recommendation": {"action": "BUY", "position_size_pct": 4.0}},
        ]
    )

    recommendations = advisor.get_recommendations(limit=2)

    assert [item["symbol"] for item in recommendations] == ["BBB", "AAA"]


def test_sort_runtime_candidates_uses_lower_risk_penalties_as_tiebreakers():
    frame = pd.DataFrame(
        [
            {"symbol": "AAA", "action": "BUY", "abstain": False, "trade_quality_score": 90.0, "effective_confidence": 75, "uncertainty_pct": 8, "downside_penalty": 12.0, "churn_penalty": 6.0, "position_size_pct": 4.0, "total_score": 9},
            {"symbol": "BBB", "action": "BUY", "abstain": False, "trade_quality_score": 90.0, "effective_confidence": 75, "uncertainty_pct": 8, "downside_penalty": 5.0, "churn_penalty": 2.0, "position_size_pct": 4.0, "total_score": 9},
        ]
    )

    ranked = TradingAdvisor._sort_runtime_candidates(frame, primary_desc_columns=['trade_quality_score'])

    assert list(ranked['symbol']) == ['BBB', 'AAA']
