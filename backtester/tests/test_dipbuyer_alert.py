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

    assert "Dip Buyer Scan" in text
    assert "Market regime: correction" in text
    assert "Qualified setups: 2 of 3 scanned | BUY 1 | WATCH 1" in text
    assert "BUY names: MSFT" in text
    assert "Top leaders: MSFT BUY (9/12) 🐦 Neutral | AAPL WATCH (7/12) 🐦 Neutral" in text
    assert "Final action: BUY listed names only; keep remaining qualified setups on watch" in text


def test_format_alert_lists_all_buy_names_when_count_is_small():
    fake = _FakeAdvisor()
    fake._market = SimpleNamespace(
        regime=MarketRegime.UPTREND_UNDER_PRESSURE,
        position_sizing=0.5,
        notes="Stay selective",
        data_source="alpaca",
        snapshot_age_seconds=0.0,
        status="ok",
    )
    fake._scan = pd.DataFrame([
        {"symbol": "MSFT", "total_score": 10},
        {"symbol": "AAPL", "total_score": 9},
        {"symbol": "NVDA", "total_score": 8},
    ])
    fake._analysis = {
        "MSFT": {"total_score": 10, "data_source": "alpaca", "recommendation": {"action": "BUY", "reason": "Strong setup"}},
        "AAPL": {"total_score": 9, "data_source": "alpaca", "recommendation": {"action": "BUY", "reason": "Strong setup"}},
        "NVDA": {"total_score": 8, "data_source": "alpaca", "recommendation": {"action": "BUY", "reason": "Strong setup"}},
    }

    with patch("dipbuyer_alert.TradingAdvisor", return_value=fake):
        text = format_alert(limit=8, min_score=6)

    assert "Market regime: uptrend under pressure" in text
    assert "BUY names: MSFT, AAPL, NVDA" in text
    assert "Final action: BUY listed names only" in text


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

    assert "Dip Buyer Scan" in text
    assert "Final action: DO NOT BUY — market regime veto (Cached market fallback active)" in text
    assert "Note: degraded market data (720s stale)" in text


def test_format_alert_includes_decision_review_for_top_leaders():
    fake = _FakeAdvisor()
    fake.risk_fetcher = SimpleNamespace(get_snapshot=lambda: {"vix": 24.0, "put_call": 1.01, "hy_spread": 500.0, "fear_greed": 28.0})
    fake._scan = pd.DataFrame(
        [
            {"symbol": "MSFT", "total_score": 9},
            {"symbol": "AAPL", "total_score": 7},
        ]
    )
    fake._analysis = {
        "MSFT": {
            "total_score": 9,
            "trade_quality_score": 91.0,
            "effective_confidence": 79,
            "uncertainty_pct": 7,
            "downside_penalty": 3.0,
            "churn_penalty": 1.0,
            "adverse_regime": {"score": 18.0, "label": "caution"},
            "data_source": "alpaca",
            "recommendation": {"action": "BUY", "entry": 100.0, "stop_loss": 93.0},
        },
        "AAPL": {
            "total_score": 7,
            "trade_quality_score": 72.0,
            "effective_confidence": 48,
            "uncertainty_pct": 31,
            "abstain": True,
            "abstain_reasons": ["macro inputs stale", "confidence assessment abstained"],
            "data_source": "yahoo",
            "recommendation": {
                "action": "WATCH",
                "reason": "Watch setup",
                "abstain": True,
                "abstain_reasons": ["macro inputs stale", "confidence assessment abstained"],
            },
        },
    }

    with patch("dipbuyer_alert.TradingAdvisor", return_value=fake):
        text = format_alert(limit=8, min_score=6)

    assert "Top leaders: MSFT BUY (9/12) 🐦 Neutral | AAPL WATCH (7/12) 🐦 Neutral" in text
    assert "Decision review: BUY 1 | WATCH 1 | NO_BUY 0" in text
    assert "Tuning balance: clean BUY 0 | risky BUY proxy 1 | abstain 1 | veto 0 | higher-tq restraint proxy 0 (>= median BUY tq 91.0)" in text
    assert "Risky buys: MSFT BUY | tq 91.0 | conf 79% u 7% | down/churn 3.0/1.0 | stress caution(18)" in text
    assert "Abstains: AAPL WATCH | tq 72.0 | conf 48% u 31% | down/churn 0.0/0.0 | stress normal(0) | ABSTAIN | reasons macro inputs stale | confidence assessment abstained | reason Watch setup" in text


def test_format_alert_review_surfaces_credit_veto_without_expanding_output_too_far():
    fake = _FakeAdvisor()
    fake._market = SimpleNamespace(
        regime=MarketRegime.UPTREND_UNDER_PRESSURE,
        position_sizing=0.5,
        notes="Stay selective",
        data_source="alpaca",
        snapshot_age_seconds=0.0,
        status="ok",
    )
    fake._scan = pd.DataFrame(
        [
            {"symbol": "MSFT", "total_score": 9},
            {"symbol": "AAPL", "total_score": 8},
            {"symbol": "TSLA", "total_score": 7},
        ]
    )
    fake._analysis = {
        "MSFT": {
            "total_score": 9,
            "trade_quality_score": 89.0,
            "effective_confidence": 76,
            "uncertainty_pct": 9,
            "data_source": "alpaca",
            "recommendation": {"action": "BUY", "reason": "clean", "trade_quality_score": 89.0},
        },
        "AAPL": {
            "total_score": 8,
            "trade_quality_score": 92.0,
            "effective_confidence": 66,
            "uncertainty_pct": 13,
            "credit_veto": True,
            "data_source": "alpaca",
            "recommendation": {"action": "NO_BUY", "reason": "Credit veto active (HY spread too high).", "trade_quality_score": 92.0},
        },
        "TSLA": {
            "total_score": 7,
            "trade_quality_score": 86.0,
            "effective_confidence": 63,
            "uncertainty_pct": 29,
            "abstain": True,
            "abstain_reasons": ["macro stress elevated"],
            "data_source": "alpaca",
            "recommendation": {
                "action": "WATCH",
                "reason": "Uncertainty too high (29%): macro stress elevated",
                "trade_quality_score": 86.0,
                "abstain": True,
                "abstain_reasons": ["macro stress elevated"],
            },
        },
    }

    with patch("dipbuyer_alert.TradingAdvisor", return_value=fake):
        text = format_alert(limit=8, min_score=6)

    lines = text.splitlines()
    assert len(lines) <= 12
    assert "Tuning balance: clean BUY 1 | risky BUY proxy 0 | abstain 1 | veto 1 | higher-tq restraint proxy 1 (>= median BUY tq 89.0)" in text
    assert "Higher-tq restraint: AAPL NO_BUY | tq 92.0 | conf 66% u 13% | down/churn 0.0/0.0 | stress normal(0) | reason Credit veto active (HY spread too high)." in text
    assert "Vetoes: AAPL NO_BUY | tq 92.0 | conf 66% u 13% | down/churn 0.0/0.0 | stress normal(0) | veto credit/reason-veto | reason Credit veto active (HY spread too high)." in text
