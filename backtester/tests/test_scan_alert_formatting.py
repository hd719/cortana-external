from types import SimpleNamespace
from unittest.mock import patch, MagicMock

import pandas as pd

from data.market_regime import MarketRegime
from canslim_alert import format_alert as format_canslim
from dipbuyer_alert import format_alert as format_dipbuyer


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
        "Scanned 4 | 3 passed threshold | 0 BUY | 0 WATCH",
        "Top names considered: CFLT, HWM, ALUR",
        "Why no buys: market correction gate",
    ]


def test_dipbuyer_alert_is_compact_when_market_gate_blocks_buys():
    analyzer = MagicMock()
    with patch("dipbuyer_alert.TradingAdvisor", return_value=_FakeDipBuyerAdvisor()), patch(
        "dipbuyer_alert.XSentimentAnalyzer", return_value=analyzer
    ), patch.dict("os.environ", {"TRADING_INCLUDE_WATCHLIST_PRIORITY": "0"}):
        text = format_dipbuyer(limit=5, min_score=6, universe_size=4)

    assert text.splitlines() == [
        "Dip Buyer Scan",
        "Market: correction — no new positions",
        "Scanned 4 | 3 passed threshold | 0 BUY | 0 WATCH",
        "Top names considered: CFLT, HWM, ALUR",
        "Why no buys: market correction gate",
    ]
    analyzer.analyze.assert_not_called()
