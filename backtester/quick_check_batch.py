#!/usr/bin/env python3
"""Run bounded quick-check analysis for a small basket of symbols."""

from __future__ import annotations

import argparse
import json
import math
import warnings
from datetime import UTC, datetime
from typing import Iterable

from advisor import TradingAdvisor


def _json_safe(value):
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC).isoformat()
        return value.astimezone(UTC).isoformat()
    if hasattr(value, "isoformat") and callable(getattr(value, "isoformat")):
        try:
            return value.isoformat()
        except Exception:
            pass
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _normalize_symbols(raw_symbols: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in raw_symbols:
        value = str(raw or "").strip().upper()
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def _build_entry(result: dict) -> dict:
    analysis = result.get("analysis", {}) if isinstance(result, dict) else {}
    recommendation = analysis.get("recommendation", {}) if isinstance(analysis, dict) else {}
    return {
        "input_symbol": result.get("input_symbol"),
        "symbol": result.get("symbol"),
        "provider_symbol": result.get("provider_symbol"),
        "asset_class": result.get("asset_class"),
        "analysis_path": result.get("analysis_path"),
        "verdict": result.get("verdict"),
        "reason": result.get("reason"),
        "base_action": recommendation.get("action"),
        "score": analysis.get("total_score"),
        "confidence": analysis.get("effective_confidence", analysis.get("confidence")),
        "formatted": TradingAdvisor.format_quick_check(result),
        "raw": _json_safe(result),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run quick-check on a bounded basket")
    parser.add_argument(
        "--symbols",
        type=str,
        required=True,
        help="Comma-separated symbol list to analyze",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    symbols = _normalize_symbols(args.symbols.split(","))
    advisor = TradingAdvisor()

    results = []
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="Timestamp.utcnow is deprecated.*")
        for symbol in symbols:
            results.append(_build_entry(advisor.quick_check(symbol)))

    payload = {
        "generated_at": datetime.now(UTC).isoformat(),
        "count": len(results),
        "symbols": symbols,
        "results": results,
    }
    print(json.dumps(payload, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
