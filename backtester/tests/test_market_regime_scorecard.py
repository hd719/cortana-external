from __future__ import annotations

import numpy as np
import pandas as pd

from data.market_regime import MarketRegime, MarketRegimeDetector


def _status_for_frame(frame: pd.DataFrame):
    detector = MarketRegimeDetector()

    def _fake_fetch(days: int = 90) -> pd.DataFrame:
        detector._data = frame
        detector.last_data_source = "test"
        detector.last_data_staleness_seconds = 0.0
        return frame

    detector.fetch_data = _fake_fetch  # type: ignore[method-assign]
    return detector.get_status()


def test_scorecard_classifies_confirmed_uptrend_from_trend_strength():
    idx = pd.date_range("2026-01-02", periods=60, freq="B")
    frame = pd.DataFrame(
        {
            "Close": np.linspace(100.0, 135.0, len(idx)),
            "Volume": np.full(len(idx), 1_000_000),
        },
        index=idx,
    )

    status = _status_for_frame(frame)

    assert status.regime == MarketRegime.CONFIRMED_UPTREND
    assert status.regime_score >= 3
    assert status.drawdown_pct >= -1.0


def test_scorecard_classifies_under_pressure_when_distribution_builds():
    idx = pd.date_range("2026-01-02", periods=60, freq="B")
    closes = list(np.linspace(100.0, 126.0, 54)) + [127.0, 124.0, 122.0, 123.0, 121.0, 122.0]
    volumes = [1_000_000] * 55 + [1_200_000, 1_350_000, 1_100_000, 1_400_000, 1_050_000]
    frame = pd.DataFrame({"Close": closes, "Volume": volumes}, index=idx)

    status = _status_for_frame(frame)

    assert status.regime == MarketRegime.UPTREND_UNDER_PRESSURE
    assert status.regime_score <= 2
    assert status.distribution_days >= 2


def test_scorecard_classifies_correction_from_downtrend_and_drawdown():
    idx = pd.date_range("2026-01-02", periods=60, freq="B")
    frame = pd.DataFrame(
        {
            "Close": np.linspace(135.0, 92.0, len(idx)),
            "Volume": np.full(len(idx), 1_000_000),
        },
        index=idx,
    )

    status = _status_for_frame(frame)

    assert status.regime == MarketRegime.CORRECTION
    assert status.regime_score <= -2
    assert status.drawdown_pct <= -8.0


def test_scorecard_sanitizes_nan_rolling_metrics():
    idx = pd.date_range("2026-01-02", periods=4, freq="B")
    frame = pd.DataFrame(
        {
            "Close": [100.0, 99.0, 98.0, 97.0],
            "Volume": [1_000_000, 1_100_000, 1_200_000, 1_300_000],
        },
        index=idx,
    )

    status = _status_for_frame(frame)

    assert np.isfinite(status.drawdown_pct)
    assert np.isfinite(status.recent_return_pct)
    assert np.isfinite(status.price_vs_21d_pct)
    assert np.isfinite(status.price_vs_50d_pct)
    assert "nan%" not in status.notes.lower()
