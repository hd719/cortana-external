import json
from datetime import UTC, datetime
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
    advisor.risk_fetcher = MagicMock(get_snapshot=lambda: {})
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
    advisor.risk_fetcher = MagicMock(get_snapshot=lambda: {})
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


def test_quick_check_attaches_context_overlays_when_available(monkeypatch):
    advisor = TradingAdvisor()
    advisor.risk_fetcher = MagicMock(get_snapshot=lambda: {})
    advisor.analyze_stock = MagicMock(
        return_value={
            "total_score": 8,
            "confidence": 74,
            "effective_confidence": 74,
            "technical_scores": {"pct_from_high": 95.0},
            "breakout_follow_through": {"score": 3},
            "exit_risk": {"score": 1},
            "recommendation": {"action": "WATCH", "reason": "constructive"},
        }
    )
    monkeypatch.setattr("advisor.load_symbol_context", lambda symbol: None)
    monkeypatch.setattr(
        advisor,
        "_load_context_overlays",
        lambda **kwargs: {
            "risk_budget_overlay": {
                "risk_budget_remaining": 0.47,
                "aggression_dial": "lean_defensive",
                "exposure_cap_hint": 0.62,
            },
            "execution_quality_overlay": {
                "execution_quality": "moderate",
                "liquidity_posture": "adequate",
                "slippage_risk": "medium",
            },
        },
    )

    result = advisor.quick_check("NVDA")

    assert result["risk_budget_overlay"]["aggression_dial"] == "lean_defensive"
    assert result["execution_quality_overlay"]["execution_quality"] == "moderate"


def test_quick_check_attaches_overlay_promotion_context_when_available(monkeypatch, tmp_path):
    registry_path = tmp_path / "overlay_registry.json"
    state_path = tmp_path / "overlay_promotion_state.json"
    registry_payload = {
        "overlays": {
            "execution_quality": {"stage": "rank_modifier", "allow_rank_modifier": True, "max_effect_pct": 0.05},
            "liquidity_tier": {"stage": "rank_modifier", "allow_rank_modifier": True, "max_effect_pct": 0.05},
            "risk_budget_state": {"stage": "surfaced", "allow_rank_modifier": False, "max_effect_pct": 0.05},
        }
    }
    state_payload = {
        "generated_at": datetime.now(UTC).isoformat(),
        "overlays": {
            "execution_quality": {"stage": "rank_modifier", "allow_rank_modifier": True, "max_effect_pct": 0.05},
            "liquidity_tier": {"stage": "rank_modifier", "allow_rank_modifier": True, "max_effect_pct": 0.05},
            "risk_budget_state": {"stage": "surfaced", "allow_rank_modifier": False, "max_effect_pct": 0.05},
        },
    }
    registry_path.write_text(json.dumps(registry_payload, indent=2) + "\n", encoding="utf-8")
    state_path.write_text(json.dumps(state_payload, indent=2) + "\n", encoding="utf-8")
    monkeypatch.setenv("TRADING_OVERLAY_REGISTRY_PATH", str(registry_path))
    monkeypatch.setenv("TRADING_OVERLAY_PROMOTION_STATE_PATH", str(state_path))

    advisor = TradingAdvisor()
    advisor.risk_fetcher = MagicMock(get_snapshot=lambda: {})
    advisor.analyze_stock = MagicMock(
        return_value={
            "total_score": 8,
            "confidence": 74,
            "effective_confidence": 74,
            "technical_scores": {"pct_from_high": 95.0},
            "breakout_follow_through": {"score": 3},
            "exit_risk": {"score": 1},
            "recommendation": {"action": "WATCH", "reason": "constructive"},
        }
    )
    monkeypatch.setattr("advisor.load_symbol_context", lambda symbol: None)

    result = advisor.quick_check("NVDA")

    assert result["verdict"] == "needs confirmation"
    assert result["overlay_promotion"]["source"] == "promotion_state"
    assert result["overlay_promotion"]["overlays"]["execution_quality"]["stage"] == "rank_modifier"


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


