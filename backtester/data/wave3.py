"""Wave 3 utilities for sector context, catalyst weighting, and position sizing."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, Optional

import pandas as pd

from data.market_data_provider import MarketDataProvider
from data.market_regime import MarketRegime, MarketStatus


SECTOR_PROXY_MAP = {
    "basic materials": "XLB",
    "communication services": "XLC",
    "consumer cyclical": "XLY",
    "consumer defensive": "XLP",
    "energy": "XLE",
    "financial services": "XLF",
    "financial": "XLF",
    "healthcare": "XLV",
    "industrials": "XLI",
    "real estate": "XLRE",
    "technology": "XLK",
    "utilities": "XLU",
}


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _coerce_numeric(history: pd.DataFrame, column: str) -> pd.Series:
    return pd.to_numeric(history[column], errors="coerce")


def _period_return(close: pd.Series, bars: int) -> float:
    if close is None or close.empty or len(close) <= bars:
        return 0.0
    base = float(close.iloc[-1 - bars])
    current = float(close.iloc[-1])
    if base == 0:
        return 0.0
    return (current / base - 1.0) * 100.0


def sector_proxy_for_name(sector: Optional[str]) -> Optional[str]:
    if not sector:
        return None
    return SECTOR_PROXY_MAP.get(sector.strip().lower())


def score_sector_relative_strength(
    stock_history: pd.DataFrame,
    sector_history: pd.DataFrame,
    *,
    sector: Optional[str],
    benchmark_symbol: Optional[str],
) -> Dict:
    """Compare stock trend quality against its sector ETF proxy."""
    if stock_history is None or stock_history.empty or len(stock_history) < 50:
        return {
            "sector": sector,
            "benchmark_symbol": benchmark_symbol,
            "score": 0,
            "status": "insufficient",
            "confidence_delta": 0,
            "reason": "Need at least 50 bars for sector-relative strength.",
        }

    if sector_history is None or sector_history.empty or len(sector_history) < 50:
        return {
            "sector": sector,
            "benchmark_symbol": benchmark_symbol,
            "score": 0,
            "status": "unavailable",
            "confidence_delta": 0,
            "reason": "Sector benchmark history unavailable.",
        }

    stock_close = _coerce_numeric(stock_history, "Close")
    sector_close = _coerce_numeric(sector_history, "Close")
    long_bars = min(63, len(stock_close) - 1, len(sector_close) - 1)
    stock_return_21 = _period_return(stock_close, 21)
    sector_return_21 = _period_return(sector_close, 21)
    stock_return_63 = _period_return(stock_close, long_bars)
    sector_return_63 = _period_return(sector_close, long_bars)

    relative_21 = stock_return_21 - sector_return_21
    relative_63 = stock_return_63 - sector_return_63

    stock_ma50 = float(stock_close.rolling(50, min_periods=20).mean().iloc[-1])
    sector_ma50 = float(sector_close.rolling(50, min_periods=20).mean().iloc[-1])
    stock_vs_50 = ((float(stock_close.iloc[-1]) / stock_ma50) - 1.0) * 100.0 if stock_ma50 else 0.0
    sector_vs_50 = ((float(sector_close.iloc[-1]) / sector_ma50) - 1.0) * 100.0 if sector_ma50 else 0.0

    raw_score = 0
    reasons = []

    if relative_21 >= 3.0:
        raw_score += 1
        reasons.append("1m relative strength is leading the sector")
    elif relative_21 <= -3.0:
        raw_score -= 1
        reasons.append("1m relative strength is lagging the sector")

    if relative_63 >= 5.0:
        raw_score += 1
        reasons.append("3m relative strength is persistent")
    elif relative_63 <= -5.0:
        raw_score -= 1
        reasons.append("3m relative strength is deteriorating")

    if stock_vs_50 >= 2.0 and sector_vs_50 <= 1.0:
        raw_score += 1
        reasons.append("stock is holding trend support better than the group")
    elif stock_vs_50 <= -2.0 and sector_vs_50 >= 0.0:
        raw_score -= 1
        reasons.append("stock is losing trend support while the group holds")

    score = int(_clamp(raw_score, -2, 2))
    status = "leader" if score >= 2 else "supportive" if score == 1 else "neutral" if score == 0 else "weak" if score == -1 else "lagging"

    if not reasons:
        reasons.append("stock is moving roughly in line with the sector")

    return {
        "sector": sector,
        "benchmark_symbol": benchmark_symbol,
        "score": score,
        "status": status,
        "confidence_delta": int(score * 5),
        "relative_return_21d_pct": round(relative_21, 1),
        "relative_return_63d_pct": round(relative_63, 1),
        "stock_vs_50d_pct": round(stock_vs_50, 1),
        "sector_vs_50d_pct": round(sector_vs_50, 1),
        "reason": "; ".join(reasons),
    }


class SectorStrengthAnalyzer:
    """Fetch sector proxy history and score stock performance versus the group."""

    def __init__(self, market_data: MarketDataProvider):
        self.market_data = market_data

    def analyze(self, stock_history: pd.DataFrame, sector: Optional[str]) -> Dict:
        benchmark_symbol = sector_proxy_for_name(sector)
        if not benchmark_symbol:
            return {
                "sector": sector,
                "benchmark_symbol": None,
                "score": 0,
                "status": "unmapped",
                "confidence_delta": 0,
                "reason": "No sector benchmark mapping available.",
            }

        try:
            sector_history = self.market_data.get_history(benchmark_symbol, period="6mo", auto_adjust=False).frame
        except Exception as exc:
            return {
                "sector": sector,
                "benchmark_symbol": benchmark_symbol,
                "score": 0,
                "status": "unavailable",
                "confidence_delta": 0,
                "reason": f"Sector benchmark fetch failed: {exc}",
            }

        return score_sector_relative_strength(
            stock_history,
            sector_history,
            sector=sector,
            benchmark_symbol=benchmark_symbol,
        )


def _coerce_event_frame(events: object) -> pd.DataFrame:
    if isinstance(events, pd.DataFrame):
        frame = events.copy()
    elif isinstance(events, list):
        frame = pd.DataFrame(events)
    else:
        return pd.DataFrame(columns=["date"])

    if "date" not in frame.columns:
        return pd.DataFrame(columns=["date"])

    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    frame = frame.dropna(subset=["date"]).sort_values("date").reset_index(drop=True)
    return frame


def score_catalyst_weighting(
    events: object,
    *,
    as_of: Optional[pd.Timestamp] = None,
    sentiment_overlay: Optional[Dict] = None,
    breakout: Optional[Dict] = None,
) -> Dict:
    """Treat earnings/event timing as a bounded confidence modifier."""
    frame = _coerce_event_frame(events)
    if frame.empty:
        return {
            "score": 0,
            "label": "NEUTRAL",
            "confidence_delta": 0,
            "reason": "No event calendar available.",
            "last_event_date": None,
            "next_event_date": None,
        }

    as_of_ts = pd.Timestamp(as_of or datetime.now(timezone.utc)).tz_localize(None)
    sentiment_score = int((sentiment_overlay or {}).get("score", 0))
    breakout_score = int((breakout or {}).get("score", 0))

    past_events = frame[frame["date"] <= as_of_ts]
    future_events = frame[frame["date"] > as_of_ts]

    score = 0
    reasons = []
    last_event_date = past_events["date"].iloc[-1] if not past_events.empty else None
    next_event_date = future_events["date"].iloc[0] if not future_events.empty else None

    if next_event_date is not None:
        days_to_event = int((next_event_date - as_of_ts).days)
        if days_to_event <= 7:
            score -= 2
            reasons.append("earnings event is imminent")
        elif days_to_event <= 21:
            score -= 1
            reasons.append("earnings event is approaching")

    if last_event_date is not None:
        days_since_event = int((as_of_ts - last_event_date).days)
        if days_since_event <= 5:
            if sentiment_score > 0 and breakout_score >= 3:
                score += 2
                reasons.append("fresh post-event reaction is supportive")
            elif sentiment_score < 0:
                score -= 1
                reasons.append("recent event reaction is still negative")
            else:
                score += 1
                reasons.append("recent event keeps the setup current")
        elif days_since_event <= 20 and sentiment_score > 0 and breakout_score >= 4:
            score += 1
            reasons.append("recent event follow-through is still constructive")

    score = int(_clamp(score, -2, 2))
    label = "TAILWIND" if score >= 2 else "SUPPORTIVE" if score == 1 else "NEUTRAL" if score == 0 else "CAUTION" if score == -1 else "RISK"

    if not reasons:
        reasons.append("event window is not materially changing the setup")

    return {
        "score": score,
        "label": label,
        "confidence_delta": int(score * 5),
        "reason": "; ".join(reasons),
        "last_event_date": last_event_date.strftime("%Y-%m-%d") if last_event_date is not None else None,
        "next_event_date": next_event_date.strftime("%Y-%m-%d") if next_event_date is not None else None,
    }


def build_position_sizing_guidance(
    *,
    market: MarketStatus,
    confidence: int,
    breakout: Optional[Dict] = None,
    exit_risk: Optional[Dict] = None,
    sector_context: Optional[Dict] = None,
    catalyst: Optional[Dict] = None,
    base_position_pct: float = 10.0,
) -> Dict:
    """Convert regime and setup quality into a bounded position-size suggestion."""
    if market.regime == MarketRegime.CORRECTION or market.position_sizing <= 0:
        return {
            "recommended_position_pct": 0.0,
            "label": "OFF",
            "base_position_pct": round(base_position_pct * market.position_sizing, 2),
            "confidence_multiplier": 0.0,
            "setup_multiplier": 0.0,
            "reason": "Market regime does not allow new positions.",
        }

    if confidence >= 85:
        confidence_multiplier = 1.1
    elif confidence >= 75:
        confidence_multiplier = 1.0
    elif confidence >= 65:
        confidence_multiplier = 0.85
    else:
        confidence_multiplier = 0.65

    setup_multiplier = 1.0
    breakout_score = int((breakout or {}).get("score", 0))
    exit_risk_score = int((exit_risk or {}).get("score", 0))
    sector_score = int((sector_context or {}).get("score", 0))
    catalyst_score = int((catalyst or {}).get("score", 0))

    if breakout_score >= 4:
        setup_multiplier *= 1.05
    elif breakout_score <= 2:
        setup_multiplier *= 0.9

    if sector_score >= 1:
        setup_multiplier *= 1.05
    elif sector_score <= -1:
        setup_multiplier *= 0.9

    if catalyst_score >= 1:
        setup_multiplier *= 1.05
    elif catalyst_score <= -1:
        setup_multiplier *= 0.88

    if exit_risk_score >= 4:
        setup_multiplier *= 0.4
    elif exit_risk_score == 3:
        setup_multiplier *= 0.6
    elif exit_risk_score == 2:
        setup_multiplier *= 0.8

    base_pct = base_position_pct * market.position_sizing
    raw_pct = base_pct * confidence_multiplier * setup_multiplier
    max_pct = base_pct * 1.15
    recommended_position_pct = round(_clamp(raw_pct, 2.5, max_pct), 2)

    label = "FULL" if recommended_position_pct >= base_pct * 0.95 else "STANDARD" if recommended_position_pct >= base_pct * 0.7 else "STARTER"

    reason_parts = [
        f"regime base {base_pct:.1f}%",
        f"confidence x{confidence_multiplier:.2f}",
        f"setup x{setup_multiplier:.2f}",
    ]

    return {
        "recommended_position_pct": recommended_position_pct,
        "label": label,
        "base_position_pct": round(base_pct, 2),
        "confidence_multiplier": round(confidence_multiplier, 2),
        "setup_multiplier": round(setup_multiplier, 2),
        "reason": ", ".join(reason_parts),
    }
