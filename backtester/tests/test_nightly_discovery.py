from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd

from nightly_discovery import build_report, format_report


class _FakeAdvisor:
    def __init__(self):
        self.screener = SimpleNamespace(
            get_universe_for_profile=lambda profile, refresh_sp500=False: ["AAPL", "MSFT", "NVDA", "COIN"],
            get_universe=lambda: ["AAPL", "MSFT", "NVDA", "COIN"],
        )

    def get_market_status(self, refresh: bool = False):
        return SimpleNamespace(regime=SimpleNamespace(value="confirmed_uptrend"), position_sizing=1.0)

    def run_nightly_discovery(self, limit: int = 25, min_technical_score: int = 3, refresh_sp500: bool = False):
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
    with patch("nightly_discovery.TradingAdvisor", return_value=_FakeAdvisor()), patch(
        "nightly_discovery.RankedUniverseSelector.refresh_cache",
        return_value={"generated_at": "2026-03-14T09:00:00+00:00", "symbols": [{"symbol": "AAA"}]},
    ):
        report = build_report(limit=2, min_technical_score=3, refresh_sp500=True)

    assert report["profile"] == "nightly_discovery"
    assert report["market_regime"] == "confirmed_uptrend"
    assert report["universe_size"] == 4
    assert report["leaders"][0]["symbol"] == "NVDA"
    assert report["leaders"][1]["action"] == "WATCH"
    assert report["live_prefilter"]["symbol_count"] == 1


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
    assert "- NVDA: action BUY | tech 6/6 | total 10/12" in text
