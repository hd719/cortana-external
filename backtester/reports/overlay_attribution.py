"""Overlay attribution report generator for research/promotion review."""

from __future__ import annotations

from datetime import UTC, datetime
from itertools import combinations
from typing import Any, Iterable, Sequence

from outcomes import (
    compare_metrics_to_baseline,
    evaluate_rolling_window_stability,
    summarize_forward_return_by_slice,
    summarize_forward_return_metrics,
)

DEFAULT_DIMENSIONS = (
    "risk_budget_state",
    "aggression_posture",
    "execution_quality",
    "liquidity_tier",
)
DEFAULT_HORIZONS = ("1d", "5d", "10d")


def build_overlay_attribution_report(
    records: Iterable[Any],
    *,
    dimensions: Sequence[str] = DEFAULT_DIMENSIONS,
    horizons: Sequence[str] = DEFAULT_HORIZONS,
    min_count: int = 20,
    interaction_min_count: int = 40,
    matched_key: str = "paper_action",
    include_interactions: bool = True,
    windows_days: Sequence[int] = (56, 84),
) -> dict[str, Any]:
    settled = list(records)
    generated_at = datetime.now(UTC).isoformat()

    report: dict[str, Any] = {
        "generated_at": generated_at,
        "records": len(settled),
        "dimensions": list(dimensions),
        "horizons": list(horizons),
        "min_count": int(min_count),
        "interaction_min_count": int(interaction_min_count),
        "matched_key": matched_key,
        "global_baseline": {},
        "slices": [],
        "interactions": [],
    }

    if not settled:
        return report

    for horizon in horizons:
        report["global_baseline"][horizon] = summarize_forward_return_metrics(settled, horizon_key=horizon)

    for dimension in dimensions:
        for horizon in horizons:
            bucket_metrics = summarize_forward_return_by_slice(
                settled,
                dimension=dimension,
                horizon_key=horizon,
                min_count=min_count,
            )
            global_baseline = report["global_baseline"][horizon]
            for bucket, metrics in bucket_metrics.items():
                bucket_records = _records_for_dimension_bucket(settled, dimension=dimension, bucket=bucket)
                matched_baseline = _summarize_matched_baseline(
                    settled,
                    bucket_records,
                    horizon_key=horizon,
                    matched_key=matched_key,
                )
                report["slices"].append(
                    {
                        "dimension": dimension,
                        "bucket": bucket,
                        "horizon": horizon,
                        "metrics": metrics,
                        "global_comparison": compare_metrics_to_baseline(metrics, global_baseline),
                        "matched_comparison": compare_metrics_to_baseline(metrics, matched_baseline),
                        "matched_baseline": matched_baseline,
                        "rolling_stability": evaluate_rolling_window_stability(
                            bucket_records,
                            horizon_key=horizon,
                            windows_days=windows_days,
                            min_matured=min_count,
                        ),
                    }
                )

    if include_interactions:
        for dim_a, dim_b in combinations(dimensions, 2):
            report["interactions"].extend(
                _build_interaction_rows(
                    settled,
                    dim_a=dim_a,
                    dim_b=dim_b,
                    horizons=horizons,
                    min_count=interaction_min_count,
                    global_baseline_by_horizon=report["global_baseline"],
                )
            )

    return report


def format_overlay_attribution_compact(
    report: dict[str, Any],
    *,
    horizon: str = "5d",
    top_n: int = 10,
) -> str:
    lines = ["Overlay attribution report", f"Records: {int(report.get('records', 0))}"]
    baseline = (report.get("global_baseline") or {}).get(horizon, {})
    lines.append(
        "Global baseline "
        f"{horizon}: n={_fmt_int(baseline.get('count'))} matured={_fmt_int(baseline.get('matured_count'))} "
        f"hit={_fmt_pct(baseline.get('hit_rate'))} "
        f"mean={_fmt_ret(baseline.get('mean_return'))}"
    )

    candidates = [row for row in report.get("slices", []) if row.get("horizon") == horizon]
    ranked = sorted(
        candidates,
        key=lambda item: (
            _sort_value((item.get("global_comparison") or {}).get("mean_return_lift")),
            _sort_value((item.get("global_comparison") or {}).get("hit_rate_lift")),
            _sort_value((item.get("metrics") or {}).get("matured_count")),
        ),
        reverse=True,
    )
    lines.append(f"Top slices ({horizon}):")
    for row in ranked[: max(0, int(top_n))]:
        metrics = row.get("metrics") or {}
        global_delta = row.get("global_comparison") or {}
        lines.append(
            f"- {row.get('dimension')}={row.get('bucket')} "
            f"(n={_fmt_int(metrics.get('count'))} matured={_fmt_int(metrics.get('matured_count'))}) "
            f"hit={_fmt_pct(metrics.get('hit_rate'))} "
            f"mean={_fmt_ret(metrics.get('mean_return'))} "
            f"delta_hit={_fmt_pct(global_delta.get('hit_rate_lift'))} "
            f"delta_mean={_fmt_ret(global_delta.get('mean_return_lift'))}"
        )
    if len(ranked) == 0:
        lines.append("- no qualifying slices for current thresholds")
    return "\n".join(lines)


