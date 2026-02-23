#!/usr/bin/env python3
"""CANSLIM daily alert runner.

Runs a quick CANSLIM scan and emits a Telegram-ready summary with:
- Market regime / position sizing status
- Top candidates
- BUY / WATCH / NO_BUY signal for each candidate
"""

from __future__ import annotations

import argparse
import io
from contextlib import redirect_stdout
from datetime import datetime
from zoneinfo import ZoneInfo

from advisor import TradingAdvisor


def _run_quiet(fn, *args, **kwargs):
    """Run noisy advisor methods while suppressing their console logs."""
    with redirect_stdout(io.StringIO()):
        return fn(*args, **kwargs)


def format_alert(limit: int = 8, min_score: int = 6) -> str:
    advisor = TradingAdvisor()

    market = _run_quiet(advisor.get_market_status, True)
    scan_df = _run_quiet(advisor.scan_for_opportunities, True, min_score)

    now_et = datetime.now(ZoneInfo("America/New_York")).strftime("%Y-%m-%d %I:%M %p ET")

    lines = [
        "📈 Trading Advisor - CANSLIM Scan",
        f"Run: {now_et}",
        (
            f"Market: {market.regime.value} | "
            f"Position Sizing: {market.position_sizing:.0%}"
        ),
        f"Status: {market.notes}",
        "",
    ]

    if scan_df.empty:
        lines.append("No CANSLIM candidates met the current scan threshold.")
        return "\n".join(lines)

    candidates = []
    for _, row in scan_df.head(limit).iterrows():
        symbol = row["symbol"]
        analysis = _run_quiet(advisor.analyze_stock, symbol)
        rec = analysis.get("recommendation", {})

        action = rec.get("action", "NO_BUY")
        reason = rec.get("reason")
        if action == "BUY":
            reason = (
                f"Entry ${rec.get('entry', 0):.2f} | "
                f"Stop ${rec.get('stop_loss', 0):.2f}"
            )
        elif not reason:
            reason = "Watch setup"

        candidates.append(
            {
                "symbol": symbol,
                "score": int(analysis.get("total_score", row.get("total_score", 0))),
                "action": action,
                "reason": reason,
            }
        )

    buy_count = sum(1 for c in candidates if c["action"] == "BUY")
    watch_count = sum(1 for c in candidates if c["action"] == "WATCH")
    no_buy_count = sum(1 for c in candidates if c["action"] == "NO_BUY")

    lines.append(
        f"Summary: {len(candidates)} candidates | BUY {buy_count} | WATCH {watch_count} | NO_BUY {no_buy_count}"
    )
    lines.append("")

    for c in candidates:
        lines.append(f"• {c['symbol']} ({c['score']}/12) → {c['action']}")
        lines.append(f"  {c['reason']}")

    lines.append("")
    lines.append("⚠️ Signals are decision support only (not financial advice).")

    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run CANSLIM alert scan")
    parser.add_argument("--limit", type=int, default=8, help="Max candidates to analyze")
    parser.add_argument("--min-score", type=int, default=6, help="Minimum total score filter")
    args = parser.parse_args()

    print(format_alert(limit=args.limit, min_score=args.min_score))


if __name__ == "__main__":
    main()
