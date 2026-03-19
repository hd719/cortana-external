#!/usr/bin/env python3
"""Paper-only experimental alpha pipeline using quick-check + Polymarket context.

This module is intentionally isolated from the production alert path.
It does not place trades or mutate any runtime production artifacts.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterable, Optional, Sequence

import pandas as pd

from advisor import TradingAdvisor
from data.market_data_provider import MarketDataProvider
from data.overlay_promotion import (
    DEFAULT_PROMOTION_STATE_PATH,
    DEFAULT_REGISTRY_PATH,
    evaluate_registry_promotions,
    load_overlay_registry,
    save_overlay_promotion_state,
)
from data.polymarket_context import load_structured_context
from outcomes import summarize_forward_return_by_dimension
from reports.overlay_attribution import (
    build_overlay_attribution_report,
    format_overlay_attribution_compact,
)

VERDICT_BASE_PROB = {
    "actionable": 0.58,
    "needs confirmation": 0.54,
    "early / interesting": 0.515,
    "extended": 0.47,
    "manage winners / exhaustion risk": 0.46,
    "avoid for now": 0.42,
}

SEVERITY_ADJ = {"minor": 0.0, "notable": 0.02, "major": 0.04}
PERSISTENCE_ADJ = {"one_off": 0.0, "persistent": 0.015, "accelerating": 0.03, "reversing": -0.02}
CONVICTION_ADJ = {"supportive": 0.02, "neutral": 0.0, "conflicting": -0.03}
DIVERGENCE_ADJ = {"none": 0.0, "watch": -0.015, "persistent": -0.03}
DEFAULT_HORIZONS = (1, 5, 10)
DEFAULT_ATTRIBUTION_ARTIFACT_PATH = Path(__file__).resolve().parent / "data" / "cache" / "overlay-attribution-latest.json"


@dataclass
class AlphaCandidate:
    symbol: str
    provider_symbol: str
    asset_class: str
    verdict: str
    base_action: str
    confidence_pct: int
    conviction: str
    divergence_state: str
    severity: str
    persistence: str
    calibrated_prob: float
    edge: float
    kelly_fraction: float
    expected_move_bps: int
    paper_action: str
    entry_price: float | None
    rationale: str
    risk_budget_state: str = "unknown"
    aggression_posture: str = "unknown"
    execution_quality: str = "unknown"
    liquidity_tier: str = "unknown"
    spread_bps: float | None = None
    slippage_bps: float | None = None
    avg_dollar_volume_musd: float | None = None
    overlay_notes: str = ""


@dataclass
class AlphaSnapshot:
    generated_at: str
    candidates: list[AlphaCandidate]


@dataclass
class SettledAlphaCandidate:
    generated_at: str
    symbol: str
    provider_symbol: str
    asset_class: str
    paper_action: str
    verdict: str
    conviction: str
    divergence_state: str
    severity: str
    persistence: str
    calibrated_prob: float
    edge: float
    kelly_fraction: float
    entry_price: float | None
    forward_returns: dict[str, float | None]
    settled_horizons: list[int]
    realized_label: str
    settled_at: str
    rationale: str
    risk_budget_state: str = "unknown"
    aggression_posture: str = "unknown"
    execution_quality: str = "unknown"
    liquidity_tier: str = "unknown"
    spread_bps: float | None = None
    slippage_bps: float | None = None
    avg_dollar_volume_musd: float | None = None
    overlay_notes: str = ""


@dataclass
class ActionCalibration:
    action: str
    count: int
    hit_rate_5d: float | None
    avg_return_5d: float | None
    avg_return_10d: float | None
    brier_5d: float | None


@dataclass
class OverlaySliceCalibration:
    dimension: str
    bucket: str
    count: int
    matured_count: int
    hit_rate_5d: float | None
    avg_return_5d: float | None


@dataclass
class PromotionGate:
    status: str
    reasons: list[str]
    minimum_samples: int
    paper_long_count: int
    paper_long_hit_rate_5d: float | None
    paper_long_avg_return_5d: float | None
    paper_long_brier_5d: float | None


@dataclass
class CalibrationReport:
    generated_at: str
    settled_candidates: int
    by_action: list[ActionCalibration]
    gate: PromotionGate
    overlay_slices: list[OverlaySliceCalibration] = field(default_factory=list)


def derive_alpha_candidate(result: dict, *, max_kelly_fraction: float = 0.08) -> AlphaCandidate:
    analysis = result.get("analysis", {}) or {}
    recommendation = analysis.get("recommendation", {}) or {}
    polymarket = result.get("polymarket", {}) or {}
    matched = polymarket.get("matched", {}) if isinstance(polymarket.get("matched"), dict) else {}

    verdict = str(result.get("verdict", "avoid for now"))
    base_prob = VERDICT_BASE_PROB.get(verdict, 0.45)
    confidence_pct = int(
        analysis.get("effective_confidence", analysis.get("confidence", recommendation.get("confidence", 0))) or 0
    )
    confidence_adj = max(min((confidence_pct - 50) / 1000.0, 0.03), -0.03)

    conviction = str(polymarket.get("conviction", "neutral") or "neutral")
    divergence_state = str(polymarket.get("divergence_state", "none") or "none")
    severity = str(matched.get("severity", "minor") or "minor")
    persistence = str(matched.get("persistence", "one_off") or "one_off")

    calibrated_prob = base_prob
    calibrated_prob += SEVERITY_ADJ.get(severity, 0.0)
    calibrated_prob += PERSISTENCE_ADJ.get(persistence, 0.0)
    calibrated_prob += CONVICTION_ADJ.get(conviction, 0.0)
    calibrated_prob += DIVERGENCE_ADJ.get(divergence_state, 0.0)
    calibrated_prob += confidence_adj
    calibrated_prob = round(min(max(calibrated_prob, 0.05), 0.95), 4)

    edge = round(calibrated_prob - 0.5, 4)
    kelly_fraction = round(min(max(2 * calibrated_prob - 1, 0.0), max_kelly_fraction), 4)

    expected_move_bps = expected_move_bps_for_candidate(
        asset_class=str(result.get("asset_class", "stock")),
        severity=severity,
        persistence=persistence,
        conviction=conviction,
    )
    paper_action = classify_paper_action(verdict, calibrated_prob, conviction, divergence_state)
    overlay = extract_overlay_dimensions(
        result,
        analysis=analysis,
        recommendation=recommendation,
        polymarket=polymarket,
    )
    rationale = build_rationale(
        verdict=verdict,
        conviction=conviction,
        divergence_state=divergence_state,
        severity=severity,
        persistence=persistence,
    )

    entry_price = safe_float(analysis.get("price", recommendation.get("entry")))

    return AlphaCandidate(
        symbol=str(result.get("symbol", "")),
        provider_symbol=str(result.get("provider_symbol", result.get("symbol", ""))),
        asset_class=str(result.get("asset_class", "stock")),
        verdict=verdict,
        base_action=str(recommendation.get("action", "N/A")),
        confidence_pct=confidence_pct,
        conviction=conviction,
        divergence_state=divergence_state,
        severity=severity,
        persistence=persistence,
        calibrated_prob=calibrated_prob,
        edge=edge,
        kelly_fraction=kelly_fraction,
        expected_move_bps=expected_move_bps,
        paper_action=paper_action,
        entry_price=entry_price,
        rationale=rationale,
        risk_budget_state=str(overlay["risk_budget_state"]),
        aggression_posture=str(overlay["aggression_posture"]),
        execution_quality=str(overlay["execution_quality"]),
        liquidity_tier=str(overlay["liquidity_tier"]),
        spread_bps=safe_float(overlay.get("spread_bps")),
        slippage_bps=safe_float(overlay.get("slippage_bps")),
        avg_dollar_volume_musd=safe_float(overlay.get("avg_dollar_volume_musd")),
        overlay_notes=str(overlay.get("overlay_notes", "")),
    )


def expected_move_bps_for_candidate(*, asset_class: str, severity: str, persistence: str, conviction: str) -> int:
    base = 140 if asset_class in {"crypto", "crypto_proxy"} else 90
    sev_mult = {"minor": 1.0, "notable": 1.4, "major": 1.8}.get(severity, 1.0)
    persist_mult = {"one_off": 1.0, "persistent": 1.15, "accelerating": 1.35, "reversing": 0.8}.get(
        persistence,
        1.0,
    )
    conviction_mult = {"supportive": 1.1, "neutral": 1.0, "conflicting": 0.8}.get(conviction, 1.0)
    return int(round(base * sev_mult * persist_mult * conviction_mult))


def classify_paper_action(verdict: str, calibrated_prob: float, conviction: str, divergence_state: str) -> str:
    if conviction == "conflicting" and divergence_state == "persistent":
        return "skip"
    if verdict == "actionable" and calibrated_prob >= 0.57:
        return "paper_long"
    if verdict in {"needs confirmation", "early / interesting"} and calibrated_prob >= 0.54:
        return "track"
    if verdict in {"extended", "manage winners / exhaustion risk"}:
        return "reduce_or_wait"
    return "skip"


def build_rationale(*, verdict: str, conviction: str, divergence_state: str, severity: str, persistence: str) -> str:
    return (
        f"{verdict}; conviction {conviction}; divergence {divergence_state}; "
        f"signal {severity}; persistence {persistence}"
    )


def extract_overlay_dimensions(
    result: dict,
    *,
    analysis: dict,
    recommendation: dict,
    polymarket: dict,
) -> dict[str, object]:
    risk_overlay = first_overlay_dict(
        result.get("risk_budget_overlay"),
        analysis.get("risk_budget_overlay"),
        recommendation.get("risk_budget_overlay"),
        result.get("risk_budget"),
        analysis.get("risk_budget"),
        recommendation.get("risk_budget"),
    )
    execution_overlay = first_overlay_dict(
        result.get("execution_quality_overlay"),
        analysis.get("execution_quality_overlay"),
        recommendation.get("execution_quality_overlay"),
        result.get("liquidity_quality_overlay"),
        analysis.get("liquidity_quality_overlay"),
        recommendation.get("liquidity_quality_overlay"),
        result.get("execution_quality"),
        analysis.get("execution_quality"),
        recommendation.get("execution_quality"),
        result.get("liquidity_quality"),
        analysis.get("liquidity_quality"),
        recommendation.get("liquidity_quality"),
    )

    risk_budget_state = coerce_bucket(
        first_non_empty(
            risk_overlay.get("state") if risk_overlay else None,
            risk_overlay.get("status") if risk_overlay else None,
            risk_overlay.get("label") if risk_overlay else None,
            result.get("risk_budget_state"),
            analysis.get("risk_budget_state"),
            recommendation.get("risk_budget_state"),
        ),
        fallback="unknown",
    )
    aggression_posture = coerce_bucket(
        first_non_empty(
            risk_overlay.get("aggression_posture") if risk_overlay else None,
            risk_overlay.get("aggression") if risk_overlay else None,
            result.get("aggression_posture"),
            analysis.get("aggression_posture"),
            recommendation.get("aggression_posture"),
            polymarket.get("aggression_dial"),
        ),
        fallback="unknown",
    )
    execution_quality = coerce_bucket(
        first_non_empty(
            execution_overlay.get("quality") if execution_overlay else None,
            execution_overlay.get("status") if execution_overlay else None,
            execution_overlay.get("tier") if execution_overlay else None,
            execution_overlay.get("label") if execution_overlay else None,
            result.get("execution_quality"),
            analysis.get("execution_quality"),
            recommendation.get("execution_quality"),
        ),
        fallback="unknown",
    )
    liquidity_tier = coerce_bucket(
        first_non_empty(
            execution_overlay.get("liquidity_tier") if execution_overlay else None,
            execution_overlay.get("liquidity") if execution_overlay else None,
            execution_overlay.get("liquidity_label") if execution_overlay else None,
            result.get("liquidity_tier"),
            analysis.get("liquidity_tier"),
            recommendation.get("liquidity_tier"),
        ),
        fallback="unknown",
    )

    spread_bps = first_float(
        execution_overlay.get("spread_bps") if execution_overlay else None,
        execution_overlay.get("estimated_spread_bps") if execution_overlay else None,
        result.get("spread_bps"),
        analysis.get("spread_bps"),
        recommendation.get("spread_bps"),
    )
    slippage_bps = first_float(
        execution_overlay.get("slippage_bps") if execution_overlay else None,
        execution_overlay.get("estimated_slippage_bps") if execution_overlay else None,
        result.get("slippage_bps"),
        analysis.get("slippage_bps"),
        recommendation.get("slippage_bps"),
    )
    avg_dollar_volume = first_float(
        execution_overlay.get("avg_dollar_volume") if execution_overlay else None,
        execution_overlay.get("avg_dollar_volume_20d") if execution_overlay else None,
        execution_overlay.get("adv_usd") if execution_overlay else None,
        result.get("avg_dollar_volume"),
        analysis.get("avg_dollar_volume"),
        recommendation.get("avg_dollar_volume"),
    )
    avg_dollar_volume_musd = round(avg_dollar_volume / 1_000_000.0, 2) if avg_dollar_volume is not None else None

    notes: list[str] = []
    if spread_bps is not None:
        notes.append(f"spread {spread_bps:.1f}bp")
    if slippage_bps is not None:
        notes.append(f"slip {slippage_bps:.1f}bp")
    if avg_dollar_volume_musd is not None:
        notes.append(f"adv ${avg_dollar_volume_musd:.1f}M")

    return {
        "risk_budget_state": risk_budget_state,
        "aggression_posture": aggression_posture,
        "execution_quality": execution_quality,
        "liquidity_tier": liquidity_tier,
        "spread_bps": spread_bps,
        "slippage_bps": slippage_bps,
        "avg_dollar_volume_musd": avg_dollar_volume_musd,
        "overlay_notes": "; ".join(notes),
    }


def default_research_symbols(limit_per_bucket: int = 3) -> list[str]:
    report = load_structured_context()
    if report is None:
        return []

    buckets = report.get("watchlistBuckets", {})
    symbols: list[str] = []
    for key in ("stocks", "cryptoProxies", "crypto"):
        entries = buckets.get(key, [])
        if not isinstance(entries, list):
            continue
        for item in entries[:limit_per_bucket]:
            symbol = str(item.get("symbol", "")).strip().upper()
            if symbol and symbol not in symbols:
                symbols.append(symbol)
    return symbols


def build_alpha_report(symbols: Iterable[str], advisor: Optional[TradingAdvisor] = None) -> list[AlphaCandidate]:
    advisor = advisor or TradingAdvisor()
    candidates: list[AlphaCandidate] = []
    for symbol in symbols:
        result = advisor.quick_check(symbol)
        candidates.append(derive_alpha_candidate(result))

    return sorted(
        candidates,
        key=lambda item: (item.paper_action != "paper_long", -item.edge, -item.expected_move_bps, item.symbol),
    )


def format_alpha_report(candidates: list[AlphaCandidate]) -> str:
    if not candidates:
        return "Experimental alpha report\nNo fresh candidates surfaced from the current Polymarket context."

    lines = ["Experimental alpha report", "Paper-only research output"]
    for candidate in candidates:
        lines.append(
            f"- {candidate.symbol}: {candidate.paper_action} | {candidate.verdict} | "
            f"p={candidate.calibrated_prob:.3f} | edge={candidate.edge:+.3f} | "
            f"kelly={candidate.kelly_fraction:.3f} | move={candidate.expected_move_bps}bps | "
            f"overlay {candidate.risk_budget_state}/{candidate.aggression_posture} + "
            f"{candidate.execution_quality}/{candidate.liquidity_tier}"
            + (f" ({candidate.overlay_notes})" if candidate.overlay_notes else "")
            + f" | {candidate.rationale}"
        )
    return "\n".join(lines)


def default_alpha_root() -> Path:
    return Path(__file__).resolve().parent / ".cache" / "experimental_alpha"


def snapshots_dir(root: Optional[Path] = None) -> Path:
    return (root or default_alpha_root()) / "snapshots"


def settled_dir(root: Optional[Path] = None) -> Path:
    return (root or default_alpha_root()) / "settled"


def persist_alpha_snapshot(
    candidates: Sequence[AlphaCandidate],
    *,
    generated_at: Optional[datetime] = None,
    root: Optional[Path] = None,
) -> Path:
    generated_at = normalize_datetime(generated_at or datetime.now(UTC))
    snapshot = AlphaSnapshot(generated_at=generated_at.isoformat(), candidates=list(candidates))
    directory = snapshots_dir(root)
    directory.mkdir(parents=True, exist_ok=True)
    file_path = directory / f"{sanitize_timestamp(snapshot.generated_at)}.json"
    latest_path = directory / "latest.json"
    write_atomic_json(file_path, asdict(snapshot))
    write_atomic_json(latest_path, asdict(snapshot))
    return file_path


def load_alpha_snapshots(root: Optional[Path] = None) -> list[AlphaSnapshot]:
    directory = snapshots_dir(root)
    if not directory.exists():
        return []

    snapshots: list[AlphaSnapshot] = []
    for path in sorted(directory.glob("*.json")):
        if path.name == "latest.json":
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            snapshots.append(
                AlphaSnapshot(
                    generated_at=str(payload["generated_at"]),
                    candidates=[AlphaCandidate(**item) for item in payload.get("candidates", [])],
                )
            )
        except Exception:
            continue
    return snapshots


def settle_alpha_snapshots(
    *,
    root: Optional[Path] = None,
    now: Optional[datetime] = None,
    market_data: Optional[MarketDataProvider] = None,
    horizons: Sequence[int] = DEFAULT_HORIZONS,
) -> list[SettledAlphaCandidate]:
    """Settle persisted paper candidates against later price history.

    Semantics:
    - entry is anchored to the first trading bar at or after the snapshot timestamp
    - horizon labels like ``1d``/``5d``/``10d`` mean trading-bar offsets, not calendar days
    - runs can include partially matured snapshots; unavailable forward horizons remain ``None``
    """
    root = root or default_alpha_root()
    now = normalize_datetime(now or datetime.now(UTC))
    market_data = market_data or MarketDataProvider(provider_order="yahoo")
    settled_records: list[SettledAlphaCandidate] = []
    price_cache: dict[str, pd.DataFrame] = {}
    out_dir = settled_dir(root)
    out_dir.mkdir(parents=True, exist_ok=True)

    for snapshot in load_alpha_snapshots(root):
        generated_at = normalize_datetime(parse_timestamp(snapshot.generated_at))
        settled_candidates: list[SettledAlphaCandidate] = []

        for candidate in snapshot.candidates:
            provider_symbol = candidate.provider_symbol or candidate.symbol
            if provider_symbol not in price_cache:
                history = market_data.get_history(provider_symbol, period="2y", auto_adjust=False)
                price_cache[provider_symbol] = history.frame

            forward_returns = evaluate_forward_returns(
                price_cache[provider_symbol],
                as_of=generated_at,
                entry_price=candidate.entry_price,
                horizons=horizons,
            )
            settled_horizons = [
                horizon for horizon in horizons if forward_returns.get(f"{horizon}d") is not None
            ]
            realized_label = classify_realized_label(
                paper_action=candidate.paper_action,
                forward_returns=forward_returns,
            )
            settled_candidates.append(
                SettledAlphaCandidate(
                    generated_at=snapshot.generated_at,
                    symbol=candidate.symbol,
                    provider_symbol=provider_symbol,
                    asset_class=candidate.asset_class,
                    paper_action=candidate.paper_action,
                    verdict=candidate.verdict,
                    conviction=candidate.conviction,
                    divergence_state=candidate.divergence_state,
                    severity=candidate.severity,
                    persistence=candidate.persistence,
                    calibrated_prob=candidate.calibrated_prob,
                    edge=candidate.edge,
                    kelly_fraction=candidate.kelly_fraction,
                    entry_price=candidate.entry_price,
                    forward_returns=forward_returns,
                    settled_horizons=settled_horizons,
                    realized_label=realized_label,
                    settled_at=now.isoformat(),
                    rationale=candidate.rationale,
                    risk_budget_state=candidate.risk_budget_state,
                    aggression_posture=candidate.aggression_posture,
                    execution_quality=candidate.execution_quality,
                    liquidity_tier=candidate.liquidity_tier,
                    spread_bps=candidate.spread_bps,
                    slippage_bps=candidate.slippage_bps,
                    avg_dollar_volume_musd=candidate.avg_dollar_volume_musd,
                    overlay_notes=candidate.overlay_notes,
                )
            )

        payload = {
            "generated_at": snapshot.generated_at,
            "settled_at": now.isoformat(),
            "candidates": [asdict(item) for item in settled_candidates],
        }
        file_path = out_dir / f"{sanitize_timestamp(snapshot.generated_at)}.json"
        write_atomic_json(file_path, payload)
        write_atomic_json(out_dir / "latest.json", payload)
        settled_records.extend(settled_candidates)

    return settled_records


def load_settled_alpha(root: Optional[Path] = None) -> list[SettledAlphaCandidate]:
    directory = settled_dir(root)
    if not directory.exists():
        return []

    records: list[SettledAlphaCandidate] = []
    for path in sorted(directory.glob("*.json")):
        if path.name == "latest.json":
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            records.extend(SettledAlphaCandidate(**item) for item in payload.get("candidates", []))
        except Exception:
            continue
    return records


def evaluate_forward_returns(
    frame: pd.DataFrame,
    *,
    as_of: datetime,
    entry_price: float | None,
    horizons: Sequence[int] = DEFAULT_HORIZONS,
) -> dict[str, float | None]:
    """Evaluate forward returns using trading-bar offsets from the entry anchor.

    The entry anchor is the first bar at or after ``as_of``.
    A horizon like ``5d`` means five future trading bars, not five calendar days.
    If a snapshot has not fully matured yet, that horizon is left as ``None``.
    """
    if frame is None or frame.empty:
        return {f"{horizon}d": None for horizon in horizons}

    price_series = pd.to_numeric(frame["Close"], errors="coerce").dropna()
    if price_series.empty:
        return {f"{horizon}d": None for horizon in horizons}

    index = pd.to_datetime(price_series.index)
    if getattr(index, "tz", None) is not None:
        index = index.tz_convert(None)
    as_of_ts = pd.Timestamp(as_of).tz_localize(None) if pd.Timestamp(as_of).tzinfo else pd.Timestamp(as_of)
    eligible = [i for i, stamp in enumerate(index) if stamp >= as_of_ts]
    if not eligible:
        return {f"{horizon}d": None for horizon in horizons}

    entry_idx = eligible[0]
    base_price = entry_price if entry_price and entry_price > 0 else safe_float(price_series.iloc[entry_idx])
    if base_price is None or base_price <= 0:
        return {f"{horizon}d": None for horizon in horizons}

    returns: dict[str, float | None] = {}
    for horizon in horizons:
        target_idx = entry_idx + int(horizon)
        if target_idx >= len(price_series):
            returns[f"{horizon}d"] = None
            continue
        target_price = safe_float(price_series.iloc[target_idx])
        returns[f"{horizon}d"] = (
            round((target_price / base_price) - 1, 4) if target_price is not None and target_price > 0 else None
        )
    return returns


def classify_realized_label(*, paper_action: str, forward_returns: dict[str, float | None]) -> str:
    ret_5d = forward_returns.get("5d")
    ret_10d = forward_returns.get("10d")

    if ret_5d is None and ret_10d is None:
        return "unsettled"

    primary = ret_10d if ret_10d is not None else ret_5d
    if primary is None:
        return "unsettled"

    if paper_action == "paper_long":
        if primary >= 0.03:
            return "validated_long"
        if primary >= 0.0:
            return "marginal_long"
        return "failed_long"

    if paper_action == "track":
        if primary >= 0.02:
            return "good_track"
        if primary >= -0.01:
            return "neutral_track"
        return "missed_track"

    if paper_action == "reduce_or_wait":
        return "good_restraint" if primary <= 0 else "late_exit_warning"

    return "good_skip" if primary <= 0 else "false_skip"


def build_calibration_report(
    records: Sequence[SettledAlphaCandidate],
    *,
    generated_at: Optional[datetime] = None,
    minimum_samples: int = 20,
) -> CalibrationReport:
    """Build calibration metrics from settled paper candidates.

    Partially matured records are intentionally included. Any record contributes to a given
    horizon only when that forward return is available.
    """
    generated_at = normalize_datetime(generated_at or datetime.now(UTC))
    settled = [
        record
        for record in records
        if record.forward_returns.get("5d") is not None or record.forward_returns.get("10d") is not None
    ]
    by_action: list[ActionCalibration] = []

    for action in sorted({record.paper_action for record in settled}):
        bucket = [record for record in settled if record.paper_action == action]
        hit_targets = [
            1.0 if (record.forward_returns.get("5d") or 0.0) > 0 else 0.0
            for record in bucket
            if record.forward_returns.get("5d") is not None
        ]
        hit_rate_5d = round(sum(hit_targets) / len(hit_targets), 4) if hit_targets else None
        avg_return_5d = mean_rounded(record.forward_returns.get("5d") for record in bucket)
        avg_return_10d = mean_rounded(record.forward_returns.get("10d") for record in bucket)
        brier_5d = (
            round(
                sum(
                    (record.calibrated_prob - (1.0 if (record.forward_returns.get("5d") or 0.0) > 0 else 0.0)) ** 2
                    for record in bucket
                    if record.forward_returns.get("5d") is not None
                )
                / len(hit_targets),
                4,
            )
            if hit_targets
            else None
        )
        by_action.append(
            ActionCalibration(
                action=action,
                count=len(bucket),
                hit_rate_5d=hit_rate_5d,
                avg_return_5d=avg_return_5d,
                avg_return_10d=avg_return_10d,
                brier_5d=brier_5d,
            )
        )

    overlay_summary = summarize_forward_return_by_dimension(
        settled,
        dimensions=("risk_budget_state", "aggression_posture", "execution_quality", "liquidity_tier"),
        horizon_key="5d",
        min_count=2,
    )
    overlay_slices: list[OverlaySliceCalibration] = []
    for dimension in ("risk_budget_state", "aggression_posture", "execution_quality", "liquidity_tier"):
        for bucket, metrics in overlay_summary.get(dimension, {}).items():
            overlay_slices.append(
                OverlaySliceCalibration(
                    dimension=dimension,
                    bucket=bucket,
                    count=int(metrics.get("count", 0)),
                    matured_count=int(metrics.get("matured_count", 0)),
                    hit_rate_5d=safe_float(metrics.get("hit_rate")),
                    avg_return_5d=safe_float(metrics.get("avg_return")),
                )
            )

    gate = build_promotion_gate(by_action, minimum_samples=minimum_samples)
    return CalibrationReport(
        generated_at=generated_at.isoformat(),
        settled_candidates=len(settled),
        by_action=by_action,
        gate=gate,
        overlay_slices=overlay_slices,
    )


def build_promotion_gate(
    by_action: Sequence[ActionCalibration],
    *,
    minimum_samples: int = 20,
) -> PromotionGate:
    paper_long = next((item for item in by_action if item.action == "paper_long"), None)
    reasons: list[str] = []

    if paper_long is None:
        reasons.append("no paper_long samples have settled yet")
    else:
        if paper_long.count < minimum_samples:
            reasons.append(f"paper_long sample count {paper_long.count} is below minimum {minimum_samples}")
        if paper_long.hit_rate_5d is None or paper_long.hit_rate_5d < 0.55:
            reasons.append("paper_long 5d hit rate is below 55%")
        if paper_long.avg_return_5d is None or paper_long.avg_return_5d < 0.01:
            reasons.append("paper_long 5d average return is below 1.0%")
        if paper_long.brier_5d is None or paper_long.brier_5d > 0.23:
            reasons.append("paper_long 5d Brier score is above 0.23")

    return PromotionGate(
        status="ready" if not reasons else "blocked",
        reasons=reasons or ["paper_long calibration cleared current thresholds"],
        minimum_samples=minimum_samples,
        paper_long_count=paper_long.count if paper_long else 0,
        paper_long_hit_rate_5d=paper_long.hit_rate_5d if paper_long else None,
        paper_long_avg_return_5d=paper_long.avg_return_5d if paper_long else None,
        paper_long_brier_5d=paper_long.brier_5d if paper_long else None,
    )


def format_calibration_report(report: CalibrationReport) -> str:
    lines = [
        "Experimental alpha calibration",
        f"Settled candidates: {report.settled_candidates}",
    ]
    for item in report.by_action:
        lines.append(
            f"- {item.action}: n={item.count} | hit5d={fmt_pct(item.hit_rate_5d)} | "
            f"avg5d={fmt_return(item.avg_return_5d)} | avg10d={fmt_return(item.avg_return_10d)} | "
            f"brier5d={fmt_float(item.brier_5d)}"
        )
    lines.append(f"Promotion gate: {report.gate.status}")
    for reason in report.gate.reasons:
        lines.append(f"- {reason}")
    if report.overlay_slices:
        lines.append("Overlay slices (5d):")
        for item in report.overlay_slices[:8]:
            lines.append(
                f"- {item.dimension}={item.bucket}: n={item.count} matured={item.matured_count} "
                f"| hit5d={fmt_pct(item.hit_rate_5d)} | avg5d={fmt_return(item.avg_return_5d)}"
            )
    return "\n".join(lines)


def build_overlay_attribution(
    records: Sequence[SettledAlphaCandidate],
    *,
    min_count: int = 20,
    interaction_min_count: int = 40,
) -> dict:
    return build_overlay_attribution_report(
        records,
        min_count=min_count,
        interaction_min_count=interaction_min_count,
    )


def _window_from_slice(slice_row: dict, window_key: str) -> dict[str, float]:
    stability = slice_row.get("rolling_stability")
    if not isinstance(stability, dict):
        return {"samples": 0, "mean_5d_return": 0.0}
    window = stability.get(window_key)
    if not isinstance(window, dict):
        return {"samples": 0, "mean_5d_return": 0.0}
    return {
        "samples": int(window.get("matured_count", 0) or 0),
        "mean_5d_return": float(window.get("mean_return", 0.0) or 0.0),
    }


def build_overlay_promotion_metrics(
    report: dict,
    *,
    overlay_name: str,
    horizon: str = "5d",
) -> dict:
    rows = [
        row for row in (report.get("slices") or [])
        if isinstance(row, dict)
        and str(row.get("dimension", "")).strip().lower() == overlay_name
        and str(row.get("horizon", "")).strip().lower() == horizon
    ]
    samples_total = sum(int((row.get("metrics") or {}).get("count", 0) or 0) for row in rows)
    matured_total = sum(int((row.get("metrics") or {}).get("matured_count", 0) or 0) for row in rows)
    if not rows:
        return {
            "samples_total": 0,
            "baseline_global": {"hit_rate_delta": 0.0, "mean_5d_return_delta": 0.0, "downside_tail_delta": 0.0},
            "baseline_matched": {"hit_rate_delta": 0.0, "mean_5d_return_delta": 0.0, "downside_tail_delta": 0.0},
            "recent_windows": [{"label": "8w", "samples": 0, "mean_5d_return": 0.0}, {"label": "12w", "samples": 0, "mean_5d_return": 0.0}],
            "windows": {"8w": {"samples": 0, "mean_5d_return": 0.0}, "12w": {"samples": 0, "mean_5d_return": 0.0}},
            "matured_total": 0,
        }

    def _weighted_delta(delta_key: str, key: str) -> float:
        weighted_sum = 0.0
        weight_total = 0.0
        for row in rows:
            metrics = row.get("metrics") or {}
            weight = float(metrics.get("matured_count", 0) or 0)
            delta_map = row.get(key) or {}
            value = float(delta_map.get(delta_key, 0.0) or 0.0)
            if weight <= 0:
                continue
            weighted_sum += value * weight
            weight_total += weight
        return round(weighted_sum / weight_total, 6) if weight_total > 0 else 0.0

    global_hit_delta = _weighted_delta("hit_rate_lift", "global_comparison")
    global_mean_delta = _weighted_delta("mean_return_lift", "global_comparison")
    global_downside_delta = _weighted_delta("worst_decile_lift", "global_comparison")
    matched_hit_delta = _weighted_delta("hit_rate_lift", "matched_comparison")
    matched_mean_delta = _weighted_delta("mean_return_lift", "matched_comparison")
    matched_downside_delta = _weighted_delta("worst_decile_lift", "matched_comparison")

    window_8_rows = [_window_from_slice(row, "56d") for row in rows]
    window_12_rows = [_window_from_slice(row, "84d") for row in rows]
    window_8_samples = sum(int(item["samples"]) for item in window_8_rows)
    window_12_samples = sum(int(item["samples"]) for item in window_12_rows)
    window_8_mean = (
        round(sum(item["mean_5d_return"] * item["samples"] for item in window_8_rows) / window_8_samples, 6)
        if window_8_samples > 0
        else 0.0
    )
    window_12_mean = (
        round(sum(item["mean_5d_return"] * item["samples"] for item in window_12_rows) / window_12_samples, 6)
        if window_12_samples > 0
        else 0.0
    )

    return {
        "samples_total": int(samples_total),
        "matured_total": int(matured_total),
        "baseline_global": {
            "hit_rate_delta": global_hit_delta,
            "mean_5d_return_delta": global_mean_delta,
            "downside_tail_delta": global_downside_delta,
        },
        "baseline_matched": {
            "hit_rate_delta": matched_hit_delta,
            "mean_5d_return_delta": matched_mean_delta,
            "downside_tail_delta": matched_downside_delta,
        },
        "recent_windows": [
            {"label": "8w", "samples": int(window_8_samples), "mean_5d_return": float(window_8_mean)},
            {"label": "12w", "samples": int(window_12_samples), "mean_5d_return": float(window_12_mean)},
        ],
        "windows": {
            "8w": {"samples": int(window_8_samples), "mean_5d_return": float(window_8_mean)},
            "12w": {"samples": int(window_12_samples), "mean_5d_return": float(window_12_mean)},
        },
    }


def build_overlay_promotion_state_from_report(
    report: dict,
    *,
    registry_path: Optional[Path] = None,
    state_path: Optional[Path] = None,
    manual_approvals: Optional[set[str]] = None,
    horizon: str = "5d",
    now: Optional[datetime] = None,
) -> dict:
    registry = load_overlay_registry(registry_path or DEFAULT_REGISTRY_PATH)
    metrics_by_overlay: dict[str, dict] = {}
    for overlay_name in ("risk_budget_state", "aggression_posture", "execution_quality", "liquidity_tier"):
        metrics_by_overlay[overlay_name] = build_overlay_promotion_metrics(
            report,
            overlay_name=overlay_name,
            horizon=horizon,
        )

    payload = evaluate_registry_promotions(
        registry,
        metrics_by_overlay,
        now=now,
        manual_approvals=manual_approvals,
    )
    payload["source_report_generated_at"] = report.get("generated_at")
    payload["source_records"] = int(report.get("records", 0) or 0)
    save_overlay_promotion_state(payload, state_path or DEFAULT_PROMOTION_STATE_PATH)
    return payload


def format_overlay_attribution_report(report: dict, *, horizon: str = "5d", top_n: int = 10) -> str:
    return format_overlay_attribution_compact(report, horizon=horizon, top_n=top_n)


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Paper-only experimental alpha pipeline")
    parser.add_argument("--symbols", type=str, help="Comma-separated symbols to evaluate")
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of text")
    parser.add_argument("--limit-per-bucket", type=int, default=3, help="Default symbol fanout from each bucket")
    parser.add_argument("--persist", action="store_true", help="Persist the current alpha snapshot")
    parser.add_argument("--settle", action="store_true", help="Settle persisted snapshots against later price history")
    parser.add_argument("--calibrate", action="store_true", help="Build calibration + promotion-gate report")
    parser.add_argument("--alpha-root", type=str, help="Override alpha research root directory")
    parser.add_argument("--minimum-samples", type=int, default=20, help="Minimum paper_long samples for promotion gate")
    parser.add_argument("--overlay-attribution", action="store_true", help="Build overlay attribution report")
    parser.add_argument(
        "--evaluate-promotions",
        action="store_true",
        help="Evaluate promotion gates and emit overlay-promotion-state artifact",
    )
    parser.add_argument("--attribution-min-count", type=int, default=20, help="Minimum samples for slice reporting")
    parser.add_argument(
        "--attribution-interaction-min-count",
        type=int,
        default=40,
        help="Minimum samples for interaction slice reporting",
    )
    parser.add_argument(
        "--attribution-horizon",
        type=str,
        default="5d",
        choices=["1d", "5d", "10d"],
        help="Horizon used in compact attribution text output",
    )
    parser.add_argument(
        "--attribution-artifact-path",
        type=str,
        help="Override path for overlay-attribution-latest.json artifact",
    )
    parser.add_argument(
        "--promotion-state-path",
        type=str,
        help="Override path for overlay-promotion-state.json artifact",
    )
    parser.add_argument(
        "--promotion-registry-path",
        type=str,
        help="Override path for overlay_registry.json",
    )
    parser.add_argument(
        "--approve-rank-modifier",
        type=str,
        default="",
        help="Comma-separated overlays manually approved for rank_modifier promotion",
    )
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> None:
    args = parse_args(argv)
    root = Path(args.alpha_root).expanduser() if args.alpha_root else default_alpha_root()

    if args.settle:
        settled = settle_alpha_snapshots(root=root)
        if args.json:
            print(json.dumps([asdict(item) for item in settled], indent=2))
        else:
            print(f"Settled {len(settled)} experimental alpha candidates.")
        return

    if args.calibrate:
        report = build_calibration_report(
            load_settled_alpha(root),
            minimum_samples=args.minimum_samples,
        )
        if args.json:
            print(json.dumps(asdict(report), indent=2))
        else:
            print(format_calibration_report(report))
        return

    if args.overlay_attribution or args.evaluate_promotions:
        report = build_overlay_attribution(
            load_settled_alpha(root),
            min_count=args.attribution_min_count,
            interaction_min_count=args.attribution_interaction_min_count,
        )
        artifact_path = Path(args.attribution_artifact_path).expanduser() if args.attribution_artifact_path else DEFAULT_ATTRIBUTION_ARTIFACT_PATH
        write_atomic_json(artifact_path, report)
        if args.evaluate_promotions:
            approvals = {
                token.strip().lower()
                for token in str(args.approve_rank_modifier or "").split(",")
                if token.strip()
            }
            state_payload = build_overlay_promotion_state_from_report(
                report,
                registry_path=Path(args.promotion_registry_path).expanduser() if args.promotion_registry_path else None,
                state_path=Path(args.promotion_state_path).expanduser() if args.promotion_state_path else None,
                manual_approvals=approvals,
                horizon=args.attribution_horizon,
            )
            if args.json:
                print(json.dumps({"attribution": report, "promotion_state": state_payload}, indent=2))
            else:
                state_path = Path(args.promotion_state_path).expanduser() if args.promotion_state_path else DEFAULT_PROMOTION_STATE_PATH
                print(format_overlay_attribution_report(report, horizon=args.attribution_horizon))
                print("")
                print(f"Promotion state written: {state_path}")
            return
        if args.json:
            print(json.dumps(report, indent=2))
        else:
            print(format_overlay_attribution_report(report, horizon=args.attribution_horizon))
        return

    if args.symbols:
        symbols = [item.strip().upper() for item in args.symbols.split(",") if item.strip()]
    else:
        symbols = default_research_symbols(limit_per_bucket=args.limit_per_bucket)

    report = build_alpha_report(symbols)
    if args.persist:
        persist_alpha_snapshot(report, root=root)

    if args.json:
        print(json.dumps([asdict(candidate) for candidate in report], indent=2))
    else:
        print(format_alpha_report(report))


def parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def normalize_datetime(value: datetime) -> datetime:
    return value.astimezone(UTC) if value.tzinfo else value.replace(tzinfo=UTC)


def sanitize_timestamp(value: str) -> str:
    return value.replace(":", "-").replace(".", "-")


def write_atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temp_path.replace(path)


def safe_float(value: object) -> float | None:
    try:
        parsed = float(value)
    except Exception:
        return None
    return parsed if pd.notna(parsed) else None


def first_non_empty(*values: object) -> str | None:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def first_float(*values: object) -> float | None:
    for value in values:
        parsed = safe_float(value)
        if parsed is not None:
            return parsed
    return None


def first_overlay_dict(*values: object) -> dict:
    for value in values:
        if isinstance(value, dict) and value:
            return value
    return {}


def coerce_bucket(value: object, *, fallback: str = "unknown") -> str:
    if value is None:
        return fallback
    text = str(value).strip().lower().replace(" ", "_")
    return text or fallback


def mean_rounded(values: Iterable[float | None]) -> float | None:
    filtered = [float(value) for value in values if value is not None]
    if not filtered:
        return None
    return round(sum(filtered) / len(filtered), 4)


def fmt_pct(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.1f}%"


def fmt_return(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:+.2f}%"


def fmt_float(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.3f}"


if __name__ == "__main__":
    main()
