#!/usr/bin/env python3
"""Paper-only experimental alpha pipeline using quick-check + Polymarket context.

This module is intentionally isolated from the production alert path.
It does not place trades or mutate any runtime production artifacts.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterable, Optional, Sequence

import pandas as pd

from advisor import TradingAdvisor
from data.market_data_provider import MarketDataProvider
from data.polymarket_context import load_structured_context

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


@dataclass
class ActionCalibration:
    action: str
    count: int
    hit_rate_5d: float | None
    avg_return_5d: float | None
    avg_return_10d: float | None
    brier_5d: float | None


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
            f"{candidate.rationale}"
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

    gate = build_promotion_gate(by_action, minimum_samples=minimum_samples)
    return CalibrationReport(
        generated_at=generated_at.isoformat(),
        settled_candidates=len(settled),
        by_action=by_action,
        gate=gate,
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
    return "\n".join(lines)


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
