"""Wave 2 scoring utilities for breakout quality, sentiment overlays, and exit risk."""

from __future__ import annotations

from typing import Dict, List, Optional

import pandas as pd

from data.market_data_service_client import MarketDataServiceClient
from data.x_sentiment import XSentimentAnalyzer


_SENTIMENT_BIAS = {
    "VERY_BEARISH": -2.0,
    "BEARISH": -1.0,
    "NEUTRAL": 0.0,
    "BULLISH": 1.0,
    "VERY_BULLISH": 2.0,
}


def _label_from_bias(bias: float) -> str:
    if bias <= -1.5:
        return "VERY_BEARISH"
    if bias <= -0.5:
        return "BEARISH"
    if bias >= 1.5:
        return "VERY_BULLISH"
    if bias >= 0.5:
        return "BULLISH"
    return "NEUTRAL"


def _coerce_numeric(history: pd.DataFrame, column: str) -> pd.Series:
    return pd.to_numeric(history[column], errors="coerce")


def score_breakout_follow_through(history: pd.DataFrame) -> Dict:
    """Score whether a breakout is holding and attracting follow-through."""
    if history is None or history.empty or len(history) < 50:
        return {
            "score": 0,
            "max_score": 5,
            "status": "insufficient",
            "reason": "Need at least 50 bars for breakout scoring.",
        }

    close = _coerce_numeric(history, "Close")
    volume = _coerce_numeric(history, "Volume")
    current = float(close.iloc[-1])
    prior_20d_high = float(close.iloc[-21:-1].max())
    ma21 = float(close.rolling(21).mean().iloc[-1])
    ma50 = float(close.rolling(50).mean().iloc[-1])
    ten_day_return = (current / float(close.iloc[-11]) - 1.0) * 100.0
    avg_vol_10d = float(volume.tail(10).mean())
    avg_vol_50d = float(volume.tail(50).mean()) if float(volume.tail(50).mean()) > 0 else 0.0
    volume_ratio = avg_vol_10d / avg_vol_50d if avg_vol_50d > 0 else 0.0

    score = 0
    reasons: List[str] = []

    if current >= prior_20d_high * 0.995:
        score += 2
        reasons.append("holding near recent highs")
    elif current >= prior_20d_high * 0.97:
        score += 1
        reasons.append("still close to breakout pivot")
    else:
        reasons.append("losing distance from breakout pivot")

    if ten_day_return >= 3.0:
        score += 1
        reasons.append("10d follow-through is positive")
    elif ten_day_return <= 0:
        reasons.append("10d follow-through stalled")

    if volume_ratio >= 1.10:
        score += 1
        reasons.append("volume expanded behind the move")
    elif volume_ratio < 0.90:
        reasons.append("volume support is fading")

    if current > ma21 and current > ma50:
        score += 1
        reasons.append("price is above 21d and 50d trend support")
    elif current < ma21:
        reasons.append("price slipped under 21d support")

    status = "strong" if score >= 4 else "mixed" if score >= 2 else "weak"
    return {
        "score": int(score),
        "max_score": 5,
        "status": status,
        "breakout_pivot": round(prior_20d_high, 2),
        "ten_day_return_pct": round(ten_day_return, 1),
        "volume_ratio_10d_vs_50d": round(volume_ratio, 2),
        "ma21": round(ma21, 2),
        "ma50": round(ma50, 2),
        "reasons": reasons,
    }


