"""Unit tests for Dip Buyer alert formatting and output semantics."""

from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd

from data.market_regime import MarketRegime
from dipbuyer_alert import _macro_gate_line, format_alert
from strategies.dip_buyer import DIPBUYER_CONFIG


class _FakeAdvisor:
    """Deterministic TradingAdvisor test double for alert formatter tests."""

    def __init__(self):
        self.risk_fetcher = SimpleNamespace(get_snapshot=lambda: {})
        self._market = SimpleNamespace(
            regime=MarketRegime.CORRECTION,
            position_sizing=0.5,
            notes="Test regime note",
            data_source="alpaca",
            snapshot_age_seconds=0.0,
            status="ok",
        )
        self._scan = pd.DataFrame(columns=["symbol", "total_score"])
        self._analysis = {}

    def get_market_status(self, refresh: bool = False):
        return self._market

    def scan_dip_opportunities(self, quick: bool = True, min_score: int = 6):
        return self._scan

    def analyze_dip_stock(self, symbol: str):
        return self._analysis.get(symbol, {"error": "not stubbed"})


def test_macro_gate_line_displays_open_and_closed_states():
    open_line = _macro_gate_line({"vix": 24, "put_call": 1.0, "hy_spread": 500, "fear_greed": 30, "hy_spread_source": "fred"})
    closed_line = _macro_gate_line(
        {
            "vix": 24,
            "put_call": 1.0,
            "hy_spread": 700,
            "fear_greed": 30,
            "hy_spread_source": "fallback_default_450",
            "hy_spread_fallback": True,
            "hy_spread_warning": "FRED unavailable",
        }
    )

    assert "Macro Gate: OPEN" in open_line
    assert "(fred)" in open_line
    assert "Macro Gate: CLOSED" in closed_line
    assert "Fallback impact" in closed_line
    assert "HY Note:" in closed_line


def test_format_alert_output_structure_and_tags_buy_watch_no_buy():
    fake = _FakeAdvisor()
    fake.risk_fetcher = SimpleNamespace(
        get_snapshot=lambda: {"vix": 24.0, "put_call": 1.01, "hy_spread": 500.0, "fear_greed": 28.0}
    )
    fake._scan = pd.DataFrame(
        [
            {"symbol": "MSFT", "total_score": 9},
            {"symbol": "AAPL", "total_score": 7},
            {"symbol": "TSLA", "total_score": 5},
        ]
    )
    fake._analysis = {
        "MSFT": {"total_score": 9, "data_source": "alpaca", "recommendation": {"action": "BUY", "entry": 100.0, "stop_loss": 93.0}},
        "AAPL": {"total_score": 7, "data_source": "yahoo", "recommendation": {"action": "WATCH", "reason": "Watch setup"}},
        "TSLA": {"total_score": 5, "data_source": "cache", "recommendation": {"action": "NO_BUY", "reason": "Score too low"}},
    }

    with patch("dipbuyer_alert.TradingAdvisor", return_value=fake):
        text = format_alert(limit=8, min_score=6)

    assert "📉 Trading Advisor - Dip Buyer Scan" in text
    assert "Market: correction" in text
    assert "Market Data Source:" in text
    assert "Run Status:" in text
    assert "Macro Gate: OPEN" in text
    assert "Summary: scanned" in text
    assert "| BUY 1 | WATCH 1 | NO_BUY 0" in text
    assert "Dip Profile: correction" in text
    assert "Data Inputs:" in text
    assert "• MSFT (9/12) → BUY" in text
    assert "• AAPL (7/12) → WATCH" in text
    assert "Blockers:" in text


def test_format_alert_reports_degraded_market_status_with_next_action():
    fake = _FakeAdvisor()
    fake._market = SimpleNamespace(
        regime=MarketRegime.CORRECTION,
        position_sizing=0.5,
        notes="Cached market fallback active.",
        data_source="cache",
        snapshot_age_seconds=720.0,
        status="degraded",
        degraded_reason="Providers unavailable. Using cached market snapshot (12m old).",
        next_action="Retry market fetch after cooldown (45s) or refresh cache.",
    )
    fake._scan = pd.DataFrame([{"symbol": "MSFT", "total_score": 9}])
    fake._analysis = {"MSFT": {"total_score": 9, "data_source": "cache", "recommendation": {"action": "WATCH", "reason": "Watch setup"}}}

    with patch("dipbuyer_alert.TradingAdvisor", return_value=fake):
        text = format_alert(limit=8, min_score=6)

    assert "Run Status: degraded" in text
    assert "⚠️ Degraded Data:" in text
    assert "Fallback Staleness: 720s" in text
    assert "Next Action:" in text
