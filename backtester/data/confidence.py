"""Shared confidence, uncertainty, and trade-quality assessment helpers."""

from __future__ import annotations

from typing import Dict, Iterable, Optional

import pandas as pd

from data.adverse_regime import build_adverse_regime_indicator
from data.market_regime import MarketRegime, MarketStatus


REASON_MESSAGES = {
    "market_regime_degraded": "Market regime data is degraded.",
    "market_correction": "Market regime is a correction.",
    "symbol_data_stale": "Symbol price history is stale or degraded.",
    "insufficient_history": "Price history is insufficient for a reliable read.",
    "sentiment_unavailable": "Reliable sentiment inputs are unavailable.",
    "sentiment_conflict": "Sentiment inputs disagree.",
    "sector_unavailable": "Sector context is unavailable.",
    "catalyst_event_imminent": "A catalyst event is too close to trust sizing.",
    "signal_conflict": "Signal layers are materially conflicted.",
    "credit_veto": "Credit veto is active.",
    "falling_knife": "Falling-knife filter is active.",
    "risk_data_incomplete": "Risk inputs are incomplete.",
    "adverse_regime_stress": "Adverse market-stress ensemble is elevated.",
}


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def confidence_bucket(value: float) -> str:
    """Map effective confidence to a stable evaluation bucket."""
    if value >= 75:
        return "high"
    if value >= 55:
        return "medium"
    if value >= 35:
        return "low"
    return "very_low"


def _size_multiplier(
    effective_confidence_pct: float,
    uncertainty_pct: float,
    abstain: bool,
    adverse_regime_multiplier: float = 1.0,
) -> float:
    if abstain:
        return round(_clamp(0.5 * adverse_regime_multiplier, 0.3, 0.75), 2)

    if effective_confidence_pct >= 85:
        confidence_multiplier = 1.1
    elif effective_confidence_pct >= 75:
        confidence_multiplier = 1.0
    elif effective_confidence_pct >= 65:
        confidence_multiplier = 0.9
    elif effective_confidence_pct >= 55:
        confidence_multiplier = 0.78
    else:
        confidence_multiplier = 0.65

    if uncertainty_pct >= 35:
        uncertainty_multiplier = 0.72
    elif uncertainty_pct >= 25:
        uncertainty_multiplier = 0.82
    elif uncertainty_pct >= 15:
        uncertainty_multiplier = 0.92
    else:
        uncertainty_multiplier = 1.0

    return round(_clamp(confidence_multiplier * uncertainty_multiplier * adverse_regime_multiplier, 0.35, 1.1), 2)


