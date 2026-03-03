"""Unit tests for risk signal fetching, scoring, and fallback behavior."""

from datetime import datetime
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
import pytest

from data.risk_signals import RiskSignalFetcher


class _Response:
    """Minimal requests-like response object for deterministic API mocks."""

    def __init__(self, payload=None, text="", headers=None):
        self._payload = payload or {}
        self.text = text
        self.headers = headers or {"Content-Type": "application/json"}

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


def test_vix_fetch_from_yfinance_history_close_column():
    """Validate VIX series extraction returns renamed close values from yfinance history."""
    fetcher = RiskSignalFetcher()
    idx = pd.date_range("2026-01-01", periods=3, freq="B")
    hist = pd.DataFrame({"Close": [20.0, 22.0, 24.0]}, index=idx)

    with patch.object(fetcher, "_fetch_yfinance_history", return_value=hist):
        series = fetcher._fetch_vix_history(datetime(2026, 1, 1), datetime(2026, 1, 10))

    assert series.name == "vix"
    assert series.tolist() == [20.0, 22.0, 24.0]


def test_hy_spread_fetch_from_fred_series_json():
    """Validate FRED observations are parsed into a numeric, dated spread series."""
    fetcher = RiskSignalFetcher()
    payload = {
        "observations": [
            {"date": "2026-01-01", "value": "410.5"},
            {"date": "2026-01-02", "value": "420.0"},
        ]
    }

    with patch("data.risk_signals.requests.get", return_value=_Response(payload=payload)):
        series = fetcher._fetch_fred_series("BAMLH0A0HYM2", datetime(2026, 1, 1), datetime(2026, 1, 10))

    assert series.name == "BAMLH0A0HYM2"
    assert series.iloc[-1] == pytest.approx(420.0)


def test_put_call_ratio_handling_prefers_total_ratio_column():
    """Validate put/call extractor chooses total ratio-like column when present."""
    fetcher = RiskSignalFetcher()
    df = pd.DataFrame(
        {
            "Trade Date": ["2026-01-01", "2026-01-02"],
            "Equity Ratio": [0.8, 0.9],
            "Total Put/Call Ratio": [1.05, 1.10],
        }
    )

    series = fetcher._extract_put_call_series(df)
    assert series.name == "put_call"
    assert series.tolist() == [1.05, 1.10]


def test_fear_proxy_composite_calculation_in_history_builder():
    """Validate fear proxy is computed as mean of VIX percentile, HY percentile, and SPY distance score."""
    fetcher = RiskSignalFetcher()
    idx = pd.date_range("2025-01-01", periods=220, freq="B")

    vix = pd.Series(range(10, 230), index=idx, dtype=float, name="vix")
    spy = pd.Series(range(300, 520), index=idx, dtype=float, name="spy_close")
    hy = pd.Series(range(350, 570), index=idx, dtype=float, name="BAMLH0A0HYM2")
    pcr = pd.Series([1.0] * len(idx), index=idx, dtype=float, name="put_call")

    with patch.object(fetcher, "_fetch_vix_history", return_value=vix), patch.object(
        fetcher, "_fetch_spy_history", return_value=spy
    ), patch.object(fetcher, "_fetch_fred_series", return_value=hy), patch.object(
        fetcher, "_fetch_put_call_history", return_value=pcr
    ):
        history = fetcher.get_history(days=90)

    assert not history.empty
    last = history.iloc[-1]
    expected = (last["vix_percentile"] + last["hy_spread_percentile"] + last["spy_distance_score"]) / 3
    assert last["fear_greed"] == pytest.approx(expected)


def test_get_snapshot_returns_expected_dict_structure():
    """Validate snapshot returns all expected keys from the latest historical row."""
    fetcher = RiskSignalFetcher()
    idx = pd.date_range("2026-01-01", periods=12, freq="B")
    history = pd.DataFrame(
        {
            "vix": [20.0] * 12,
            "put_call": [1.0] * 12,
            "hy_spread": list(range(400, 412)),
            "fear_greed": [35.0] * 12,
            "vix_percentile": [50.0] * 12,
            "hy_spread_percentile": [60.0] * 12,
            "spy_distance_score": [40.0] * 12,
        },
        index=idx,
    )

    with patch.object(fetcher, "_build_history", return_value=history):
        snap = fetcher.get_snapshot()

    expected_keys = {
        "timestamp",
        "vix",
        "put_call",
        "hy_spread",
        "fear_greed",
        "vix_percentile",
        "hy_spread_percentile",
        "spy_distance_score",
        "hy_spread_change_10d",
    }
    assert expected_keys.issubset(set(snap.keys()))


