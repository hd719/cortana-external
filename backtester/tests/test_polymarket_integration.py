from types import SimpleNamespace
from unittest.mock import patch

from canslim_alert import format_alert as format_canslim
from data.market_regime import MarketRegime
from data.polymarket_context import build_alert_context_lines, load_compact_context, load_watchlist_entries
from data.universe import UniverseScreener
from dipbuyer_alert import format_alert as format_dipbuyer


def test_load_compact_context_returns_none_when_artifacts_missing(tmp_path, monkeypatch):
    monkeypatch.setenv("POLYMARKET_COMPACT_REPORT_PATH", str(tmp_path / "compact.txt"))
    monkeypatch.setenv("POLYMARKET_REPORT_JSON_PATH", str(tmp_path / "report.json"))
    assert load_compact_context() is None


def test_universe_screener_merges_polymarket_watchlist(tmp_path, monkeypatch):
    watchlist_path = tmp_path / "polymarket_watchlist.json"
    report_path = tmp_path / "latest-report.json"
    watchlist_path.write_text(
        """{
  "updated_at": "2999-03-14T01:00:00Z",
  "source": "polymarket_market_intel",
  "tickers": [{"symbol": "XYZT", "asset_class": "stock"}]
}"""
    )
    report_path.write_text(
        """{
  "metadata": {
    "generatedAt": "2999-03-14T01:00:00.000Z"
  }
}"""
    )

    monkeypatch.setenv("POLYMARKET_WATCHLIST_PATH", str(watchlist_path))
    monkeypatch.setenv("POLYMARKET_REPORT_JSON_PATH", str(report_path))
    screener = UniverseScreener(cache_dir=str(tmp_path / "cache"))
    assert "XYZT" in screener.get_dynamic_tickers()


def test_universe_screener_ignores_direct_crypto_symbols_from_polymarket_watchlist(tmp_path, monkeypatch):
    watchlist_path = tmp_path / "polymarket_watchlist.json"
    report_path = tmp_path / "latest-report.json"
    watchlist_path.write_text(
        """{
  "updated_at": "2999-03-14T01:00:00Z",
  "source": "polymarket_market_intel",
  "tickers": [
    {"symbol": "BTC", "asset_class": "crypto"},
    {"symbol": "COIN", "asset_class": "crypto_proxy"}
  ]
}"""
    )
    report_path.write_text(
        """{
  "metadata": {
    "generatedAt": "2999-03-14T01:00:00.000Z"
  }
}"""
    )

    monkeypatch.setenv("POLYMARKET_WATCHLIST_PATH", str(watchlist_path))
    monkeypatch.setenv("POLYMARKET_REPORT_JSON_PATH", str(report_path))

    screener = UniverseScreener(cache_dir=str(tmp_path / "cache"))
    polymarket_entries = screener._load_polymarket_watchlist()
    assert {item["symbol"] for item in polymarket_entries} == {"COIN"}


def test_stale_polymarket_watchlist_does_not_enter_universe(tmp_path, monkeypatch):
    watchlist_path = tmp_path / "polymarket_watchlist.json"
    report_path = tmp_path / "latest-report.json"
    watchlist_path.write_text(
        """{
  "updated_at": "2020-03-14T01:00:00Z",
  "source": "polymarket_market_intel",
  "tickers": [{"symbol": "STALE"}]
}"""
    )
    report_path.write_text(
        """{
  "metadata": {
    "generatedAt": "2020-03-14T01:00:00.000Z"
  }
}"""
    )

    monkeypatch.setenv("POLYMARKET_WATCHLIST_PATH", str(watchlist_path))
    monkeypatch.setenv("POLYMARKET_REPORT_JSON_PATH", str(report_path))

    assert load_watchlist_entries(max_age_hours=1) == []

    screener = UniverseScreener(cache_dir=str(tmp_path / "cache"))
    assert "STALE" not in screener.get_dynamic_tickers()


def test_fresh_report_with_stale_watchlist_is_rejected(tmp_path, monkeypatch):
    watchlist_path = tmp_path / "polymarket_watchlist.json"
    report_path = tmp_path / "latest-report.json"
    watchlist_path.write_text(
        """{
  "updated_at": "2020-03-14T01:00:00Z",
  "source": "polymarket_market_intel",
  "tickers": [{"symbol": "STALE"}]
}"""
    )
    report_path.write_text(
        """{
  "metadata": {
    "generatedAt": "2999-03-14T01:00:00.000Z"
  }
}"""
    )

    monkeypatch.setenv("POLYMARKET_WATCHLIST_PATH", str(watchlist_path))
    monkeypatch.setenv("POLYMARKET_REPORT_JSON_PATH", str(report_path))

    assert load_watchlist_entries(max_age_hours=1) == []

    screener = UniverseScreener(cache_dir=str(tmp_path / "cache"))
    assert "STALE" not in screener.get_dynamic_tickers()


