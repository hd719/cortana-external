from types import SimpleNamespace

import pandas as pd
import pytest

from main import load_backtest_data, normalize_market_frame


def test_normalize_market_frame_maps_provider_columns_to_legacy_schema():
    frame = pd.DataFrame(
        {
            "Open": [100.0, 101.0],
            "High": [102.0, 103.0],
            "Low": [99.0, 100.0],
            "Close": [101.0, 102.0],
            "Volume": [1_000_000, 1_100_000],
        },
        index=pd.date_range("2026-01-01", periods=2, freq="D", tz="UTC"),
    )

    normalized = normalize_market_frame(frame)

    assert list(normalized.columns) == ["open", "high", "low", "close", "volume"]
    assert float(normalized.iloc[0]["close"]) == 101.0


def test_normalize_market_frame_rejects_missing_columns():
    frame = pd.DataFrame({"Open": [100.0], "Close": [101.0]})

    with pytest.raises(ValueError, match="missing required columns"):
        normalize_market_frame(frame)


def test_load_backtest_data_uses_provider_for_symbol_and_benchmark():
    frame = pd.DataFrame(
        {
            "Open": [100.0, 101.0, 102.0],
            "High": [101.0, 102.0, 103.0],
            "Low": [99.0, 100.0, 101.0],
            "Close": [100.5, 101.5, 102.5],
            "Volume": [1_000_000, 1_050_000, 1_100_000],
        },
        index=pd.date_range("2026-01-01", periods=3, freq="D", tz="UTC"),
    )

    class _Provider:
        def __init__(self):
            self.calls = []

        def get_history(self, symbol: str, period: str = "1y", auto_adjust: bool = False):
            self.calls.append((symbol, period, auto_adjust))
            return SimpleNamespace(frame=frame, source="yahoo", status="ok", degraded_reason="")

    provider = _Provider()
    loaded = load_backtest_data(symbol="NVDA", benchmark="SPY", years=2, provider=provider)

    assert provider.calls == [("NVDA", "2y", False), ("SPY", "2y", False)]
    assert list(loaded["data"].columns) == ["open", "high", "low", "close", "volume"]
    assert loaded["benchmark_data"] is not None

