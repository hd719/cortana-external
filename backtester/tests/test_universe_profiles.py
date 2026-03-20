import json
import logging
from types import SimpleNamespace

import pandas as pd

from data.market_data_provider import MarketDataError
from data.universe import (
    GROWTH_WATCHLIST,
    SP500_TICKERS,
    UNIVERSE_PROFILE_NIGHTLY_DISCOVERY,
    UNIVERSE_PROFILE_QUICK,
    UniverseScreener,
)


def _history_frame() -> pd.DataFrame:
    idx = pd.date_range(end="2026-03-20", periods=252, freq="D")
    return pd.DataFrame(
        {
            "Open": [100 + i * 0.2 for i in range(len(idx))],
            "High": [101 + i * 0.2 for i in range(len(idx))],
            "Low": [99 + i * 0.2 for i in range(len(idx))],
            "Close": [100 + i * 0.2 for i in range(len(idx))],
            "Volume": [600_000 + (i % 10) * 5_000 for i in range(len(idx))],
        },
        index=idx,
    )


def test_quick_profile_returns_deduped_growth_watchlist(tmp_path):
    screener = UniverseScreener(cache_dir=str(tmp_path))

    symbols = screener.get_universe_for_profile(UNIVERSE_PROFILE_QUICK)

    assert symbols[0] == GROWTH_WATCHLIST[0]
    assert len(symbols) == len(set(symbols))


def test_bundled_static_lists_drop_known_stale_symbols():
    stale = {"ANSS", "BPMC", "HEXY", "HES", "PXD", "SGEN", "SQ"}

    assert not stale.intersection(set(SP500_TICKERS))
    assert "XYZ" in GROWTH_WATCHLIST


def test_sp500_constituents_cache_round_trip_and_normalization(tmp_path, monkeypatch):
    screener = UniverseScreener(cache_dir=str(tmp_path))
    monkeypatch.setattr(
        screener,
        "_fetch_live_sp500_constituents",
        lambda: ["BRK.B", "MSFT", "AAPL", "AAPL"],
    )

    symbols = screener.load_sp500_constituents(refresh=True)

    assert symbols == ["BRK-B", "MSFT", "AAPL"]
    payload = json.loads((tmp_path / "sp500_constituents.json").read_text(encoding="utf-8"))
    assert payload["symbols"] == ["BRK-B", "MSFT", "AAPL"]

    monkeypatch.setattr(
        screener,
        "_fetch_live_sp500_constituents",
        lambda: (_ for _ in ()).throw(RuntimeError("network down")),
    )
    assert screener.load_sp500_constituents(refresh=False) == ["BRK-B", "MSFT", "AAPL"]


def test_sp500_constituents_fall_back_to_static_list_when_live_fetch_and_cache_fail(tmp_path, monkeypatch):
    screener = UniverseScreener(cache_dir=str(tmp_path))
    monkeypatch.setattr(
        screener,
        "_fetch_live_sp500_constituents",
        lambda: (_ for _ in ()).throw(RuntimeError("network down")),
    )

    symbols = screener.load_sp500_constituents(refresh=True)

    assert symbols == screener._dedupe_symbols(SP500_TICKERS)


def test_sp500_constituents_logs_when_live_refresh_falls_back(tmp_path, monkeypatch, caplog):
    screener = UniverseScreener(cache_dir=str(tmp_path))
    monkeypatch.setattr(
        screener,
        "_fetch_live_sp500_constituents",
        lambda: (_ for _ in ()).throw(RuntimeError("network down")),
    )

    with caplog.at_level(logging.WARNING):
        screener.load_sp500_constituents(refresh=True)

    assert "Live S&P 500 constituent refresh failed" in caplog.text
    assert "Using static bundled S&P 500 constituents" in caplog.text


