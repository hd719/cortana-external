"""Helpers for consuming materialized Polymarket market-intel artifacts."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def latest_compact_report_path() -> Path:
    return Path(
        os.getenv(
            "POLYMARKET_COMPACT_REPORT_PATH",
            str(_repo_root() / "var" / "market-intel" / "polymarket" / "latest-compact.txt"),
        )
    )


def latest_report_json_path() -> Path:
    return Path(
        os.getenv(
            "POLYMARKET_REPORT_JSON_PATH",
            str(_repo_root() / "var" / "market-intel" / "polymarket" / "latest-report.json"),
        )
    )


def latest_watchlist_path() -> Path:
    return Path(
        os.getenv(
            "POLYMARKET_WATCHLIST_PATH",
            str(Path(__file__).parent / "polymarket_watchlist.json"),
        )
    )


def _load_json(path: Path) -> Optional[dict[str, Any]]:
    try:
        payload = json.loads(path.read_text())
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


def _parse_generated_at(payload: dict[str, Any]) -> Optional[datetime]:
    generated_at = str(payload.get("metadata", {}).get("generatedAt", "")).strip()
    if not generated_at:
        return None
    try:
        return datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
    except Exception:
        return None


def _parse_updated_at(payload: dict[str, Any]) -> Optional[datetime]:
    updated_at = str(payload.get("updated_at", "")).strip()
    if not updated_at:
        return None
    try:
        return datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
    except Exception:
        return None


def load_watchlist_entries(max_age_hours: float = 8.0) -> list[dict[str, Any]]:
    report_path = latest_report_json_path()
    watchlist_path = latest_watchlist_path()
    if not report_path.exists() or not watchlist_path.exists():
        return []

    report_payload = _load_json(report_path)
    watchlist_payload = _load_json(watchlist_path)
    if report_payload is None or watchlist_payload is None:
        return []

    report_generated = _parse_generated_at(report_payload)
    watchlist_updated = _parse_updated_at(watchlist_payload)
    if report_generated is None or watchlist_updated is None:
        return []

    now = datetime.now(timezone.utc)
    report_age_hours = (now - report_generated).total_seconds() / 3600.0
    watchlist_age_hours = (now - watchlist_updated).total_seconds() / 3600.0
    if report_age_hours > max_age_hours or watchlist_age_hours > max_age_hours:
        return []

    tickers = watchlist_payload.get("tickers", [])
    return tickers if isinstance(tickers, list) else []


def load_compact_context(max_age_hours: float = 8.0) -> Optional[str]:
    report_path = latest_report_json_path()
    compact_path = latest_compact_report_path()
    if not report_path.exists() or not compact_path.exists():
        return None

    try:
        payload = _load_json(report_path)
        if payload is None:
            return None
        generated = _parse_generated_at(payload)
        if generated is None:
            return None
        age_hours = (datetime.now(timezone.utc) - generated).total_seconds() / 3600.0
        if age_hours > max_age_hours:
            return None
        return compact_path.read_text().strip() or None
    except Exception:
        return None
