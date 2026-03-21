import pandas as pd

from data.wave2 import (
    HeadlineSentimentAnalyzer,
    build_sentiment_overlay,
    score_breakout_follow_through,
    score_exit_risk,
)


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


def test_breakout_follow_through_scores_strong_trend():
    closes = [100 + i * 0.5 for i in range(50)] + [126, 127, 128, 129, 130, 131, 132, 133, 134, 135]
    volumes = [1_000_000.0] * 50 + [1_400_000.0] * 10
    report = score_breakout_follow_through(_history(closes, volumes))

    assert report["status"] == "strong"
    assert report["score"] == 5
    assert report["ten_day_return_pct"] > 3.0


def test_headline_sentiment_analyzer_scores_yfinance_news():
    analyzer = HeadlineSentimentAnalyzer()
    payload = [
        {"title": "Company beats earnings and raises outlook"},
        {"title": "Analyst upgrade highlights strong demand"},
        {"title": "Momentum breakout extends after record growth"},
    ]
    analyzer.service_client.get_symbol_payload = lambda *args, **kwargs: {"status": "ok", "data": {"payload": {"items": payload}}}  # type: ignore[assignment]
    result = analyzer.analyze("NVDA")

    assert result["article_count"] == 3
    assert result["sentiment"] in {"BULLISH", "VERY_BULLISH"}
    assert result["bullish_pct"] > result["bearish_pct"]


def test_sentiment_overlay_neutralizes_conflicting_sources():
    class _News:
        def analyze(self, _: str):
            return {"sentiment": "BEARISH", "article_count": 3}

    class _X:
        def analyze(self, _: str):
            return {"sentiment": "VERY_BULLISH", "tweet_count": 10}

    overlay = build_sentiment_overlay("TSLA", headline_analyzer=_News(), x_analyzer=_X())

    assert overlay["label"] == "NEUTRAL"
    assert overlay["score"] == 0
    assert overlay["veto"] is False


def test_exit_risk_flags_breakout_failure_under_distribution():
    closes = [100 + i * 0.6 for i in range(50)] + [129, 128, 127, 126, 124, 121, 118, 116, 114, 112]
    volumes = [900_000.0] * 50 + [1_800_000.0] * 10
    history = _history(closes, volumes)
    breakout = {"breakout_pivot": 128.0}

    report = score_exit_risk(history, breakout)

    assert report["score"] >= 4
    assert report["veto"] is True
    assert report["status"] == "high"