def test_format_quick_check_renders_overlay_annotations_when_present():
    text = TradingAdvisor.format_quick_check(
        {
            "symbol": "NVDA",
            "verdict": "needs confirmation",
            "analysis_path": "canslim",
            "asset_class": "stock",
            "reason": "Setup is constructive, but confirmation is still incomplete.",
            "analysis": {
                "total_score": 8,
                "confidence": 68,
                "effective_confidence": 68,
                "recommendation": {"action": "WATCH"},
            },
            "risk_budget_overlay": {
                "risk_budget_remaining": 0.47,
                "aggression_dial": "lean_defensive",
                "exposure_cap_hint": 0.62,
            },
            "execution_quality_overlay": {
                "execution_quality": "moderate",
                "liquidity_posture": "adequate",
                "slippage_risk": "medium",
            },
        }
    )

    assert "Risk budget: remaining 47% | cap 62% | aggression lean defensive" in text
    assert "Execution quality: quality moderate | liquidity adequate | slippage medium" in text


def test_format_quick_check_renders_overlay_promotion_line():
    text = TradingAdvisor.format_quick_check(
        {
            "symbol": "NVDA",
            "verdict": "needs confirmation",
            "analysis_path": "canslim",
            "asset_class": "stock",
            "reason": "Setup is constructive.",
            "analysis": {
                "total_score": 8,
                "confidence": 68,
                "effective_confidence": 68,
                "recommendation": {"action": "WATCH"},
            },
            "overlay_promotion": {
                "source": "promotion_state",
                "overlays": {
                    "execution_quality": {
                        "stage": "rank_modifier",
                        "allow_rank_modifier": True,
                        "max_effect_pct": 0.05,
                    },
                    "liquidity_tier": {
                        "stage": "surfaced",
                        "allow_rank_modifier": False,
                        "max_effect_pct": 0.05,
                    },
                },
            },
        }
    )

    assert "Overlay promotion: execution quality rank active (cap 5%) | liquidity tier surfaced" in text


def test_quick_check_promotion_context_supports_rank_modifier_eligible_shape(monkeypatch, tmp_path):
    registry_path = tmp_path / "overlay_registry.json"
    state_path = tmp_path / "overlay_promotion_state.json"
    registry_payload = {
        "overlays": [
            {"name": "execution_quality", "stage": "rank_modifier", "rank_modifier_eligible": True, "modifier_bounds": {"min": -0.05, "max": 0.05}},
            {"name": "liquidity_tier", "stage": "rank_modifier", "rank_modifier_eligible": True, "modifier_bounds": {"min": -0.05, "max": 0.05}},
            {"name": "risk_budget_state", "stage": "surfaced", "rank_modifier_eligible": False, "modifier_bounds": {"min": -0.05, "max": 0.05}},
        ]
    }
    state_payload = {
        "generated_at": datetime.now(UTC).isoformat(),
        "overlays": [
            {"name": "execution_quality", "stage": "rank_modifier", "rank_modifier_eligible": True, "modifier_bounds": {"min": -0.05, "max": 0.05}},
            {"name": "liquidity_tier", "stage": "rank_modifier", "rank_modifier_eligible": True, "modifier_bounds": {"min": -0.05, "max": 0.05}},
            {"name": "risk_budget_state", "stage": "surfaced", "rank_modifier_eligible": False, "modifier_bounds": {"min": -0.05, "max": 0.05}},
        ],
    }
    registry_path.write_text(json.dumps(registry_payload, indent=2) + "\n", encoding="utf-8")
    state_path.write_text(json.dumps(state_payload, indent=2) + "\n", encoding="utf-8")
    monkeypatch.setenv("TRADING_OVERLAY_REGISTRY_PATH", str(registry_path))
    monkeypatch.setenv("TRADING_OVERLAY_PROMOTION_STATE_PATH", str(state_path))

    advisor = TradingAdvisor()
    advisor.risk_fetcher = MagicMock(get_snapshot=lambda: {})
    advisor.analyze_stock = MagicMock(
        return_value={
            "total_score": 8,
            "confidence": 74,
            "effective_confidence": 74,
            "technical_scores": {"pct_from_high": 95.0},
            "breakout_follow_through": {"score": 3},
            "exit_risk": {"score": 1},
            "recommendation": {"action": "WATCH", "reason": "constructive"},
        }
    )
    monkeypatch.setattr("advisor.load_symbol_context", lambda symbol: None)

    result = advisor.quick_check("NVDA")
    promotion = result["overlay_promotion"]["overlays"]
    assert promotion["execution_quality"]["allow_rank_modifier"] is True
    assert promotion["execution_quality"]["max_effect_pct"] == 0.05
