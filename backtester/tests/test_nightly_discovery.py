from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd

from nightly_discovery import build_report, format_report


class _FakeAdvisor:
    def __init__(self):
        self.last_nightly_symbols = None
        self.screener = SimpleNamespace(
            get_universe_for_profile=lambda profile, refresh_sp500=False: ["AAPL", "MSFT", "NVDA", "COIN"],
            get_universe=lambda: ["AAPL", "MSFT", "NVDA", "COIN"],
        )

    def get_market_status(self, refresh: bool = False):
        return SimpleNamespace(regime=SimpleNamespace(value="confirmed_uptrend"), position_sizing=1.0)

    def run_nightly_discovery(
        self,
        limit: int = 25,
        min_technical_score: int = 3,
        refresh_sp500: bool = False,
        symbols=None,
    ):
        self.last_nightly_symbols = list(symbols or [])
        return pd.DataFrame(
            [
                {
                    "symbol": "NVDA",
                    "technical_score": 6,
                    "total_score": 10,
                    "action": "BUY",
                    "rank_score": 12.5,
                    "confidence": 82,
                    "reason": "clean breakout",
                },
                {
                    "symbol": "COIN",
                    "technical_score": 5,
                    "total_score": 8,
                    "action": "WATCH",
                    "rank_score": 10.0,
                    "confidence": 63,
                    "reason": "crypto proxy strength",
                },
            ]
        )


def test_build_report_uses_nightly_profile_and_formats_leaders():
    fake_advisor = _FakeAdvisor()
    with patch("nightly_discovery.TradingAdvisor", return_value=fake_advisor), patch(
        "nightly_discovery.RankedUniverseSelector.refresh_cache",
        return_value={
            "generated_at": "2026-03-14T09:00:00+00:00",
            "symbols": [{"symbol": "AAA"}],
            "feature_snapshot": {
                "schema_version": 1,
                "generated_at": "2026-03-14T09:00:00+00:00",
                "symbol_count": 1,
                "source": "ranked_universe_selector.refresh_cache",
            },
            "liquidity_overlay": {
                "path": "/tmp/liquidity.json",
                "generated_at": "2026-03-14T09:00:01+00:00",
                "symbol_count": 1,
                "summary": {
                    "median_estimated_slippage_bps": 11.2,
                    "high_quality_count": 1,
                },
            },
        },
    ), patch("nightly_discovery._load_buy_decision_calibration_summary", return_value=None):
        report = build_report(limit=2, min_technical_score=3, refresh_sp500=True)

    assert report["profile"] == "nightly_discovery"
    assert report["market_regime"] == "confirmed_uptrend"
    assert report["universe_size"] == 4
    assert report["leaders"][0]["symbol"] == "NVDA"
    assert report["leaders"][1]["action"] == "WATCH"
    assert report["live_prefilter"]["symbol_count"] == 1
    assert report["feature_snapshot"]["schema_version"] == 1
    assert report["feature_snapshot"]["symbol_count"] == 1
    assert report["liquidity_overlay"]["symbol_count"] == 1
    assert report["liquidity_overlay"]["summary"]["median_estimated_slippage_bps"] == 11.2
    assert fake_advisor.last_nightly_symbols == ["AAPL", "MSFT", "NVDA", "COIN"]


def test_format_report_renders_compact_nightly_summary():
    report = {
        "profile": "nightly_discovery",
        "market_regime": "confirmed_uptrend",
        "position_sizing": 1.0,
        "universe_size": 4,
        "live_prefilter": {
            "path": "/tmp/prefilter.json",
            "generated_at": "2026-03-14T09:00:00+00:00",
            "symbol_count": 42,
        },
        "feature_snapshot": {
            "path": "/tmp/prefilter.json",
            "schema_version": 1,
            "generated_at": "2026-03-14T09:00:00+00:00",
            "symbol_count": 42,
            "source": "ranked_universe_selector.refresh_cache",
        },
        "liquidity_overlay": {
            "path": "/tmp/liquidity.json",
            "generated_at": "2026-03-14T09:00:03+00:00",
            "symbol_count": 39,
            "summary": {
                "median_estimated_slippage_bps": 9.8,
                "high_quality_count": 17,
            },
        },
        "leaders": [
            {
                "symbol": "NVDA",
                "technical_score": 6,
                "total_score": 10,
                "action": "BUY",
                "rank_score": 12.5,
                "confidence": 82,
                "reason": "clean breakout",
            }
        ],
    }

    text = format_report(report)

    assert "Nightly Discovery" in text
    assert "Profile: nightly_discovery" in text
    assert "Universe size: 4" in text
    assert "Live prefilter cache: 42 symbols" in text
    assert "Feature snapshot: v1 | 42 symbols | 2026-03-14T09:00:00+00:00 | ranked_universe_selector.refresh_cache" in text
    assert "Liquidity overlay cache: 39 symbols | 2026-03-14T09:00:03+00:00 | median slip 9.8bps | high quality 17" in text
    assert "- NVDA: action BUY | tech 6/6 | total 10/12" in text


def test_format_report_surfaces_buy_decision_calibration_when_available():
    report = {
        "profile": "nightly_discovery",
        "market_regime": "confirmed_uptrend",
        "position_sizing": 1.0,
        "universe_size": 4,
        "leaders": [],
        "buy_decision_calibration": {
            "path": "/tmp/buy-decision-calibration-latest.json",
            "generated_at": "2026-03-14T08:30:00+00:00",
            "is_stale": False,
            "reason": "fresh",
            "status": "fresh",
            "settled_candidates": 24,
        },
    }

    text = format_report(report)

    assert "Buy decision calibration: fresh | stale=False | settled 24 | 2026-03-14T08:30:00+00:00" in text
