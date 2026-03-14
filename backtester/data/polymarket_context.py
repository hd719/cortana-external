"""Helpers for consuming materialized Polymarket market-intel artifacts."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional


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


def _report_is_fresh(payload: dict[str, Any], max_age_hours: float) -> bool:
    generated = _parse_generated_at(payload)
    if generated is None:
        return False

    age_hours = (datetime.now(timezone.utc) - generated).total_seconds() / 3600.0
    return age_hours <= max_age_hours


def load_watchlist_entries(
    max_age_hours: float = 8.0,
    allowed_asset_classes: Optional[Iterable[str]] = None,
) -> list[dict[str, Any]]:
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
    if not isinstance(tickers, list):
        return []

    allowed = {str(item).strip().lower() for item in (allowed_asset_classes or []) if str(item).strip()}
    if not allowed:
        return tickers

    return [
        item
        for item in tickers
        if str(item.get("asset_class", "")).strip().lower() in allowed
    ]


def load_structured_context(max_age_hours: float = 8.0) -> Optional[dict[str, Any]]:
    report_path = latest_report_json_path()
    if not report_path.exists():
        return None

    payload = _load_json(report_path)
    if payload is None or not _report_is_fresh(payload, max_age_hours):
        return None
    return payload


def load_compact_context(max_age_hours: float = 8.0) -> Optional[str]:
    report_path = latest_report_json_path()
    compact_path = latest_compact_report_path()
    if not report_path.exists() or not compact_path.exists():
        return None

    try:
        payload = _load_json(report_path)
        if payload is None:
            return None
        if not _report_is_fresh(payload, max_age_hours):
            return None
        return compact_path.read_text().strip() or None
    except Exception:
        return None


def build_alert_context_lines(
    technical_watchlist: Optional[Iterable[str]] = None,
    max_age_hours: float = 8.0,
) -> list[str]:
    compact = load_compact_context(max_age_hours=max_age_hours)
    report = load_structured_context(max_age_hours=max_age_hours)
    if compact is None:
        return []

    compact_lines = [line for line in compact.splitlines() if not line.startswith("Watchlist:")]
    if report is None:
        return compact_lines

    lines = list(compact_lines)
    summary = report.get("summary", {})
    posture_line = _format_posture_line(summary)
    if posture_line:
        lines.append(posture_line)

    focus_line = _format_focus_line(report, technical_watchlist or [])
    if focus_line:
        lines.append(focus_line)

    return lines


def _format_posture_line(summary: dict[str, Any]) -> Optional[str]:
    conviction = str(summary.get("conviction", "")).strip()
    aggression = str(summary.get("aggressionDial", "") or summary.get("aggression_dial", "")).strip()
    divergence = summary.get("divergence", {})
    divergence_summary = str(divergence.get("summary", "")).strip() if isinstance(divergence, dict) else ""
    parts = []
    if conviction:
        parts.append(f"conviction {conviction}")
    if aggression:
        parts.append(f"aggression {aggression.replace('_', ' ')}")
    if divergence_summary:
        parts.append(f"divergence {divergence_summary.lower()}")
    return f"Polymarket posture: {' | '.join(parts)}" if parts else None


def _format_focus_line(report: dict[str, Any], technical_watchlist: Iterable[str]) -> Optional[str]:
    technical = {str(symbol).strip().upper() for symbol in technical_watchlist if str(symbol).strip()}
    tickers = report.get("watchlistBuckets") or report.get("watchlist_buckets") or {}
    entries = []
    for key in ("stocks", "cryptoProxies", "crypto", "funds", "crypto_proxies"):
        bucket = tickers.get(key, [])
        if isinstance(bucket, list):
            entries.extend(bucket)

    overlap = []
    early = []
    crypto = []

    for item in entries:
        symbol = str(item.get("symbol", "")).strip().upper()
        if not symbol:
            continue
        asset_class = str(item.get("assetClass", "") or item.get("asset_class", "")).strip().lower()
        severity = str(item.get("severity", "minor")).strip().lower()
        persistence = str(item.get("persistence", "one_off")).strip().lower()
        ranked = severity in {"notable", "major"} or persistence in {"persistent", "accelerating", "reversing"}

        if symbol in technical and symbol not in overlap:
            overlap.append(symbol)
        elif ranked and symbol not in early:
            early.append(symbol)

        if asset_class in {"crypto", "crypto_proxy"} and symbol not in crypto:
            crypto.append(symbol)

    parts = []
    if overlap:
        parts.append(f"overlap {', '.join(overlap[:3])}{_suffix_count(overlap, 3)}")
    if early:
        parts.append(f"early {', '.join(early[:3])}{_suffix_count(early, 3)}")
    if crypto:
        parts.append(f"crypto {', '.join(crypto[:3])}{_suffix_count(crypto, 3)}")

    return f"Polymarket focus: {' | '.join(parts)}" if parts else None


def _suffix_count(values: list[str], limit: int) -> str:
    extra = len(values) - limit
    return f" (+{extra} more)" if extra > 0 else ""


def load_symbol_context(symbol: str, max_age_hours: float = 8.0) -> Optional[dict[str, Any]]:
    report = load_structured_context(max_age_hours=max_age_hours)
    if report is None:
        return None

    target = _normalize_symbol_key(symbol)
    if not target:
        return None

    buckets = report.get("watchlistBuckets") or report.get("watchlist_buckets") or {}
    matched = None

    for key in ("stocks", "cryptoProxies", "crypto", "funds", "crypto_proxies"):
        entries = buckets.get(key, [])
        if not isinstance(entries, list):
            continue
        for item in entries:
            candidate = _normalize_symbol_key(item.get("symbol", ""))
            if candidate == target:
                matched = item
                break
        if matched is not None:
            break

    summary = report.get("summary", {})
    if matched is None and not summary:
        return None

    divergence = summary.get("divergence", {}) if isinstance(summary, dict) else {}
    return {
        "symbol": target,
        "matched": matched,
        "conviction": str(summary.get("conviction", "")).strip().lower(),
        "aggression_dial": str(summary.get("aggressionDial", "") or summary.get("aggression_dial", "")).strip(),
        "divergence_summary": str(divergence.get("summary", "")).strip() if isinstance(divergence, dict) else "",
        "divergence_state": str(divergence.get("state", "")).strip() if isinstance(divergence, dict) else "",
    }


def _normalize_symbol_key(symbol: Any) -> str:
    value = str(symbol or "").strip().upper()
    if value.endswith("-USD"):
        value = value[:-4]
    return value
