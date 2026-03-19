"""Deterministic overlay promotion policy evaluator and file-backed registry helpers."""

from __future__ import annotations

import json
import math
import os
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Literal, Mapping, Optional

OverlayStage = Literal["logged", "surfaced", "rank_modifier"]

DEFAULT_REGISTRY_PATH = Path(__file__).with_name("overlay_registry.json")
DEFAULT_PROMOTION_STATE_PATH = Path(__file__).with_name("cache") / "overlay-promotion-state.json"

STAGE_ORDER: dict[OverlayStage, int] = {
    "logged": 0,
    "surfaced": 1,
    "rank_modifier": 2,
}

DEFAULT_MODIFIER_BOUNDS = {"min": -0.05, "max": 0.05}
COOLDOWN_WEEKS = 4


@dataclass(frozen=True)
class GateEvaluation:
    gate: str
    passed: bool
    reasons: list[str]
    details: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class PromotionDecision:
    from_stage: OverlayStage
    to_stage: OverlayStage
    action: Literal["promote", "hold", "demote"]
    gate: str
    passed: bool
    cooldown_active: bool
    requires_manual_approval: bool
    reasons: list[str]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def load_overlay_registry(path: str | Path | None = None) -> dict[str, Any]:
    target = Path(path or DEFAULT_REGISTRY_PATH).expanduser()
    if not target.exists():
        return {"schema_version": 1, "policy_version": "2026-03-19-v1", "overlays": []}
    with target.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError("overlay registry must be a JSON object")
    payload.setdefault("schema_version", 1)
    payload.setdefault("policy_version", "2026-03-19-v1")
    payload.setdefault("overlays", [])
    return payload


