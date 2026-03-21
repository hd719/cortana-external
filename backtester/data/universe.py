"""
Universe Screening Module

Filters and screens stocks to find CANSLIM candidates.

=============================================================================
WHY DO WE NEED A UNIVERSE?
=============================================================================

We can't analyze every stock in the market (6000+). We need to filter
down to a manageable universe of candidates that meet basic criteria.

CANSLIM Universe Criteria (from PRD):
- Market cap > $1B (mid to large cap)
- Average volume > 400K shares/day (liquid)
- Price > $15 (no penny stocks)

Then we score each candidate on CANSLIM factors to find the best setups.

=============================================================================
"""

import pandas as pd
import numpy as np
from typing import List, Dict, Optional, Set
from datetime import UTC, datetime, timedelta
import json
import logging
import os
from pathlib import Path
import time
import requests

from .market_data_provider import MarketDataError, MarketDataProvider
from .market_data_service_client import MarketDataServiceClient
from .polymarket_context import load_watchlist_entries


LOGGER = logging.getLogger(__name__)


# Bundled fallback universe.
# Normal runtime should prefer the TS-owned base-universe artifact and only use
# this list when the service artifact is unavailable or stale.
SP500_TICKERS = [
    # === Mega Cap / Top 30 by market cap ===
    "AAPL", "MSFT", "AMZN", "NVDA", "GOOGL", "GOOG", "META", "TSLA", "BRK-B",
    "UNH", "LLY", "JPM", "V", "AVGO", "XOM", "MA", "JNJ", "PG", "HD",
    "COST", "MRK", "ABBV", "CRM", "CVX", "KO", "PEP", "WMT", "BAC", "NFLX",
    "TMO", "MCD", "CSCO", "ABT", "ACN", "LIN", "DHR", "ORCL", "AMD", "TXN",

    # === Technology & Software ===
    "ADBE", "INTU", "NOW", "SNPS", "CDNS", "PANW", "CRWD", "FTNT", "WDAY",
    "TEAM", "HUBS", "DDOG", "ZS", "MNDY", "BILL", "PCTY", "PAYC", "TTD",
    "VEEV", "CPAY", "GDDY", "GEN", "AKAM", "EPAM", "GLOB",

    # === Semiconductors ===
    "AVGO", "AMD", "QCOM", "TXN", "ADI", "LRCX", "KLAC", "AMAT", "MRVL",
    "ON", "NXPI", "MCHP", "SWKS", "MPWR", "ARM", "SMCI", "CRUS", "WOLF",

    # === Financials ===
    "JPM", "BAC", "WFC", "GS", "MS", "SCHW", "BLK", "SPGI", "ICE", "CME",
    "CB", "PGR", "AIG", "MET", "PRU", "TRV", "ALL", "AXP", "FI", "PYPL",
    "COF", "USB", "PNC", "BK", "AMP", "RJF", "HOOD", "SOFI",

    # === Healthcare & Biotech ===
    "LLY", "UNH", "JNJ", "MRK", "ABBV", "TMO", "ABT", "DHR", "PFE", "BMY",
    "AMGN", "GILD", "VRTX", "REGN", "ISRG", "SYK", "BSX", "MDT", "EW", "ZTS",
    "IDXX", "DXCM", "ALGN", "HOLX", "IQV", "CI", "ELV", "HUM", "MOH",
    "MRNA", "BMRN", "ALNY", "PCVX", "ARGX", "NBIX", "SRPT", "IONS",

    # === Industrials & Defense ===
    "GE", "CAT", "HON", "UNP", "UPS", "RTX", "DE", "BA", "LMT", "NOC",
    "GD", "ITW", "ETN", "PH", "EMR", "ROK", "AME", "FTV", "CARR",
    "TT", "AXON", "VRSK", "TDG", "HWM", "GWW", "FAST", "IR",

    # === Consumer / Retail ===
    "COST", "WMT", "HD", "LOW", "TJX", "NKE", "SBUX", "MCD", "CMG", "YUM",
    "DPZ", "LULU", "DECK", "BIRD", "ONON", "CAVA", "ELF", "CELH",
    "ORLY", "AZO", "ULTA", "ROST", "DG", "DLTR", "FIVE",

    # === Energy ===
    "XOM", "CVX", "COP", "EOG", "SLB", "MPC", "PSX", "VLO", "OXY",
    "DVN", "FANG", "HAL", "TRGP", "WMB", "KMI", "OKE", "LNG",

    # === Communication & Media ===
    "GOOGL", "META", "NFLX", "DIS", "CMCSA", "T", "VZ", "TMUS", "CHTR",
    "SPOT", "RBLX", "ROKU", "ZM", "MTCH",

    # === REITs & Utilities ===
    "PLD", "AMT", "CCI", "EQIX", "SPG", "PSA", "WELL", "DLR", "O",
    "NEE", "SO", "DUK", "AEP", "SRE", "D", "PCG", "VST", "CEG",

    # === Materials & Chemicals ===
    "APD", "SHW", "ECL", "LIN", "FCX", "NEM", "NUE", "STLD", "VMC", "MLM",
    "CL", "CLX", "DD", "EMN",

    # === Additional Large Cap / S&P 500 Components ===
    "GRMN", "CDNS", "SNPS", "MELI", "WDAY", "ADSK", "LRCX", "ANET", "MNST",
    "FTNT", "CPRT", "CTAS", "ODFL", "PCAR", "FICO", "MSCI", "IDXX", "DXCM",
    "EW", "ROP", "MTD", "WST", "ZBRA", "TER", "TRMB", "NTAP", "JBHT",
    "POOL", "TECH", "BIO", "PKG", "WRB", "CINF", "GL", "AIZ",
    "FDS", "CBOE", "NDAQ", "MKTX", "TROW", "IVZ", "BEN",

    # === High-Growth Tech / AI / Cloud ===
    "PLTR", "NET", "SNOW", "MDB", "ESTC", "CFLT", "IOT", "AI", "PATH",
    "GTLB", "DOCN", "BRZE", "AMPL", "FRSH", "TOST", "GLBE",
    "APP", "RDDT", "GRAB", "SE", "BABA", "JD", "PDD", "BIDU",
    "ASAN", "TWLO", "OKTA", "U", "PINS", "SNAP",

    # === Recent Strong IPOs / Newer Public Companies ===
    "RKLB", "CART", "BIRK", "DUOL", "CAVA", "KVYO", "ONON",
    "VRT", "CRDO", "IBKR", "FOUR", "SOUN",

    # === Biotech Growth ===
    "PCVX", "BMRN", "INCY", "EXAS", "HALO", "RARE",
    "RCKT", "DNLI", "KRYS", "RYTM", "INSM", "NUVB",

    # === Energy Transition / Infrastructure ===
    "ENPH", "SEDG", "FSLR", "RUN", "ARRY", "PWR", "QUBT",

    # === Industrials / Aerospace Growth ===
    "ARES", "KKR", "APO", "OWL", "STEP",
]

