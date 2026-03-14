from unittest.mock import MagicMock

from advisor import TradingAdvisor


def test_normalize_quick_check_symbol_maps_crypto_aliases_and_proxies():
    assert TradingAdvisor._normalize_quick_check_symbol("btc") == {
        "input_symbol": "BTC",
        "display_symbol": "BTC",
        "provider_symbol": "BTC-USD",
        "asset_class": "crypto",
    }
    assert TradingAdvisor._normalize_quick_check_symbol("ETH-USD") == {
        "input_symbol": "ETH-USD",
        "display_symbol": "ETH",
        "provider_symbol": "ETH-USD",
        "asset_class": "crypto",
    }
    assert TradingAdvisor._normalize_quick_check_symbol("coin")["asset_class"] == "crypto_proxy"
    assert TradingAdvisor._normalize_quick_check_symbol("nvda")["asset_class"] == "stock"


def test_quick_check_downgrades_actionable_stock_when_polymarket_conflicts(monkeypatch):
    advisor = TradingAdvisor()
    advisor.analyze_stock = MagicMock(
        return_value={
            "total_score": 9,
            "confidence": 80,
            "effective_confidence": 80,
            "technical_scores": {"pct_from_high": 98.0},
            "breakout_follow_through": {"score": 4},
            "exit_risk": {"score": 1},
            "recommendation": {"action": "BUY", "reason": "clean breakout"},
        }
    )
    monkeypatch.setattr(
        "advisor.load_symbol_context",
        lambda symbol: {
            "symbol": symbol,
            "conviction": "conflicting",
            "divergence_summary": "Persistent divergence",
            "divergence_state": "persistent",
            "matched": {"themes": ["rates"], "severity": "major", "persistence": "persistent"},
        },
    )

    result = advisor.quick_check("NVDA")

    assert result["analysis_path"] == "canslim"
    assert result["verdict"] == "needs confirmation"
    assert "downgraded to confirmation-only" in result["reason"]
    advisor.analyze_stock.assert_called_once_with("NVDA", quiet=True)


def test_quick_check_uses_dip_path_for_direct_crypto_and_can_lift_early_to_confirmation(monkeypatch):
    advisor = TradingAdvisor()
    advisor.analyze_dip_stock = MagicMock(
        return_value={
            "total_score": 5,
            "confidence": 52,
            "effective_confidence": 52,
            "recovery_ready": True,
            "falling_knife": False,
            "rebound_pct": 0.04,
            "recommendation": {"action": "WATCH", "reason": "recovery improving"},
        }
    )
    monkeypatch.setattr(
        "advisor.load_symbol_context",
        lambda symbol: {
            "symbol": symbol,
            "conviction": "supportive",
            "divergence_summary": "No major divergence",
            "divergence_state": "none",
            "matched": {"themes": ["crypto-policy"], "severity": "major", "persistence": "accelerating"},
        },
    )

    result = advisor.quick_check("BTC")

    assert result["provider_symbol"] == "BTC-USD"
    assert result["analysis_path"] == "dip_buyer"
    assert result["verdict"] == "needs confirmation"
    assert "Supportive Polymarket context lifts this" in result["reason"]
    advisor.analyze_dip_stock.assert_called_once_with("BTC-USD", quiet=True)


def test_format_quick_check_renders_compact_operator_summary():
    text = TradingAdvisor.format_quick_check(
        {
            "symbol": "BTC",
            "verdict": "needs confirmation",
            "analysis_path": "dip_buyer",
            "asset_class": "crypto",
            "reason": "Recovery is improving, but the dip setup still needs confirmation.",
            "analysis": {
                "total_score": 6,
                "confidence": 54,
                "effective_confidence": 54,
                "recommendation": {"action": "WATCH"},
            },
            "polymarket": {
                "conviction": "supportive",
                "divergence_summary": "No major divergence",
                "matched": {"themes": ["crypto-policy", "rates"]},
            },
        }
    )

    assert "Quick check: BTC -> needs confirmation" in text
    assert "Polymarket: supportive | No major divergence | themes crypto-policy, rates" in text
    assert "Base action: WATCH | Score 6/12 | Confidence 54%" in text
