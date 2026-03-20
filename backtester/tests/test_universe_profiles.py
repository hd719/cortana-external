import json
import logging
from types import SimpleNamespace

from data.universe import (
    GROWTH_WATCHLIST,
    SP500_TICKERS,
    UNIVERSE_PROFILE_NIGHTLY_DISCOVERY,
    UNIVERSE_PROFILE_QUICK,
    UniverseScreener,
)


def test_quick_profile_returns_deduped_growth_watchlist(tmp_path):
    screener = UniverseScreener(cache_dir=str(tmp_path))

    symbols = screener.get_universe_for_profile(UNIVERSE_PROFILE_QUICK)

    assert symbols[0] == GROWTH_WATCHLIST[0]
    assert len(symbols) == len(set(symbols))


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

    class _NoisyTicker:
        @property
        def info(self):
            print("symbol does not exist")
            raise RuntimeError("bad ticker")

    monkeypatch.setattr("data.universe.yf.Ticker", lambda symbol: _NoisyTicker())

    assert screener.get_stock_info("BAD") is None
    captured = capsys.readouterr()
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