# Growth/momentum stocks to always include in scans
GROWTH_WATCHLIST = [
    # Mega cap leaders
    "NVDA", "TSLA", "META", "AMZN", "GOOGL", "MSFT", "AAPL", "NFLX",

    # Cybersecurity & Cloud
    "CRWD", "PLTR", "NET", "SNOW", "DDOG", "ZS", "PANW", "FTNT", "S",

    # AI / Data Infrastructure
    "ARM", "SMCI", "AI", "PATH", "SNOW", "MDB", "ESTC", "CFLT", "DDOG",

    # Semiconductors
    "AMD", "AVGO", "MRVL", "ARM", "SMCI", "AMAT", "LRCX", "KLAC", "ON", "MPWR",

    # High-growth tech / fintech
    "UBER", "ABNB", "XYZ", "SHOP", "COIN", "HOOD", "SOFI", "AFRM", "NU", "TOST",
    "TTD", "HUBS", "MNDY", "BILL",

    # Biotech / Healthcare growth
    "LLY", "NVO", "VRTX", "REGN", "ARGX", "NBIX", "SRPT", "ALNY", "MRNA",

    # Consumer growth / IPOs with momentum
    "CAVA", "ONON", "BIRK", "ELF", "CELH", "DUOL", "CART", "RKLB",
    "LULU", "DECK", "CMG",

    # Energy / Infrastructure
    "VST", "CEG", "TRGP", "LNG",

    # Industrials with momentum
    "AXON", "TT", "GE", "CARR", "HWM", "TDG",

    # Additional high-growth / AI infrastructure
    "APP", "RDDT", "VRT", "CRDO", "ANET", "FICO", "PLTR",
    "GRAB", "SE", "NU", "MELI", "FOUR", "SOUN", "IOT",
    "KVYO", "GLBE", "GTLB",

    # Alt energy / private equity growth
    "ENPH", "FSLR", "KKR", "APO", "ARES",
]

