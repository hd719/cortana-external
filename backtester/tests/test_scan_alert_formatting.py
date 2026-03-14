from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from canslim_alert import format_alert as format_canslim
from data.market_regime import MarketRegime
from dipbuyer_alert import format_alert as format_dipbuyer


@pytest.fixture(autouse=True)
def _disable_polymarket_artifacts(monkeypatch, tmp_path):
    monkeypatch.setenv("POLYMARKET_COMPACT_REPORT_PATH", str(tmp_path / "missing-compact.txt"))
    monkeypatch.setenv("POLYMARKET_REPORT_JSON_PATH", str(tmp_path / "missing-report.json"))
    monkeypatch.setenv("POLYMARKET_WATCHLIST_PATH", str(tmp_path / "missing-watchlist.json"))


class _FakeCanSlimAdvisor:
    def __init__(self):
        self._market = SimpleNamespace(
            regime=MarketRegime.CORRECTION,
            position_sizing=0.0,
            notes="market correction gate",
            snapshot_age_seconds=0.0,
            status="ok",
        )
        self.screener = SimpleNamespace(get_universe=lambda: ["CFLT", "HWM", "ALUR", "SHOP"])
        self._analysis = {
            "CFLT": {"total_score": 7, "recommendation": {"action": "NO_BUY", "reason": "market correction gate"}},
            "HWM": {"total_score": 7, "recommendation": {"action": "NO_BUY", "reason": "market correction gate"}},
            "ALUR": {"total_score": 6, "recommendation": {"action": "NO_BUY", "reason": "market correction gate"}},
            "SHOP": {"total_score": 4, "recommendation": {"action": "NO_BUY", "reason": "below threshold"}},
        }

    def get_market_status(self, refresh: bool = False):
        return self._market

    def analyze_stock(self, symbol: str):
        return self._analysis[symbol]


class _FakeDipBuyerAdvisor:
    def __init__(self):
        self.risk_fetcher = SimpleNamespace(get_snapshot=lambda: {})
        self._market = SimpleNamespace(
            regime=MarketRegime.CORRECTION,
            position_sizing=0.0,
            notes="market correction gate",
            snapshot_age_seconds=0.0,
            status="ok",
        )
        self.screener = SimpleNamespace(get_universe=lambda: ["CFLT", "HWM", "ALUR", "SHOP"])
        self._analysis = {
            "CFLT": {"total_score": 7, "recommendation": {"action": "NO_BUY", "reason": "market correction gate"}},
            "HWM": {"total_score": 7, "recommendation": {"action": "NO_BUY", "reason": "market correction gate"}},
            "ALUR": {"total_score": 6, "recommendation": {"action": "NO_BUY", "reason": "market correction gate"}},
            "SHOP": {"total_score": 4, "recommendation": {"action": "NO_BUY", "reason": "below threshold"}},
        }

    def get_market_status(self, refresh: bool = False):
        return self._market

    def analyze_dip_stock(self, symbol: str):
        return self._analysis[symbol]


def test_canslim_alert_is_compact_when_market_gate_blocks_buys():
    with patch("canslim_alert.TradingAdvisor", return_value=_FakeCanSlimAdvisor()), patch.dict("os.environ", {"TRADING_INCLUDE_WATCHLIST_PRIORITY": "0"}):
        text = format_canslim(limit=5, min_score=6, universe_size=4)

    assert text.splitlines() == [
        "CANSLIM Scan",
        "Market: correction — no new positions",
        "Scanned 4 | market gate active | 0 BUY | 0 WATCH",
        "Top names considered: CFLT, HWM, ALUR",
        "Why no buys: market correction gate",
    ]


