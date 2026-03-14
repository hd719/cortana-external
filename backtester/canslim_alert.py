#!/usr/bin/env python3
"""CANSLIM daily alert runner with deterministic scanner telemetry."""

from __future__ import annotations

import argparse
import io
import os
import re
import sys
import warnings
from collections import Counter, defaultdict
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime
from zoneinfo import ZoneInfo

from advisor import TradingAdvisor
from data.adverse_regime import build_adverse_regime_indicator
from data.polymarket_context import build_alert_context_lines
from data.universe import GROWTH_WATCHLIST
from evaluation.decision_review import render_decision_review


def _trade_quality_sort_key(record: dict) -> tuple:
    return (
        TradingAdvisor._action_priority(record.get('action', 'NO_BUY')),
        int(bool(record.get('abstain', False))),
        -float(record.get('trade_quality_score', record.get('score', 0))),
        -float(record.get('effective_confidence', 0)),
        float(record.get('uncertainty_pct', 0)),
        -float(record.get('score', 0)),
        str(record.get('symbol', '')),
    )


def _run_quiet(fn, *args, **kwargs):
    with warnings.catch_warnings(), redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
        warnings.simplefilter("ignore")
        return fn(*args, **kwargs)


def _market_headline(market) -> str:
    regime = getattr(market.regime, "value", str(market.regime)).replace("_", " ")
    if regime == "correction":
        return "Market: correction — no new positions"
    if regime == "uptrend under pressure":
        return f"Market: {regime} — reduced exposure"
    return f"Market: {regime} — position sizing {market.position_sizing:.0%}"


def _top_names(records: list[dict], limit: int = 3) -> str:
    names = []
    seen = set()
    for rec in records:
        sym = rec.get("symbol")
        if sym and sym not in seen:
            seen.add(sym)
            names.append(sym)
        if len(names) >= limit:
            break
    return ", ".join(names) if names else "none"


def _dedupe_reason(reason: str) -> str:
    reason = re.sub(r"\s+", " ", (reason or "").strip())
    return reason.rstrip(".")


