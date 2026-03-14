#!/usr/bin/env python3
"""Nightly discovery scan over the broader universe profile."""

from __future__ import annotations

import argparse
import json

from advisor import TradingAdvisor
from data.universe import UNIVERSE_PROFILE_NIGHTLY_DISCOVERY


def build_report(limit: int = 20, min_technical_score: int = 3, refresh_sp500: bool = False) -> dict:
    advisor = TradingAdvisor()
    market = advisor.get_market_status(refresh=True)
    symbols = advisor.screener.get_universe_for_profile(
        UNIVERSE_PROFILE_NIGHTLY_DISCOVERY,
        refresh_sp500=refresh_sp500,
    )
    discoveries = advisor.run_nightly_discovery(
        limit=limit,
        min_technical_score=min_technical_score,
        refresh_sp500=refresh_sp500,
    )

    leaders = []
    if not discoveries.empty:
        for _, row in discoveries.head(limit).iterrows():
            leaders.append(
                {
                    "symbol": row["symbol"],
                    "technical_score": int(row.get("technical_score", 0)),
                    "total_score": int(row.get("total_score", 0)),
                    "action": str(row.get("action", "NO_BUY")),
                    "rank_score": float(row.get("rank_score", 0.0)),
                    "confidence": int(row.get("confidence", 0) or 0),
                    "reason": str(row.get("reason", "")),
                }
            )

    return {
        "profile": UNIVERSE_PROFILE_NIGHTLY_DISCOVERY,
        "market_regime": getattr(getattr(market, "regime", None), "value", "unknown"),
        "position_sizing": float(getattr(market, "position_sizing", 0.0) or 0.0),
        "universe_size": len(symbols),
        "leaders": leaders,
    }


def format_report(report: dict) -> str:
    lines = [
        "Nightly Discovery",
        f"Profile: {report['profile']}",
        f"Market regime: {report['market_regime']} | Position sizing {report['position_sizing']:.0%}",
        f"Universe size: {report['universe_size']}",
    ]
    leaders = report.get("leaders", [])
    if not leaders:
        lines.append("Leaders: none")
        return "\n".join(lines)

    lines.append(f"Leaders surfaced: {len(leaders)}")
    for leader in leaders:
        lines.append(
            f"- {leader['symbol']}: action {leader['action']} | tech {leader['technical_score']}/6 | "
            f"total {leader['total_score']}/12 | rank {leader['rank_score']:.1f} | "
            f"conf {leader['confidence']}% | {leader['reason']}"
        )
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the nightly discovery scan")
    parser.add_argument("--limit", type=int, default=20, help="Maximum number of leaders to show")
    parser.add_argument("--min-technical-score", type=int, default=3, help="Minimum technical score to include")
    parser.add_argument("--refresh-sp500", action="store_true", help="Refresh live S&P 500 constituents before scanning")
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of text")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    report = build_report(
        limit=args.limit,
        min_technical_score=args.min_technical_score,
        refresh_sp500=args.refresh_sp500,
    )
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(format_report(report))


if __name__ == "__main__":
    main()
