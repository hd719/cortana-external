from importlib.util import module_from_spec, spec_from_file_location
import json
from pathlib import Path


FORMATTER_PATH = Path(__file__).resolve().parents[1] / "scripts" / "local_output_formatter.py"
SPEC = spec_from_file_location("local_output_formatter", FORMATTER_PATH)
MODULE = module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def test_format_alert_simplifies_context_and_decision():
    raw = """CANSLIM Scan
Market: correction — no new positions
Polymarket: Fed easing odds 64% (0 pts/24h); US recession odds 36% (0 pts/24h)
Overlay: Risk-on conflict — Polymarket is leaning risk-on, but the current equity regime is not fully supportive.
Risk budget: remaining 0% | cap 0% | aggression lean more selective | note market regime correction
Execution quality: quality good | liquidity high | slippage high | good liquidity | high | slippage high (155.2bps)
Universe selection: 96 pinned | 24 ranked | source cache | cache age 0.9h
Scanned 120 | market gate active | 0 BUY | 0 WATCH
Why no buys: Regime score -7: 6 distribution days and -5.9% drawdown. Stay defensive.
"""
    text = MODULE.format_alert(raw)

    assert "Takeaway" in text
    assert "- Market: correction — no new positions" in text
    assert "- Macro: Risk-on conflict — Polymarket is leaning risk-on, but the current equity regime is not fully supportive." in text
    assert "- Risk: remaining risk budget 0% | exposure cap 0% | market regime correction" in text
    assert "- Trading conditions: quality good | liquidity high | slippage high" in text
    assert "- Scan input: 96 pinned + 24 ranked names | source cache | cache age 0.9h" in text
    assert "- Why no buys: Regime score -7: 6 distribution days and -5.9% drawdown. Stay defensive." in text


def test_format_alert_surfaces_leader_bucket_overlap(tmp_path):
    leader_path = tmp_path / "leader-baskets.json"
    leader_path.write_text(
        json.dumps(
            {
                "buckets": {
                    "daily": [{"symbol": "OXY"}, {"symbol": "APA"}],
                    "weekly": [{"symbol": "OXY"}, {"symbol": "APA"}, {"symbol": "GEV"}],
                    "monthly": [{"symbol": "OXY"}, {"symbol": "APA"}, {"symbol": "GEV"}, {"symbol": "MPC"}],
                },
                "priority": {"symbols": ["OXY", "APA", "GEV", "MPC"]},
            }
        ),
        encoding="utf-8",
    )
    raw = """CANSLIM Scan
Market: correction — no new positions
Universe selection: 20 pinned | 100 ranked | source cache | cache age 0.0h
Scanned 120 | market gate active | 0 BUY | 0 WATCH
Top names considered: OXY, APA, GEV
Why no buys: Stay defensive
"""
    text = MODULE.format_alert(raw, leader_bucket_path=str(leader_path))

    assert "- Leader-bucket overlap: priority OXY, APA, GEV | daily OXY, APA | weekly OXY, APA, GEV | monthly OXY, APA, GEV" in text


def test_format_quick_check_strips_runtime_noise_and_simplifies_verdict():
    raw = """/tmp/site-packages/yfinance/scrapers/history.py:173: Pandas4Warning: Timestamp.utcnow is deprecated
  dt_now = pd.Timestamp.utcnow()
Quick check: BTC -> avoid for now
Path: dip_buyer | Asset: crypto
Polymarket: conflicting | Divergence watch | themes crypto-policy
Risk budget: remaining 0% | cap 0% | aggression lean more selective | note market regime correction
Execution quality: quality good | liquidity high | slippage high | good liquidity | high | slippage high (196.5bps)
Reason: Falling-knife filter active: wait for bounce confirmation above the short-term trend. Polymarket context: conflicting on crypto-policy.
Base action: NO_BUY | Score 7/12 | Confidence 16%
"""
    text = MODULE.format_quick_check(raw)

    assert "Pandas4Warning" not in text
    assert "dt_now = pd.Timestamp.utcnow()" not in text
    assert "- Setup: dip_buyer | Asset: crypto" in text
    assert "- Macro: conflicting | Divergence watch | themes crypto-policy" in text
    assert "- Why: Falling-knife filter active: wait for bounce confirmation above the short-term trend. Polymarket context: conflicting on crypto-policy." in text
    assert "- Model output: NO_BUY | Score 7/12 | Confidence 16%" in text


