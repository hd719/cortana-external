"""Helpers for consuming materialized Polymarket market-intel artifacts."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


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


def load_compact_context(max_age_hours: float = 8.0) -> Optional[str]:
    report_path = latest_report_json_path()
    compact_path = latest_compact_report_path()
    if not report_path.exists() or not compact_path.exists():
        return None

    try:
        payload = json.loads(report_path.read_text())
        generated_at = str(payload.get("metadata", {}).get("generatedAt", "")).strip()
        if not generated_at:
            return None
        generated = datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
        age_hours = (datetime.now(timezone.utc) - generated).total_seconds() / 3600.0
        if age_hours > max_age_hours:
            return None
        return compact_path.read_text().strip() or None
    except Exception:
        return None