UNIVERSE_PROFILE_QUICK = "quick"
UNIVERSE_PROFILE_STANDARD = "standard"
UNIVERSE_PROFILE_NIGHTLY_DISCOVERY = "nightly_discovery"
UNIVERSE_PROFILES = {
    UNIVERSE_PROFILE_QUICK: "Growth watchlist only",
    UNIVERSE_PROFILE_STANDARD: "Curated broad universe used by the current live stack",
    UNIVERSE_PROFILE_NIGHTLY_DISCOVERY: "Broader nightly discovery universe using live S&P 500 constituents when available",
}


class UniverseScreener:
    """
    Screens stocks to find CANSLIM candidates.
    
    Usage:
        screener = UniverseScreener()
        candidates = screener.screen()
        
        # Get top 20 by score
        top_picks = screener.rank_candidates(candidates)[:20]
    """
    
    def __init__(self, cache_dir: str = None, market_data: Optional[MarketDataProvider] = None):
        """Initialize the screener."""
        if cache_dir is None:
            cache_dir = Path(__file__).parent / "cache"
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(exist_ok=True)
        self._service_base_url = os.getenv("MARKET_DATA_SERVICE_BASE_URL", "http://localhost:3033").rstrip("/")
        self._service_timeout_seconds = float(os.getenv("MARKET_DATA_SERVICE_TIMEOUT_SECONDS", "1.5"))
        self._base_universe_cache: Optional[List[str]] = None
        self._base_universe_cache_refresh = datetime.now(UTC)
        self.market_data = market_data or MarketDataProvider(cache_dir=str(self.cache_dir / "market_data"))
        self.service_client = MarketDataServiceClient(
            base_url=self._service_base_url,
            timeout_seconds=self._service_timeout_seconds,
        )

    def _service_request(self, path: str, method: str = "GET", **kwargs):
        try:
            if method == "POST":
                response = requests.post(f"{self._service_base_url}{path}", timeout=self._service_timeout_seconds, **kwargs)
            else:
                response = requests.get(f"{self._service_base_url}{path}", timeout=self._service_timeout_seconds, **kwargs)
        except Exception as exc:
            LOGGER.debug("Universe service request failed for %s: %s", path, exc)
            return None, 0
        if response is None or response.status_code != 200:
            return None, getattr(response, "status_code", 0)
        try:
            return response.json(), response.status_code
        except Exception as exc:
            LOGGER.debug("Universe service response parse failed for %s: %s", path, exc)
            return None, response.status_code

    def _sp500_constituents_cache_path(self) -> Path:
        return self.cache_dir / "sp500_constituents.json"

    @staticmethod
    def _normalize_symbol(symbol: str) -> str:
        return str(symbol or "").strip().upper().replace(".", "-")

    @classmethod
    def _dedupe_symbols(cls, symbols: List[str]) -> List[str]:
        seen: Set[str] = set()
        ordered: List[str] = []
        for symbol in symbols:
            normalized = cls._normalize_symbol(symbol)
            if normalized and normalized not in seen:
                seen.add(normalized)
                ordered.append(normalized)
        return ordered

    def _load_cached_sp500_constituents(self, *, max_age_hours: float = 24.0) -> Optional[List[str]]:
        path = self._sp500_constituents_cache_path()
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            raw_generated_at = str(payload.get("generated_at")).strip().replace("Z", "+00:00")
            generated_at = datetime.fromisoformat(raw_generated_at)
            if generated_at.tzinfo is None:
                generated_at = generated_at.replace(tzinfo=UTC)
            age_seconds = max((datetime.now(UTC) - generated_at).total_seconds(), 0.0)
            if age_seconds > max_age_hours * 3600:
                return None
            symbols = payload.get("symbols", [])
            if not isinstance(symbols, list) or not symbols:
                return None
            return self._dedupe_symbols(symbols)
        except Exception:
            return None

    def _write_sp500_constituents_cache(self, symbols: List[str]) -> None:
        payload = {
            "generated_at": datetime.now(UTC).isoformat(),
            "symbols": self._dedupe_symbols(symbols),
        }
        self._sp500_constituents_cache_path().write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    @staticmethod
    def _parse_ts_timestamp(value: object) -> Optional[datetime]:
        if not value:
            return None
        try:
            if isinstance(value, (int, float)):
                return datetime.fromtimestamp(float(value), tz=UTC)
            if isinstance(value, datetime):
                return value.replace(tzinfo=value.tzinfo or UTC)
            raw = str(value).strip().replace("Z", "+00:00")
            if not raw:
                return None
            return datetime.fromisoformat(raw)
        except Exception:
            return None

    @staticmethod
    def _is_fresh_timestamp(ts: Optional[datetime], max_age_hours: float) -> bool:
        if ts is None:
            return False
        age_seconds = max((datetime.now(UTC) - ts.astimezone(UTC)).total_seconds(), 0.0)
        return age_seconds <= max_age_hours * 3600

    def _parse_universe_payload(self, payload: dict, *, max_age_hours: float = 24.0) -> Optional[List[str]]:
        if not isinstance(payload, dict):
            return None

        status = str(payload.get("status") or "").lower()
        if status and status not in {"ok", "degraded"}:
            return None

        data = payload.get("data", payload)
        if not isinstance(data, dict):
            return None

        symbols = data.get("symbols") or payload.get("symbols")
        if not isinstance(symbols, list) or not symbols:
            return None

        generated_at = self._parse_ts_timestamp(data.get("updatedAt") or payload.get("updatedAt"))
        if generated_at is not None and not self._is_fresh_timestamp(generated_at, max_age_hours):
            return None

        return self._dedupe_symbols(symbols)

    def _load_base_universe_from_service(self, *, max_age_hours: float = 24.0, refresh: bool = False) -> Optional[List[str]]:
        if refresh:
            _, refresh_status = self._service_request("/market-data/universe/refresh", method="POST")
            if refresh_status == 0:
                LOGGER.debug("Universe refresh service request failed or unavailable.")

        payload, status_code = self._service_request("/market-data/universe/base")
        if payload is None or status_code == 0:
            return None
        return self._parse_universe_payload(payload, max_age_hours=max_age_hours)

    def _fetch_price_history(self, symbol: str, period: str = "1y") -> Optional[pd.DataFrame]:
        try:
            return self.market_data.get_history(symbol, period=period, auto_adjust=False).frame
        except MarketDataError as exc:
            LOGGER.debug("Skipping %s during provider history fetch: %s", symbol, exc)
            return None

    def _fetch_stock_metadata(self, symbol: str) -> Dict:
        payload = self.service_client.get_symbol_payload("metadata", symbol)
        data = self.service_client.extract_data(payload) or {}
        if not isinstance(data, dict):
            return {}
        return {
            'name': data.get('name', symbol),
            'market_cap': data.get('market_cap'),
            'float_shares': data.get('float_shares'),
            'beta': data.get('beta'),
            'sector': data.get('sector'),
            'industry': data.get('industry'),
        }

    def load_sp500_constituents(self, *, refresh: bool = False, max_age_hours: float = 24.0) -> List[str]:
        if not refresh:
            cached = self._load_cached_sp500_constituents(max_age_hours=max_age_hours)
            if cached:
                return cached

        symbols = self._load_base_universe_from_service(
            refresh=refresh,
            max_age_hours=max_age_hours,
        )
        if symbols:
            self._write_sp500_constituents_cache(symbols)
            return symbols

        if not refresh:
            cached = self._load_cached_sp500_constituents(max_age_hours=24 * 365)
            if cached:
                LOGGER.warning("Using cached S&P 500 constituents for nightly discovery")
                return cached

        cached = self._load_cached_sp500_constituents(max_age_hours=24 * 365)
        if cached:
            LOGGER.warning("Using cached S&P 500 constituents for nightly discovery")
            return cached
        LOGGER.warning("Using static bundled S&P 500 constituents for nightly discovery")
        return self._dedupe_symbols(SP500_TICKERS)
    
    def _dynamic_watchlist_path(self) -> Path:
        """Path to dynamic watchlist JSON in this module directory."""
        return Path(__file__).parent / "dynamic_watchlist.json"

    def _get_base_universe(self, *, refresh: bool = False, max_age_hours: float = 24.0) -> List[str]:
        if not refresh and self._base_universe_cache is not None:
            return self._base_universe_cache
        symbols = self.load_sp500_constituents(refresh=refresh, max_age_hours=max_age_hours)
        self._base_universe_cache = self._dedupe_symbols(symbols)
        self._base_universe_cache_refresh = datetime.now(UTC)
        return self._base_universe_cache

    def _load_watchlist_payload(self, path: Path) -> List[Dict]:
        """
        Load ticker entries from disk.

        Returns an empty list if file is missing/corrupt.
        """
        if not path.exists():
            return []

        try:
            payload = json.loads(path.read_text())
            tickers = payload.get("tickers", [])
            if not isinstance(tickers, list):
                return []
            return tickers
        except Exception:
            return []

    def _load_dynamic_watchlist(self) -> List[Dict]:
        """Load dynamic social-discovery ticker entries from disk."""
        return self._load_watchlist_payload(self._dynamic_watchlist_path())

    def _load_polymarket_watchlist(self) -> List[Dict]:
        """Load Polymarket-derived ticker entries from disk."""
        max_age_hours = float(os.getenv("POLYMARKET_WATCHLIST_MAX_AGE_HOURS", "8"))
        return load_watchlist_entries(
            max_age_hours=max_age_hours,
            allowed_asset_classes={"stock", "etf", "crypto_proxy"},
        )

    def get_dynamic_tickers(
        self,
        include_growth: bool = True,
        static_symbols: Optional[Set[str]] = None,
    ) -> List[str]:
        """
        Return only dynamic ticker symbols that are not already in static lists.
        """
        static_universe: Set[str] = set(static_symbols or self._get_base_universe())
        if include_growth:
            static_universe.update(GROWTH_WATCHLIST)

        dynamic_symbols: Set[str] = set()
        for item in [*self._load_dynamic_watchlist(), *self._load_polymarket_watchlist()]:
            symbol = str(item.get("symbol", "")).upper().strip()
            if symbol:
                dynamic_symbols.add(symbol)

        return sorted(list(dynamic_symbols - static_universe))

    def get_universe_stats(self, include_growth: bool = True) -> Dict[str, int]:
        """
        Return static/dynamic/total ticker counts for the active universe.
        """
        static_universe: Set[str] = set(self._get_base_universe())
        if include_growth:
            static_universe.update(GROWTH_WATCHLIST)

        dynamic_only = set(self.get_dynamic_tickers(include_growth=include_growth))
        total = static_universe | dynamic_only

        return {
            "static": len(static_universe),
            "dynamic": len(dynamic_only),
            "total": len(total),
        }

    def get_universe(self, include_growth: bool = True) -> List[str]:
        """
        Get the list of tickers to screen.

        Args:
            include_growth: Include growth watchlist stocks

        Returns:
            List of ticker symbols
        """
        universe: Set[str] = set(self._get_base_universe())

        if include_growth:
            universe.update(GROWTH_WATCHLIST)

        # Merge dynamic social-discovery symbols (safe fallback to static-only).
        universe.update(self.get_dynamic_tickers(include_growth=include_growth, static_symbols=universe))

        return sorted(list(universe))

    def get_nightly_discovery_universe(
        self,
        *,
        include_growth: bool = True,
        refresh_sp500: bool = False,
    ) -> List[str]:
        universe: Set[str] = set(self._get_base_universe(refresh=refresh_sp500))
        if include_growth:
            universe.update(self._dedupe_symbols(GROWTH_WATCHLIST))
        universe.update(self.get_dynamic_tickers(include_growth=include_growth, static_symbols=universe))
        return sorted(list(universe))

    def get_universe_for_profile(
        self,
        profile: str = UNIVERSE_PROFILE_STANDARD,
        *,
        refresh_sp500: bool = False,
        include_growth: bool = True,
    ) -> List[str]:
        if profile == UNIVERSE_PROFILE_QUICK:
            return self._dedupe_symbols(GROWTH_WATCHLIST)
        if profile == UNIVERSE_PROFILE_STANDARD:
            return self.get_universe(include_growth=include_growth)
        if profile == UNIVERSE_PROFILE_NIGHTLY_DISCOVERY:
            return self.get_nightly_discovery_universe(
                include_growth=include_growth,
                refresh_sp500=refresh_sp500,
            )
        raise ValueError(f"Unknown universe profile: {profile}")
    
    def get_stock_info(self, symbol: str, history: Optional[pd.DataFrame] = None) -> Optional[Dict]:
        """
        Get basic info for a stock (price, market cap, volume).
        
        Returns None if the stock doesn't meet basic criteria.
        """
        try:
            history = history if history is not None else self._fetch_price_history(symbol)
            if history is None or history.empty:
                return None

            close = pd.to_numeric(history.get('Close'), errors='coerce').dropna()
            volume = pd.to_numeric(history.get('Volume'), errors='coerce').dropna()
            if close.empty or volume.empty:
                return None

            window = min(len(volume), 50)
            price = float(close.iloc[-1])
            avg_volume = float(volume.tail(window).mean()) if window else 0.0
            result = {
                'symbol': symbol,
                'name': symbol,
                'price': price,
                'market_cap': None,
                'avg_volume': avg_volume,
                'float_shares': None,
                'beta': None,
                'sector': None,
                'industry': None,
                '52w_high': float(close.max()),
                '52w_low': float(close.min()),
            }

            if result['price'] < 15 or result['avg_volume'] < 400_000:
                return result

            result.update(self._fetch_stock_metadata(symbol))
            return result
            
        except Exception as e:
            LOGGER.debug("Skipping %s during basic info fetch: %s", symbol, e)
            return None
    
    def passes_basic_filters(self, info: Dict) -> bool:
        """
        Check if a stock passes basic CANSLIM filters.
        
        Criteria:
        - Market cap > $1B
        - Average volume > 400K
        - Price > $15
        """
        if info is None:
            return False
        
        market_cap = info.get('market_cap')
        avg_volume = info.get('avg_volume')
        price = info.get('price')
        
        # Check each criterion
        if market_cap is None or market_cap < 1_000_000_000:  # $1B
            return False
        
        if avg_volume is None or avg_volume < 400_000:
            return False
        
        if price is None or price < 15:
            return False
        
        return True
    
    def calculate_technical_score(self, symbol: str, history: Optional[pd.DataFrame] = None) -> Dict:
        """
        Calculate technical CANSLIM scores (N, L, S) for a stock.
        
        Returns dict with scores and supporting data.
        """
        try:
            hist = history if history is not None else self._fetch_price_history(symbol)
            
            if hist is None or hist.empty or len(hist) < 50:
                return {'symbol': symbol, 'error': 'Insufficient data'}
            
            close = pd.to_numeric(hist['Close'], errors='coerce').dropna()
            volume = pd.to_numeric(hist['Volume'], errors='coerce').dropna()
            if close.empty or volume.empty:
                return {'symbol': symbol, 'error': 'Insufficient data'}
            
            # N — New High (proximity to 52-week high)
            high_52w = close.max()
            current = close.iloc[-1]
            pct_from_high = current / high_52w
            
            if pct_from_high >= 0.95:
                n_score = 2
            elif pct_from_high >= 0.90:
                n_score = 1
            else:
                n_score = 0
            
            # L — Leader (relative strength / momentum)
            if len(close) >= 126:
                momentum_6m = (current / close.iloc[-126] - 1) * 100
            else:
                momentum_6m = (current / close.iloc[0] - 1) * 100
            
            if momentum_6m >= 25:
                l_score = 2
            elif momentum_6m >= 10:
                l_score = 1
            else:
                l_score = 0
            
            # S — Supply/Demand (volume on up days vs down days)
            daily_return = close.pct_change()
            up_days = daily_return > 0
            
            avg_up_volume = volume[up_days].mean() if up_days.any() else 0
            avg_down_volume = volume[~up_days].mean() if (~up_days).any() else 1
            
            vol_ratio = avg_up_volume / avg_down_volume if avg_down_volume > 0 else 0
            
            if vol_ratio >= 1.5:
                s_score = 2 if vol_ratio >= 2.0 else 1
            else:
                s_score = 0
            
            return {
                'symbol': symbol,
                'price': current,
                '52w_high': high_52w,
                'pct_from_high': pct_from_high * 100,
                'momentum_6m': momentum_6m,
                'volume_ratio': vol_ratio,
                'N_score': n_score,
                'L_score': l_score,
                'S_score': s_score,
                'technical_score': n_score + l_score + s_score,
            }
            
        except Exception as e:
            return {'symbol': symbol, 'error': str(e)}
    
    def screen(
        self,
        symbols: List[str] = None,
        min_technical_score: int = 3,
        verbose: bool = True,
    ) -> pd.DataFrame:
        """
        Screen stocks and calculate CANSLIM scores.
        
        Args:
            symbols: List of symbols to screen (default: full universe)
            min_technical_score: Minimum technical score to include
            verbose: Print progress
        
        Returns:
            DataFrame of candidates with scores
        """
        if symbols is None:
            symbols = self.get_universe()
        else:
            symbols = self._dedupe_symbols(symbols)
        
        if verbose:
            print(f"🔍 Screening {len(symbols)} stocks...")
            print(f"   Filters: Market cap > $1B, Volume > 400K, Price > $15")
            print(f"   Min technical score: {min_technical_score}/6")
            print()
        
        candidates = []
        passed = 0
        failed = 0
        
        for i, symbol in enumerate(symbols):
            if verbose and (i + 1) % 10 == 0:
                print(f"   Progress: {i + 1}/{len(symbols)} ({passed} passed, {failed} filtered)")

            history = self._fetch_price_history(symbol)
            if history is None or history.empty:
                failed += 1
                continue
            
            # Get basic info
            info = self.get_stock_info(symbol, history=history)
            
            # Apply basic filters
            if not self.passes_basic_filters(info):
                failed += 1
                continue
            
            # Calculate technical scores
            tech = self.calculate_technical_score(symbol, history=history)
            
            if 'error' in tech:
                failed += 1
                continue
            
            # Apply minimum score filter
            if tech['technical_score'] < min_technical_score:
                failed += 1
                continue
            
            # Combine info
            candidate = {
                **info,
                **tech,
            }
            candidates.append(candidate)
            passed += 1
            
            # Rate limiting (avoid Yahoo Finance blocks)
            time.sleep(0.2)
        
        if verbose:
            print(f"\n✅ Screening complete!")
            print(f"   Passed: {passed}")
            print(f"   Filtered: {failed}")
        
        if not candidates:
            return pd.DataFrame()
        
        df = pd.DataFrame(candidates)
        
        # Sort by technical score
        df = df.sort_values('technical_score', ascending=False)
        
        return df
    
    def quick_screen(self, symbols: List[str] = None) -> pd.DataFrame:
        """
        Quick screen using only the growth watchlist.
        
        Faster than full screen — good for daily checks.
        """
        if symbols is None:
            symbols = GROWTH_WATCHLIST
        
        return self.screen(symbols, min_technical_score=2, verbose=True)
    
    def rank_candidates(
        self,
        df: pd.DataFrame,
        fundamental_weight: float = 0.5,
    ) -> pd.DataFrame:
        """
        Rank candidates by combined fundamental + technical score.
        
        Args:
            df: DataFrame from screen()
            fundamental_weight: Weight for fundamental vs technical (0-1)
        
        Returns:
            Sorted DataFrame with final rankings
        """
        if df.empty:
            return df
        
        # Add fundamental scores if not present
        # (This would require calling FundamentalsFetcher for each)
        
        # For now, rank by technical score + proximity to high
        df = df.copy()
        
        # Composite score
        df['composite'] = (
            df['technical_score'] * 2 +  # Weight technical
            df['pct_from_high'] / 10     # Bonus for near highs
        )
        
        return df.sort_values('composite', ascending=False)