def test_format_leader_baskets_surfaces_daily_weekly_monthly_names():
    raw = """{
  "generated_at": "2026-03-20T20:00:00+00:00",
  "buckets": {
    "daily": [
      {"symbol": "NVDA", "window_return_pct": 3.2, "appearances": 1},
      {"symbol": "AMD", "window_return_pct": null, "appearances": 1}
    ],
    "weekly": [
      {"symbol": "NVDA", "window_return_pct": 8.4, "appearances": 4},
      {"symbol": "MSFT", "window_return_pct": 6.1, "appearances": 3}
    ],
    "monthly": [
      {"symbol": "NVDA", "window_return_pct": 16.2, "appearances": 9},
      {"symbol": "META", "window_return_pct": 12.5, "appearances": 7},
      {"symbol": "AAPL", "window_return_pct": 9.0, "appearances": 5}
    ]
  },
  "priority": {
    "symbols": ["NVDA", "AMD", "MSFT", "META"]
  }
}"""
    text = MODULE.format_leader_baskets(raw)

    assert "Leader buckets" in text
    assert "- Updated: 2026-03-20T20:00:00+00:00" in text
    assert "- Priority set: NVDA, AMD, MSFT, META" in text
    assert "- Format: % move over that bucket window | (x) = number of appearances in that bucket" in text
    assert "- Daily: NVDA +3.2% (1x), AMD n/a (1x)" in text
    assert "- Weekly: NVDA +8.4% (4x), MSFT +6.1% (3x)" in text
    assert "- Monthly: NVDA +16.2% (9x), META +12.5% (7x), AAPL +9.0% (5x)" in text


def test_format_market_data_ops_surfaces_role_budget_and_universe_state():
    raw = json.dumps(
        {
            "data": {
                "streamerRoleConfigured": "auto",
                "streamerRoleActive": "leader",
                "streamerLockHeld": True,
                "providerMetrics": {
                    "fallbackUsage": {"yahoo": 3, "shared_state": 2},
                    "sourceUsage": {"schwab_streamer": 12, "yahoo": 3},
                },
                "health": {
                    "providers": {
                        "schwabStreamerMeta": {
                            "operatorState": "healthy",
                            "failurePolicy": None,
                            "connected": True,
                            "operatorAction": "No operator action required.",
                            "subscriptionBudget": {
                                "LEVELONE_EQUITIES": {
                                    "requestedSymbols": 40,
                                    "softCap": 250,
                                    "headroomRemaining": 210,
                                    "overSoftCap": False,
                                    "lastPrunedCount": 0,
                                },
                                "CHART_EQUITY": {
                                    "requestedSymbols": 10,
                                    "softCap": 250,
                                    "headroomRemaining": 240,
                                    "overSoftCap": False,
                                    "lastPrunedCount": 0,
                                },
                            },
                        }
                    }
                },
                "universe": {
                    "latest": {"source": "remote_json", "updatedAt": "2026-03-21T20:00:00+00:00"},
                    "ownership": {
                        "refreshPolicy": "TS owns the artifact refresh path; python_seed is a terminal fallback only."
                    },
                },
            }
        }
    )
    text = MODULE.format_market_data_ops(raw)

    assert "Market data ops" in text
    assert "- Streamer role: leader (configured auto) | lock held yes" in text
    assert "- Stream state: healthy | policy none | connected yes" in text
    assert "- Symbol budget: LEVELONE_EQUITIES: 40/250 requested | headroom 210 | CHART_EQUITY: 10/250 requested | headroom 240" in text
    assert "- Fallbacks: yahoo 3 | shared_state 2 | primary source mix schwab_streamer 12, yahoo 3" in text
    assert "- Universe: remote_json | updated 2026-03-21T20:00:00+00:00" in text
