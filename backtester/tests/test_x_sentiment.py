"""Unit tests for X/Twitter sentiment analyzer and alert integration."""

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pandas as pd

from data.market_regime import MarketRegime
from data.x_sentiment import XSentimentAnalyzer
from dipbuyer_alert import format_alert


class _FakeAdvisor:
    def __init__(self):
        self.risk_fetcher = SimpleNamespace(
            get_snapshot=lambda: {"vix": 24.0, "put_call": 1.0, "hy_spread": 500.0, "fear_greed": 30.0}
        )
        self._market = SimpleNamespace(
            regime=MarketRegime.CORRECTION,
            position_sizing=0.5,
            notes="Test regime note",
        )
        self._scan = pd.DataFrame(
            [
                {"symbol": "MSFT", "total_score": 9},
                {"symbol": "AAPL", "total_score": 7},
                {"symbol": "TSLA", "total_score": 5},
            ]
        )
        self._analysis = {
            "MSFT": {"total_score": 9, "recommendation": {"action": "BUY", "entry": 100.0, "stop_loss": 93.0}},
            "AAPL": {"total_score": 7, "recommendation": {"action": "WATCH", "reason": "Watch setup"}},
            "TSLA": {"total_score": 5, "recommendation": {"action": "NO_BUY", "reason": "Score too low"}},
        }

    def get_market_status(self, refresh: bool = False):
        return self._market

    def scan_dip_opportunities(self, quick: bool = True, min_score: int = 6):
        return self._scan

    def analyze_dip_stock(self, symbol: str):
        return self._analysis[symbol]


def test_keyword_scoring_bearish_bullish_neutral():
    analyzer = XSentimentAnalyzer()

    assert analyzer._score_tweet("This stock will crash and dump hard") == -1
    assert analyzer._score_tweet("Time to buy calls on this dip") == 1
    assert analyzer._score_tweet("just watching price action today") == 0


def test_sentiment_aggregation_percentages_and_label():
    analyzer = XSentimentAnalyzer(rate_limit_seconds=0)
    mock_payload = [
        {"text": "crash dump sell"},
        {"text": "short puts tank"},
        {"text": "buy calls long"},
        {"text": "no idea"},
        {"text": "still neutral"},
    ]

    with patch.object(analyzer, "_run_bird_search", return_value=json.dumps(mock_payload)):
        result = analyzer.analyze("TSLA")

    assert result["tweet_count"] == 5
    assert result["bearish_pct"] == 40.0
    assert result["bullish_pct"] == 20.0
    assert result["neutral_pct"] == 40.0
    assert result["sentiment"] == "NEUTRAL"


def test_failure_handling_returns_unavailable():
    analyzer = XSentimentAnalyzer(rate_limit_seconds=0)

    with patch.object(analyzer, "_run_bird_search", side_effect=RuntimeError("bird missing")):
        result = analyzer.analyze("TSLA")

    assert result["sentiment"] == "UNAVAILABLE"
    assert result["tweet_count"] == 0


def test_rate_limit_and_cache_behavior():
    analyzer = XSentimentAnalyzer(cache_ttl_seconds=1800, rate_limit_seconds=2)
    payload = '[{"text":"buy dip"}]'

    with patch.object(analyzer, "_run_bird_search", return_value=payload) as run_mock, patch(
        "data.x_sentiment.time.sleep"
    ) as sleep_mock:
        first = analyzer.analyze("TSLA")
        second = analyzer.analyze("TSLA")

    assert run_mock.call_count == 1
    assert sleep_mock.call_count == 0
    assert first == second


def test_alert_output_includes_social_sentiment_and_tags():
    fake_advisor = _FakeAdvisor()

    analyzer_instance = MagicMock()
    analyzer_instance.analyze.side_effect = [
        {
            "ticker": "MSFT",
            "sentiment": "VERY_BEARISH",
            "bearish_pct": 70.0,
            "bullish_pct": 10.0,
            "neutral_pct": 20.0,
            "tweet_count": 10,
            "sample_tweets": ["crash dump"],
        },
        {
            "ticker": "AAPL",
            "sentiment": "BULLISH",
            "bearish_pct": 10.0,
            "bullish_pct": 65.0,
            "neutral_pct": 25.0,
            "tweet_count": 10,
            "sample_tweets": ["buy calls"],
        },
    ]

    with patch("dipbuyer_alert.TradingAdvisor", return_value=fake_advisor), patch(
        "dipbuyer_alert.XSentimentAnalyzer", return_value=analyzer_instance
    ):
        text = format_alert(limit=8, min_score=6)

    assert "🐦 Sentiment: 2/2 checked | 1 contrarian signals" in text
    assert "• MSFT (9/12) → BUY | 🐦 Contrarian ✅" in text
    assert "• AAPL (7/12) → WATCH | 🐦 Caution ⚠️" in text
    assert "• TSLA (5/12) → NO_BUY" in text