class _FakeAdvisor:
    def __init__(self):
        self.risk_fetcher = SimpleNamespace(get_snapshot=lambda: {})
        self._market = SimpleNamespace(
            regime=MarketRegime.CORRECTION,
            position_sizing=0.0,
            notes="market correction gate",
            snapshot_age_seconds=0.0,
            status="ok",
        )
        self.screener = SimpleNamespace(get_universe=lambda: ["AAA"])

    def get_market_status(self, refresh: bool = False):
        return self._market

    def analyze_stock(self, symbol: str):
        return {"total_score": 7, "recommendation": {"action": "NO_BUY", "reason": "market correction gate"}}

    def analyze_dip_stock(self, symbol: str):
        return {"total_score": 7, "recommendation": {"action": "NO_BUY", "reason": "market correction gate"}}


def test_alerts_include_polymarket_context_when_artifact_is_fresh(tmp_path, monkeypatch):
    compact_path = tmp_path / "latest-compact.txt"
    report_path = tmp_path / "latest-report.json"
    compact_path.write_text("Polymarket: Fed easing odds 77%\nOverlay: Mixed overlay\nWatchlist: QQQ, NVDA\n")
    report_path.write_text(
        """{
  "metadata": {
    "generatedAt": "2999-03-14T01:00:00.000Z"
  },
  "summary": {
    "conviction": "conflicting",
    "aggressionDial": "lean_more_selective",
    "divergence": {
      "summary": "Persistent divergence"
    }
  },
  "watchlistBuckets": {
    "stocks": [
      {"symbol": "NVDA", "assetClass": "stock", "severity": "major", "persistence": "persistent"},
      {"symbol": "HOOD", "assetClass": "stock", "severity": "notable", "persistence": "persistent"}
    ],
    "cryptoProxies": [
      {"symbol": "COIN", "assetClass": "crypto_proxy", "severity": "notable", "persistence": "persistent"}
    ],
    "crypto": [
      {"symbol": "BTC", "assetClass": "crypto", "severity": "major", "persistence": "accelerating"}
    ],
    "funds": []
  }
}"""
    )

    monkeypatch.setenv("POLYMARKET_COMPACT_REPORT_PATH", str(compact_path))
    monkeypatch.setenv("POLYMARKET_REPORT_JSON_PATH", str(report_path))
    monkeypatch.setenv("TRADING_INCLUDE_WATCHLIST_PRIORITY", "0")

    with patch("canslim_alert.TradingAdvisor", return_value=_FakeAdvisor()):
        canslim_text = format_canslim(limit=2, min_score=6, universe_size=1)
    with patch("dipbuyer_alert.TradingAdvisor", return_value=_FakeAdvisor()), patch("dipbuyer_alert.XSentimentAnalyzer"):
        dip_text = format_dipbuyer(limit=2, min_score=6, universe_size=1)

    assert "Polymarket: Fed easing odds 77%" in canslim_text
    assert "Polymarket: Fed easing odds 77%" in dip_text
    assert "Polymarket posture: conviction conflicting | aggression lean more selective | divergence persistent divergence" in canslim_text
    assert "Polymarket focus: overlap NVDA, HOOD, COIN | early BTC | crypto COIN, BTC" in dip_text


def test_build_alert_context_lines_falls_back_cleanly_when_only_compact_report_exists(tmp_path, monkeypatch):
    compact_path = tmp_path / "latest-compact.txt"
    report_path = tmp_path / "latest-report.json"
    compact_path.write_text("Polymarket: Fed easing odds 77%\nOverlay: Mixed overlay\nWatchlist: QQQ, NVDA\n")
    report_path.write_text(
        """{
  "metadata": {
    "generatedAt": "2999-03-14T01:00:00.000Z"
  }
}"""
    )

    monkeypatch.setenv("POLYMARKET_COMPACT_REPORT_PATH", str(compact_path))
    monkeypatch.setenv("POLYMARKET_REPORT_JSON_PATH", str(report_path))

    lines = build_alert_context_lines(["QQQ", "NVDA"])
    assert lines == ["Polymarket: Fed easing odds 77%", "Overlay: Mixed overlay"]
