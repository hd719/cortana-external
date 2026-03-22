#!/usr/bin/env python3
"""Local-only formatter for wrapper output."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys


NOISE_PATTERNS = (
    "Pandas4Warning:",
    "Timestamp.utcnow is deprecated",
    "dt_now = pd.Timestamp.utcnow()",
)


def strip_runtime_noise(text: str) -> str:
    lines = []
    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        if any(pattern in line for pattern in NOISE_PATTERNS):
            continue
        lines.append(line)
    return "\n".join(lines).strip()


def _find_line(lines: list[str], prefix: str) -> str | None:
    for line in lines:
        if line.startswith(prefix):
            return line[len(prefix) :].strip()
    return None


def _parse_symbol_list(value: str) -> list[str]:
    cleaned = re.sub(r"^\([^)]*\):\s*", "", str(value or "").strip())
    if not cleaned or cleaned.lower() == "none":
        return []
    items = []
    for part in cleaned.split(","):
        symbol = re.sub(r"[^A-Z0-9\-]", "", part.strip().upper())
        if symbol:
            items.append(symbol)
    return items


def _load_leader_buckets(path: str | None) -> dict | None:
    if not path:
        return None
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def _leader_overlap_line(lines: list[str], leader_payload: dict | None) -> str | None:
    if not leader_payload:
        return None

    buckets = leader_payload.get("buckets") if isinstance(leader_payload.get("buckets"), dict) else {}
    priority = leader_payload.get("priority") if isinstance(leader_payload.get("priority"), dict) else {}

    candidates: list[str] = []
    for prefix in ("BUY names:", "Watch names", "Top names considered:", "Top leaders:"):
        value = _find_line(lines, prefix)
        if not value:
            continue
        candidates.extend(_parse_symbol_list(value))

    seen = set()
    ordered_candidates = []
    for symbol in candidates:
        if symbol not in seen:
            seen.add(symbol)
            ordered_candidates.append(symbol)

    if not ordered_candidates:
        return None

    def _bucket_symbols(name: str) -> list[str]:
        if name == "priority":
            values = priority.get("symbols", []) if isinstance(priority, dict) else []
            return [str(item).strip().upper() for item in values if str(item).strip()]
        values = buckets.get(name, [])
        if not isinstance(values, list):
            return []
        return [
            str(item.get("symbol", "")).strip().upper()
            for item in values
            if isinstance(item, dict) and str(item.get("symbol", "")).strip()
        ]

    overlaps = []
    for name in ("priority", "daily", "weekly", "monthly"):
        bucket_set = set(_bucket_symbols(name))
        matched = [symbol for symbol in ordered_candidates if symbol in bucket_set]
        if matched:
            overlaps.append(f"{name} {', '.join(matched[:4])}")

    if not overlaps:
        return "Leader-bucket overlap: none"
    return "Leader-bucket overlap: " + " | ".join(overlaps)


def _summarize_polymarket(lines: list[str]) -> list[str]:
    out: list[str] = []
    overlay = _find_line(lines, "Overlay:")
    posture = _find_line(lines, "Posture:")
    if overlay:
        out.append(f"Macro: {overlay}")
    elif posture:
        out.append(f"Macro posture: {posture}")
    polymarket = _find_line(lines, "Polymarket:")
    if polymarket:
        out.append(f"Polymarket snapshot: {polymarket}")
    return out


def _summarize_risk(lines: list[str]) -> list[str]:
    out: list[str] = []
    risk = _find_line(lines, "Risk budget:")
    execution = _find_line(lines, "Execution quality:")
    universe = _find_line(lines, "Universe selection:")

    if risk:
        remaining = re.search(r"remaining\s+([0-9]+%)", risk)
        cap = re.search(r"cap\s+([0-9]+%)", risk)
        note = re.search(r"note\s+(.+)$", risk)
        parts = []
        if remaining:
            parts.append(f"remaining risk budget {remaining.group(1)}")
        if cap:
            parts.append(f"exposure cap {cap.group(1)}")
        if note:
            parts.append(note.group(1))
        out.append("Risk: " + (" | ".join(parts) if parts else risk))

    if execution:
        quality = re.search(r"quality\s+([a-z]+)", execution, re.I)
        liquidity = re.search(r"liquidity\s+([a-z]+)", execution, re.I)
        slippage = re.search(r"slippage\s+([a-z]+)", execution, re.I)
        parts = []
        if quality:
            parts.append(f"quality {quality.group(1)}")
        if liquidity:
            parts.append(f"liquidity {liquidity.group(1)}")
        if slippage:
            parts.append(f"slippage {slippage.group(1)}")
        out.append("Trading conditions: " + (" | ".join(parts) if parts else execution))

    if universe:
        pinned = re.search(r"(\d+)\s+pinned", universe)
        ranked = re.search(r"(\d+)\s+ranked", universe)
        source = re.search(r"source\s+([a-z]+)", universe, re.I)
        age = re.search(r"cache age\s+([0-9.]+h)", universe)
        parts = []
        if pinned and ranked:
            parts.append(f"{pinned.group(1)} pinned + {ranked.group(1)} ranked names")
        if source:
            parts.append(f"source {source.group(1)}")
        if age:
            parts.append(f"cache age {age.group(1)}")
        out.append("Scan input: " + (" | ".join(parts) if parts else universe))

    return out


def format_alert(text: str, *, leader_bucket_path: str | None = None) -> str:
    cleaned = strip_runtime_noise(text)
    lines = [line.strip() for line in cleaned.splitlines() if line.strip()]
    if not lines:
        return ""
    leader_payload = _load_leader_buckets(leader_bucket_path)

    title = lines[0]
    out = [title]

    takeaway: list[str] = []
    market = _find_line(lines, "Market:")
    market_regime = _find_line(lines, "Market regime:")
    if market:
        takeaway.append(f"Market: {market}")
    elif market_regime:
        takeaway.append(f"Market: {market_regime}")
    takeaway.extend(_summarize_polymarket(lines))
    takeaway.extend(_summarize_risk(lines))

    if takeaway:
        out.extend(["", "Takeaway"])
        out.extend(f"- {line}" for line in takeaway)

    decision: list[str] = []
    for prefix in (
        "Scanned ",
        "Qualified setups:",
        "BUY names:",
        "Watch names",
        "Correction gate:",
        "Top names considered:",
        "Top leaders:",
        "Decision review:",
        "Tuning balance:",
        "Good buys:",
        "Risky buys:",
        "Higher-tq restraint:",
        "Abstains:",
        "Vetoes:",
        "Why no buys:",
        "Final action:",
        "Leaders:",
        "Note:",
    ):
        value = _find_line(lines, prefix)
        if value is None:
            continue
        if prefix == "Scanned ":
            decision.append(f"Scan result: {prefix}{value}")
        elif prefix == "Watch names":
            decision.append(f"Watchlist: {value}")
        elif prefix == "BUY names:":
            decision.append(f"Buy list: {value}")
        else:
            decision.append(f"{prefix.rstrip(':')}: {value}")

    if decision:
        overlap_line = _leader_overlap_line(lines, leader_payload)
        if overlap_line:
            decision.append(overlap_line)
        out.extend(["", "Decision"])
        out.extend(f"- {line}" for line in decision)

    return "\n".join(out)


def format_quick_check(text: str) -> str:
    cleaned = strip_runtime_noise(text)
    lines = [line.strip() for line in cleaned.splitlines() if line.strip()]
    if not lines:
        return ""

    title = lines[0]
    out = [title]

    takeaway: list[str] = []
    path_asset = _find_line(lines, "Path:")
    polymarket = _find_line(lines, "Polymarket:")
    takeaway.extend(_summarize_risk(lines))
    if path_asset:
        takeaway.insert(0, f"Setup: {path_asset}")
    if polymarket:
        takeaway.insert(1 if takeaway else 0, f"Macro: {polymarket}")

    if takeaway:
        out.extend(["", "Takeaway"])
        out.extend(f"- {line}" for line in takeaway)

    verdict: list[str] = []
    reason = _find_line(lines, "Reason:")
    base_action = _find_line(lines, "Base action:")
    if reason:
        verdict.append(f"Why: {reason}")
    if base_action:
        verdict.append(f"Model output: {base_action}")

    if verdict:
        out.extend(["", "Verdict"])
        out.extend(f"- {line}" for line in verdict)

    return "\n".join(out)


def format_leader_baskets(text: str) -> str:
    try:
        payload = json.loads(text)
    except Exception:
        return "Leader buckets\n\n- Leader basket artifact is missing or unreadable."

    buckets = payload.get("buckets") if isinstance(payload.get("buckets"), dict) else {}
    priority = payload.get("priority") if isinstance(payload.get("priority"), dict) else {}
    generated_at = payload.get("generated_at") or "unknown"

    def _format_bucket(items: object) -> str:
        if not isinstance(items, list):
            return "none yet"
        rendered: list[str] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            symbol = str(item.get("symbol", "")).strip().upper()
            if not symbol:
                continue
            appearances = int(item.get("appearances", 0) or 0)
            change = item.get("window_return_pct")
            if change is None:
                rendered.append(f"{symbol} n/a ({appearances}x)")
                continue
            rendered.append(f"{symbol} {float(change):+.1f}% ({appearances}x)")
        return ", ".join(rendered) if rendered else "none yet"

    daily = _format_bucket(buckets.get("daily"))
    weekly = _format_bucket(buckets.get("weekly"))
    monthly = _format_bucket(buckets.get("monthly"))
    combined = [
        str(symbol).strip().upper()
        for symbol in priority.get("symbols", [])
        if str(symbol).strip()
    ] if isinstance(priority, dict) else []

    out = ["Leader buckets", "", "Takeaway"]
    out.append(f"- Updated: {generated_at}")
    out.append(
        "- Priority set: "
        + (", ".join(combined) if combined else "none yet")
    )
    out.extend(["", "Buckets"])
    out.append("- Format: % move over that bucket window | (x) = number of appearances in that bucket")
    out.append(f"- Daily: {daily}")
    out.append(f"- Weekly: {weekly}")
    out.append(f"- Monthly: {monthly}")
    return "\n".join(out)


def format_market_data_ops(text: str) -> str:
    try:
        payload = json.loads(text)
    except Exception:
        return "Market data ops\n\n- Ops payload is missing or unreadable."

    data = payload.get("data") if isinstance(payload, dict) else {}
    if not isinstance(data, dict):
        return "Market data ops\n\n- Ops payload is missing or unreadable."

    provider_metrics = data.get("providerMetrics") if isinstance(data.get("providerMetrics"), dict) else {}
    health = data.get("health") if isinstance(data.get("health"), dict) else {}
    providers = health.get("providers") if isinstance(health.get("providers"), dict) else {}
    streamer = providers.get("schwabStreamerMeta") if isinstance(providers.get("schwabStreamerMeta"), dict) else {}
    budget = streamer.get("subscriptionBudget") if isinstance(streamer.get("subscriptionBudget"), dict) else {}
    universe = data.get("universe") if isinstance(data.get("universe"), dict) else {}
    latest_universe = universe.get("latest") if isinstance(universe.get("latest"), dict) else {}
    ownership = universe.get("ownership") if isinstance(universe.get("ownership"), dict) else {}

    def _budget_line(name: str) -> str | None:
        item = budget.get(name)
        if not isinstance(item, dict):
            return None
        requested = item.get("requestedSymbols")
        soft_cap = item.get("softCap")
        headroom = item.get("headroomRemaining")
        if requested is None or soft_cap is None:
            return None
        extra = " | over cap" if item.get("overSoftCap") else ""
        if item.get("lastPrunedCount"):
            extra += f" | pruned {item.get('lastPrunedCount')}"
        return f"{name}: {requested}/{soft_cap} requested | headroom {headroom}{extra}"

    fallback_usage = provider_metrics.get("fallbackUsage") if isinstance(provider_metrics.get("fallbackUsage"), dict) else {}
    source_usage = provider_metrics.get("sourceUsage") if isinstance(provider_metrics.get("sourceUsage"), dict) else {}

    out = ["Market data ops", "", "Takeaway"]
    out.append(
        "- Streamer role: "
        f"{data.get('streamerRoleActive', 'unknown')} (configured {data.get('streamerRoleConfigured', 'unknown')})"
        f" | lock held {'yes' if data.get('streamerLockHeld') else 'no'}"
    )
    out.append(
        "- Stream state: "
        f"{streamer.get('operatorState', 'unknown')}"
        f" | policy {streamer.get('failurePolicy') or 'none'}"
        f" | connected {'yes' if streamer.get('connected') else 'no'}"
    )
    if streamer.get("operatorAction") and streamer.get("operatorAction") != "No operator action required.":
        out.append(f"- Operator action: {streamer.get('operatorAction')}")
    budget_lines = [line for line in (_budget_line("LEVELONE_EQUITIES"), _budget_line("CHART_EQUITY")) if line]
    if budget_lines:
        out.append("- Symbol budget: " + " | ".join(budget_lines))
    out.append(
        "- Fallbacks: "
        f"yahoo {fallback_usage.get('yahoo', 0)} | shared_state {fallback_usage.get('shared_state', 0)}"
        f" | primary source mix {', '.join(f'{k} {v}' for k, v in sorted(source_usage.items())) or 'none yet'}"
    )
    if latest_universe:
        out.append(
            "- Universe: "
            f"{latest_universe.get('source', 'unknown')}"
            f" | updated {latest_universe.get('updatedAt', 'unknown')}"
        )
    if ownership:
        out.append(f"- Universe ownership: {ownership.get('refreshPolicy', 'n/a')}")
    return "\n".join(out)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Format local backtester wrapper output")
    parser.add_argument("--mode", choices=("alert", "quick-check", "leader-baskets", "market-data-ops"), required=True)
    parser.add_argument("--leader-basket-path")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    raw = sys.stdin.read()
    if args.mode == "alert":
        print(format_alert(raw, leader_bucket_path=args.leader_basket_path))
        return
    if args.mode == "leader-baskets":
        print(format_leader_baskets(raw))
        return
    if args.mode == "market-data-ops":
        print(format_market_data_ops(raw))
        return
    print(format_quick_check(raw))


if __name__ == "__main__":
    main()