# =============================================================================
# QUICK SCREENER FUNCTIONS
# =============================================================================

def find_breakouts(days: int = 5) -> pd.DataFrame:
    """
    Find stocks breaking out to new highs in the last N days.
    
    A "breakout" is when a stock crosses above its recent resistance
    (prior high) on high volume.
    """
    print(f"🚀 Finding breakouts in the last {days} days...")
    
    screener = UniverseScreener()
    symbols = screener.get_universe()
    
    breakouts = []
    
    for symbol in symbols:
        try:
            hist = screener._fetch_price_history(symbol, period="3mo")
            
            if hist is None or len(hist) < 20:
                continue
            
            # Check if made new 20-day high in last N days
            close = hist['Close']
            volume = hist['Volume']
            
            rolling_high = close.rolling(20).max()
            recent = close.iloc[-days:]
            recent_highs = rolling_high.iloc[-days:]
            
            # Breakout = price crosses above rolling high
            for i in range(len(recent)):
                if i == 0:
                    continue
                if recent.iloc[i] > recent_highs.iloc[i-1]:
                    # Check volume confirmation
                    avg_vol = volume.rolling(50).mean().iloc[-1]
                    if volume.iloc[-days + i] > avg_vol * 1.5:
                        breakouts.append({
                            'symbol': symbol,
                            'breakout_date': recent.index[i].strftime('%Y-%m-%d'),
                            'price': recent.iloc[i],
                            'volume_ratio': volume.iloc[-days + i] / avg_vol,
                        })
                        break
            
            time.sleep(0.1)
            
        except Exception:
            continue
    
    if breakouts:
        df = pd.DataFrame(breakouts)
        print(f"✅ Found {len(df)} breakouts")
        return df
    
    return pd.DataFrame()


def find_leaders(min_momentum: float = 20) -> pd.DataFrame:
    """
    Find market leaders (stocks with strong relative strength).
    
    Leaders are stocks that are outperforming the market.
    """
    print(f"👑 Finding market leaders (6-month momentum > {min_momentum}%)...")
    
    screener = UniverseScreener()
    results = screener.quick_screen()
    
    if results.empty:
        return results
    
    # Filter by momentum
    leaders = results[results['momentum_6m'] >= min_momentum]
    
    print(f"✅ Found {len(leaders)} leaders")
    
    return leaders[['symbol', 'price', 'momentum_6m', 'pct_from_high', 'technical_score']]


# =============================================================================
# TEST
# =============================================================================

if __name__ == "__main__":
    print("=== Universe Screener Test ===\n")
    
    screener = UniverseScreener()
    
    # Quick screen (growth watchlist only)
    print("Running quick screen on growth watchlist...\n")
    results = screener.quick_screen()
    
    if not results.empty:
        print("\n📊 Top Candidates:")
        print(results[['symbol', 'price', 'momentum_6m', 'pct_from_high', 'technical_score']].head(10).to_string())
    
    print("\n✅ Screener ready!")
