#!/usr/bin/env python3
"""Dip Buyer alert runner with regime profile + rejection telemetry."""

from __future__ import annotations

import argparse
import io
import os
import re
import warnings
from collections import Counter, defaultdict
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime
from zoneinfo import ZoneInfo

from advisor import TradingAdvisor
from data.adverse_regime import build_adverse_regime_indicator
from data.polymarket_context import load_compact_context
from data.universe import GROWTH_WATCHLIST
from data.x_sentiment import XSentimentAnalyzer
from evaluation.decision_review import render_decision_review
from strategies.dip_buyer import DIPBUYER_CONFIG


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
        return "Market regime: correction"
    if regime == "uptrend under pressure":
        return "Market regime: uptrend under pressure"
    return f"Market regime: {regime} | Position sizing {market.position_sizing:.0%}"


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


def _all_names(records: list[dict], limit: int = 10) -> str:
    names = []
    seen = set()
    for rec in records:
        sym = rec.get("symbol")
        if sym and sym not in seen:
            seen.add(sym)
            names.append(sym)
    if not names:
        return "none"
    if len(names) <= limit:
        return ", ".join(names)
    return ", ".join(names[:limit]) + f" (+{len(names) - limit} more)"


def _dedupe_reason(reason: str) -> str:
    reason = re.sub(r"\s+", " ", (reason or "").strip())
    return reason.rstrip(".")


def _fmt_value(value, decimals: int = 1) -> str:
    if value is None:
        return "N/A"
    try:
        if value != value:
            return "N/A"
    except Exception:
        return "N/A"
    return f"{value:.{decimals}f}" if decimals else f"{value:.0f}"


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


def _macro_gate_line(snapshot: dict) -> str:
    if not snapshot:
        return "Macro Gate: unavailable"
    cfg = DIPBUYER_CONFIG
    hy_spread = snapshot.get("hy_spread")
    credit_veto = bool(hy_spread is not None and hy_spread == hy_spread and hy_spread > cfg["credit"]["hy_spread_weak"])
    gate = "CLOSED" if credit_veto else "OPEN"
    line = (
        "Macro Gate: "
        f"{gate} | VIX {_fmt_value(snapshot.get('vix'))} | "
        f"PCR {_fmt_value(snapshot.get('put_call'), 2)} | "
        f"HY {_fmt_value(hy_spread, 0)} bps ({snapshot.get('hy_spread_source', 'unknown')}) | "
        f"Fear {_fmt_value(snapshot.get('fear_greed'), 0)}"
    )
    if snapshot.get("hy_spread_fallback"):
        line += " | Fallback impact: neutral-credit assumption"
    if snapshot.get("hy_spread_warning"):
        line += f"\nHY Note: {snapshot['hy_spread_warning']}"
    return line


def _sentiment_tag(sentiment: str) -> str:
    return {
        "VERY_BEARISH": "🐦 Contrarian ✅",
        "BEARISH": "🐦 Bearish",
        "NEUTRAL": "🐦 Neutral",
        "BULLISH": "🐦 Caution ⚠️",
    }.get(sentiment, "")


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
    dedup = []
    for sym in out:
        if sym not in seen:
            seen.add(sym)
            dedup.append(sym)
    return dedup


def _deterministic_universe(advisor: TradingAdvisor, universe_size: int) -> tuple[list[str], int]:
    if hasattr(advisor, "screener"):
        base = _run_quiet(advisor.screener.get_universe)
    else:
        scan_df = _run_quiet(advisor.scan_dip_opportunities, True, 0)
        base = list(scan_df.get("symbol", []).tolist()) if hasattr(scan_df, "get") else []
        return base[:universe_size], 0
    priority = _load_priority_symbols()
    ordered = []
    seen = set()
    for sym in [*priority, *base]:
        if sym not in seen:
            seen.add(sym)
            ordered.append(sym)
    return ordered[:universe_size], len(priority)


def _profile_for_market(market_regime: str) -> tuple[str, dict]:
    if market_regime == "correction":
        return "correction", DIPBUYER_CONFIG["profiles"].get("correction", {})
    if market_regime == "uptrend_under_pressure":
        return "under_pressure", DIPBUYER_CONFIG["profiles"].get("under_pressure", {})
    if market_regime == "confirmed_uptrend":
        return "bull", DIPBUYER_CONFIG["profiles"].get("bull", {})
    return "inactive", {}