def _leader_risk_line(records: list[dict], limit: int = 3) -> str:
    chunks = []
    for rec in records[:limit]:
        if not rec.get("has_risk_telemetry"):
            continue

        parts = [str(rec.get("symbol", ""))]
        if rec.get("trade_quality_score") is not None:
            parts.append(f"tq {float(rec['trade_quality_score']):.1f}")
        if rec.get("effective_confidence"):
            parts.append(f"conf {float(rec['effective_confidence']):.0f}%")
        if rec.get("uncertainty_pct") is not None:
            parts.append(f"u {float(rec['uncertainty_pct']):.0f}%")
        downside_penalty = rec.get("downside_penalty")
        churn_penalty = rec.get("churn_penalty")
        if downside_penalty is not None or churn_penalty is not None:
            parts.append(
                f"down/churn {float(downside_penalty or 0.0):.1f}/{float(churn_penalty or 0.0):.1f}"
            )
        adverse_label = rec.get("adverse_regime_label")
        adverse_score = rec.get("adverse_regime_score")
        if (adverse_label and str(adverse_label).lower() != "normal") or float(adverse_score or 0.0) > 0:
            label = adverse_label or "normal"
            parts.append(f"stress {label}({float(adverse_score or 0.0):.0f})")
        if rec.get("abstain"):
            parts.append("ABSTAIN")
        chunks.append(" | ".join(parts))

    return f"Leader telemetry: {'; '.join(chunks)}" if chunks else ""


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
    if hasattr(advisor, "screener"):
        base = _run_quiet(advisor.screener.get_universe)
    else:
        scan_df = _run_quiet(advisor.scan_for_opportunities, True, 0)
        base = list(scan_df.get("symbol", []).tolist()) if hasattr(scan_df, "get") else []
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
    stress = build_adverse_regime_indicator(market=market)
    symbols, priority_count = _deterministic_universe(advisor, universe_size)

    lines = [
        "CANSLIM Scan",
        _market_headline(market),
    ]
    lines.extend(_run_quiet(build_alert_context_lines, GROWTH_WATCHLIST))
    if stress.get("label") != "normal" and getattr(getattr(market, 'regime', None), 'value', '') != 'correction':
        lines.append(f"Adverse regime: {stress['label']} ({float(stress['score']):.0f}) -- {stress['reason']}")
    evaluated = 0
    passed = []
    rejected = []
    source_counts = Counter()
    max_input_staleness = 0.0

    for symbol in symbols:
        analysis = _run_quiet(advisor.analyze_stock, symbol)
        if analysis.get("error"):
            continue

        evaluated += 1
        source_counts[analysis.get("data_source", "unknown")] += 1
        max_input_staleness = max(max_input_staleness, float(analysis.get("data_staleness_seconds", 0.0) or 0.0))
        score = int(analysis.get("total_score", 0))
        rec = analysis.get("recommendation", {})
        action = rec.get("action", "NO_BUY")
        reason = rec.get("reason") or "No reason provided."

        has_risk_telemetry = any(
            key in rec or key in analysis
            for key in (
                "trade_quality_score",
                "effective_confidence",
                "uncertainty_pct",
                "downside_penalty",
                "churn_penalty",
                "adverse_regime_score",
                "adverse_regime_label",
            )
        ) or bool(rec.get("abstain", analysis.get("abstain", False)))
        record = {
            "symbol": symbol,
            "score": score,
            "action": action,
            "reason": reason,
            "rec": rec,
            "trade_quality_score": rec.get("trade_quality_score", analysis.get("trade_quality_score", score)),
            "effective_confidence": rec.get("effective_confidence", analysis.get("effective_confidence", analysis.get("confidence", 0))),
            "uncertainty_pct": rec.get("uncertainty_pct", analysis.get("uncertainty_pct", 0)),
            "downside_penalty": rec.get("downside_penalty", analysis.get("downside_penalty", 0.0)),
            "churn_penalty": rec.get("churn_penalty", analysis.get("churn_penalty", 0.0)),
            "adverse_regime_score": rec.get("adverse_regime_score", analysis.get("adverse_regime_score", analysis.get("adverse_regime", {}).get("score", 0.0))),
            "adverse_regime_label": rec.get("adverse_regime_label", analysis.get("adverse_regime_label", analysis.get("adverse_regime", {}).get("label", "normal"))),
            "abstain": rec.get("abstain", analysis.get("abstain", False)),
            "abstain_reasons": rec.get("abstain_reasons", analysis.get("abstain_reasons", [])),
            "abstain_reason_codes": rec.get("abstain_reason_codes", analysis.get("abstain_reason_codes", [])),
            "sentiment_veto": bool(analysis.get("sentiment_overlay", {}).get("veto", False)),
            "exit_risk_veto": bool(analysis.get("exit_risk", {}).get("veto", False)),
            "market_regime_blocked": action == "NO_BUY" and "market in correction" in reason.lower(),
            "has_risk_telemetry": has_risk_telemetry,
        }
        if score >= min_score:
            passed.append(record)
        else:
            record["reason"] = f"Below min-score filter ({score}<{min_score})"
            rejected.append(record)

        if action == "NO_BUY":
            rejected.append(record)

    if not passed:
        lines.append(f"Scanned {len(symbols)} | 0 passed threshold | 0 BUY | 0 WATCH")
        lines.append(f"Top names considered: {_top_names([{'symbol': s} for s in symbols], 3)}")
        lines.append("Why no buys: no names cleared the CANSLIM threshold")
        return "\n".join(lines)

    ranked = sorted(passed, key=_trade_quality_sort_key)
    candidates = ranked[:limit]

    buy_count = sum(1 for c in candidates if c["action"] == "BUY")
    watch_count = sum(1 for c in candidates if c["action"] == "WATCH")
    no_buy_count = sum(1 for c in candidates if c["action"] == "NO_BUY")

    lines.append(f"Scanned {len(symbols)} | {len(passed)} passed threshold | {buy_count} BUY | {watch_count} WATCH")
    lines.append(f"Top names considered: {_top_names(candidates, 3)}")

    if buy_count == 0 and watch_count == 0:
        why = _dedupe_reason(market.notes or "market correction gate")
        lines.append(f"Why no buys: {why}")
    elif candidates:
        preview = []
        for c in candidates[: min(limit, 3)]:
            preview.append(f"{c['symbol']} {c['action']} ({c['score']}/12)")
        lines.append("Leaders: " + " | ".join(preview))
        lines.extend(render_decision_review(candidates[: min(limit, 5)], detail_limit=2))

    if getattr(market, "status", "ok") == "degraded":
        lines.append(f"Note: degraded market data ({float(getattr(market, 'snapshot_age_seconds', 0.0) or 0.0):.0f}s stale)")
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
