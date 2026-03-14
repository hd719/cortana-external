from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from canslim_alert import format_alert as format_canslim
from data.market_regime import MarketRegime
from data.polymarket_context import load_compact_context
from data.universe import UniverseScreener
from dipbuyer_alert import format_alert as format_dipbuyer


def test_load_compact_context_returns_none_when_artifacts_missing(tmp_path, monkeypatch):
    monkeypatch.setenv("POLYMARKET_COMPACT_REPORT_PATH", str(tmp_path / "compact.txt"))
    monkeypatch.setenv("POLYMARKET_REPORT_JSON_PATH", str(tmp_path / "report.json"))
    assert load_compact_context() is None


def test_universe_screener_merges_polymarket_watchlist(tmp_path, monkeypatch):
    watchlist_path = tmp_path / "polymarket_watchlist.json"
    watchlist_path.write_text(
        """{
  "updated_at": "2026-03-14T01:00:00Z",
  "source": "polymarket_market_intel",
  "tickers": [{"symbol": "XYZT"}]
}"""
    )

    monkeypatch.setenv("POLYMARKET_WATCHLIST_PATH", str(watchlist_path))
    screener = UniverseScreener(cache_dir=str(tmp_path / "cache"))
    assert "XYZT" in screener.get_dynamic_tickers()


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
    compact_path.write_text("Polymarket: Fed easing odds 77%\\nOverlay: Mixed overlay\\nWatchlist: QQQ, NVDA\\n")
    report_path.write_text(
        """{
  "metadata": {
    "generatedAt": "2999-03-14T01:00:00.000Z"
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
