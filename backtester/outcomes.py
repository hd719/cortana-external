"""Outcome labeling utilities for realized trades and forward windows."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from math import ceil
from typing import Any, Dict, Iterable, Sequence

import pandas as pd


@dataclass(frozen=True)
class OutcomeLabel:
    """Normalized outcome label for a realized trade."""

    label: str
    bucket: str
    holding_days: int


def label_trade_outcome(
    pnl_pct: float,
    exit_reason: str,
    holding_days: int,
    *,
    scratch_band_pct: float = 1.0,
    win_threshold_pct: float = 4.0,
    outsized_win_threshold_pct: float = 12.0,
) -> OutcomeLabel:
    """Map a realized trade into a reviewable outcome label."""
    holding_days = max(int(holding_days), 0)
    exit_reason = (exit_reason or "").lower()

    if exit_reason == "stop_loss":
        label = "quick_stop" if holding_days <= 3 else "stopped_out"
        return OutcomeLabel(label=label, bucket="loss", holding_days=holding_days)

    if pnl_pct >= outsized_win_threshold_pct:
        return OutcomeLabel(label="outsized_win", bucket="win", holding_days=holding_days)

    if pnl_pct >= win_threshold_pct:
        return OutcomeLabel(label="trend_win", bucket="win", holding_days=holding_days)

    if abs(pnl_pct) < scratch_band_pct:
        return OutcomeLabel(label="scratch", bucket="neutral", holding_days=holding_days)

    if pnl_pct > 0:
        return OutcomeLabel(label="small_win", bucket="win", holding_days=holding_days)

    label = "controlled_loss" if pnl_pct > -win_threshold_pct else "failed_trade"
    return OutcomeLabel(label=label, bucket="loss", holding_days=holding_days)


def annotate_trade_outcomes(trades: pd.DataFrame) -> pd.DataFrame:
    """Attach outcome labels to a trades dataframe."""
    if trades.empty:
        return trades.copy()

    annotated = trades.copy()
    if "holding_days" not in annotated.columns:
        holding_days = (
            pd.to_datetime(annotated["exit_date"]) - pd.to_datetime(annotated["entry_date"])
        ).dt.days.fillna(0)
        annotated["holding_days"] = holding_days.astype(int)

    outcomes = [
        label_trade_outcome(
            float(row.pnl_pct),
            str(row.exit_reason),
            int(row.holding_days),
        )
        for row in annotated.itertuples(index=False)
    ]
    annotated["outcome_label"] = [o.label for o in outcomes]
    annotated["outcome_bucket"] = [o.bucket for o in outcomes]
    return annotated


def summarize_outcomes(trades: pd.DataFrame) -> Dict[str, int]:
    """Return a flat summary of outcome labels for downstream reporting."""
    annotated = annotate_trade_outcomes(trades)
    if annotated.empty:
        return {}
    return annotated["outcome_label"].value_counts().sort_index().to_dict()


def summarize_forward_return_by_dimension(
    records: Iterable[Any],
    *,
    dimensions: Iterable[str],
    horizon_key: str = "5d",
    min_count: int = 1,
) -> Dict[str, Dict[str, Dict[str, float | int | None]]]:
    """Summarize forward-return hit rate and average return across categorical dimensions.

    This helper is used by paper/research paths to evaluate contextual overlays over time.
    It is intentionally read-only and does not participate in live trade authority.
    """
    summary: Dict[str, Dict[str, Dict[str, float | int | None]]] = {}
    for dimension in dimensions:
        buckets: Dict[str, dict[str, float | int]] = {}
        for record in records:
            bucket = _extract_value(record, dimension)
            bucket_key = str(bucket).strip().lower().replace(" ", "_") if bucket is not None else "unknown"
            if not bucket_key:
                bucket_key = "unknown"
            forward_returns = _extract_value(record, "forward_returns")
            if not isinstance(forward_returns, dict):
                continue
            value = forward_returns.get(horizon_key)
            state = buckets.setdefault(
                bucket_key,
                {"count": 0, "matured_count": 0, "hits": 0, "return_sum": 0.0},
            )
            state["count"] += 1
            if value is None:
                continue
            try:
                parsed = float(value)
            except Exception:
                continue
            state["matured_count"] += 1
            state["hits"] += 1 if parsed > 0 else 0
            state["return_sum"] += parsed

        bucket_summary: Dict[str, Dict[str, float | int | None]] = {}
        for bucket_key, state in sorted(buckets.items()):
            if int(state["count"]) < max(int(min_count), 1):
                continue
            matured_count = int(state["matured_count"])
            hit_rate = round(float(state["hits"]) / matured_count, 4) if matured_count else None
            avg_return = round(float(state["return_sum"]) / matured_count, 4) if matured_count else None
            bucket_summary[bucket_key] = {
                "count": int(state["count"]),
                "matured_count": matured_count,
                "hit_rate": hit_rate,
                "avg_return": avg_return,
            }

        if bucket_summary:
            summary[str(dimension)] = bucket_summary

    return summary


def summarize_forward_return_metrics(
    records: Iterable[Any],
    *,
    horizon_key: str,
) -> Dict[str, float | int | None]:
    """Summarize forward-return distribution for a specific horizon."""
    all_records = list(records)
    matured_values: list[float] = []
    positive_hits = 0
    for record in all_records:
        value = extract_forward_return(record, horizon_key)
        if value is None:
            continue
        matured_values.append(value)
        if value > 0:
            positive_hits += 1

    matured_count = len(matured_values)
    if matured_count == 0:
        return {
            "count": len(all_records),
            "matured_count": 0,
            "hit_rate": None,
            "mean_return": None,
            "median_return": None,
            "p10_return": None,
            "worst_decile_mean": None,
        }

    sorted_values = sorted(matured_values)
    decile_size = max(1, ceil(matured_count / 10))
    worst_decile = sorted_values[:decile_size]
    quantile_index = max(0, int((matured_count - 1) * 0.1))
    p10_return = sorted_values[quantile_index]
    median_return = float(pd.Series(sorted_values).median())
    mean_return = sum(sorted_values) / matured_count
    worst_decile_mean = sum(worst_decile) / len(worst_decile)

    return {
        "count": len(all_records),
        "matured_count": matured_count,
        "hit_rate": round(positive_hits / matured_count, 4),
        "mean_return": round(mean_return, 4),
        "median_return": round(median_return, 4),
        "p10_return": round(p10_return, 4),
        "worst_decile_mean": round(worst_decile_mean, 4),
    }


def summarize_forward_return_by_slice(
    records: Iterable[Any],
    *,
    dimension: str,
    horizon_key: str,
    min_count: int = 1,
) -> Dict[str, Dict[str, float | int | None]]:
    """Summarize forward-return metrics by one categorical dimension."""
    grouped: dict[str, list[Any]] = {}
    for record in records:
        bucket = _extract_value(record, dimension)
        bucket_key = str(bucket).strip().lower().replace(" ", "_") if bucket is not None else "unknown"
        if not bucket_key:
            bucket_key = "unknown"
        grouped.setdefault(bucket_key, []).append(record)

    output: Dict[str, Dict[str, float | int | None]] = {}
    for bucket, bucket_records in sorted(grouped.items()):
        if len(bucket_records) < max(1, int(min_count)):
            continue
        output[bucket] = summarize_forward_return_metrics(bucket_records, horizon_key=horizon_key)
    return output


def compare_metrics_to_baseline(
    metrics: Dict[str, float | int | None],
    baseline: Dict[str, float | int | None],
) -> Dict[str, float | int | None]:
    """Compute metric deltas versus a baseline metric set."""
    hit_rate = _safe_float(metrics.get("hit_rate"))
    baseline_hit = _safe_float(baseline.get("hit_rate"))
    mean_return = _safe_float(metrics.get("mean_return"))
    baseline_mean = _safe_float(baseline.get("mean_return"))
    p10_return = _safe_float(metrics.get("p10_return"))
    baseline_p10 = _safe_float(baseline.get("p10_return"))
    worst_decile = _safe_float(metrics.get("worst_decile_mean"))
    baseline_worst_decile = _safe_float(baseline.get("worst_decile_mean"))

    return {
        "hit_rate_lift": _round_or_none(hit_rate - baseline_hit if hit_rate is not None and baseline_hit is not None else None),
        "mean_return_lift": _round_or_none(
            mean_return - baseline_mean if mean_return is not None and baseline_mean is not None else None
        ),
        "p10_lift": _round_or_none(p10_return - baseline_p10 if p10_return is not None and baseline_p10 is not None else None),
        "worst_decile_lift": _round_or_none(
            worst_decile - baseline_worst_decile
            if worst_decile is not None and baseline_worst_decile is not None
            else None
        ),
    }


def evaluate_rolling_window_stability(
    records: Iterable[Any],
    *,
    horizon_key: str,
    windows_days: Sequence[int] = (56, 84),
    min_matured: int = 20,
) -> Dict[str, Dict[str, float | int | bool | None]]:
    """Evaluate rolling-window stability over a horizon using generated timestamps."""
    parsed: list[tuple[datetime, Any]] = []
    for record in records:
        stamp = parse_record_timestamp(record)
        if stamp is None:
            continue
        parsed.append((stamp, record))

    if not parsed:
        return {}

    parsed.sort(key=lambda item: item[0])
    latest = parsed[-1][0]
    output: Dict[str, Dict[str, float | int | bool | None]] = {}
    for days in windows_days:
        threshold = latest - timedelta(days=int(days))
        window_records = [record for stamp, record in parsed if stamp >= threshold]
        metrics = summarize_forward_return_metrics(window_records, horizon_key=horizon_key)
        matured_count = int(metrics.get("matured_count", 0) or 0)
        mean_return = _safe_float(metrics.get("mean_return"))
        hit_rate = _safe_float(metrics.get("hit_rate"))
        output[f"{int(days)}d"] = {
            **metrics,
            "stable": bool(
                matured_count >= int(min_matured)
                and mean_return is not None
                and mean_return >= 0.0
                and hit_rate is not None
                and hit_rate >= 0.5
            ),
        }
    return output


def parse_record_timestamp(record: Any, *, key: str = "generated_at") -> datetime | None:
    value = _extract_value(record, key)
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        stamp = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except Exception:
        return None
    return stamp.astimezone(UTC) if stamp.tzinfo else stamp.replace(tzinfo=UTC)


def extract_forward_return(record: Any, horizon_key: str) -> float | None:
    forward_returns = _extract_value(record, "forward_returns")
    if not isinstance(forward_returns, dict):
        return None
    value = forward_returns.get(horizon_key)
    return _safe_float(value)


def _extract_value(record: Any, key: str) -> Any:
    if isinstance(record, dict):
        return record.get(key)
    return getattr(record, key, None)


def _safe_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except Exception:
        return None
    return parsed if pd.notna(parsed) else None


def _round_or_none(value: float | None) -> float | None:
    return round(value, 4) if value is not None else None
