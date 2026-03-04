from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pandas as pd
import pytest

from data.market_data_provider import MarketDataError, MarketDataProvider


def _frame() -> pd.DataFrame:
    idx = pd.date_range(end=datetime.now(), periods=5, freq="D")
    return pd.DataFrame(
        {
            "Open": [1, 2, 3, 4, 5],
            "High": [1, 2, 3, 4, 5],
            "Low": [1, 2, 3, 4, 5],
            "Close": [1, 2, 3, 4, 5],
            "Volume": [10, 11, 12, 13, 14],
        },
        index=idx,
    )


def test_alpaca_provider_happy_path(tmp_path):
    provider = MarketDataProvider(provider_order="alpaca,yahoo", cache_dir=str(tmp_path), max_retries=0)
    expected = _frame()

    provider._fetch_alpaca_history = lambda symbol, period, auto_adjust=False: expected  # type: ignore[method-assign]

    result = provider.get_history("SPY", period="1y")

    assert result.source == "alpaca"
    assert result.status == "ok"
    assert not result.frame.empty


def test_provider_fallback_to_yahoo_when_alpaca_fails(tmp_path):
    provider = MarketDataProvider(provider_order="alpaca,yahoo", cache_dir=str(tmp_path), max_retries=0)
    expected = _frame()

    def _alpaca_fail(symbol, period, auto_adjust=False):
        raise MarketDataError("alpaca unavailable", transient=True)

    provider._fetch_alpaca_history = _alpaca_fail  # type: ignore[method-assign]
    provider._fetch_yahoo_history = lambda symbol, period, auto_adjust=False: expected  # type: ignore[method-assign]

    result = provider.get_history("SPY", period="1y")

    assert result.source == "yahoo"
    assert result.status == "ok"


def test_degraded_cache_path_when_live_providers_fail(tmp_path):
    provider = MarketDataProvider(provider_order="alpaca,yahoo", cache_dir=str(tmp_path), cache_ttl_seconds=1800, max_retries=0)
    cached_df = _frame()
    provider._write_cache("SPY", "1y", "alpaca", cached_df)

    def _fail(*args, **kwargs):
        raise MarketDataError("rate limit", transient=True)

    provider._fetch_alpaca_history = _fail  # type: ignore[method-assign]
    provider._fetch_yahoo_history = _fail  # type: ignore[method-assign]

    result = provider.get_history("SPY", period="1y")

    assert result.source == "cache"
    assert result.status == "degraded"
    assert "cached" in result.degraded_reason.lower()