def _safe_float(value: object, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def regime_quality_modifier(
    *,
    market: Optional[object] = None,
    regime: Optional[object] = None,
    position_sizing: Optional[object] = None,
) -> float:
    """Translate market posture into a bounded ranking modifier."""
    if market is not None:
        regime = getattr(market, "regime", regime)
        position_sizing = getattr(market, "position_sizing", position_sizing)

    modifier = 1.0
    if position_sizing is not None:
        modifier = _clamp(0.5 + (_safe_float(position_sizing, 1.0) * 0.5), 0.5, 1.0)

    if regime == MarketRegime.CORRECTION:
        modifier = min(modifier, 0.55)
    elif regime == MarketRegime.UPTREND_UNDER_PRESSURE:
        modifier = min(modifier, 0.82)

    return round(modifier, 2)


def downside_risk_proxy(prices: Optional[object]) -> Dict[str, float]:
    """Build a bounded downside-risk proxy from existing price history.

    This is intentionally simpler than true CVaR: we blend recent drawdown with
    the average of the worst daily losses so runtime ranking can penalize setups
    that have ugly left-tail behavior without adding a heavy portfolio model.
    """
    if prices is None:
        return {
            "penalty": 0.0,
            "drawdown_pct": 0.0,
            "tail_loss_pct": 0.0,
            "source": "unavailable",
        }

    series = pd.Series(prices).dropna().astype(float)
    if len(series) < 10:
        return {
            "penalty": 0.0,
            "drawdown_pct": 0.0,
            "tail_loss_pct": 0.0,
            "source": "insufficient_history",
        }

    window = series.tail(63)
    rolling_high = window.cummax().replace(0, pd.NA)
    drawdowns = ((window / rolling_high) - 1.0).fillna(0.0)
    drawdown_pct = abs(float(drawdowns.min()) * 100.0)

    returns = window.pct_change().dropna()
    negative_returns = returns[returns < 0]
    if negative_returns.empty:
        tail_loss_pct = 0.0
    else:
        worst_n = max(1, min(5, len(negative_returns)))
        tail_loss_pct = abs(float(negative_returns.nsmallest(worst_n).mean()) * 100.0)

    penalty = round(_clamp(drawdown_pct * 0.85 + tail_loss_pct * 2.0, 0.0, 25.0), 2)
    return {
        "penalty": penalty,
        "drawdown_pct": round(drawdown_pct, 2),
        "tail_loss_pct": round(tail_loss_pct, 2),
        "source": "63d_drawdown_tail_loss",
    }


def churn_penalty_proxy(*, exit_risk_score: object = None, recovery_ready: Optional[bool] = None, falling_knife: Optional[bool] = None) -> Dict[str, object]:
    """Build a bounded churn/flip-risk proxy from existing runtime signals."""
    reasons: list[str] = []
    penalty = 0.0

    if exit_risk_score is not None:
        exit_score = max(0.0, _safe_float(exit_risk_score, 0.0))
        if exit_score > 0:
            penalty += exit_score * 5.0
            reasons.append('exit_risk_score')

    if recovery_ready is not None and not bool(recovery_ready):
        penalty += 8.0
        reasons.append('recovery_not_confirmed')

    if falling_knife is not None and bool(falling_knife):
        penalty += 10.0
        reasons.append('falling_knife')

    return {
        "penalty": round(_clamp(penalty, 0.0, 25.0), 2),
        "reason": "+".join(reasons) if reasons else "none",
    }


def risk_adjusted_size_multiplier(*, downside_penalty: object = 0.0, churn_penalty: object = 0.0) -> float:
    """Translate runtime downside/churn penalties into a bounded size multiplier."""
    total_penalty = _clamp(_safe_float(downside_penalty, 0.0) + _safe_float(churn_penalty, 0.0), 0.0, 40.0)
    return round(_clamp(1.0 - (total_penalty / 50.0), 0.45, 1.0), 2)


def build_trade_quality_score(
    *,
    raw_setup_score: object,
    setup_scale: object,
    confidence_pct: object,
    uncertainty_pct: object,
    regime_modifier: object,
    cost_penalty: object = 0.0,
    cost_penalty_reason: str = "",
    downside_penalty: object = 0.0,
    downside_penalty_reason: str = "",
    churn_penalty: object = 0.0,
    churn_penalty_reason: str = "",
    adverse_regime_penalty: object = 0.0,
    adverse_regime_reason: str = "",
) -> Dict:
    """
    Build an explicit runtime trade-quality score from existing decision inputs.

    The score is only for ordering. Hard vetoes, abstain logic, and regime gates
    still determine BUY/WATCH/NO_BUY eligibility.
    """
    raw_setup_value = max(0.0, _safe_float(raw_setup_score, 0.0))
    setup_scale_value = max(1.0, _safe_float(setup_scale, 1.0))
    setup_component = round((raw_setup_value / setup_scale_value) * 55.0, 2)
    confidence_value = _clamp(_safe_float(confidence_pct, 0.0), 0.0, 100.0)
    uncertainty_value = _clamp(_safe_float(uncertainty_pct, 0.0), 0.0, 100.0)
    regime_value = _clamp(_safe_float(regime_modifier, 1.0), 0.4, 1.05)
    cost_value = _clamp(_safe_float(cost_penalty, 0.0), 0.0, 40.0)
    downside_value = _clamp(_safe_float(downside_penalty, 0.0), 0.0, 30.0)
    churn_value = _clamp(_safe_float(churn_penalty, 0.0), 0.0, 25.0)
    adverse_regime_value = _clamp(_safe_float(adverse_regime_penalty, 0.0), 0.0, 20.0)

    score = round(
        (setup_component + confidence_value - uncertainty_value - cost_value - downside_value - churn_value - adverse_regime_value)
        * regime_value,
        2,
    )

    return {
        "score": score,
        "setup_score": round(raw_setup_value, 2),
        "setup_scale": round(setup_scale_value, 2),
        "setup_component": setup_component,
        "confidence_pct": round(confidence_value, 2),
        "uncertainty_penalty": round(uncertainty_value, 2),
        "regime_modifier": round(regime_value, 2),
        "cost_penalty": round(cost_value, 2),
        "cost_penalty_reason": cost_penalty_reason,
        "downside_penalty": round(downside_value, 2),
        "downside_penalty_reason": downside_penalty_reason,
        "churn_penalty": round(churn_value, 2),
        "churn_penalty_reason": churn_penalty_reason,
        "adverse_regime_penalty": round(adverse_regime_value, 2),
        "adverse_regime_reason": adverse_regime_reason,
    }


def _normalize_codes(codes: Iterable[str]) -> list[str]:
    ordered: list[str] = []
    seen = set()
    for code in codes:
        if not code or code in seen:
            continue
        seen.add(code)
        ordered.append(code)
    return ordered


def _finalize_assessment(
    *,
    symbol: str,
    raw_confidence_pct: float,
    component_signal: Dict[str, int],
    component_uncertainty: Dict[str, int],
    data_quality: Dict[str, object],
    reason_codes: Iterable[str],
    adverse_regime: Optional[Dict[str, object]] = None,
) -> Dict:
    uncertainty_pct = int(
        _clamp(sum(max(0, int(value)) for value in component_uncertainty.values()), 0, 95)
    )
    effective_confidence_pct = int(_clamp(round(raw_confidence_pct) - uncertainty_pct, 0, 100))
    codes = _normalize_codes(reason_codes)
    abstain = uncertainty_pct >= 35 or effective_confidence_pct < 35
    if abstain and not codes:
        codes = ["signal_conflict"]
    adverse_regime = adverse_regime or build_adverse_regime_indicator(market=None)
    adverse_regime_multiplier = _clamp(_safe_float(adverse_regime.get("size_multiplier"), 1.0), 0.55, 1.0)

    return {
        "version": 1,
        "symbol": symbol,
        "raw_confidence_pct": int(_clamp(round(raw_confidence_pct), 0, 100)),
        "uncertainty_pct": uncertainty_pct,
        "effective_confidence_pct": effective_confidence_pct,
        "confidence_bucket": confidence_bucket(effective_confidence_pct),
        "size_multiplier": _size_multiplier(
            effective_confidence_pct,
            uncertainty_pct,
            abstain,
            adverse_regime_multiplier=adverse_regime_multiplier,
        ),
        "abstain": abstain,
        "abstain_reason_codes": codes if abstain else [],
        "abstain_reasons": [REASON_MESSAGES.get(code, code.replace("_", " ")) for code in codes] if abstain else [],
        "component_signal": component_signal,
        "component_uncertainty": component_uncertainty,
        "data_quality": data_quality,
        "adverse_regime": adverse_regime,
    }


def build_confidence_assessment(
    *,
    market: MarketStatus,
    total_score: int,
    breakout: Dict,
    sentiment_overlay: Dict,
    exit_risk: Dict,
    sector_context: Dict,
    catalyst_weighting: Dict,
    data_status: str,
    data_staleness_seconds: float,
    history_bars: int,
    symbol: str,
) -> Dict:
    """Build a shared CANSLIM confidence/uncertainty assessment."""
    breakout_score = int((breakout or {}).get("score", 0))
    sentiment_score = int((sentiment_overlay or {}).get("score", 0))
    exit_risk_score = int((exit_risk or {}).get("score", 0))
    sector_score = int((sector_context or {}).get("score", 0))
    catalyst_score = int((catalyst_weighting or {}).get("score", 0))
    sentiment_delta = int((sentiment_overlay or {}).get("confidence_delta", 0))
    sector_delta = int((sector_context or {}).get("confidence_delta", 0))
    catalyst_delta = int((catalyst_weighting or {}).get("confidence_delta", 0))

    raw_confidence_pct = _clamp(
        28
        + total_score * 5
        + breakout_score * 6
        + sentiment_delta
        - exit_risk_score * 7
        + sector_delta
        + catalyst_delta,
        5,
        95,
    )

    market_penalty = 0
    reason_codes: list[str] = []
    if getattr(market, "status", "ok") == "degraded":
        market_penalty += 10
        if float(getattr(market, "snapshot_age_seconds", 0.0) or 0.0) >= 1800:
            market_penalty += 4
        reason_codes.append("market_regime_degraded")

    stale_penalty = 0
    if data_status != "ok":
        stale_penalty += 6
    if data_staleness_seconds >= 3600:
        stale_penalty += 10
    elif data_staleness_seconds >= 900:
        stale_penalty += 6
    elif data_staleness_seconds >= 300:
        stale_penalty += 3
    if stale_penalty:
        reason_codes.append("symbol_data_stale")

    history_penalty = 0
    if history_bars < 50:
        history_penalty = 20
    elif history_bars < 126:
        history_penalty = 10
    elif history_bars < 200:
        history_penalty = 4
    if history_penalty:
        reason_codes.append("insufficient_history")

    sentiment_unavailable_penalty = 0
    sentiment_conflict_penalty = 0
    sentiment_source = (sentiment_overlay or {}).get("source", "none")
    sentiment_reason = str((sentiment_overlay or {}).get("reason", "")).lower()
    if sentiment_source == "none":
        sentiment_unavailable_penalty = 6
        reason_codes.append("sentiment_unavailable")
    elif "disagree" in sentiment_reason:
        sentiment_conflict_penalty = 8
        reason_codes.append("sentiment_conflict")

    sector_penalty = 0
    if (sector_context or {}).get("status") in {"unavailable", "unmapped", "insufficient"}:
        sector_penalty = 5
        reason_codes.append("sector_unavailable")

    event_penalty = 0
    if catalyst_score <= -2:
        event_penalty = 10
    elif catalyst_score < 0:
        event_penalty = 6
    if event_penalty:
        reason_codes.append("catalyst_event_imminent")

    signal_conflict_penalty = 0
    if total_score >= 8 and exit_risk_score >= 3:
        signal_conflict_penalty += 8
    if total_score >= 8 and sector_score < 0:
        signal_conflict_penalty += 4
    if sentiment_score > 0 and breakout_score <= 1:
        signal_conflict_penalty += 4
    if sentiment_score < 0 and breakout_score >= 4:
        signal_conflict_penalty += 4
    if sector_score < 0 and catalyst_score < 0 and total_score >= 7:
        signal_conflict_penalty += 4
    if signal_conflict_penalty:
        reason_codes.append("signal_conflict")

    if getattr(market, "regime", None) == MarketRegime.CORRECTION:
        reason_codes.append("market_correction")
    adverse_regime = build_adverse_regime_indicator(market=market)
    adverse_regime_penalty = int(adverse_regime["confidence_penalty"])
    if adverse_regime_penalty:
        reason_codes.append("adverse_regime_stress")

    component_signal = {
        "total_score": int(total_score),
        "breakout_score": breakout_score,
        "sentiment_score": sentiment_score,
        "sector_score": sector_score,
        "catalyst_score": catalyst_score,
        "exit_risk_score": exit_risk_score,
    }
    component_uncertainty = {
        "market_data_degraded": market_penalty,
        "symbol_data_stale": stale_penalty,
        "insufficient_history": history_penalty,
        "sentiment_unavailable": sentiment_unavailable_penalty,
        "sentiment_conflict": sentiment_conflict_penalty,
        "sector_unavailable": sector_penalty,
        "event_risk": event_penalty,
        "signal_conflict": signal_conflict_penalty,
        "adverse_regime": adverse_regime_penalty,
    }
    data_quality = {
        "history_status": data_status,
        "history_staleness_seconds": float(data_staleness_seconds or 0.0),
        "market_status": getattr(market, "status", "ok"),
        "market_snapshot_age_seconds": float(getattr(market, "snapshot_age_seconds", 0.0) or 0.0),
    }

    return _finalize_assessment(
        symbol=symbol,
        raw_confidence_pct=raw_confidence_pct,
        component_signal=component_signal,
        component_uncertainty=component_uncertainty,
        data_quality=data_quality,
        reason_codes=reason_codes,
        adverse_regime=adverse_regime,
    )


def build_dip_confidence_assessment(
    *,
    symbol: str,
    market: MarketStatus,
    total_score: int,
    q_score: int,
    v_score: int,
    c_score: int,
    market_active: bool,
    credit_veto: bool,
    recovery_ready: bool,
    falling_knife: bool,
    risk_inputs: Optional[Dict[str, object]] = None,
    data_status: str = "ok",
    data_staleness_seconds: float = 0.0,
    history_bars: int = 0,
) -> Dict:
    """Build a Dip Buyer confidence assessment with the shared contract."""
    raw_confidence_pct = _clamp(
        24
        + total_score * 6
        + (6 if recovery_ready else -8)
        + (4 if market_active else -12)
        - (10 if falling_knife else 0)
        - (18 if credit_veto else 0),
        5,
        95,
    )

    market_penalty = 0
    reason_codes: list[str] = []
    if getattr(market, "status", "ok") == "degraded":
        market_penalty += 10
        reason_codes.append("market_regime_degraded")

    stale_penalty = 0
    if data_status != "ok":
        stale_penalty += 6
    if data_staleness_seconds >= 3600:
        stale_penalty += 10
    elif data_staleness_seconds >= 900:
        stale_penalty += 6
    elif data_staleness_seconds >= 300:
        stale_penalty += 3
    if stale_penalty:
        reason_codes.append("symbol_data_stale")

    history_penalty = 0
    if history_bars < 30:
        history_penalty = 16
    elif history_bars < 60:
        history_penalty = 6
    if history_penalty:
        reason_codes.append("insufficient_history")

    risk_penalty = 0
    if risk_inputs:
        missing_count = sum(1 for value in risk_inputs.values() if value is None)
        risk_penalty = min(missing_count * 4, 12)
        if risk_penalty:
            reason_codes.append("risk_data_incomplete")

    structure_penalty = 0
    if credit_veto:
        structure_penalty += 22
        reason_codes.append("credit_veto")
    if falling_knife:
        structure_penalty += 18
        reason_codes.append("falling_knife")
    if not market_active and getattr(market, "regime", None) == MarketRegime.CORRECTION:
        reason_codes.append("market_correction")
    adverse_regime = build_adverse_regime_indicator(market=market, risk_inputs=risk_inputs)
    adverse_regime_penalty = int(adverse_regime["confidence_penalty"])
    if adverse_regime_penalty:
        reason_codes.append("adverse_regime_stress")

    component_signal = {
        "total_score": int(total_score),
        "q_score": int(q_score),
        "v_score": int(v_score),
        "c_score": int(c_score),
        "market_active": int(bool(market_active)),
        "recovery_ready": int(bool(recovery_ready)),
    }
    component_uncertainty = {
        "market_data_degraded": market_penalty,
        "symbol_data_stale": stale_penalty,
        "insufficient_history": history_penalty,
        "risk_data_incomplete": risk_penalty,
        "signal_conflict": structure_penalty,
        "adverse_regime": adverse_regime_penalty,
    }
    data_quality = {
        "history_status": data_status,
        "history_staleness_seconds": float(data_staleness_seconds or 0.0),
        "market_status": getattr(market, "status", "ok"),
        "market_snapshot_age_seconds": float(getattr(market, "snapshot_age_seconds", 0.0) or 0.0),
    }

    return _finalize_assessment(
        symbol=symbol,
        raw_confidence_pct=raw_confidence_pct,
        component_signal=component_signal,
        component_uncertainty=component_uncertainty,
        data_quality=data_quality,
        reason_codes=reason_codes,
        adverse_regime=adverse_regime,
    )