def format_alert(limit: int = 8, min_score: int = 6, universe_size: int = 120) -> str:
    advisor = TradingAdvisor()
    sentiment_analyzer = XSentimentAnalyzer()

    market = _run_quiet(advisor.get_market_status, True)
    snapshot = _run_quiet(advisor.risk_fetcher.get_snapshot)
    stress = build_adverse_regime_indicator(market=market, risk_inputs=snapshot)
    profile_name, profile = _profile_for_market(market.regime.value)
    symbols, priority_count = _deterministic_universe(advisor, universe_size)

    lines = [
        "Dip Buyer Scan",
        _market_headline(market),
    ]
    polymarket_context = _run_quiet(load_compact_context)
    if polymarket_context:
        lines.extend(polymarket_context.splitlines())
    if stress.get("label") != "normal" and getattr(getattr(market, 'regime', None), 'value', '') != 'correction':
        lines.append(f"Adverse regime: {stress['label']} ({float(stress['score']):.0f}) -- {stress['reason']}")
    evaluated = 0
    passed = []
    rejected = []
    rejected_no_buy = []
    sentiment_checked = 0
    contrarian_count = 0
    source_counts = Counter()
    max_input_staleness = 0.0

    for symbol in symbols:
        analysis = _run_quiet(advisor.analyze_dip_stock, symbol)
        if analysis.get("error"):
            continue

        evaluated += 1
        source_counts[analysis.get("data_source", "unknown")] += 1
        max_input_staleness = max(max_input_staleness, float(analysis.get("data_staleness_seconds", 0.0) or 0.0))
        rec = analysis.get("recommendation", {})
        action = rec.get("action", "NO_BUY")
        score = int(analysis.get("total_score", 0))
        reason = rec.get("reason") or "No reason provided."

        if score >= min_score:
            sentiment_tag = ""
            if action in {"BUY", "WATCH"}:
                sentiment = sentiment_analyzer.analyze(symbol)
                if sentiment.get("sentiment") != "UNAVAILABLE":
                    sentiment_checked += 1
                if sentiment.get("sentiment") == "VERY_BEARISH":
                    contrarian_count += 1
                sentiment_value = sentiment.get("sentiment", "")
                if sentiment_value == "UNAVAILABLE":
                    sentiment_value = "NEUTRAL"
                sentiment_tag = _sentiment_tag(sentiment_value)
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
            passed.append({
                "symbol": symbol,
                "score": score,
                "action": action,
                "reason": reason,
                "rec": rec,
                "sentiment_tag": sentiment_tag,
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
                "credit_veto": bool(rec.get("credit_veto", analysis.get("credit_veto", False))),
                "falling_knife": bool(analysis.get("falling_knife", False)),
                "market_inactive": not bool(analysis.get("market_active", True)),
                "has_risk_telemetry": has_risk_telemetry,
            })
        else:
            rejected.append({"symbol": symbol, "reason": f"Below min-score filter ({score}<{min_score})"})
            if action == "NO_BUY":
                rejected_no_buy.append({"symbol": symbol, "score": score, "reason": reason})

        if action == "NO_BUY":
            rejected.append({"symbol": symbol, "reason": reason})

    if not passed:
        lines.append(f"Qualified setups: 0 of {len(symbols)} scanned | BUY 0 | WATCH 0")
        lines.append(f"Top leaders: {_top_names([{'symbol': s} for s in symbols], 3)}")
        lines.append(f"Final action: DO NOT BUY — market regime veto ({_dedupe_reason(market.notes or 'market correction gate')})")
        return "\n".join(lines)

    ranked = sorted(passed, key=_trade_quality_sort_key)
    candidates = ranked[:limit]
    buy_candidates = [c for c in candidates if c["action"] == "BUY"]
    watch_candidates = [c for c in candidates if c["action"] == "WATCH"]
    buy_count = len(buy_candidates)
    watch_count = len(watch_candidates)

    lines.append(f"Qualified setups: {len(passed)} of {len(symbols)} scanned | BUY {buy_count} | WATCH {watch_count}")
    if buy_count > 0:
        lines.append(f"BUY names: {_all_names(buy_candidates, 10)}")
    else:
        lines.append("BUY names: none")

    preview = []
    for c in candidates[: min(limit, 3)]:
        suffix = f" {c['sentiment_tag']}" if c['sentiment_tag'] else ""
        preview.append(f"{c['symbol']} {c['action']} ({c['score']}/12){suffix}")
    leaders_line = " | ".join(preview) if preview else "none"
    lines.append("Top leaders: " + leaders_line)
    review_lines = render_decision_review(candidates[: min(limit, 5)], detail_limit=2)
    lines.extend(review_lines)
    review_has_restraint_or_veto = any(
        line.startswith(("Higher-tq restraint:", "Abstains:", "Vetoes:"))
        for line in review_lines
    )
    if sentiment_checked > 0 and not review_has_restraint_or_veto:
        lines.append("Leaders: " + leaders_line)

    if buy_count == 0:
        veto_reason = _dedupe_reason(market.notes or 'market correction gate')
        lines.append(f"Final action: DO NOT BUY — market regime veto ({veto_reason})")
    elif watch_count > 0:
        lines.append("Final action: BUY listed names only; keep remaining qualified setups on watch")
    else:
        lines.append("Final action: BUY listed names only")

    if getattr(market, "status", "ok") == "degraded":
        lines.append(f"Note: degraded market data ({float(getattr(market, 'snapshot_age_seconds', 0.0) or 0.0):.0f}s stale)")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Dip Buyer alert scan")
    parser.add_argument("--limit", type=int, default=8)
    parser.add_argument("--min-score", type=int, default=6)
    parser.add_argument("--universe-size", type=int, default=int(os.getenv("TRADING_UNIVERSE_SIZE", "120")))
    args = parser.parse_args()
    print(format_alert(limit=args.limit, min_score=args.min_score, universe_size=args.universe_size))


if __name__ == "__main__":
    main()
