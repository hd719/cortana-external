#!/usr/bin/env python3
"""Dip Buyer daily alert runner.

Runs a Dip Buyer scan and emits a Telegram-ready summary with:
- Market regime / position sizing status
- Macro gate status (VIX / Put-Call / HY spreads)
- BUY / WATCH / NO_BUY signals
"""

from __future__ import annotations

import argparse
import io
from contextlib import redirect_stdout
from datetime import datetime
from zoneinfo import ZoneInfo

from advisor import TradingAdvisor
from strategies.dip_buyer import DIPBUYER_CONFIG


def _run_quiet(fn, *args, **kwargs):
    """Run noisy advisor methods while suppressing their console logs."""
    with redirect_stdout(io.StringIO()):
        return fn(*args, **kwargs)


def _fmt_value(value, decimals: int = 1) -> str:
    if value is None:
        return "N/A"
    try:
        if value != value:  # NaN check
            return "N/A"
    except Exception:
        return "N/A"

    if decimals == 0:
        return f"{value:.0f}"
    return f"{value:.{decimals}f}"


def _macro_gate_line(snapshot: dict) -> str:
    if not snapshot:
        return "Macro Gate: unavailable"

    cfg = DIPBUYER_CONFIG
    vix = snapshot.get("vix")
    put_call = snapshot.get("put_call")
    hy_spread = snapshot.get("hy_spread")
    fear = snapshot.get("fear_greed")

    credit_veto = False
    if hy_spread is not None and hy_spread == hy_spread:
        credit_veto = hy_spread > cfg["credit"]["hy_spread_weak"]

    gate = "CLOSED" if credit_veto else "OPEN"

    return (
        "Macro Gate: "
        f"{gate} | VIX {_fmt_value(vix)} | "
        f"PCR {_fmt_value(put_call, 2)} | "
        f"HY {_fmt_value(hy_spread, 0)} bps | "
        f"Fear {_fmt_value(fear, 0)}"
    )


def format_alert(limit: int = 8, min_score: int = 6) -> str:
    advisor = TradingAdvisor()

    market = _run_quiet(advisor.get_market_status, True)
    snapshot = _run_quiet(advisor.risk_fetcher.get_snapshot)
    scan_df = _run_quiet(advisor.scan_dip_opportunities, True, min_score)

    now_et = datetime.now(ZoneInfo("America/New_York")).strftime("%Y-%m-%d %I:%M %p ET")

    lines = [
        "📉 Trading Advisor - Dip Buyer Scan",
        f"Run: {now_et}",
        (
            f"Market: {market.regime.value} | "
            f"Position Sizing: {market.position_sizing:.0%}"
        ),
        f"Status: {market.notes}",
        _macro_gate_line(snapshot),
        "",
    ]

    if scan_df.empty:
        lines.append("No Dip Buyer candidates met the current scan threshold.")
        return "\n".join(lines)

    candidates = []
    for _, row in scan_df.head(limit).iterrows():
        symbol = row["symbol"]
        analysis = _run_quiet(advisor.analyze_dip_stock, symbol)
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
    parser = argparse.ArgumentParser(description="Run Dip Buyer alert scan")
    parser.add_argument("--limit", type=int, default=8, help="Max candidates to analyze")
    parser.add_argument("--min-score", type=int, default=6, help="Minimum total score filter")
    args = parser.parse_args()

    print(format_alert(limit=args.limit, min_score=args.min_score))


if __name__ == "__main__":
    main()
