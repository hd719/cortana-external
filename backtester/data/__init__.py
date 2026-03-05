# Data module - for fetching and managing historical price data
from pathlib import Path
import os
import re

from dotenv import load_dotenv

# Auto-load repo-level .env for local script runs (advisor/dipbuyer/risk signals).
# Does not override already-exported environment variables.
_REPO_ROOT = Path(__file__).resolve().parents[2]
_ENV_PATH = _REPO_ROOT / ".env"


def _extract_fred_api_key_colon_fallback(env_text: str) -> str | None:
    """
    Parse malformed FRED key lines like `FRED_API_KEY: value`.
    This is a narrow fallback and intentionally does not replace normal dotenv parsing.
    """
    pattern = re.compile(r"^(?:export\s+)?FRED_API_KEY\s*:\s*(.+)$")
    for raw_line in env_text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        match = pattern.match(line)
        if not match:
            continue

        value = match.group(1).strip()
        if value.startswith(("'", '"')) and value.endswith(("'", '"')) and len(value) >= 2:
            value = value[1:-1].strip()
        else:
            value = value.split("#", 1)[0].strip()

        if value:
            return value
    return None


def _load_fred_api_key_colon_fallback(env_path: Path) -> None:
    # Preserve precedence: existing environment variables (or dotenv-loaded values) always win.
    if os.getenv("FRED_API_KEY"):
        return
    try:
        env_text = env_path.read_text(encoding="utf-8")
    except OSError:
        return
    fallback_value = _extract_fred_api_key_colon_fallback(env_text)
    if fallback_value:
        os.environ["FRED_API_KEY"] = fallback_value


load_dotenv(_ENV_PATH, override=False)
_load_fred_api_key_colon_fallback(_ENV_PATH)

from .fetcher import (
    AlpacaDataFetcher,
    get_historical_data,
    get_multiple_symbols,
    get_spy_benchmark,
)
from .fundamentals import FundamentalsCache, FundamentalsFetcher
from .market_regime import MarketRegime, MarketRegimeDetector, MarketStatus
from .universe import GROWTH_WATCHLIST, SP500_TICKERS, UniverseScreener
