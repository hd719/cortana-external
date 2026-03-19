from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

from data.overlay_promotion import (
    bounded_rank_modifier,
    evaluate_gate_a,
    evaluate_gate_b,
    evaluate_registry_promotions,
    evaluate_overlay_promotion,
    load_overlay_registry,
    save_overlay_promotion_state,
    save_overlay_registry,
)


def _metrics(
    *,
    samples_total: int = 160,
    baseline_global: dict | None = None,
    baseline_matched: dict | None = None,
    recent_windows: list[dict] | None = None,
    windows: dict | None = None,
) -> dict:
    return {
        "samples_total": samples_total,
        "baseline_global": baseline_global
        or {
            "hit_rate_delta": 0.02,
            "mean_5d_return_delta": 0.001,
            "downside_tail_delta": 0.0,
        },
        "baseline_matched": baseline_matched
        or {
            "hit_rate_delta": -0.01,
            "mean_5d_return_delta": 0.0,
            "downside_tail_delta": 0.0,
        },
        "recent_windows": recent_windows
        or [
            {"label": "w1", "samples": 26, "mean_5d_return": 0.003},
            {"label": "w2", "samples": 24, "mean_5d_return": 0.001},
            {"label": "w3", "samples": 22, "mean_5d_return": -0.0001},
        ],
        "windows": windows
        or {
            "8w": {"samples": 34, "mean_5d_return": 0.001},
            "12w": {"samples": 48, "mean_5d_return": 0.0014},
        },
    }


def test_gate_a_passes_when_either_baseline_beats_and_recent_window_rules_hold():
    result = evaluate_gate_a(_metrics())

    assert result.passed is True
    assert result.gate == "A"
    assert result.details["global_baseline_passed"] is True
    assert result.details["matched_baseline_passed"] is False


def test_gate_a_fails_when_last_two_windows_have_too_few_samples():
    metrics = _metrics(
        recent_windows=[
            {"label": "w1", "samples": 25, "mean_5d_return": 0.002},
            {"label": "w2", "samples": 18, "mean_5d_return": 0.001},
            {"label": "w3", "samples": 19, "mean_5d_return": 0.0004},
        ]
    )
    result = evaluate_gate_a(metrics)

    assert result.passed is False
    assert any("last two rolling windows" in reason for reason in result.reasons)


def test_gate_b_requires_both_baselines_allowlist_and_manual_approval():
    metrics = _metrics(
        baseline_global={
            "hit_rate_delta": 0.03,
            "mean_5d_return_delta": 0.001,
            "downside_tail_delta": 0.0,
        },
        baseline_matched={
            "hit_rate_delta": 0.01,
            "mean_5d_return_delta": 0.0005,
            "downside_tail_delta": 0.0,
        },
    )
    approved = evaluate_gate_b(
        metrics,
        rank_modifier_eligible=True,
        manual_approval=True,
    )
    not_approved = evaluate_gate_b(
        metrics,
        rank_modifier_eligible=True,
        manual_approval=False,
    )
    not_allowlisted = evaluate_gate_b(
        metrics,
        rank_modifier_eligible=False,
        manual_approval=True,
    )

    assert approved.passed is True
    assert not_approved.passed is False
    assert not_allowlisted.passed is False


def test_logged_overlay_promotes_to_surfaced_when_gate_a_passes():
    result = evaluate_overlay_promotion(
        {"name": "risk_budget_state", "stage": "logged", "rank_modifier_eligible": False},
        _metrics(samples_total=60),
        now=datetime(2026, 3, 19, tzinfo=UTC),
    )

    assert result["decision"]["action"] == "promote"
    assert result["entry"]["stage"] == "surfaced"
    assert result["entry"]["failed_windows"] == 0