class HeadlineSentimentAnalyzer:
    """Lightweight headline sentiment using the local market-data service."""

    BEARISH_KEYWORDS = {
        "downgrade", "miss", "misses", "cuts", "cut", "probe", "lawsuit", "fall", "falls",
        "weak", "warning", "bearish", "slowdown", "risk", "selloff", "decline", "exit",
    }
    BULLISH_KEYWORDS = {
        "upgrade", "beats", "beat", "raises", "record", "growth", "strong", "bullish",
        "breakout", "surge", "demand", "buyback", "expands", "wins", "momentum",
    }

    def __init__(self, service_client: Optional[MarketDataServiceClient] = None):
        self.service_client = service_client or MarketDataServiceClient()

    def _default_result(self, ticker: str) -> Dict:
        return {
            "ticker": ticker,
            "sentiment": "UNAVAILABLE",
            "bearish_pct": 0.0,
            "bullish_pct": 0.0,
            "neutral_pct": 0.0,
            "article_count": 0,
            "sample_headlines": [],
        }

    def _extract_texts(self, items: object) -> List[str]:
        if not isinstance(items, list):
            return []

        texts: List[str] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            title = item.get("title")
            summary = item.get("summary")
            chunks = [chunk.strip() for chunk in [title, summary] if isinstance(chunk, str) and chunk.strip()]
            if chunks:
                texts.append(" ".join(chunks))
        return texts

    def _score_text(self, text: str) -> int:
        tokens = set(text.lower().replace("/", " ").split())
        bearish_hits = len(tokens.intersection(self.BEARISH_KEYWORDS))
        bullish_hits = len(tokens.intersection(self.BULLISH_KEYWORDS))
        if bearish_hits > bullish_hits:
            return -1
        if bullish_hits > bearish_hits:
            return 1
        return 0

    def analyze(self, ticker: str) -> Dict:
        symbol = ticker.upper().strip()
        payload = self.service_client.get_symbol_payload("news", symbol)
        data = self.service_client.extract_data(payload) or {}
        items = data.get("items", []) if isinstance(data, dict) else []
        texts = self._extract_texts(items)
        if not texts:
            return self._default_result(symbol)

        scores = [self._score_text(text) for text in texts]
        total = len(scores)
        bearish_count = sum(1 for score in scores if score < 0)
        bullish_count = sum(1 for score in scores if score > 0)
        neutral_count = total - bearish_count - bullish_count

        bearish_pct = round((bearish_count / total) * 100, 1)
        bullish_pct = round((bullish_count / total) * 100, 1)
        neutral_pct = round((neutral_count / total) * 100, 1)
        bias = (bullish_count - bearish_count) / total

        return {
            "ticker": symbol,
            "sentiment": _label_from_bias(bias * 2.0),
            "bearish_pct": bearish_pct,
            "bullish_pct": bullish_pct,
            "neutral_pct": neutral_pct,
            "article_count": total,
            "sample_headlines": texts[:3],
        }


def build_sentiment_overlay(
    symbol: str,
    *,
    headline_analyzer: Optional[HeadlineSentimentAnalyzer] = None,
    x_analyzer: Optional[XSentimentAnalyzer] = None,
) -> Dict:
    """Blend headline/news sentiment with optional X sentiment as a confidence overlay."""
    headline_analyzer = headline_analyzer or HeadlineSentimentAnalyzer()
    news = headline_analyzer.analyze(symbol)
    x_result = x_analyzer.analyze(symbol) if x_analyzer is not None else None

    sources: List[str] = []
    biases: List[float] = []

    if news.get("sentiment") != "UNAVAILABLE" and int(news.get("article_count", 0)) >= 2:
        sources.append("news")
        biases.append(_SENTIMENT_BIAS.get(news.get("sentiment", "NEUTRAL"), 0.0))

    if x_result and x_result.get("sentiment") != "UNAVAILABLE" and int(x_result.get("tweet_count", 0)) >= 5:
        sources.append("x")
        biases.append(_SENTIMENT_BIAS.get(x_result.get("sentiment", "NEUTRAL"), 0.0))

    if not biases:
        return {
            "label": "NEUTRAL",
            "score": 0,
            "confidence_delta": 0,
            "veto": False,
            "source": "none",
            "reason": "No reliable sentiment input.",
            "news": news,
            "x": x_result,
        }

    same_direction = all(bias >= 0 for bias in biases) or all(bias <= 0 for bias in biases)
    combined_bias = sum(biases) / len(biases)
    if len(biases) == 2 and same_direction and abs(combined_bias) > 0:
        combined_bias += 0.5 if combined_bias > 0 else -0.5
    elif len(biases) == 2 and not same_direction:
        combined_bias = 0.0

    label = _label_from_bias(combined_bias)
    score = max(-2, min(2, int(round(combined_bias))))
    confidence_delta = int(round(combined_bias * 6))
    veto = combined_bias <= -1.5

    if len(sources) == 2 and same_direction:
        reason = f"{label.lower().replace('_', ' ')} sentiment confirmed across news and X."
    elif len(sources) == 2:
        reason = "News and X sentiment disagree; overlay neutralized."
    elif sources[0] == "news":
        reason = f"News headlines skew {label.lower().replace('_', ' ')}."
    else:
        reason = f"X chatter skewed {label.lower().replace('_', ' ')}."

    return {
        "label": label,
        "score": score,
        "confidence_delta": confidence_delta,
        "veto": veto,
        "source": "+".join(sources),
        "reason": reason,
        "news": news,
        "x": x_result,
    }


