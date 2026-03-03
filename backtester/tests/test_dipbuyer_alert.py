"""Unit tests for Dip Buyer alert formatting and output semantics."""

from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd

from data.market_regime import MarketRegime
from dipbuyer_alert import _macro_gate_line, format_alert


class _FakeAdvisor:
    """Deterministic TradingAdvisor test double for alert formatter tests."""

    def __init__(self):
        self.risk_fetcher = SimpleNamespace(get_snapshot=lambda: {})
        self._market = SimpleNamespace(
            regime=MarketRegime.CORRECTION,
            position_sizing=0.5,
            notes="Test regime note",
        )
        self._scan = pd.DataFrame(columns=["symbol", "total_score"])
        self._analysis = {}

    def get_market_status(self, refresh: bool = False):
        return self._market

    def scan_dip_opportunities(self, quick: bool = True, min_score: int = 6):
        return self._scan

    def analyze_dip_stock(self, symbol: str):
        return self._analysis[symbol]


def test_macro_gate_line_displays_open_and_closed_states():
    """Validate macro gate text toggles OPEN/CLOSED based on HY spread credit veto."""
    open_line = _macro_gate_line({"vix": 24, "put_call": 1.0, "hy_spread": 500, "fear_greed": 30})
    closed_line = _macro_gate_line({"vix": 24, "put_call": 1.0, "hy_spread": 700, "fear_greed": 30})

    assert "Macro Gate: OPEN" in open_line
    assert "Macro Gate: CLOSED" in closed_line


def test_format_alert_output_structure_and_tags_buy_watch_no_buy():
    """Validate Telegram-ready alert output includes header, summary, and action tags."""
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
        "MSFT": {"total_score": 9, "recommendation": {"action": "BUY", "entry": 100.0, "stop_loss": 93.0}},
        "AAPL": {"total_score": 7, "recommendation": {"action": "WATCH", "reason": "Watch setup"}},
        "TSLA": {"total_score": 5, "recommendation": {"action": "NO_BUY", "reason": "Score too low"}},
    }

    with patch("dipbuyer_alert.TradingAdvisor", return_value=fake):
        text = format_alert(limit=8, min_score=6)

    assert "📉 Trading Advisor - Dip Buyer Scan" in text
    assert "Market: correction" in text
    assert "Macro Gate: OPEN" in text
    assert "Summary: 3 candidates | BUY 1 | WATCH 1 | NO_BUY 1" in text
    assert "• MSFT (9/12) → BUY" in text
    assert "• AAPL (7/12) → WATCH" in text
    assert "• TSLA (5/12) → NO_BUY" in text


def test_format_alert_candidate_order_follows_scan_sorting_by_score_desc():
    """Validate candidate display order reflects descending score order from scanner."""
    fake = _FakeAdvisor()
    fake._scan = pd.DataFrame(
        [
            {"symbol": "AAA", "total_score": 11},
            {"symbol": "BBB", "total_score": 8},
            {"symbol": "CCC", "total_score": 6},
        ]
    )
    fake._analysis = {
        "AAA": {"total_score": 11, "recommendation": {"action": "BUY", "entry": 50.0, "stop_loss": 46.5}},
        "BBB": {"total_score": 8, "recommendation": {"action": "BUY", "entry": 40.0, "stop_loss": 37.2}},
        "CCC": {"total_score": 6, "recommendation": {"action": "WATCH", "reason": "Watch setup"}},
    }

    with patch("dipbuyer_alert.TradingAdvisor", return_value=fake):
        text = format_alert(limit=8, min_score=6)

    pos_aaa = text.find("• AAA")
    pos_bbb = text.find("• BBB")
    pos_ccc = text.find("• CCC")
    assert -1 not in (pos_aaa, pos_bbb, pos_ccc)
    assert pos_aaa < pos_bbb < pos_ccc


def test_format_alert_displays_no_candidates_message_when_scan_empty():
    """Validate formatter emits explicit no-candidates line when scan returns empty DataFrame."""
    fake = _FakeAdvisor()
    fake._scan = pd.DataFrame(columns=["symbol", "total_score"])

    with patch("dipbuyer_alert.TradingAdvisor", return_value=fake):
        text = format_alert(limit=5, min_score=6)

    assert "No Dip Buyer candidates met the current scan threshold." in text