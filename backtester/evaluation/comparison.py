"""Wave 4 helpers for comparing simple scoring models against overlay-aware ranks."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Dict, Iterable, Optional, Sequence

import pandas as pd

from scoring_tuning import MODEL_COMPARISON_CALIBRATION, ModelComparisonCalibration


@dataclass(frozen=True)
class ModelFamily:
    """Configuration for a practical scoring model comparison."""

    name: str
    score_column: str
    description: str
    top_n: Optional[int] = None
    min_score: Optional[float] = None


def score_enhanced_rank(
    total_score: float,
    breakout_score: float,
    sentiment_score: float,
    exit_risk_score: float,
    sector_score: float = 0.0,
    catalyst_score: float = 0.0,
    calibration: ModelComparisonCalibration = MODEL_COMPARISON_CALIBRATION,
) -> float:
    """Shared overlay-aware rank used by advisor outputs and Wave 4 comparisons."""
    return round(
        float(total_score)
        + float(breakout_score) * calibration.breakout_weight
        + float(sentiment_score) * calibration.sentiment_weight
        + float(sector_score) * calibration.sector_weight
        + float(catalyst_score) * calibration.catalyst_weight
        - float(exit_risk_score) * calibration.exit_risk_weight,
        2,
    )


def _numeric(frame: pd.DataFrame, column: str) -> pd.Series:
    if column not in frame.columns:
        return pd.Series(0.0, index=frame.index, dtype=float)
    return pd.to_numeric(frame[column], errors="coerce").fillna(0.0)


def attach_model_family_scores(
    candidates: pd.DataFrame,
    *,
    calibration: ModelComparisonCalibration = MODEL_COMPARISON_CALIBRATION,
) -> pd.DataFrame:
    """Add comparable score columns for baseline, tactical, and enhanced models."""
    if candidates is None:
        return pd.DataFrame()
    if candidates.empty:
        return candidates.copy()

    frame = candidates.copy()
    total = _numeric(frame, "total_score")
    breakout = _numeric(frame, "breakout_score")
    sentiment = _numeric(frame, "sentiment_score")
    exit_risk = _numeric(frame, "exit_risk_score")
    sector = _numeric(frame, "sector_score")
    catalyst = _numeric(frame, "catalyst_score")

    frame["baseline_score"] = total.round(2)
    frame["tactical_score"] = (
        total
        + breakout * calibration.breakout_weight
        - exit_risk * calibration.exit_risk_weight
    ).round(2)

    computed_enhanced = (
        total
        + breakout * calibration.breakout_weight
        + sentiment * calibration.sentiment_weight
        + sector * calibration.sector_weight
        + catalyst * calibration.catalyst_weight
        - exit_risk * calibration.exit_risk_weight
    ).round(2)
    if "rank_score" in frame.columns:
        frame["enhanced_score"] = pd.to_numeric(frame["rank_score"], errors="coerce").fillna(computed_enhanced)
    else:
        frame["enhanced_score"] = computed_enhanced

    return frame


def build_default_model_families(
    *,
    top_n: int = 5,
    baseline_min_score: Optional[float] = None,
    calibration: ModelComparisonCalibration = MODEL_COMPARISON_CALIBRATION,
) -> list[ModelFamily]:
    """Default Wave 4 comparison path from simple score to overlay-aware rank."""
    if baseline_min_score is None:
        baseline_min_score = calibration.baseline_min_score

    return [
        ModelFamily(
            name="baseline_total",
            score_column="baseline_score",
            description="Core CANSLIM total score only.",
            top_n=top_n,
            min_score=baseline_min_score,
        ),
        ModelFamily(
            name="tactical_overlay",
            score_column="tactical_score",
            description="Adds breakout follow-through and exit-risk discipline.",
            top_n=top_n,
        ),
        ModelFamily(
            name="enhanced_rank",
            score_column="enhanced_score",
            description="Uses the full Wave 2/3 overlay-aware rank.",
            top_n=top_n,
        ),
    ]


def _symbol_list(frame: pd.DataFrame) -> list[str]:
    if "symbol" in frame.columns:
        return frame["symbol"].astype(str).tolist()
    return [str(idx) for idx in frame.index]


def _select_candidates(frame: pd.DataFrame, family: ModelFamily) -> pd.DataFrame:
    if frame.empty or family.score_column not in frame.columns:
        return frame.iloc[0:0].copy()

    selected = frame.copy()
    if family.min_score is not None:
        selected = selected[pd.to_numeric(selected[family.score_column], errors="coerce") >= family.min_score]

    sort_columns = [family.score_column]
    for column in ("effective_confidence", "confidence", "uncertainty_pct", "total_score", "symbol"):
        if column in selected.columns and column not in sort_columns:
            sort_columns.append(column)

    if selected.empty:
        return selected

    ascending = [False] * len(sort_columns)
    if "uncertainty_pct" in sort_columns:
        ascending[sort_columns.index("uncertainty_pct")] = True
    if "symbol" in sort_columns:
        ascending[sort_columns.index("symbol")] = True

    selected = selected.sort_values(sort_columns, ascending=ascending, kind="mergesort")
    if family.top_n is not None:
        selected = selected.head(family.top_n)
    return selected.reset_index(drop=True)


def _safe_mean(frame: pd.DataFrame, column: str) -> float:
    if column not in frame.columns or frame.empty:
        return 0.0
    series = pd.to_numeric(frame[column], errors="coerce").dropna()
    if series.empty:
        return 0.0
    return float(series.mean())


def _safe_median(frame: pd.DataFrame, column: str) -> float:
    if column not in frame.columns or frame.empty:
        return 0.0
    series = pd.to_numeric(frame[column], errors="coerce").dropna()
    if series.empty:
        return 0.0
    return float(series.median())


def _safe_mean_with_fallback(frame: pd.DataFrame, primary: str, fallback: str) -> float:
    if primary in frame.columns:
        return _safe_mean(frame, primary)
    return _safe_mean(frame, fallback)


def _safe_bool_series(frame: pd.DataFrame, column: str) -> pd.Series:
    if frame.empty or column not in frame.columns:
        return pd.Series(False, index=frame.index, dtype=bool)
    values = frame[column]
    if pd.api.types.is_bool_dtype(values):
        return values.fillna(False).astype(bool)
    return pd.to_numeric(values, errors="coerce").fillna(0).astype(bool)


def _safe_action_series(frame: pd.DataFrame, column: str) -> pd.Series:
    if frame.empty or column not in frame.columns:
        return pd.Series("", index=frame.index, dtype=object)
    return frame[column].fillna("").astype(str).str.upper()


def _outcome_mask(
    frame: pd.DataFrame,
    *,
    future_return_column: str,
    outcome_bucket_column: str,
    positive: bool,
) -> pd.Series:
    if frame.empty:
        return pd.Series(False, index=frame.index, dtype=bool)

    mask = pd.Series(False, index=frame.index, dtype=bool)
    if outcome_bucket_column in frame.columns:
        buckets = frame[outcome_bucket_column].fillna("").astype(str).str.lower()
        mask = mask | buckets.eq("win" if positive else "loss")
    if future_return_column in frame.columns:
        future_returns = pd.to_numeric(frame[future_return_column], errors="coerce")
        mask = mask | (future_returns.gt(0) if positive else future_returns.le(0))
    return mask.fillna(False).astype(bool)


def _safe_masked_mean(frame: pd.DataFrame, column: str, mask: pd.Series) -> float:
    if frame.empty or column not in frame.columns or mask.empty or not bool(mask.any()):
        return 0.0
    series = pd.to_numeric(frame.loc[mask, column], errors="coerce").dropna()
    if series.empty:
        return 0.0
    return float(series.mean())


def _safe_label_mode(frame: pd.DataFrame, column: str, default: str = "n/a") -> str:
    if column not in frame.columns or frame.empty:
        return default
    labels = [str(value).strip() for value in frame[column].fillna("").astype(str) if str(value).strip()]
    if not labels:
        return default
    counts = Counter(labels)
    return sorted(counts.items(), key=lambda item: (-item[1], item[0]))[0][0]


def _format_pick_risk_details(record: Dict[str, object]) -> str:
    symbol = str(record.get("symbol", "")).strip()
    if not symbol:
        return ""

    action = str(record.get("action", "")).strip()
    parts = [symbol]
    if action:
        parts.append(action)

    trade_quality = record.get("trade_quality_score")
    if trade_quality is not None:
        try:
            parts.append(f"tq {float(trade_quality):.1f}")
        except (TypeError, ValueError):
            pass

    effective_confidence = record.get("effective_confidence", record.get("confidence"))
    uncertainty_pct = record.get("uncertainty_pct")
    confidence_bits = []
    try:
        confidence_bits.append(f"conf {float(effective_confidence):.0f}%")
    except (TypeError, ValueError):
        pass
    try:
        confidence_bits.append(f"u {float(uncertainty_pct):.0f}%")
    except (TypeError, ValueError):
        pass
    if confidence_bits:
        parts.append(" ".join(confidence_bits))

    downside_penalty = record.get("downside_penalty")
    churn_penalty = record.get("churn_penalty")
    risk_bits = []
    try:
        risk_bits.append(f"down {float(downside_penalty):.1f}")
    except (TypeError, ValueError):
        pass
    try:
        risk_bits.append(f"churn {float(churn_penalty):.1f}")
    except (TypeError, ValueError):
        pass
    if risk_bits:
        parts.append(" ".join(risk_bits))

    adverse_label = str(record.get("adverse_regime_label", "") or "").strip()
    adverse_score = record.get("adverse_regime_score")
    adverse_bits = []
    if adverse_label:
        adverse_bits.append(adverse_label)
    try:
        adverse_bits.append(f"{float(adverse_score):.0f}")
    except (TypeError, ValueError):
        pass
    if adverse_bits and (adverse_label.lower() != "normal" or float(adverse_score or 0.0) > 0):
        parts.append(f"stress {'/'.join(adverse_bits)}")

    if bool(record.get("abstain", False)):
        parts.append("ABSTAIN")

    return " | ".join(parts)


def _rate(frame: pd.DataFrame, series: pd.Series) -> float:
    if frame.empty or series.empty:
        return 0.0
    return round(float(series.mean() * 100.0), 1)


def _safe_datetime_series(frame: pd.DataFrame, column: str) -> pd.Series:
    if frame.empty or column not in frame.columns:
        return pd.Series(pd.NaT, index=frame.index, dtype="datetime64[ns]")
    return pd.to_datetime(frame[column], errors="coerce")


def _format_date_label(timestamp: pd.Timestamp) -> str:
    if pd.isna(timestamp):
        return "n/a"
    return timestamp.strftime("%Y-%m-%d")


def _summarize_review_slice_model(
    selected: pd.DataFrame,
    *,
    model_name: str,
    row_ids: set[int],
    future_return_column: str,
    outcome_bucket_column: str,
) -> Dict[str, object]:
    if selected.empty or "__comparison_row_id" not in selected.columns:
        filtered = selected.iloc[0:0].copy()
    else:
        filtered = selected[selected["__comparison_row_id"].isin(row_ids)].reset_index(drop=True)

    record: Dict[str, object] = {
        "model": model_name,
        "selected_count": int(len(filtered)),
        "symbols": _symbol_list(filtered)[:3],
        "avg_future_return_pct": round(_safe_mean(filtered, future_return_column), 2),
        "hit_rate_pct": 0.0,
        "win_rate_pct": 0.0,
    }
    if future_return_column in filtered.columns and not filtered.empty:
        future_returns = pd.to_numeric(filtered[future_return_column], errors="coerce").dropna()
        if not future_returns.empty:
            record["hit_rate_pct"] = _rate(filtered, future_returns > 0)
    if outcome_bucket_column in filtered.columns and not filtered.empty:
        buckets = filtered[outcome_bucket_column].fillna("").astype(str).str.lower()
        record["win_rate_pct"] = _rate(filtered, buckets == "win")
    return record


def _build_regime_review_section(
    frame: pd.DataFrame,
    selections: Dict[str, pd.DataFrame],
    families: Sequence[ModelFamily],
    *,
    future_return_column: str,
    outcome_bucket_column: str,
) -> Optional[Dict[str, object]]:
    for column in ("market_regime", "adverse_regime_label"):
        if column not in frame.columns:
            continue
        labels = frame[column].fillna("").astype(str).str.strip()
        labels = labels[labels != ""]
        if labels.empty:
            continue
        counts = Counter(labels)
        if len(counts) < 2:
            continue

        slices = []
        for value, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:3]:
            row_ids = set(
                pd.to_numeric(
                    frame.loc[frame[column].fillna("").astype(str).str.strip() == value, "__comparison_row_id"],
                    errors="coerce",
                ).dropna().astype(int)
            )
            slices.append(
                {
                    "label": value,
                    "candidate_count": int(count),
                    "models": [
                        _summarize_review_slice_model(
                            selections.get(family.name, frame.iloc[0:0]),
                            model_name=family.name,
                            row_ids=row_ids,
                            future_return_column=future_return_column,
                            outcome_bucket_column=outcome_bucket_column,
                        )
                        for family in families
                    ],
                }
            )
        return {
            "title": f"Regime split ({column})",
            "source_column": column,
            "slices": slices,
        }
    return None


def _build_time_review_section(
    frame: pd.DataFrame,
    selections: Dict[str, pd.DataFrame],
    families: Sequence[ModelFamily],
    *,
    future_return_column: str,
    outcome_bucket_column: str,
) -> Optional[Dict[str, object]]:
    for column in ("entry_date", "signal_date", "review_date", "date", "as_of_date", "timestamp"):
        dates = _safe_datetime_series(frame, column)
        valid_dates = dates.dropna()
        if valid_dates.nunique() < 2:
            continue

        ordered_index = list(valid_dates.sort_values(kind="mergesort").index)
        midpoint = len(ordered_index) // 2
        if midpoint <= 0 or midpoint >= len(ordered_index):
            continue

        slices = []
        for label, slice_index in (("early", ordered_index[:midpoint]), ("late", ordered_index[midpoint:])):
            slice_dates = dates.loc[slice_index].dropna()
            if slice_dates.empty:
                continue
            row_ids = set(
                pd.to_numeric(frame.loc[slice_index, "__comparison_row_id"], errors="coerce").dropna().astype(int)
            )
            date_span = f"{_format_date_label(slice_dates.min())}..{_format_date_label(slice_dates.max())}"
            slices.append(
                {
                    "label": f"{label} {date_span}",
                    "candidate_count": int(len(slice_index)),
                    "models": [
                        _summarize_review_slice_model(
                            selections.get(family.name, frame.iloc[0:0]),
                            model_name=family.name,
                            row_ids=row_ids,
                            future_return_column=future_return_column,
                            outcome_bucket_column=outcome_bucket_column,
                        )
                        for family in families
                    ],
                }
            )
        if len(slices) == 2:
            return {
                "title": f"Time split ({column})",
                "source_column": column,
                "slices": slices,
            }
    return None


def _build_review_slices(
    frame: pd.DataFrame,
    selections: Dict[str, pd.DataFrame],
    families: Sequence[ModelFamily],
    *,
    future_return_column: str,
    outcome_bucket_column: str,
) -> list[Dict[str, object]]:
    sections = []
    regime_section = _build_regime_review_section(
        frame,
        selections,
        families,
        future_return_column=future_return_column,
        outcome_bucket_column=outcome_bucket_column,
    )
    if regime_section is not None:
        sections.append(regime_section)

    time_section = _build_time_review_section(
        frame,
        selections,
        families,
        future_return_column=future_return_column,
        outcome_bucket_column=outcome_bucket_column,
    )
    if time_section is not None:
        sections.append(time_section)
    return sections


def compare_model_families(
    candidates: pd.DataFrame,
    families: Sequence[ModelFamily],
    *,
    baseline_name: Optional[str] = None,
    future_return_column: str = "future_return_pct",
    outcome_bucket_column: str = "outcome_bucket",
    action_column: str = "action",
    calibration: ModelComparisonCalibration = MODEL_COMPARISON_CALIBRATION,
) -> tuple[pd.DataFrame, Dict[str, pd.DataFrame]]:
    """Compare how different score families rank and filter the same candidate set."""
    frame = attach_model_family_scores(candidates, calibration=calibration).copy()
    frame["__comparison_row_id"] = range(len(frame))
    selections = {family.name: _select_candidates(frame, family) for family in families}

    if baseline_name is None and families:
        baseline_name = families[0].name
    baseline_selected = selections.get(baseline_name, frame.iloc[0:0])
    baseline_symbols = set(_symbol_list(baseline_selected))

    rows = []
    universe_size = len(frame)
    for family in families:
        selected = selections[family.name]
        symbols = set(_symbol_list(selected))
        action_series = _safe_action_series(selected, action_column)
        abstain_series = _safe_bool_series(selected, "abstain")
        buy_mask = action_series.eq("BUY") & ~abstain_series
        restraint_mask = ~action_series.eq("BUY") | abstain_series
        veto_mask = action_series.eq("NO_BUY") | abstain_series
        bad_outcome_mask = _outcome_mask(
            selected,
            future_return_column=future_return_column,
            outcome_bucket_column=outcome_bucket_column,
            positive=False,
        )
        row = {
            "model": family.name,
            "score_column": family.score_column,
            "description": family.description,
            "universe_size": int(universe_size),
            "selected_count": int(len(selected)),
            "coverage_pct": round((len(selected) / universe_size) * 100.0, 1) if universe_size else 0.0,
            "avg_score": round(_safe_mean(selected, family.score_column), 2),
            "avg_trade_quality_score": round(_safe_mean(selected, "trade_quality_score"), 2),
            "avg_confidence": round(_safe_mean_with_fallback(selected, "confidence", "effective_confidence"), 1),
            "avg_effective_confidence": round(_safe_mean_with_fallback(selected, "effective_confidence", "confidence"), 1),
            "avg_uncertainty_pct": round(_safe_mean(selected, "uncertainty_pct"), 1),
            "avg_downside_penalty": round(_safe_mean(selected, "downside_penalty"), 2),
            "avg_churn_penalty": round(_safe_mean(selected, "churn_penalty"), 2),
            "avg_adverse_regime_score": round(_safe_mean(selected, "adverse_regime_score"), 2),
            "top_adverse_regime_label": _safe_label_mode(selected, "adverse_regime_label", default="n/a"),
            "buy_count": int(action_series.eq("BUY").sum()),
            "watch_count": int(action_series.eq("WATCH").sum()),
            "no_buy_count": int(action_series.eq("NO_BUY").sum()),
            "abstain_count": int(abstain_series.sum()),
            "abstain_rate_pct": 0.0,
            "restraint_count": int(restraint_mask.sum()),
            "restraint_rate_pct": 0.0,
            "buy_avg_future_return_pct": round(_safe_masked_mean(selected, future_return_column, buy_mask), 2),
            "restraint_avg_future_return_pct": round(_safe_masked_mean(selected, future_return_column, restraint_mask), 2),
            "restraint_bad_outcome_count": int((restraint_mask & bad_outcome_mask).sum()),
            "veto_preserved_bad_outcome_count": int((veto_mask & bad_outcome_mask).sum()),
            "avg_future_return_pct": round(_safe_mean(selected, future_return_column), 2),
            "median_future_return_pct": round(_safe_median(selected, future_return_column), 2),
            "hit_rate_pct": 0.0,
            "win_rate_pct": 0.0,
            "loss_rate_pct": 0.0,
            "overlap_with_baseline": 0,
            "model_only_count": 0,
            "baseline_only_count": 0,
            "avoided_baseline_bad_outcome_count": 0,
            "missed_baseline_good_outcome_count": 0,
        }

        if future_return_column in selected.columns and not selected.empty:
            future_returns = pd.to_numeric(selected[future_return_column], errors="coerce").dropna()
            if not future_returns.empty:
                row["hit_rate_pct"] = _rate(selected, future_returns > 0)

        if outcome_bucket_column in selected.columns and not selected.empty:
            buckets = selected[outcome_bucket_column].fillna("").astype(str).str.lower()
            row["win_rate_pct"] = _rate(selected, buckets == "win")
            row["loss_rate_pct"] = _rate(selected, buckets == "loss")

        if baseline_symbols:
            row["overlap_with_baseline"] = len(symbols.intersection(baseline_symbols))
            row["model_only_count"] = len(symbols - baseline_symbols)
            row["baseline_only_count"] = len(baseline_symbols - symbols)
            if family.name != baseline_name and "symbol" in baseline_selected.columns:
                baseline_only = baseline_selected[
                    ~baseline_selected["symbol"].astype(str).isin(symbols)
                ].reset_index(drop=True)
                row["avoided_baseline_bad_outcome_count"] = int(
                    _outcome_mask(
                        baseline_only,
                        future_return_column=future_return_column,
                        outcome_bucket_column=outcome_bucket_column,
                        positive=False,
                    ).sum()
                )
                row["missed_baseline_good_outcome_count"] = int(
                    _outcome_mask(
                        baseline_only,
                        future_return_column=future_return_column,
                        outcome_bucket_column=outcome_bucket_column,
                        positive=True,
                    ).sum()
                )

        if row["selected_count"]:
            row["abstain_rate_pct"] = round((row["abstain_count"] / row["selected_count"]) * 100.0, 1)
            row["restraint_rate_pct"] = round((row["restraint_count"] / row["selected_count"]) * 100.0, 1)

        rows.append(row)

    summary = pd.DataFrame(rows)
    summary.attrs["review_slices"] = _build_review_slices(
        frame,
        selections,
        families,
        future_return_column=future_return_column,
        outcome_bucket_column=outcome_bucket_column,
    )
    return summary, selections


def render_model_comparison_report(
    summary: pd.DataFrame,
    selections: Dict[str, pd.DataFrame],
    *,
    baseline_name: Optional[str] = None,
    title: str = "Wave 4 Model Comparison",
    symbol_limit: int = 5,
) -> str:
    """Format a concise text report for reviewing model-family differences."""
    if summary.empty:
        return f"{title}\nNo candidates available for comparison."

    if baseline_name is None:
        baseline_name = str(summary.iloc[0]["model"])

    universe_size = int(summary.iloc[0].get("universe_size", 0))
    lines = [title, f"Universe: {universe_size} candidates"]

    for row in summary.to_dict(orient="records"):
        model = row["model"]
        selected = selections.get(model, pd.DataFrame())
        symbols = _symbol_list(selected)[:symbol_limit]
        line = (
            f"{model}: picked {row['selected_count']} | avg {row['score_column']} {row['avg_score']:.2f}"
            f" | buys {row['buy_count']} | watches {row['watch_count']} | no-buy {row['no_buy_count']}"
        )
        if row.get("avg_trade_quality_score", 0.0) > 0:
            line += f" | avg tq {row['avg_trade_quality_score']:.2f}"
        if row["avg_confidence"] > 0:
            line += f" | avg conf {row['avg_confidence']:.1f}%"
        if row.get("avg_effective_confidence", 0.0) > 0:
            line += f" | eff conf {row['avg_effective_confidence']:.1f}%"
        if row.get("avg_uncertainty_pct", 0.0) > 0:
            line += f" | avg uncertainty {row['avg_uncertainty_pct']:.1f}%"
        if row.get("avg_downside_penalty", 0.0) > 0 or row.get("avg_churn_penalty", 0.0) > 0:
            line += f" | avg downside/churn proxy {row['avg_downside_penalty']:.2f}/{row['avg_churn_penalty']:.2f}"
        if row.get("avg_adverse_regime_score", 0.0) > 0 or row.get("top_adverse_regime_label") not in {"", "n/a"}:
            line += f" | avg stress {row['avg_adverse_regime_score']:.1f} ({row['top_adverse_regime_label']})"
        if row.get("restraint_count", 0) > 0:
            line += f" | restraint {row['restraint_count']} ({row['restraint_rate_pct']:.1f}%)"
        if row.get("abstain_count", 0) > 0:
            line += f" | abstain {row['abstain_count']}"
        if row["avg_future_return_pct"] != 0.0 or row["hit_rate_pct"] != 0.0:
            line += (
                f" | avg return {row['avg_future_return_pct']:+.2f}%"
                f" | hit rate {row['hit_rate_pct']:.1f}%"
            )
        if row["win_rate_pct"] != 0.0 or row["loss_rate_pct"] != 0.0:
            line += (
                f" | win/loss {row['win_rate_pct']:.1f}%/{row['loss_rate_pct']:.1f}%"
            )
        lines.append(line)

        if model != baseline_name:
            overlap_line = (
                f"  overlap vs {baseline_name}: {row['overlap_with_baseline']} | "
                f"model-only {row['model_only_count']} | baseline-only {row['baseline_only_count']}"
            )
            if row.get("avoided_baseline_bad_outcome_count", 0) > 0 or row.get("missed_baseline_good_outcome_count", 0) > 0:
                overlap_line += (
                    f" | avoided baseline bad outcomes {row['avoided_baseline_bad_outcome_count']}"
                    f" | missed baseline good outcomes {row['missed_baseline_good_outcome_count']}"
                )
            lines.append(overlap_line)

        discipline_chunks = []
        if row.get("buy_avg_future_return_pct", 0.0) != 0.0:
            discipline_chunks.append(f"buy avg return {row['buy_avg_future_return_pct']:+.2f}%")
        if row.get("restraint_count", 0) > 0 and row.get("restraint_avg_future_return_pct", 0.0) != 0.0:
            discipline_chunks.append(f"restrained avg return {row['restraint_avg_future_return_pct']:+.2f}%")
        if row.get("restraint_bad_outcome_count", 0) > 0:
            discipline_chunks.append(f"restraint bad-outcome proxy {row['restraint_bad_outcome_count']}")
        if row.get("veto_preserved_bad_outcome_count", 0) > 0:
            discipline_chunks.append(f"veto-preserved bad outcomes {row['veto_preserved_bad_outcome_count']}")
        if discipline_chunks:
            lines.append(f"  discipline: {' | '.join(discipline_chunks)}")

        if symbols:
            lines.append(f"  picks: {', '.join(symbols)}")
            pick_details = [
                _format_pick_risk_details(record)
                for record in selected.head(symbol_limit).to_dict(orient="records")
            ]
            pick_details = [detail for detail in pick_details if detail]
            if pick_details:
                lines.append(f"  risk: {'; '.join(pick_details)}")

    review_slices = summary.attrs.get("review_slices", [])
    if review_slices:
        lines.append("Review slices:")
        for section in review_slices:
            lines.append(f"  {section['title']}:")
            for slice_row in section.get("slices", []):
                model_parts = []
                for model_row in slice_row.get("models", []):
                    part = f"{model_row['model']} {model_row['selected_count']}"
                    slice_symbols = model_row.get("symbols", [])
                    if slice_symbols:
                        part += f" [{', '.join(slice_symbols)}]"
                    if model_row["selected_count"] > 0 and (
                        model_row.get("avg_future_return_pct", 0.0) != 0.0
                        or model_row.get("hit_rate_pct", 0.0) != 0.0
                        or model_row.get("win_rate_pct", 0.0) != 0.0
                    ):
                        part += (
                            f" {model_row['avg_future_return_pct']:+.2f}%/"
                            f"{model_row['hit_rate_pct']:.1f}%"
                        )
                    model_parts.append(part)
                lines.append(
                    f"  {slice_row['label']} ({slice_row['candidate_count']} cands): {'; '.join(model_parts)}"
                )

    return "\n".join(lines)
