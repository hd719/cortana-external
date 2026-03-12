from types import SimpleNamespace

import pandas as pd

from data.market_regime import MarketRegime
from data.wave3 import (
    build_position_sizing_guidance,
    score_catalyst_weighting,
    score_sector_relative_strength,
)


def _history(closes: list[float], volumes: list[float] | None = None) -> pd.DataFrame:
    idx = pd.date_range("2025-11-03", periods=len(closes), freq="B")
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


def test_sector_relative_strength_rewards_sector_leaders():
    stock = _history([100 + i * 0.9 for i in range(80)])
    sector = _history([100 + i * 0.35 for i in range(80)])

    report = score_sector_relative_strength(stock, sector, sector="Technology", benchmark_symbol="XLK")

    assert report["score"] == 2
    assert report["status"] == "leader"
    assert report["confidence_delta"] > 0
    assert report["relative_return_63d_pct"] > 5.0


def test_catalyst_weighting_flags_imminent_event_risk():
    events = [
        {"date": "2026-02-21"},
        {"date": "2026-03-14"},
    ]

    report = score_catalyst_weighting(
        events,
        as_of=pd.Timestamp("2026-03-11"),
        sentiment_overlay={"score": 1},
        breakout={"score": 4},
    )

    assert report["score"] == -1
    assert report["label"] == "CAUTION"
    assert report["next_event_date"] == "2026-03-14"


def test_position_sizing_guidance_expands_only_for_high_quality_setup():
    market = SimpleNamespace(regime=MarketRegime.CONFIRMED_UPTREND, position_sizing=1.0)

    report = build_position_sizing_guidance(
        market=market,
        confidence=88,
        breakout={"score": 5},
        exit_risk={"score": 1},
        sector_context={"score": 1},
        catalyst={"score": 1},
    )

    assert report["label"] == "FULL"
    assert report["recommended_position_pct"] > 10.0
    assert report["recommended_position_pct"] <= 11.5


def test_position_sizing_guidance_respects_uncertainty_assessment():
    market = SimpleNamespace(regime=MarketRegime.CONFIRMED_UPTREND, position_sizing=1.0)

    report = build_position_sizing_guidance(
        market=market,
        confidence=78,
        confidence_assessment={
            "effective_confidence_pct": 62,
            "uncertainty_pct": 38,
            "abstain": True,
        },
        breakout={"score": 4},
        exit_risk={"score": 1},
        sector_context={"score": 1},
        catalyst={"score": 0},
    )

    assert report["label"] == "PROBE"
    assert report["uncertainty_multiplier"] < 1.0
    assert report["recommended_position_pct"] < 7.0


def test_position_sizing_guidance_shrinks_for_adverse_regime_stress():
    market = SimpleNamespace(
        regime=MarketRegime.UPTREND_UNDER_PRESSURE,
        position_sizing=0.75,
        distribution_days=4,
        drawdown_pct=-6.4,
        trend_direction="down",
        price_vs_21d_pct=-1.5,
        price_vs_50d_pct=-2.4,
    )

    calm = build_position_sizing_guidance(
        market=SimpleNamespace(regime=MarketRegime.CONFIRMED_UPTREND, position_sizing=1.0),
        confidence=82,
        confidence_assessment={
            "effective_confidence_pct": 82,
            "uncertainty_pct": 8,
            "abstain": False,
            "adverse_regime": {
                "score": 8.0,
                "label": "normal",
                "reason": "market backdrop is not showing elevated stress",
                "size_multiplier": 1.0,
            },
        },
        breakout={"score": 4},
        exit_risk={"score": 1},
        sector_context={"score": 1},
        catalyst={"score": 0},
    )
    stressed = build_position_sizing_guidance(
        market=market,
        confidence=82,
        confidence_assessment={
            "effective_confidence_pct": 68,
            "uncertainty_pct": 18,
            "abstain": False,
            "adverse_regime": {
                "score": 42.0,
                "label": "elevated",
                "reason": "market regime: uptrend under pressure; 4 recent distribution days",
                "size_multiplier": 0.65,
            },
        },
        breakout={"score": 4},
        exit_risk={"score": 1},
        sector_context={"score": 1},
        catalyst={"score": 0},
    )

    assert stressed["adverse_regime_multiplier"] < calm["adverse_regime_multiplier"]
    assert stressed["recommended_position_pct"] < calm["recommended_position_pct"]