def score_exit_risk(history: pd.DataFrame, breakout: Optional[Dict] = None) -> Dict:
    """Score how fragile the current setup looks from an exit-management perspective."""
    if history is None or history.empty or len(history) < 50:
        return {
            "score": 2,
            "max_score": 5,
            "status": "unknown",
            "veto": False,
            "reason": "Need at least 50 bars for exit-risk scoring.",
        }

    close = _coerce_numeric(history, "Close")
    high = _coerce_numeric(history, "High")
    low = _coerce_numeric(history, "Low")
    volume = _coerce_numeric(history, "Volume")

    current = float(close.iloc[-1])
    ma21 = float(close.rolling(21).mean().iloc[-1])
    ma50 = float(close.rolling(50).mean().iloc[-1])
    pivot = float((breakout or {}).get("breakout_pivot") or close.iloc[-21:-1].max())

    tr = pd.concat(
        [
            (high - low).abs(),
            (high - close.shift(1)).abs(),
            (low - close.shift(1)).abs(),
        ],
        axis=1,
    ).max(axis=1)
    atr_pct = float(tr.rolling(14).mean().iloc[-1] / current * 100.0)

    volume_avg_20d = volume.rolling(20).mean()
    daily_return = close.pct_change()
    distribution_days = int(
        (
            (daily_return < -0.015)
            & (volume > volume_avg_20d * 1.15)
        ).tail(10).sum()
    )

    pivot_distance_pct = (current / pivot - 1.0) * 100.0 if pivot > 0 else 0.0

    score = 0
    reasons: List[str] = []

    if current < ma21:
        score += 1
        reasons.append("below 21d support")
    if current < ma50:
        score += 1
        reasons.append("below 50d support")

    if pivot_distance_pct < -1.0:
        score += 2
        reasons.append("failed back under breakout pivot")
    elif pivot_distance_pct < 1.0:
        score += 1
        reasons.append("little cushion above pivot")

    if atr_pct >= 4.5:
        score += 1
        reasons.append("ATR is elevated")

    if distribution_days >= 2:
        score += 1
        reasons.append("recent distribution pressure")

    score = min(score, 5)
    status = "high" if score >= 4 else "moderate" if score >= 2 else "low"

    return {
        "score": int(score),
        "max_score": 5,
        "status": status,
        "veto": score >= 4,
        "pivot_distance_pct": round(pivot_distance_pct, 1),
        "atr_pct": round(atr_pct, 1),
        "distribution_days_10d": distribution_days,
        "reasons": reasons or ["exit structure looks orderly"],
    }
    def __init__(self, service_client: Optional[MarketDataServiceClient] = None):
        self.service_client = service_client or MarketDataServiceClient()
