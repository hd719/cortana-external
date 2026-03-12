"""Shared adverse-regime ensemble over existing market stress inputs."""

from __future__ import annotations

from typing import Dict, Optional

from data.market_regime import MarketRegime


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _safe_float(value: object, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def build_adverse_regime_indicator(
    *,
    market: Optional[object],
    risk_inputs: Optional[Dict[str, object]] = None,
) -> Dict[str, object]:
    """Collapse existing market stress signals into one bounded runtime feature."""
    if market is None:
        return {
            "score": 0.0,
            "label": "normal",
            "reason": "market stress inputs unavailable",
            "reason_components": [],
            "components": [],
            "confidence_penalty": 0,
            "trade_quality_penalty": 0.0,
            "size_multiplier": 1.0,
            "source": "unavailable",
        }

    components: list[Dict[str, object]] = []

    def add_component(name: str, score: float, detail: str) -> None:
        if score <= 0:
            return
        components.append({"name": name, "score": round(score, 2), "detail": detail})

    regime = getattr(market, "regime", None)
    position_sizing = _clamp(_safe_float(getattr(market, "position_sizing", 1.0), 1.0), 0.0, 1.0)
    distribution_days = max(0, int(round(_safe_float(getattr(market, "distribution_days", 0), 0.0))))
    drawdown_pct = _safe_float(getattr(market, "drawdown_pct", 0.0), 0.0)
    drawdown_pct = -abs(drawdown_pct) if drawdown_pct > 0 else drawdown_pct
    trend_direction = str(getattr(market, "trend_direction", "sideways") or "sideways").lower()
    price_vs_21d_pct = _safe_float(getattr(market, "price_vs_21d_pct", 0.0), 0.0)
    price_vs_50d_pct = _safe_float(getattr(market, "price_vs_50d_pct", 0.0), 0.0)

    if regime == MarketRegime.CORRECTION:
        add_component("regime", 28.0, "market regime: correction")
    elif regime == MarketRegime.UPTREND_UNDER_PRESSURE:
        add_component("regime", 12.0, "market regime: uptrend under pressure")
    elif regime == MarketRegime.RALLY_ATTEMPT:
        add_component("regime", 8.0, "market regime: rally attempt")

    sizing_stress = round((1.0 - position_sizing) * 10.0, 2)
    if sizing_stress >= 1.0:
        add_component("position_sizing", sizing_stress, f"position sizing capped at {position_sizing:.0%}")

    if distribution_days >= 6:
        add_component("distribution_days", 13.0, f"{distribution_days} recent distribution days")
    elif distribution_days == 5:
        add_component("distribution_days", 9.0, "5 recent distribution days")
    elif distribution_days >= 3:
        add_component("distribution_days", 5.0, f"{distribution_days} recent distribution days")

    if drawdown_pct <= -10:
        add_component("drawdown", 12.0, f"{abs(drawdown_pct):.1f}% drawdown from recent high")
    elif drawdown_pct <= -6:
        add_component("drawdown", 8.0, f"{abs(drawdown_pct):.1f}% drawdown from recent high")
    elif drawdown_pct <= -3:
        add_component("drawdown", 4.0, f"{abs(drawdown_pct):.1f}% drawdown from recent high")

    if trend_direction == "down":
        add_component("trend", 6.0, "trend direction remains down")
    elif trend_direction == "sideways" and regime != MarketRegime.CONFIRMED_UPTREND:
        add_component("trend", 2.0, "trend direction is still sideways")

    if price_vs_21d_pct < 0:
        add_component("price_vs_21d", 2.0, "index is below the 21-day trend")
    if price_vs_50d_pct < 0:
        add_component("price_vs_50d", 4.0, "index is below the 50-day trend")

    macro_components: list[Dict[str, object]] = []
    risk_inputs = risk_inputs or {}
    vix_percentile = _safe_float(risk_inputs.get("vix_percentile"), float("nan"))
    hy_percentile = _safe_float(risk_inputs.get("hy_spread_percentile"), float("nan"))
    hy_spread = _safe_float(risk_inputs.get("hy_spread"), float("nan"))
    fear_greed = _safe_float(risk_inputs.get("fear_greed"), float("nan"))
    hy_change_10d = _safe_float(risk_inputs.get("hy_spread_change_10d"), float("nan"))

    if vix_percentile == vix_percentile:
        if vix_percentile >= 85:
            macro_components.append({"name": "vix_percentile", "score": 6.0, "detail": "VIX percentile is stretched"})
        elif vix_percentile >= 70:
            macro_components.append({"name": "vix_percentile", "score": 4.0, "detail": "VIX percentile is elevated"})

    hy_stress_score = 0.0
    hy_stress_detail = ""
    if hy_percentile == hy_percentile:
        if hy_percentile >= 85:
            hy_stress_score, hy_stress_detail = 6.0, "HY spread percentile is stressed"
        elif hy_percentile >= 70:
            hy_stress_score, hy_stress_detail = 4.0, "HY spread percentile is elevated"
    elif hy_spread == hy_spread:
        if hy_spread >= 650:
            hy_stress_score, hy_stress_detail = 6.0, "HY spreads are in veto territory"
        elif hy_spread >= 550:
            hy_stress_score, hy_stress_detail = 4.0, "HY spreads remain wide"
    if hy_stress_score > 0:
        macro_components.append({"name": "hy_spread", "score": hy_stress_score, "detail": hy_stress_detail})

    if fear_greed == fear_greed:
        if fear_greed >= 75:
            macro_components.append({"name": "fear_greed", "score": 4.0, "detail": "fear proxy remains elevated"})
        elif fear_greed >= 60:
            macro_components.append({"name": "fear_greed", "score": 2.0, "detail": "fear proxy is leaning risk-off"})

    if hy_change_10d == hy_change_10d:
        if hy_change_10d >= 75:
            macro_components.append({"name": "hy_spread_change_10d", "score": 4.0, "detail": "HY spreads are widening fast"})
        elif hy_change_10d >= 40:
            macro_components.append({"name": "hy_spread_change_10d", "score": 2.0, "detail": "HY spreads are still widening"})

    macro_total = min(sum(float(item["score"]) for item in macro_components), 12.0)
    if macro_total > 0:
        macro_detail = "; ".join(str(item["detail"]) for item in macro_components[:2])
        add_component("macro", macro_total, macro_detail)

    ordered_components = sorted(components, key=lambda item: float(item["score"]), reverse=True)
    score = round(_clamp(sum(float(item["score"]) for item in ordered_components), 0.0, 100.0), 2)

    if score >= 55:
        label = "severe"
    elif score >= 35:
        label = "elevated"
    elif score >= 18:
        label = "caution"
    else:
        label = "normal"

    reason_components = [str(item["detail"]) for item in ordered_components[:4]]
    reason = "; ".join(reason_components) if reason_components else "market backdrop is not showing elevated stress"

    return {
        "score": score,
        "label": label,
        "reason": reason,
        "reason_components": reason_components,
        "components": ordered_components,
        "confidence_penalty": int(round(_clamp(score / 4.0, 0.0, 18.0))),
        "trade_quality_penalty": round(_clamp(score / 7.0, 0.0, 12.0), 2),
        "size_multiplier": round(_clamp(1.0 - (score / 120.0), 0.55, 1.0), 2),
        "source": "market_status_plus_macro" if risk_inputs else "market_status",
    }