def test_canslim_alert_timing_line_surfaces_phase_and_nested_timings():
    fake = _FakeCanSlimAdvisor()
    fake._market = SimpleNamespace(
        regime=MarketRegime.CONFIRMED_UPTREND,
        position_sizing=1.0,
        notes="trend intact",
        snapshot_age_seconds=0.0,
        status="ok",
    )
    fake.screener = SimpleNamespace(get_universe=lambda: ["AAA"])
    fake._analysis = {
        "AAA": {
            "total_score": 8,
            "data_source": "yahoo",
            "data_staleness_seconds": 12.0,
            "timing": {"history": 0.8, "fundamentals": 0.2, "sector": 0.4},
            "recommendation": {"action": "WATCH", "reason": "watch", "trade_quality_score": 80.0},
        }
    }

    with patch("canslim_alert.TradingAdvisor", return_value=fake), patch.dict(
        "os.environ",
        {"TRADING_INCLUDE_WATCHLIST_PRIORITY": "0", "BACKTESTER_TIMING": "1"},
    ):
        text = format_canslim(limit=5, min_score=6, universe_size=1)

    assert "Timing:" in text
    assert "market" in text
    assert "universe" in text
    assert "analysis" in text
    assert "slowest nested: history 0.80s" in text


def test_dipbuyer_alert_is_compact_when_market_gate_blocks_buys():
    analyzer = MagicMock()
    with patch("dipbuyer_alert.TradingAdvisor", return_value=_FakeDipBuyerAdvisor()), patch(
        "dipbuyer_alert.XSentimentAnalyzer", return_value=analyzer
    ), patch.dict("os.environ", {"TRADING_INCLUDE_WATCHLIST_PRIORITY": "0"}):
        text = format_dipbuyer(limit=5, min_score=6, universe_size=4)

    assert text.splitlines() == [
        "Dip Buyer Scan",
        "Market regime: correction",
        "Qualified setups: 3 of 4 scanned | BUY 0 | WATCH 0",
        "BUY names: none",
        "Top leaders: CFLT NO_BUY (7/12) | HWM NO_BUY (7/12) | ALUR NO_BUY (6/12)",
        "Decision review: BUY 0 | WATCH 0 | NO_BUY 3",
        "Tuning balance: clean BUY 0 | risky BUY proxy 0 | abstain 0 | veto 3 | higher-tq restraint proxy n/a",
        "Vetoes: CFLT NO_BUY | tq 7.0 | conf 0% u 0% | down/churn 0.0/0.0 | stress normal(0) | veto market-gate | reason market correction gate; HWM NO_BUY | tq 7.0 | conf 0% u 0% | down/churn 0.0/0.0 | stress normal(0) | veto market-gate | reason market correction gate (+1 more)",
        "Final action: DO NOT BUY — market regime veto (market correction gate)",
    ]
    analyzer.analyze.assert_not_called()


def test_canslim_alert_uses_trade_quality_order_for_leaders():
    fake = _FakeCanSlimAdvisor()
    fake._market = SimpleNamespace(
        regime=MarketRegime.CONFIRMED_UPTREND,
        position_sizing=1.0,
        notes="trend intact",
        snapshot_age_seconds=0.0,
        status="ok",
    )
    fake.screener = SimpleNamespace(get_universe=lambda: ["AAA", "BBB"])
    fake._analysis = {
        "AAA": {
            "total_score": 9,
            "trade_quality_score": 71.0,
            "effective_confidence": 52,
            "uncertainty_pct": 31,
            "abstain": True,
            "abstain_reasons": ["data coverage thin", "adverse regime elevated"],
            "recommendation": {
                "action": "WATCH",
                "reason": "uncertain",
                "trade_quality_score": 71.0,
                "abstain": True,
                "abstain_reasons": ["data coverage thin", "adverse regime elevated"],
            },
        },
        "BBB": {
            "total_score": 8,
            "trade_quality_score": 94.0,
            "effective_confidence": 80,
            "uncertainty_pct": 8,
            "downside_penalty": 2.0,
            "churn_penalty": 1.0,
            "abstain": False,
            "recommendation": {
                "action": "BUY",
                "reason": "clean",
                "trade_quality_score": 94.0,
                "effective_confidence": 80,
                "uncertainty_pct": 8,
                "downside_penalty": 2.0,
                "churn_penalty": 1.0,
                "abstain": False,
            },
        },
    }

    with patch("canslim_alert.TradingAdvisor", return_value=fake), patch.dict("os.environ", {"TRADING_INCLUDE_WATCHLIST_PRIORITY": "0"}):
        text = format_canslim(limit=5, min_score=6, universe_size=2)

    assert "Top names considered: BBB, AAA" in text
    assert "Leaders: BBB BUY (8/12) | AAA WATCH (9/12)" in text
    assert "Decision review: BUY 1 | WATCH 1 | NO_BUY 0" in text
    assert "Tuning balance: clean BUY 1 | risky BUY proxy 0 | abstain 1 | veto 0 | higher-tq restraint proxy 0 (>= median BUY tq 94.0)" in text
    assert "Good buys: BBB BUY | tq 94.0 | conf 80% u 8% | down/churn 2.0/1.0 | stress normal(0)" in text
    assert "Abstains: AAA WATCH | tq 71.0 | conf 52% u 31% | down/churn 0.0/0.0 | stress normal(0) | ABSTAIN | reasons data coverage thin | adverse regime elevated | reason uncertain" in text


