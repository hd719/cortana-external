from types import SimpleNamespace

from reports.overlay_attribution import build_overlay_attribution_report, format_overlay_attribution_compact


def _record(
    *,
    stamp: str,
    action: str,
    risk: str,
    aggression: str,
    quality: str,
    liquidity: str,
    r1: float | None,
    r5: float | None,
    r10: float | None,
):
    return SimpleNamespace(
        generated_at=stamp,
        paper_action=action,
        risk_budget_state=risk,
        aggression_posture=aggression,
        execution_quality=quality,
        liquidity_tier=liquidity,
        forward_returns={"1d": r1, "5d": r5, "10d": r10},
    )


def test_overlay_attribution_report_builds_horizon_slices_and_baselines():
    records = [
        _record(
            stamp="2026-03-01T12:00:00+00:00",
            action="paper_long",
            risk="tight",
            aggression="selective",
            quality="good",
            liquidity="tier1",
            r1=0.01,
            r5=0.03,
            r10=0.04,
        ),
        _record(
            stamp="2026-03-03T12:00:00+00:00",
            action="paper_long",
            risk="tight",
            aggression="selective",
            quality="good",
            liquidity="tier1",
            r1=0.0,
            r5=0.01,
            r10=0.02,
        ),
        _record(
            stamp="2026-03-05T12:00:00+00:00",
            action="track",
            risk="normal",
            aggression="balanced",
            quality="fair",
            liquidity="tier2",
            r1=-0.01,
            r5=-0.02,
            r10=-0.01,
        ),
    ]

    report = build_overlay_attribution_report(
        records,
        min_count=1,
        interaction_min_count=2,
    )

    assert report["records"] == 3
    assert "5d" in report["global_baseline"]
    assert any(item["horizon"] == "1d" for item in report["slices"])
    assert any(item["horizon"] == "10d" for item in report["slices"])
    assert any(item["dimension"] == "execution_quality" for item in report["slices"])
    assert any(item["dimensions"] == ["execution_quality", "liquidity_tier"] for item in report["interactions"])


def test_overlay_attribution_report_includes_global_and_matched_comparisons():
    records = [
        _record(
            stamp="2026-03-01T12:00:00+00:00",
            action="paper_long",
            risk="tight",
            aggression="selective",
            quality="good",
            liquidity="tier1",
            r1=0.01,
            r5=0.03,
            r10=0.05,
        ),
        _record(
            stamp="2026-03-02T12:00:00+00:00",
            action="paper_long",
            risk="tight",
            aggression="selective",
            quality="good",
            liquidity="tier1",
            r1=-0.005,
            r5=0.01,
            r10=0.02,
        ),
        _record(
            stamp="2026-03-03T12:00:00+00:00",
            action="track",
            risk="normal",
            aggression="balanced",
            quality="fair",
            liquidity="tier2",
            r1=-0.01,
            r5=-0.03,
            r10=-0.02,
        ),
    ]

    report = build_overlay_attribution_report(records, min_count=2, interaction_min_count=3)
    row = next(
        item
        for item in report["slices"]
        if item["dimension"] == "execution_quality" and item["bucket"] == "good" and item["horizon"] == "5d"
    )
    assert "hit_rate_lift" in row["global_comparison"]
    assert "mean_return_lift" in row["matched_comparison"]


def test_overlay_attribution_rolling_stability_marks_window_health():
    records = [
        _record(
            stamp="2026-01-01T12:00:00+00:00",
            action="paper_long",
            risk="normal",
            aggression="balanced",
            quality="good",
            liquidity="tier1",
            r1=0.01,
            r5=0.02,
            r10=0.03,
        ),
        _record(
            stamp="2026-02-15T12:00:00+00:00",
            action="paper_long",
            risk="normal",
            aggression="balanced",
            quality="good",
            liquidity="tier1",
            r1=-0.01,
            r5=0.01,
            r10=0.02,
        ),
        _record(
            stamp="2026-03-10T12:00:00+00:00",
            action="paper_long",
            risk="normal",
            aggression="balanced",
            quality="good",
            liquidity="tier1",
            r1=0.005,
            r5=0.015,
            r10=0.01,
        ),
    ]

    report = build_overlay_attribution_report(records, min_count=1, interaction_min_count=3)
    row = next(
        item
        for item in report["slices"]
        if item["dimension"] == "risk_budget_state" and item["bucket"] == "normal" and item["horizon"] == "5d"
    )
    assert "56d" in row["rolling_stability"]
    assert "84d" in row["rolling_stability"]
    assert "stable" in row["rolling_stability"]["56d"]


def test_overlay_attribution_compact_format_is_readable():
    report = {
        "records": 2,
        "global_baseline": {
            "5d": {
                "count": 2,
                "matured_count": 2,
                "hit_rate": 0.5,
                "mean_return": 0.01,
            }
        },
        "slices": [
            {
                "dimension": "execution_quality",
                "bucket": "good",
                "horizon": "5d",
                "metrics": {"count": 2, "matured_count": 2, "hit_rate": 1.0, "mean_return": 0.03},
                "global_comparison": {"hit_rate_lift": 0.5, "mean_return_lift": 0.02},
            }
        ],
    }

    text = format_overlay_attribution_compact(report, horizon="5d", top_n=5)
    assert "Overlay attribution report" in text
    assert "Global baseline 5d" in text
    assert "execution_quality=good" in text
