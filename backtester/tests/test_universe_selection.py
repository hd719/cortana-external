from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd

from data.universe_selection import RankedUniverseSelector


def _history(
    closes: list[float],
    volumes: list[float] | None = None,
    *,
    start: str = "2025-01-01",
) -> pd.DataFrame:
    index = pd.date_range(start=start, periods=len(closes), freq="B", tz="UTC")
    vols = volumes or [1_000_000.0] * len(closes)
    return pd.DataFrame(
        {
            "Open": closes,
            "High": [value * 1.01 for value in closes],
            "Low": [value * 0.99 for value in closes],
            "Close": closes,
            "Volume": vols,
        },
        index=index,
    )


def test_selector_keeps_priority_symbols_pinned_and_ranks_remaining(tmp_path):
    selector = RankedUniverseSelector(cache_path=tmp_path / "prefilter.json")

    benchmark = _history([100 + i * 0.15 for i in range(120)], [10_000_000.0] * 120)
    histories = {
        "SPY": benchmark,
        "AAA": _history([100 + i * 0.03 for i in range(120)], [600_000.0] * 120),
        "BBB": _history([100 + i * 0.20 for i in range(120)], [2_000_000.0] * 120),
        "CCC": _history([100 + i * 0.35 for i in range(120)], [4_500_000.0] * 120),
    }
    selector._fetch_histories = lambda symbols: histories  # type: ignore[method-assign]

    result = selector.select_live_universe(
        base_symbols=["AAA", "BBB", "CCC"],
        priority_symbols=["ZZZ", "BBB"],
        universe_size=3,
        market_regime="confirmed_uptrend",
    )

    assert result.symbols == ["ZZZ", "BBB", "CCC"]
    assert result.priority_symbols == ["ZZZ", "BBB"]
    assert result.ranked_symbols == ["CCC"]
    assert result.source == "live_refresh"
    assert Path(selector.cache_path).exists()


def test_selector_uses_fresh_cache_when_available(tmp_path):
    cache_path = tmp_path / "prefilter.json"
    payload = {
        "schema_version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "symbols": [
            {"symbol": "AAA", "prefilter_score": 45.0},
            {"symbol": "BBB", "prefilter_score": 88.0},
            {"symbol": "CCC", "prefilter_score": 70.0},
        ],
    }
    cache_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    selector = RankedUniverseSelector(cache_path=cache_path)
    result = selector.select_live_universe(
        base_symbols=["AAA", "BBB", "CCC", "DDD"],
        priority_symbols=["AAA"],
        universe_size=4,
        market_regime="confirmed_uptrend",
    )

    assert result.symbols == ["AAA", "BBB", "CCC", "DDD"]
    assert result.source == "cache"
    assert result.unscored_symbols == ["DDD"]
