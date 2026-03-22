"""Lightweight prediction logging + settlement for alert outputs."""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, Optional

import pandas as pd

from data.market_data_provider import MarketDataError, MarketDataProvider

DEFAULT_HORIZONS = (1, 5, 20)


@dataclass(frozen=True)
class PredictionRecord:
    symbol: str
    action: str
    score: float | None
    confidence: float | None
    reason: str


def default_prediction_root() -> Path:
    return Path(__file__).resolve().parents[1] / ".cache" / "prediction_accuracy"


def persist_prediction_snapshot(
    *,
    strategy: str,
    market_regime: str,
    records: Iterable[dict],
    root: Optional[Path] = None,
    generated_at: Optional[datetime] = None,
) -> Path | None:
    normalized = [_normalize_record(item) for item in records]
    normalized = [item for item in normalized if item is not None]
    if not normalized:
        return None

    now = generated_at or datetime.now(timezone.utc)
    payload = {
        "strategy": strategy,
        "market_regime": market_regime,
        "generated_at": now.isoformat(),
        "records": [asdict(item) for item in normalized],
    }
    out_dir = (root or default_prediction_root()) / "snapshots"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{now.strftime('%Y%m%d-%H%M%S-%f')}-{strategy}.json"
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path


def settle_prediction_snapshots(
    *,
    root: Optional[Path] = None,
    horizons: tuple[int, ...] = DEFAULT_HORIZONS,
    provider: Optional[MarketDataProvider] = None,
    now: Optional[datetime] = None,
) -> list[dict]:
    base = root or default_prediction_root()
    snapshots_dir = base / "snapshots"
    settled_dir = base / "settled"
    settled_dir.mkdir(parents=True, exist_ok=True)
    provider = provider or MarketDataProvider()
    current_time = now or datetime.now(timezone.utc)
    settled: list[dict] = []

    for path in sorted(snapshots_dir.glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        generated_at = _parse_dt(payload.get("generated_at"))
        if generated_at is None:
            continue
        out_path = settled_dir / path.name
        records = payload.get("records") or []
        settled_records = []
        for record in records:
            symbol = str(record.get("symbol") or "").strip().upper()
            if not symbol:
                continue
            settlement = _settle_record(
                symbol=symbol,
                generated_at=generated_at,
                horizons=horizons,
                provider=provider,
                now=current_time,
            )
            settled_records.append({**record, **settlement})
        out_payload = {
            "strategy": payload.get("strategy"),
            "market_regime": payload.get("market_regime"),
            "generated_at": payload.get("generated_at"),
            "settled_at": current_time.isoformat(),
            "records": settled_records,
        }
        out_path.write_text(json.dumps(out_payload, indent=2), encoding="utf-8")
        settled.append(out_payload)
    return settled


def build_prediction_accuracy_summary(root: Optional[Path] = None) -> dict:
    base = root or default_prediction_root()
    settled_dir = base / "settled"
    buckets: dict[tuple[str, str], dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    snapshot_count = 0
    for path in sorted(settled_dir.glob("*.json")):
        snapshot_count += 1
        payload = json.loads(path.read_text(encoding="utf-8"))
        strategy = str(payload.get("strategy") or "unknown")
        for record in payload.get("records") or []:
            action = str(record.get("action") or "UNKNOWN").upper()
            for horizon_key, value in (record.get("forward_returns_pct") or {}).items():
                if isinstance(value, (int, float)):
                    buckets[(strategy, action)][horizon_key].append(float(value))

    summary_rows = []
    for (strategy, action), series in sorted(buckets.items()):
        row = {"strategy": strategy, "action": action}
        for horizon_key, values in sorted(series.items()):
            if not values:
                continue
            avg_return = sum(values) / len(values)
            hit_rate = sum(1 for value in values if value > 0) / len(values)
            row[horizon_key] = {
                "samples": len(values),
                "avg_return_pct": round(avg_return, 3),
                "hit_rate": round(hit_rate, 3),
            }
        summary_rows.append(row)

    artifact = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "snapshot_count": snapshot_count,
        "summary": summary_rows,
    }
    reports_dir = base / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    (reports_dir / "prediction-accuracy-latest.json").write_text(json.dumps(artifact, indent=2), encoding="utf-8")
    return artifact


def _normalize_record(item: dict) -> PredictionRecord | None:
    symbol = str(item.get("symbol") or "").strip().upper()
    if not symbol:
        return None
    return PredictionRecord(
        symbol=symbol,
        action=str(item.get("action") or "UNKNOWN").strip().upper(),
        score=_to_float(item.get("score")),
        confidence=_to_float(
            item.get("effective_confidence", item.get("confidence"))
        ),
        reason=str(item.get("reason") or "").strip(),
    )


def _settle_record(
    *,
    symbol: str,
    generated_at: datetime,
    horizons: tuple[int, ...],
    provider: MarketDataProvider,
    now: datetime,
) -> dict:
    try:
        history = provider.get_history(symbol, period="6mo").frame.copy()
    except MarketDataError as error:
        return {"settlement_error": str(error), "forward_returns_pct": {}}

    if history.empty:
        return {"settlement_error": "empty history", "forward_returns_pct": {}}

    history.index = pd.to_datetime(history.index, utc=True)
    anchor = history.loc[history.index >= generated_at]
    if anchor.empty:
        return {"settlement_error": "no anchor bar after prediction", "forward_returns_pct": {}}

    anchor_close = float(anchor.iloc[0]["Close"])
    forward_returns = {}
    for horizon in horizons:
        horizon_cutoff = generated_at + timedelta(days=horizon)
        if now < horizon_cutoff:
            continue
        future_rows = history.loc[history.index >= horizon_cutoff]
        if future_rows.empty:
            continue
        future_close = float(future_rows.iloc[0]["Close"])
        if anchor_close:
            forward_returns[f"{horizon}d"] = round(((future_close - anchor_close) / anchor_close) * 100.0, 3)
    return {"forward_returns_pct": forward_returns}


def _to_float(value: object) -> float | None:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if numeric != numeric:
        return None
    return numeric


def _parse_dt(value: object) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)
