#!/usr/bin/env python3
"""Nightly discovery scan over the broader universe profile."""

from __future__ import annotations

import argparse
import json
import warnings
from pathlib import Path

DEFAULT_BUY_DECISION_CALIBRATION_PATH = (
    Path(__file__).resolve().parent / ".cache" / "experimental_alpha" / "calibration" / "buy-decision-calibration-latest.json"
)

from advisor import TradingAdvisor
from data.universe import UNIVERSE_PROFILE_NIGHTLY_DISCOVERY
from data.universe_selection import RankedUniverseSelector


def _with_runtime_warning_filters(fn, *args, **kwargs):
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="Timestamp.utcnow is deprecated.*")
        warnings.filterwarnings("ignore", category=FutureWarning, module="yfinance")
        warnings.filterwarnings("ignore", category=UserWarning, module="yfinance")
        return fn(*args, **kwargs)


def build_report(
    limit: int = 20,
    min_technical_score: int = 3,
    refresh_sp500: bool = False,
    refresh_live_prefilter: bool = True,
) -> dict:
    advisor = TradingAdvisor()
    market = _with_runtime_warning_filters(advisor.get_market_status, refresh=True)
    symbols = advisor.screener.get_universe_for_profile(
        UNIVERSE_PROFILE_NIGHTLY_DISCOVERY,
        refresh_sp500=refresh_sp500,
    )
    discoveries = _with_runtime_warning_filters(
        advisor.run_nightly_discovery,
        limit=limit,
        min_technical_score=min_technical_score,
        refresh_sp500=refresh_sp500,
        symbols=symbols,
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

    live_prefilter = None
    liquidity_overlay = None
    feature_snapshot = None
    buy_decision_calibration = _load_buy_decision_calibration_summary()
    if refresh_live_prefilter:
        standard_symbols = advisor.screener.get_universe()
        selector = RankedUniverseSelector()
        payload = _with_runtime_warning_filters(
            selector.refresh_cache,
            base_symbols=standard_symbols,
            market_regime=getattr(getattr(market, "regime", None), "value", "unknown"),
        )
        live_prefilter = {
            "path": str(selector.cache_path),
            "generated_at": payload.get("generated_at"),
            "symbol_count": len(payload.get("symbols", [])),
        }
        liquidity = payload.get("liquidity_overlay")
        if isinstance(liquidity, dict):
            liquidity_overlay = {
                "path": str(liquidity.get("path", "")),
                "generated_at": liquidity.get("generated_at"),
                "symbol_count": int(liquidity.get("symbol_count", 0) or 0),
                "summary": liquidity.get("summary") or {},
            }
        snapshot = payload.get("feature_snapshot")
        if isinstance(snapshot, dict):
            feature_snapshot = {
                "path": str(selector.cache_path),
                "schema_version": int(snapshot.get("schema_version", 0) or 0),
                "generated_at": snapshot.get("generated_at"),
                "symbol_count": int(snapshot.get("symbol_count", 0) or 0),
                "source": str(snapshot.get("source", "")),
            }

    return {
        "profile": UNIVERSE_PROFILE_NIGHTLY_DISCOVERY,
        "market_regime": getattr(getattr(market, "regime", None), "value", "unknown"),
        "position_sizing": float(getattr(market, "position_sizing", 0.0) or 0.0),
        "universe_size": len(symbols),
        "leaders": leaders,
        "live_prefilter": live_prefilter,
        "liquidity_overlay": liquidity_overlay,
        "feature_snapshot": feature_snapshot,
        "buy_decision_calibration": buy_decision_calibration,
    }


def format_report(report: dict) -> str:
    lines = [
        "Nightly Discovery",
        f"Profile: {report['profile']}",
        f"Market regime: {report['market_regime']} | Position sizing {report['position_sizing']:.0%}",
        f"Universe size: {report['universe_size']}",
    ]
    leaders = report.get("leaders", [])
    prefilter = report.get("live_prefilter")
    if prefilter:
        lines.append(
            f"Live prefilter cache: {prefilter['symbol_count']} symbols | {prefilter['generated_at']}"
        )
    snapshot = report.get("feature_snapshot")
    if snapshot:
        lines.append(
            "Feature snapshot: "
            f"v{int(snapshot.get('schema_version', 0) or 0)} | "
            f"{int(snapshot.get('symbol_count', 0) or 0)} symbols | "
            f"{snapshot.get('generated_at')} | "
            f"{snapshot.get('source') or 'unknown'}"
        )
    liquidity = report.get("liquidity_overlay")
    if liquidity:
        summary = liquidity.get("summary") or {}
        line = f"Liquidity overlay cache: {liquidity['symbol_count']} symbols | {liquidity['generated_at']}"
        median_slippage = summary.get("median_estimated_slippage_bps")
        high_quality_count = summary.get("high_quality_count")
        extras = []
        if median_slippage is not None:
            extras.append(f"median slip {float(median_slippage):.1f}bps")
        if high_quality_count is not None:
            extras.append(f"high quality {int(high_quality_count)}")
        if extras:
            line += " | " + " | ".join(extras)
        lines.append(line)
    calibration = report.get("buy_decision_calibration")
    if calibration:
        lines.append(
            "Buy decision calibration: "
            f"{calibration.get('status', 'unknown')} | "
            f"stale={calibration.get('is_stale')} | "
            f"settled {int(calibration.get('settled_candidates', 0) or 0)} | "
            f"{calibration.get('generated_at') or 'unknown'}"
        )
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
    parser.add_argument(
        "--skip-live-prefilter-refresh",
        action="store_true",
        help="Do not refresh the live scan prefilter cache after the nightly run",
    )
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of text")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    report = build_report(
        limit=args.limit,
        min_technical_score=args.min_technical_score,
        refresh_sp500=args.refresh_sp500,
        refresh_live_prefilter=not args.skip_live_prefilter_refresh,
    )
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(format_report(report))


def _load_buy_decision_calibration_summary() -> dict | None:
    if not DEFAULT_BUY_DECISION_CALIBRATION_PATH.exists():
        return None
    try:
        payload = json.loads(DEFAULT_BUY_DECISION_CALIBRATION_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    freshness = payload.get("freshness") if isinstance(payload.get("freshness"), dict) else {}
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    return {
        "path": str(DEFAULT_BUY_DECISION_CALIBRATION_PATH),
        "generated_at": payload.get("generated_at"),
        "is_stale": freshness.get("is_stale"),
        "reason": freshness.get("reason"),
        "status": freshness.get("reason") or "unknown",
        "settled_candidates": int(summary.get("settled_candidates", 0) or 0),
    }


if __name__ == "__main__":
    main()