def test_surfaced_overlay_promotes_to_rank_modifier_with_manual_approval_only():
    entry = {"name": "execution_quality", "stage": "surfaced", "rank_modifier_eligible": True}
    metrics = _metrics(
        samples_total=180,
        baseline_matched={
            "hit_rate_delta": 0.03,
            "mean_5d_return_delta": 0.001,
            "downside_tail_delta": 0.0,
        },
    )

    hold_result = evaluate_overlay_promotion(
        entry,
        metrics,
        now=datetime(2026, 3, 19, tzinfo=UTC),
        manual_approval=False,
    )
    promote_result = evaluate_overlay_promotion(
        entry,
        metrics,
        now=datetime(2026, 3, 19, tzinfo=UTC),
        manual_approval=True,
    )

    assert hold_result["entry"]["stage"] == "surfaced"
    assert hold_result["decision"]["action"] == "hold"
    assert promote_result["entry"]["stage"] == "rank_modifier"
    assert promote_result["decision"]["action"] == "promote"


def test_auto_demote_after_two_consecutive_failures_and_apply_cooldown():
    entry = {
        "name": "execution_quality",
        "stage": "rank_modifier",
        "rank_modifier_eligible": True,
        "failed_windows": 1,
    }
    failing = _metrics(samples_total=50)

    result = evaluate_overlay_promotion(
        entry,
        failing,
        now=datetime(2026, 3, 19, tzinfo=UTC),
        manual_approval=False,
    )

    assert result["decision"]["action"] == "demote"
    assert result["entry"]["stage"] == "surfaced"
    assert result["entry"]["cooldown_until"] is not None
    assert result["entry"]["failed_windows"] == 0


def test_cooldown_blocks_repromotion_even_when_gate_passes():
    now = datetime(2026, 3, 19, tzinfo=UTC)
    entry = {
        "name": "execution_quality",
        "stage": "logged",
        "rank_modifier_eligible": True,
        "cooldown_until": (now + timedelta(days=10)).isoformat(),
    }
    result = evaluate_overlay_promotion(
        entry,
        _metrics(samples_total=80),
        now=now,
        manual_approval=False,
    )

    assert result["entry"]["stage"] == "logged"
    assert result["decision"]["action"] == "hold"
    assert result["decision"]["cooldown_active"] is True


def test_bounded_rank_modifier_clamps_to_plus_minus_5_percent():
    assert bounded_rank_modifier(0.20, {"min": -0.05, "max": 0.05}) == 0.05
    assert bounded_rank_modifier(-0.20, {"min": -0.05, "max": 0.05}) == -0.05
    assert bounded_rank_modifier(0.01, {"min": -0.05, "max": 0.05}) == 0.01


def test_registry_save_and_load_are_file_backed_and_deterministic(tmp_path: Path):
    registry_path = tmp_path / "overlay_registry.json"
    payload = {
        "schema_version": 1,
        "policy_version": "2026-03-19-v1",
        "overlays": [{"name": "execution_quality", "stage": "surfaced"}],
    }

    save_overlay_registry(payload, registry_path)
    loaded = load_overlay_registry(registry_path)

    assert loaded["schema_version"] == 1
    assert loaded["policy_version"] == "2026-03-19-v1"
    assert loaded["overlays"][0]["name"] == "execution_quality"


def test_evaluate_registry_promotions_emits_runtime_compatible_state_and_writes_file(tmp_path: Path):
    registry = {
        "schema_version": 1,
        "policy_version": "2026-03-19-v1",
        "overlays": [
            {
                "name": "execution_quality",
                "stage": "surfaced",
                "rank_modifier_eligible": True,
                "modifier_bounds": {"min": -0.05, "max": 0.05},
            }
        ],
    }
    metrics_by_overlay = {
        "execution_quality": _metrics(
            samples_total=180,
            baseline_matched={
                "hit_rate_delta": 0.02,
                "mean_5d_return_delta": 0.001,
                "downside_tail_delta": 0.0,
            },
        )
    }
    payload = evaluate_registry_promotions(
        registry,
        metrics_by_overlay,
        now=datetime(2026, 3, 19, tzinfo=UTC),
        manual_approvals={"execution_quality"},
    )
    entry = payload["overlays"][0]

    assert entry["name"] == "execution_quality"
    assert entry["stage"] == "rank_modifier"
    assert entry["allow_rank_modifier"] is True
    assert entry["max_effect_pct"] == 0.05

    state_path = tmp_path / "overlay-promotion-state.json"
    saved = save_overlay_promotion_state(payload, state_path)
    loaded = load_overlay_registry(saved)
    assert saved == state_path
    assert loaded["overlays"][0]["stage"] == "rank_modifier"
