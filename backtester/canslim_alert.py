#!/usr/bin/env python3
"""CANSLIM daily alert runner with deterministic scanner telemetry."""

from __future__ import annotations

import argparse
import io
import os
from collections import Counter, defaultdict
from contextlib import redirect_stdout
from datetime import datetime
from zoneinfo import ZoneInfo

from advisor import TradingAdvisor
from data.universe import GROWTH_WATCHLIST


def _run_quiet(fn, *args, **kwargs):
    with redirect_stdout(io.StringIO()):
        return fn(*args, **kwargs)


def _load_priority_symbols() -> list[str]:
    out: list[str] = []
    csv_symbols = os.getenv("TRADING_PRIORITY_SYMBOLS", "")
    if csv_symbols:
        out.extend([s.strip().upper() for s in csv_symbols.split(",") if s.strip()])

    if os.getenv("TRADING_INCLUDE_WATCHLIST_PRIORITY", "1") != "0":
        out.extend([s.upper() for s in GROWTH_WATCHLIST])

    file_path = os.getenv("TRADING_PRIORITY_FILE")
    if file_path and os.path.exists(file_path):
        with open(file_path, "r", encoding="utf-8") as f:
            for line in f:
                sym = line.strip().upper()
                if sym and not sym.startswith("#"):
                    out.append(sym)

    seen = set()
    deduped = []
    for sym in out:
        if sym not in seen:
            seen.add(sym)
            deduped.append(sym)
    return deduped


def _deterministic_universe(advisor: TradingAdvisor, universe_size: int) -> tuple[list[str], int]:
    base = _run_quiet(advisor.screener.get_universe)
    priority = _load_priority_symbols()
    ordered = []
    seen = set()
    for sym in [*priority, *base]:
        if sym not in seen:
            seen.add(sym)
            ordered.append(sym)
    return ordered[:universe_size], len(priority)


def format_alert(limit: int = 8, min_score: int = 6, universe_size: int = 120) -> str:
    advisor = TradingAdvisor()
    market = _run_quiet(advisor.get_market_status, True)
    symbols, priority_count = _deterministic_universe(advisor, universe_size)

    now_et = datetime.now(ZoneInfo("America/New_York")).strftime("%Y-%m-%d %I:%M %p ET")
    lines = [
        "📈 Trading Advisor - CANSLIM Scan",
        f"Run: {now_et}",
        f"Market: {market.regime.value} | Position Sizing: {market.position_sizing:.0%}",
        f"Status: {market.notes}",
        f"Scanner: universe={len(symbols)} | priority_symbols={priority_count}",
        "",
    ]

    evaluated = 0
    passed = []
    rejected = []

    for symbol in symbols:
        analysis = _run_quiet(advisor.analyze_stock, symbol)
        if analysis.get("error"):
            continue

        evaluated += 1
        score = int(analysis.get("total_score", 0))
        rec = analysis.get("recommendation", {})
        action = rec.get("action", "NO_BUY")
        reason = rec.get("reason") or "No reason provided."

        record = {"symbol": symbol, "score": score, "action": action, "reason": reason, "rec": rec}
        if score >= min_score:
            passed.append(record)
        else:
            record["reason"] = f"Below min-score filter ({score}<{min_score})"
            rejected.append(record)

        if action == "NO_BUY":
            rejected.append(record)

    if not passed:
        lines.append("No CANSLIM candidates met the current scan threshold.")
        lines.append(f"Summary: scanned {len(symbols)} | evaluated {evaluated} | threshold-passed 0 | BUY 0 | WATCH 0 | NO_BUY 0")
        return "\n".join(lines)

    ranked = sorted(passed, key=lambda x: x["score"], reverse=True)
    candidates = ranked[:limit]

    buy_count = sum(1 for c in candidates if c["action"] == "BUY")
    watch_count = sum(1 for c in candidates if c["action"] == "WATCH")
    no_buy_count = sum(1 for c in candidates if c["action"] == "NO_BUY")

    lines.append(
        f"Summary: scanned {len(symbols)} | evaluated {evaluated} | threshold-passed {len(passed)} | BUY {buy_count} | WATCH {watch_count} | NO_BUY {no_buy_count}"
    )

    reason_counts = Counter(r["reason"] for r in rejected)
    if reason_counts:
        top = ", ".join([f"{k} ({v})" for k, v in reason_counts.most_common(3)])
        lines.append(f"Blockers: {top}")
        samples = defaultdict(list)
        for r in rejected:
            if len(samples[r["reason"]]) < 3:
                samples[r["reason"]].append(r["symbol"])
        sample_bits = [f"{k} => {', '.join(v)}" for k, v in list(samples.items())[:2]]
        if sample_bits:
            lines.append(f"Blocker samples: {' | '.join(sample_bits)}")

    lines.append("")

    for c in candidates:
        reason = c["reason"]
        if c["action"] == "BUY":
            reason = f"Entry ${c['rec'].get('entry', 0):.2f} | Stop ${c['rec'].get('stop_loss', 0):.2f}"
        lines.append(f"• {c['symbol']} ({c['score']}/12) → {c['action']}")
        lines.append(f"  {reason}")

    lines.append("")
    lines.append("⚠️ Signals are decision support only (not financial advice).")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run CANSLIM alert scan")
    parser.add_argument("--limit", type=int, default=8)
    parser.add_argument("--min-score", type=int, default=6)
    parser.add_argument("--universe-size", type=int, default=int(os.getenv("TRADING_UNIVERSE_SIZE", "120")))
    args = parser.parse_args()
    print(format_alert(limit=args.limit, min_score=args.min_score, universe_size=args.universe_size))


if __name__ == "__main__":
    main()