def _build_interaction_rows(
    records: Sequence[Any],
    *,
    dim_a: str,
    dim_b: str,
    horizons: Sequence[str],
    min_count: int,
    global_baseline_by_horizon: dict[str, Any],
) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], list[Any]] = {}
    for record in records:
        a = _bucket_value(record, dim_a)
        b = _bucket_value(record, dim_b)
        grouped.setdefault((a, b), []).append(record)

    rows: list[dict[str, Any]] = []
    for (bucket_a, bucket_b), bucket_records in sorted(grouped.items()):
        if len(bucket_records) < max(1, int(min_count)):
            continue
        for horizon in horizons:
            metrics = summarize_forward_return_metrics(bucket_records, horizon_key=horizon)
            rows.append(
                {
                    "dimensions": [dim_a, dim_b],
                    "buckets": [bucket_a, bucket_b],
                    "horizon": horizon,
                    "metrics": metrics,
                    "global_comparison": compare_metrics_to_baseline(
                        metrics,
                        global_baseline_by_horizon.get(horizon, {}),
                    ),
                }
            )
    return rows


def _records_for_dimension_bucket(records: Sequence[Any], *, dimension: str, bucket: str) -> list[Any]:
    key = str(bucket).strip().lower()
    return [record for record in records if _bucket_value(record, dimension) == key]


def _summarize_matched_baseline(
    records: Sequence[Any],
    bucket_records: Sequence[Any],
    *,
    horizon_key: str,
    matched_key: str,
) -> dict[str, float | int | None]:
    groups = _group_by(records, matched_key)
    if not groups:
        return summarize_forward_return_metrics(records, horizon_key=horizon_key)

    bucket_groups = _group_by(bucket_records, matched_key)
    if not bucket_groups:
        return summarize_forward_return_metrics(records, horizon_key=horizon_key)

    matched_pool: list[Any] = []
    for group, bucket_group_records in bucket_groups.items():
        source = groups.get(group, [])
        if not source:
            continue
        matched_pool.extend(source[: max(len(bucket_group_records), 1)])

    if not matched_pool:
        return summarize_forward_return_metrics(records, horizon_key=horizon_key)
    return summarize_forward_return_metrics(matched_pool, horizon_key=horizon_key)


def _group_by(records: Sequence[Any], key: str) -> dict[str, list[Any]]:
    output: dict[str, list[Any]] = {}
    for record in records:
        bucket = _bucket_value(record, key)
        output.setdefault(bucket, []).append(record)
    return output


def _bucket_value(record: Any, key: str) -> str:
    value = record.get(key) if isinstance(record, dict) else getattr(record, key, None)
    if value is None:
        return "unknown"
    text = str(value).strip().lower().replace(" ", "_")
    return text or "unknown"


def _fmt_int(value: Any) -> str:
    try:
        return str(int(value))
    except Exception:
        return "0"


def _fmt_pct(value: Any) -> str:
    try:
        return f"{float(value) * 100:.1f}%"
    except Exception:
        return "n/a"


def _fmt_ret(value: Any) -> str:
    try:
        return f"{float(value) * 100:+.2f}%"
    except Exception:
        return "n/a"


def _sort_value(value: Any) -> float:
    try:
        return float(value)
    except Exception:
        return float("-inf")