def save_overlay_registry(payload: Mapping[str, Any], path: str | Path | None = None) -> Path:
    target = Path(path or DEFAULT_REGISTRY_PATH).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    serializable = dict(payload)
    serializable["schema_version"] = int(serializable.get("schema_version", 1))
    serializable["policy_version"] = str(serializable.get("policy_version", "2026-03-19-v1"))
    serializable["updated_at"] = _iso(datetime.now(UTC))
    tmp = target.with_suffix(target.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        json.dump(serializable, handle, indent=2, sort_keys=True)
        handle.write("\n")
    os.replace(tmp, target)
    return target


def evaluate_gate_a(metrics: Mapping[str, Any]) -> GateEvaluation:
    reasons: list[str] = []
    total_samples = _as_int(metrics.get("samples_total"))
    if total_samples < 40:
        reasons.append(f"samples_total {total_samples} < 40")

    recent_windows = _recent_windows(metrics)
    if len(recent_windows) < 2:
        reasons.append("requires at least 2 rolling windows")
    else:
        last_two = recent_windows[-2:]
        min_last_two = min(_as_int(window.get("samples")) for window in last_two)
        if min_last_two < 20:
            reasons.append("last two rolling windows require >=20 samples each")

    non_negative_count = sum(
        1 for window in recent_windows if _as_float(window.get("mean_5d_return")) >= 0.0
    )
    required_non_negative = math.ceil((len(recent_windows) * 2.0) / 3.0) if recent_windows else 0
    if recent_windows and non_negative_count < required_non_negative:
        reasons.append(
            f"non-negative 5d windows {non_negative_count}/{len(recent_windows)} below 2/3"
        )

    global_cmp = _baseline_pass(metrics.get("baseline_global"))
    matched_cmp = _baseline_pass(metrics.get("baseline_matched"))
    if not (global_cmp["passed"] or matched_cmp["passed"]):
        reasons.append("must beat either global or matched baseline")

    passed = not reasons
    details = {
        "samples_total": total_samples,
        "non_negative_windows": non_negative_count,
        "required_non_negative_windows": required_non_negative,
        "global_baseline_passed": global_cmp["passed"],
        "matched_baseline_passed": matched_cmp["passed"],
    }
    return GateEvaluation(gate="A", passed=passed, reasons=reasons, details=details)


def evaluate_gate_b(
    metrics: Mapping[str, Any],
    *,
    rank_modifier_eligible: bool,
    manual_approval: bool,
) -> GateEvaluation:
    reasons: list[str] = []
    total_samples = _as_int(metrics.get("samples_total"))
    if total_samples < 150:
        reasons.append(f"samples_total {total_samples} < 150")

    windows = _windows_map(metrics)
    for label in ("8w", "12w"):
        window = windows.get(label)
        if not isinstance(window, Mapping):
            reasons.append(f"missing stability window {label}")
            continue
        samples = _as_int(window.get("samples"))
        mean_5d = _as_float(window.get("mean_5d_return"))
        if samples < 20:
            reasons.append(f"window {label} samples {samples} < 20")
        if mean_5d < 0.0:
            reasons.append(f"window {label} mean_5d_return {mean_5d:.4f} < 0")

    global_cmp = _baseline_pass(metrics.get("baseline_global"))
    matched_cmp = _baseline_pass(metrics.get("baseline_matched"))
    if not global_cmp["passed"]:
        reasons.append("must beat global baseline")
    if not matched_cmp["passed"]:
        reasons.append("must beat matched baseline")

    if not rank_modifier_eligible:
        reasons.append("overlay is not allowlisted for rank_modifier")
    if not manual_approval:
        reasons.append("manual approval required for rank_modifier promotion")

    passed = not reasons
    details = {
        "samples_total": total_samples,
        "global_baseline_passed": global_cmp["passed"],
        "matched_baseline_passed": matched_cmp["passed"],
        "rank_modifier_eligible": rank_modifier_eligible,
        "manual_approval": manual_approval,
    }
    return GateEvaluation(gate="B", passed=passed, reasons=reasons, details=details)


def evaluate_overlay_promotion(
    entry: Mapping[str, Any],
    metrics: Mapping[str, Any],
    *,
    now: datetime | None = None,
    manual_approval: bool = False,
) -> dict[str, Any]:
    current = datetime.now(UTC) if now is None else now.astimezone(UTC)
    stage = _normalize_stage(entry.get("stage"))
    failed_windows = _as_int(entry.get("failed_windows"))
    cooldown_until = _parse_dt(entry.get("cooldown_until"))
    cooldown_active = cooldown_until is not None and current < cooldown_until

    rank_modifier_eligible = bool(entry.get("rank_modifier_eligible", False))
    requires_manual = stage != "rank_modifier"

    if stage == "logged":
        gate_eval = evaluate_gate_a(metrics)
    elif stage == "surfaced":
        gate_eval = evaluate_gate_b(
            metrics,
            rank_modifier_eligible=rank_modifier_eligible,
            manual_approval=manual_approval,
        )
    else:
        gate_eval = evaluate_gate_b(
            metrics,
            rank_modifier_eligible=True,
            manual_approval=True,
        )

    next_stage = stage
    action: Literal["promote", "hold", "demote"] = "hold"
    reasons = list(gate_eval.reasons)

    if gate_eval.passed:
        failed_windows = 0
        if cooldown_active:
            reasons.append("cooldown active; promotion blocked")
        else:
            if stage == "logged":
                next_stage = "surfaced"
                action = "promote"
            elif stage == "surfaced" and rank_modifier_eligible and manual_approval:
                next_stage = "rank_modifier"
                action = "promote"
    else:
        failed_windows += 1
        if stage in {"surfaced", "rank_modifier"} and failed_windows >= 2:
            next_stage = "surfaced" if stage == "rank_modifier" else "logged"
            action = "demote"
            failed_windows = 0
            cooldown_until = current + timedelta(weeks=COOLDOWN_WEEKS)
            reasons.append("auto-demoted after 2 consecutive failed windows")

    updated = dict(entry)
    updated["stage"] = next_stage
    updated["failed_windows"] = failed_windows
    updated["last_evaluated_at"] = _iso(current)
    updated["last_gate"] = gate_eval.gate
    updated["last_gate_passed"] = gate_eval.passed
    updated["last_gate_reasons"] = reasons
    updated["last_gate_details"] = gate_eval.details
    updated["requires_manual_approval_for_rank_modifier"] = True
    updated["rank_modifier_eligible"] = rank_modifier_eligible
    updated["modifier_bounds"] = _normalize_bounds(entry.get("modifier_bounds"))
    # Compatibility aliases consumed by existing runtime readers.
    updated["allow_rank_modifier"] = rank_modifier_eligible
    updated["max_effect_pct"] = float(updated["modifier_bounds"]["max"])
    updated["cooldown_until"] = _iso(cooldown_until) if cooldown_until else None

    decision = PromotionDecision(
        from_stage=stage,
        to_stage=next_stage,
        action=action,
        gate=gate_eval.gate,
        passed=gate_eval.passed,
        cooldown_active=cooldown_active,
        requires_manual_approval=requires_manual,
        reasons=reasons,
    )
    return {"entry": updated, "decision": decision.to_dict(), "gate": gate_eval.to_dict()}


def evaluate_registry_promotions(
    registry_payload: Mapping[str, Any],
    metrics_by_overlay: Mapping[str, Mapping[str, Any]],
    *,
    now: datetime | None = None,
    manual_approvals: Optional[set[str]] = None,
) -> dict[str, Any]:
    current = datetime.now(UTC) if now is None else now.astimezone(UTC)
    approvals = {str(name).strip().lower() for name in (manual_approvals or set()) if str(name).strip()}
    overlays = _iter_registry_overlays(registry_payload)

    updated_entries: list[dict[str, Any]] = []
    decisions: list[dict[str, Any]] = []
    for entry in overlays:
        name = str(entry.get("name") or entry.get("overlay") or "").strip().lower()
        if not name:
            continue
        metrics = metrics_by_overlay.get(name, {})
        evaluated = evaluate_overlay_promotion(
            entry,
            metrics,
            now=current,
            manual_approval=name in approvals,
        )
        next_entry = dict(evaluated["entry"])
        next_entry["name"] = name
        updated_entries.append(next_entry)
        decisions.append({"name": name, **evaluated["decision"]})

    return {
        "schema_version": int(registry_payload.get("schema_version", 1)),
        "policy_version": str(registry_payload.get("policy_version", "2026-03-19-v1")),
        "generated_at": _iso(current),
        "overlays": updated_entries,
        "decisions": decisions,
    }


def save_overlay_promotion_state(
    payload: Mapping[str, Any],
    path: str | Path | None = None,
) -> Path:
    target = Path(path or DEFAULT_PROMOTION_STATE_PATH).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    serializable = dict(payload)
    serializable["schema_version"] = int(serializable.get("schema_version", 1))
    serializable["generated_at"] = str(serializable.get("generated_at", _iso(datetime.now(UTC))))
    tmp = target.with_suffix(target.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        json.dump(serializable, handle, indent=2, sort_keys=True)
        handle.write("\n")
    os.replace(tmp, target)
    return target


def bounded_rank_modifier(raw_value: float, bounds: Mapping[str, Any] | None = None) -> float:
    normalized = _normalize_bounds(bounds)
    lo = _as_float(normalized.get("min"), DEFAULT_MODIFIER_BOUNDS["min"])
    hi = _as_float(normalized.get("max"), DEFAULT_MODIFIER_BOUNDS["max"])
    if lo > hi:
        lo, hi = hi, lo
    return max(lo, min(hi, float(raw_value)))


def _baseline_pass(raw: Any) -> dict[str, bool]:
    baseline = raw if isinstance(raw, Mapping) else {}
    hit_rate_delta = _as_float(baseline.get("hit_rate_delta"))
    mean_5d_delta = _as_float(baseline.get("mean_5d_return_delta"))
    downside_tail_delta = _as_float(baseline.get("downside_tail_delta"))
    return {
        "passed": (hit_rate_delta > 0.0 or mean_5d_delta > 0.0) and downside_tail_delta >= 0.0
    }


def _recent_windows(metrics: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    raw = metrics.get("recent_windows")
    if isinstance(raw, list):
        return [item for item in raw if isinstance(item, Mapping)]
    windows = _windows_map(metrics)
    ordered = []
    for label in ("8w", "12w"):
        window = windows.get(label)
        if isinstance(window, Mapping):
            ordered.append(window)
    return ordered


def _windows_map(metrics: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    raw = metrics.get("windows")
    if isinstance(raw, Mapping):
        return {
            str(key): value
            for key, value in raw.items()
            if isinstance(key, str) and isinstance(value, Mapping)
        }
    return {}


def _normalize_stage(value: object) -> OverlayStage:
    normalized = str(value or "logged").strip().lower()
    if normalized not in STAGE_ORDER:
        return "logged"
    return normalized  # type: ignore[return-value]


def _normalize_bounds(value: object) -> dict[str, float]:
    if isinstance(value, Mapping):
        lo = _as_float(value.get("min"), DEFAULT_MODIFIER_BOUNDS["min"])
        hi = _as_float(value.get("max"), DEFAULT_MODIFIER_BOUNDS["max"])
    else:
        lo = DEFAULT_MODIFIER_BOUNDS["min"]
        hi = DEFAULT_MODIFIER_BOUNDS["max"]
    lo = max(-0.05, min(0.05, lo))
    hi = max(-0.05, min(0.05, hi))
    if lo > hi:
        lo, hi = hi, lo
    return {"min": lo, "max": hi}


def _iter_registry_overlays(payload: Mapping[str, Any]) -> list[dict[str, Any]]:
    overlays = payload.get("overlays")
    if isinstance(overlays, list):
        return [dict(item) for item in overlays if isinstance(item, Mapping)]
    if isinstance(overlays, Mapping):
        out: list[dict[str, Any]] = []
        for key, value in overlays.items():
            if not isinstance(value, Mapping):
                continue
            item = dict(value)
            item.setdefault("name", str(key))
            out.append(item)
        return out
    return []


def _as_int(value: object, default: int = 0) -> int:
    try:
        return int(value) if value is not None else default
    except (TypeError, ValueError):
        return default


def _as_float(value: object, default: float = 0.0) -> float:
    try:
        return float(value) if value is not None else default
    except (TypeError, ValueError):
        return default


def _parse_dt(value: object) -> Optional[datetime]:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat()


__all__ = [
    "COOLDOWN_WEEKS",
    "DEFAULT_MODIFIER_BOUNDS",
    "DEFAULT_PROMOTION_STATE_PATH",
    "DEFAULT_REGISTRY_PATH",
    "GateEvaluation",
    "OverlayStage",
    "PromotionDecision",
    "bounded_rank_modifier",
    "evaluate_gate_a",
    "evaluate_gate_b",
    "evaluate_registry_promotions",
    "evaluate_overlay_promotion",
    "load_overlay_registry",
    "save_overlay_promotion_state",
    "save_overlay_registry",
]
