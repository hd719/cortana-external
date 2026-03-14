import json

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
