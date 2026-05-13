from __future__ import annotations

import json
import re
from pathlib import Path

from .models import WatchlistDefinition
from .storage import default_cache_dir

SYMBOL_RE = re.compile(r"^[A-Z][A-Z0-9.-]{0,14}$")

DEFAULT_WATCHLISTS = {
    "core": WatchlistDefinition(
        name="core",
        symbols=["AAPL", "MSFT", "NVDA", "AMD", "TSLA", "GOOG", "AMZN", "META"],
        description="Default large-cap technology and AI watchlist.",
    ),
    "benchmarks": WatchlistDefinition(
        name="benchmarks",
        symbols=["SPY", "QQQ", "IWM"],
        description="Market reference ETFs.",
    ),
}


def normalize_symbols(symbols: list[str] | str) -> list[str]:
    raw = symbols.split(",") if isinstance(symbols, str) else symbols
    normalized = []
    for item in raw:
        symbol = item.strip().upper()
        if not symbol:
            continue
        if not SYMBOL_RE.match(symbol):
            raise ValueError(f"Invalid symbol: {item}")
        if symbol not in normalized:
            normalized.append(symbol)
    if not normalized:
        raise ValueError("At least one symbol is required")
    return normalized


def load_watchlist(name: str, *, watchlist_dir: Path | str | None = None) -> WatchlistDefinition:
    normalized = name.strip().lower()
    if normalized in DEFAULT_WATCHLISTS:
        return DEFAULT_WATCHLISTS[normalized]
    directory = Path(watchlist_dir).expanduser().resolve() if watchlist_dir else default_cache_dir() / "watchlists"
    path = directory / f"{normalized}.json"
    if not path.exists():
        raise KeyError(f"Unknown watchlist: {name}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    definition = WatchlistDefinition.model_validate(payload)
    return definition.model_copy(update={"symbols": normalize_symbols(definition.symbols)})