def test_nightly_discovery_profile_merges_live_constituents_growth_and_dynamic(tmp_path, monkeypatch):
    screener = UniverseScreener(cache_dir=str(tmp_path))
    monkeypatch.setattr(screener, "load_sp500_constituents", lambda refresh=False, max_age_hours=24.0: ["AAPL", "MSFT"])
    monkeypatch.setattr(screener, "_load_dynamic_watchlist", lambda: [{"symbol": "NET"}, {"symbol": "AAPL"}])
    monkeypatch.setattr(screener, "_load_polymarket_watchlist", lambda: [{"symbol": "COIN"}])

    symbols = screener.get_universe_for_profile(UNIVERSE_PROFILE_NIGHTLY_DISCOVERY)

    assert "AAPL" in symbols
    assert "MSFT" in symbols
    assert "NET" in symbols
    assert "COIN" in symbols
    assert len(symbols) == len(set(symbols))


def test_get_stock_info_suppresses_provider_noise(tmp_path, monkeypatch, capsys):
    screener = UniverseScreener(cache_dir=str(tmp_path))
    monkeypatch.setattr(screener, "_fetch_price_history", lambda symbol, period="1y": _history_frame())

    class _NoisyTicker:
        @property
        def info(self):
            print("symbol does not exist")
            raise RuntimeError("bad ticker")

    monkeypatch.setattr("data.universe.yf.Ticker", lambda symbol: _NoisyTicker())

    info = screener.get_stock_info("BAD")
    captured = capsys.readouterr()
    assert info is not None
    assert info["market_cap"] is None
    assert captured.out == ""
    assert captured.err == ""


def test_fetch_live_sp500_constituents_uses_request_headers(tmp_path, monkeypatch):
    screener = UniverseScreener(cache_dir=str(tmp_path))
    captured = {}

    def _fake_get(url, headers=None, timeout=0):
        captured["url"] = url
        captured["headers"] = headers
        captured["timeout"] = timeout
        return SimpleNamespace(
            text="<table><tr><th>Symbol</th></tr><tr><td>MSFT</td></tr></table>",
            raise_for_status=lambda: None,
        )

    monkeypatch.setattr("data.universe.requests.get", _fake_get)

    assert screener._fetch_live_sp500_constituents() == ["MSFT"]
    assert captured["headers"]["User-Agent"]
    assert captured["timeout"] == 20


def test_calculate_technical_score_uses_market_data_provider_history(tmp_path, monkeypatch):
    calls = []

    class _Provider:
        def get_history(self, symbol, period="1y", auto_adjust=False):
            calls.append((symbol, period, auto_adjust))
            return SimpleNamespace(frame=_history_frame())

    screener = UniverseScreener(cache_dir=str(tmp_path), market_data=_Provider())

    class _TickerShouldNotBeUsed:
        def history(self, *args, **kwargs):
            raise AssertionError("Ticker.history should not be used")

    monkeypatch.setattr("data.universe.yf.Ticker", lambda symbol: _TickerShouldNotBeUsed())

    result = screener.calculate_technical_score("AAPL")

    assert "error" not in result
    assert calls == [("AAPL", "1y", False)]


def test_calculate_technical_score_returns_error_when_provider_history_fails(tmp_path):
    class _Provider:
        def get_history(self, symbol, period="1y", auto_adjust=False):
            raise MarketDataError("provider down", transient=True)

    screener = UniverseScreener(cache_dir=str(tmp_path), market_data=_Provider())

    result = screener.calculate_technical_score("BAD")

    assert result["symbol"] == "BAD"
    assert result["error"] == "Insufficient data"


def test_screen_filters_symbols_when_provider_history_unavailable(tmp_path, monkeypatch):
    class _Provider:
        def get_history(self, symbol, period="1y", auto_adjust=False):
            if symbol == "AAA":
                return SimpleNamespace(frame=_history_frame())
            raise MarketDataError("missing", transient=True)

    screener = UniverseScreener(cache_dir=str(tmp_path), market_data=_Provider())
    monkeypatch.setattr(
        screener,
        "_fetch_stock_metadata",
        lambda symbol: {
            "name": symbol,
            "market_cap": 5_000_000_000,
            "float_shares": 1_000_000,
            "beta": 1.0,
            "sector": "Tech",
            "industry": "Software",
        },
    )

    results = screener.screen(symbols=["AAA", "BBB"], min_technical_score=0, verbose=False)

    assert list(results["symbol"]) == ["AAA"]
