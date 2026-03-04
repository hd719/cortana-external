#!/usr/bin/env python3
"""Dip Buyer alert runner with regime profile + rejection telemetry."""

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
from data.x_sentiment import XSentimentAnalyzer
from strategies.dip_buyer import DIPBUYER_CONFIG


def _run_quiet(fn, *args, **kwargs):
    with redirect_stdout(io.StringIO()):
        return fn(*args, **kwargs)


def _fmt_value(value, decimals: int = 1) -> str:
    if value is None:
        return "N/A"
    try:
        if value != value:
            return "N/A"
    except Exception:
        return "N/A"
    return f"{value:.{decimals}f}" if decimals else f"{value:.0f}"


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
    profile_name, profile = _profile_for_market(market.regime.value)
    symbols, priority_count = _deterministic_universe(advisor, universe_size)

    now_et = datetime.now(ZoneInfo("America/New_York")).strftime("%Y-%m-%d %I:%M %p ET")
    lines = [
        "📉 Trading Advisor - Dip Buyer Scan",
        f"Run: {now_et}",
        f"Market: {market.regime.value} | Position Sizing: {market.position_sizing:.0%}",
        f"Market Data Source: {getattr(market, 'data_source', 'unknown')} | staleness={float(getattr(market, 'snapshot_age_seconds', 0.0) or 0.0):.0f}s",
        f"Run Status: {getattr(market, 'status', 'ok')}",
        f"Status: {market.notes}",
        _macro_gate_line(snapshot),
        f"Dip Profile: {profile_name} | buy>={profile.get('score_thresholds', {}).get('buy', min_score)} | watch>={profile.get('score_thresholds', {}).get('watch', min_score)} | max_pos={profile.get('risk', {}).get('max_position_pct', DIPBUYER_CONFIG['risk']['max_position_pct']):.0%}",
        f"Scanner: universe={len(symbols)} | priority_symbols={priority_count}",
        "",
    ]
    if getattr(market, "status", "ok") == "degraded":
        lines.append(f"⚠️ Degraded Data: {getattr(market, 'degraded_reason', 'market data fallback in use')}")
        lines.append(f"Fallback Staleness: {float(getattr(market, 'snapshot_age_seconds', 0.0) or 0.0):.0f}s")
        lines.append(f"Next Action: {getattr(market, 'next_action', 'retry market fetch after cooldown')}")
        lines.append("")

    evaluated = 0
    passed = []
    rejected = []
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
                sentiment_tag = _sentiment_tag(sentiment.get("sentiment", ""))
            passed.append({"symbol": symbol, "score": score, "action": action, "reason": reason, "rec": rec, "sentiment_tag": sentiment_tag})
        else:
            rejected.append({"symbol": symbol, "reason": f"Below min-score filter ({score}<{min_score})"})

        if action == "NO_BUY":
            rejected.append({"symbol": symbol, "reason": reason})

    if not passed:
        lines.append("No Dip Buyer candidates met the current scan threshold.")
        lines.append(f"Summary: scanned {len(symbols)} | evaluated {evaluated} | threshold-passed 0 | BUY 0 | WATCH 0 | NO_BUY 0")
        return "\n".join(lines)

    ranked = sorted(passed, key=lambda x: x["score"], reverse=True)
    candidates = ranked[:limit]
    buy_count = sum(1 for c in candidates if c["action"] == "BUY")
    watch_count = sum(1 for c in candidates if c["action"] == "WATCH")
    no_buy_count = sum(1 for c in candidates if c["action"] == "NO_BUY")

    lines.append(f"Summary: scanned {len(symbols)} | evaluated {evaluated} | threshold-passed {len(passed)} | BUY {buy_count} | WATCH {watch_count} | NO_BUY {no_buy_count}")
    lines.append(f"🐦 Sentiment: {sentiment_checked}/{max(buy_count + watch_count, 0)} checked | {contrarian_count} contrarian signals")
    source_breakdown = ", ".join([f"{k}={v}" for k, v in sorted(source_counts.items())]) if source_counts else "none"
    lines.append(f"Data Inputs: {source_breakdown} | max_staleness={max_input_staleness:.0f}s")

    reason_counts = Counter(r["reason"] for r in rejected)
    if reason_counts:
        lines.append("Blockers: " + ", ".join([f"{k} ({v})" for k, v in reason_counts.most_common(3)]))
        samples = defaultdict(list)
        for r in rejected:
            if len(samples[r["reason"]]) < 3:
                samples[r["reason"]].append(r["symbol"])
        sample_bits = [f"{k} => {', '.join(v)}" for k, v in list(samples.items())[:2]]
        if sample_bits:
            lines.append("Blocker samples: " + " | ".join(sample_bits))

    lines.append("")
    for c in candidates:
        line = f"• {c['symbol']} ({c['score']}/12) → {c['action']}"
        if c["sentiment_tag"]:
            line += f" | {c['sentiment_tag']}"
        lines.append(line)
        if c["action"] == "BUY":
            lines.append(f"  Entry ${c['rec'].get('entry', 0):.2f} | Stop ${c['rec'].get('stop_loss', 0):.2f}")
        else:
            lines.append(f"  {c['reason']}")

    lines.append("")
    lines.append("⚠️ Signals are decision support only (not financial advice).")
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