def test_get_history_returns_dataframe_with_required_columns():
    """Validate public history API returns DataFrame with core signal columns."""
    fetcher = RiskSignalFetcher()
    idx = pd.date_range("2026-01-01", periods=20, freq="B")
    frame = pd.DataFrame(
        {
            "vix": [20.0] * 20,
            "spy_close": [400.0] * 20,
            "hy_spread": [450.0] * 20,
            "put_call": [1.0] * 20,
            "vix_percentile": [50.0] * 20,
            "hy_spread_percentile": [55.0] * 20,
            "spy_distance_score": [45.0] * 20,
            "fear_greed": [50.0] * 20,
        },
        index=idx,
    )

    with patch.object(fetcher, "_build_history", return_value=frame):
        history = fetcher.get_history(days=20)

    for col in ["vix", "hy_spread", "put_call", "fear_greed"]:
        assert col in history.columns


def test_graceful_fallback_when_apis_fail_returns_empty_or_defaults():
    """Validate failed upstream calls do not crash and return safe fallback outputs."""
    fetcher = RiskSignalFetcher()

    with patch("data.risk_signals.requests.get", side_effect=Exception("network down")):
        fred = fetcher._fetch_fred_series("BAMLH0A0HYM2", datetime(2026, 1, 1), datetime(2026, 1, 10))
        cboe = fetcher._fetch_put_call_from_cboe(datetime(2026, 1, 1), datetime(2026, 1, 10))

    assert fred.empty
    assert cboe.empty

    with patch.object(fetcher, "_fetch_vix_history", return_value=pd.Series(dtype=float)), patch.object(
        fetcher, "_fetch_spy_history", return_value=pd.Series(dtype=float)
    ), patch.object(fetcher, "_fetch_fred_series", return_value=pd.Series(dtype=float)), patch.object(
        fetcher, "_fetch_put_call_history", return_value=pd.Series(dtype=float)
    ):
        history = fetcher.get_history(days=5)

    assert not history.empty
    assert (history["put_call"] == 1.0).all()


def test_put_call_sanity_bounds_clamp_to_neutral_one():
    """Values outside sanity bounds [0.3, 3.0] are clamped to neutral 1.0."""
    fetcher = RiskSignalFetcher()
    series = pd.Series([0.2, 0.3, 1.2, 3.0, 3.1])

    cleaned = fetcher._validate_put_call_series(series)
    assert cleaned.tolist() == [1.0, 0.3, 1.2, 3.0, 1.0]


def test_put_call_history_uses_spy_options_proxy_when_cboe_fails():
    """When CBOE path is empty, yfinance SPY option-chain proxy should be used."""
    fetcher = RiskSignalFetcher()
    idx = pd.date_range("2026-01-01", periods=3, freq="B")
    proxy = pd.Series([1.1, 1.1, 1.1], index=idx, name="put_call")

    with patch.object(fetcher, "_fetch_put_call_from_cboe", return_value=pd.Series(dtype=float)), patch.object(
        fetcher, "_fetch_put_call_from_yfinance_options", return_value=proxy
    ):
        out = fetcher._fetch_put_call_history(datetime(2026, 1, 1), datetime(2026, 1, 10))

    assert out.equals(proxy)