def test_canslim_alert_review_surfaces_veto_and_restraint_proxies_compactly():
    fake = _FakeCanSlimAdvisor()
    fake._market = SimpleNamespace(
        regime=MarketRegime.CONFIRMED_UPTREND,
        position_sizing=1.0,
        notes="trend intact",
        snapshot_age_seconds=0.0,
        status="ok",
    )
    fake.screener = SimpleNamespace(get_universe=lambda: ["AAA", "BBB", "CCC"])
    fake._analysis = {
        "AAA": {
            "total_score": 8,
            "trade_quality_score": 88.0,
            "effective_confidence": 77,
            "uncertainty_pct": 9,
            "downside_penalty": 2.0,
            "churn_penalty": 1.0,
            "recommendation": {"action": "BUY", "reason": "clean", "trade_quality_score": 88.0},
        },
        "BBB": {
            "total_score": 9,
            "trade_quality_score": 90.0,
            "effective_confidence": 59,
            "uncertainty_pct": 12,
            "downside_penalty": 3.0,
            "churn_penalty": 2.0,
            "exit_risk": {"veto": True},
            "recommendation": {"action": "WATCH", "reason": "Exit risk too high", "trade_quality_score": 90.0},
        },
        "CCC": {
            "total_score": 8,
            "trade_quality_score": 83.0,
            "effective_confidence": 70,
            "uncertainty_pct": 8,
            "sentiment_overlay": {"veto": True},
            "recommendation": {"action": "WATCH", "reason": "Sentiment overlay veto: bearish", "trade_quality_score": 83.0},
        },
    }

    with patch("canslim_alert.TradingAdvisor", return_value=fake), patch.dict("os.environ", {"TRADING_INCLUDE_WATCHLIST_PRIORITY": "0"}):
        text = format_canslim(limit=5, min_score=6, universe_size=3)

    lines = text.splitlines()
    assert len(lines) <= 9
    assert "Tuning balance: clean BUY 1 | risky BUY proxy 0 | abstain 0 | veto 2 | higher-tq restraint proxy 1 (>= median BUY tq 88.0)" in text
    assert "Higher-tq restraint: BBB WATCH | tq 90.0 | conf 59% u 12% | down/churn 3.0/2.0 | stress normal(0) | reason Exit risk too high" in text
    assert "Vetoes: BBB WATCH | tq 90.0 | conf 59% u 12% | down/churn 3.0/2.0 | stress normal(0) | veto exit-risk | reason Exit risk too high; CCC WATCH | tq 83.0 | conf 70% u 8% | down/churn 0.0/0.0 | stress normal(0) | veto sentiment/reason-veto | reason Sentiment overlay veto: bearish" in text