def test_hy_spread_defaults_to_450_when_fred_fails():
    """HY spread fallback default should be 450 bps when FRED is unavailable."""
    fetcher = RiskSignalFetcher()
    idx = pd.date_range("2026-01-01", periods=180, freq="B")
    vix = pd.Series(np.linspace(20, 30, len(idx)), index=idx, name="vix")
    spy = pd.Series(np.linspace(400, 420, len(idx)), index=idx, name="spy_close")

    with patch.object(fetcher, "_fetch_vix_history", return_value=vix), patch.object(
        fetcher, "_fetch_spy_history", return_value=spy
    ), patch.object(fetcher, "_fetch_fred_series", return_value=pd.Series(dtype=float)), patch.object(
        fetcher, "_fetch_put_call_history", return_value=pd.Series(dtype=float)
    ):
        history = fetcher.get_history(days=30)

    assert (history["hy_spread"] == 450.0).all()


def test_fear_proxy_uses_simple_fallback_when_hy_percentile_missing():
    """Fear proxy should fallback to (vix_percentile + spy_distance_score)/2 when HY percentile is NaN."""
    fetcher = RiskSignalFetcher()
    idx = pd.date_range("2026-01-01", periods=220, freq="B")
    vix = pd.Series(np.linspace(15, 35, len(idx)), index=idx, name="vix")
    spy = pd.Series(np.linspace(500, 450, len(idx)), index=idx, name="spy_close")
    pcr = pd.Series([1.0] * len(idx), index=idx, name="put_call")

    def percentile_side_effect(series: pd.Series) -> pd.Series:
        if series.name == "hy_spread":
            return pd.Series(np.nan, index=series.index)
        return RiskSignalFetcher._percentile_series(series)

    with patch.object(fetcher, "_fetch_vix_history", return_value=vix), patch.object(
        fetcher, "_fetch_spy_history", return_value=spy
    ), patch.object(fetcher, "_fetch_fred_series", return_value=pd.Series(dtype=float)), patch.object(
        fetcher, "_fetch_put_call_history", return_value=pcr
    ), patch.object(fetcher, "_percentile_series", side_effect=percentile_side_effect):
        history = fetcher.get_history(days=60)

    expected = (history["vix_percentile"] + history["spy_distance_score"]) / 2
    assert np.allclose(history["fear_greed"].values, expected.values, equal_nan=False)


def test_fear_proxy_always_numeric_and_bounded_0_100():
    """Fear proxy output should always be finite numeric values in [0, 100]."""
    fetcher = RiskSignalFetcher()
    idx = pd.date_range("2026-01-01", periods=220, freq="B")
    vix = pd.Series([np.nan] * len(idx), index=idx, name="vix")
    spy = pd.Series([np.nan] * len(idx), index=idx, name="spy_close")

    with patch.object(fetcher, "_fetch_vix_history", return_value=vix), patch.object(
        fetcher, "_fetch_spy_history", return_value=spy
    ), patch.object(fetcher, "_fetch_fred_series", return_value=pd.Series(dtype=float)), patch.object(
        fetcher, "_fetch_put_call_history", return_value=pd.Series(dtype=float)
    ):
        history = fetcher.get_history(days=20)

    assert history["fear_greed"].notna().all()
    assert np.isfinite(history["fear_greed"]).all()
    assert ((history["fear_greed"] >= 0) & (history["fear_greed"] <= 100)).all()


def test_get_snapshot_all_keys_present_and_numeric_non_nan():
    """Snapshot should include expected keys and numeric fields must be real numbers (no NaN)."""
    fetcher = RiskSignalFetcher()
    idx = pd.date_range("2026-01-01", periods=12, freq="B")
    history = pd.DataFrame(
        {
            "vix": [22.0] * 12,
            "put_call": [1.0] * 12,
            "hy_spread": [450.0] * 12,
            "fear_greed": [50.0] * 12,
            "vix_percentile": [55.0] * 12,
            "hy_spread_percentile": [50.0] * 12,
            "spy_distance_score": [45.0] * 12,
        },
        index=idx,
    )

    with patch.object(fetcher, "_build_history", return_value=history):
        snap = fetcher.get_snapshot()

    expected_keys = {
        "timestamp",
        "vix",
        "put_call",
        "hy_spread",
        "fear_greed",
        "vix_percentile",
        "hy_spread_percentile",
        "spy_distance_score",
        "hy_spread_change_10d",
    }
    assert expected_keys == set(snap.keys())

    for key in expected_keys - {"timestamp"}:
        assert isinstance(snap[key], float)
        assert not np.isnan(snap[key])