"""
Fundamentals Data Module

Service-backed fundamentals loader used by CANSLIM, Dip Buyer, and advisor flows.
The Python layer stays focused on scoring/analysis while the TS market-data service
owns external IO and provider fallback.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Optional

import pandas as pd

from .market_data_service_client import MarketDataServiceClient


class FundamentalsCache:
    """Small JSON cache to avoid hammering the local service repeatedly."""

    def __init__(self, cache_dir: str = None):
        if cache_dir is None:
            cache_dir = Path(__file__).parent / "cache"
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(exist_ok=True)

    def _cache_path(self, symbol: str, data_type: str) -> Path:
        return self.cache_dir / f"{symbol}_{data_type}.json"

    def get(self, symbol: str, data_type: str) -> Optional[dict]:
        path = self._cache_path(symbol, data_type)
        if not path.exists():
            return None
        mtime = datetime.fromtimestamp(path.stat().st_mtime)
        if datetime.now() - mtime > timedelta(hours=24):
            return None
        with open(path, "r") as f:
            return json.load(f)

    def set(self, symbol: str, data_type: str, data: dict):
        path = self._cache_path(symbol, data_type)
        with open(path, "w") as f:
            json.dump(data, f, indent=2, default=str)


class FundamentalsFetcher:
    """Fetch normalized fundamentals from the local market-data service."""

    def __init__(self, service_client: MarketDataServiceClient | None = None):
        self.cache = FundamentalsCache()
        self.service_client = service_client or MarketDataServiceClient()

    def _load_payload(self, symbol: str, as_of_date: str = None) -> Dict:
        cache_key = f"fundamentals_{as_of_date}" if as_of_date else "fundamentals"
        cached = self.cache.get(symbol, cache_key)
        if cached is not None:
            return cached

        payload = self.service_client.get_symbol_payload(
            "fundamentals",
            symbol,
            params={"as_of_date": as_of_date} if as_of_date else None,
        )
        data = self.service_client.extract_data(payload) or {}
        if not isinstance(data, dict):
            data = {}

        normalized = {
            "symbol": symbol.upper().strip(),
            "as_of_date": as_of_date or datetime.now().strftime("%Y-%m-%d"),
            "eps_growth": _maybe_float(data.get("eps_growth")),
            "annual_eps_growth": _maybe_float(data.get("annual_eps_growth")),
            "revenue_growth": _maybe_float(data.get("revenue_growth")),
            "institutional_pct": _maybe_float(data.get("institutional_pct")),
            "float_shares": _maybe_float(data.get("float_shares")),
            "shares_outstanding": _maybe_float(data.get("shares_outstanding")),
            "short_ratio": _maybe_float(data.get("short_ratio")),
            "short_pct_of_float": _maybe_float(data.get("short_pct_of_float")),
            "sector": data.get("sector"),
            "industry": data.get("industry"),
            "earnings_event_window": data.get("earnings_event_window", []),
            "last_earnings_date": data.get("last_earnings_date"),
            "next_earnings_date": data.get("next_earnings_date"),
            "earnings_history": data.get("earnings_history", []),
            "quarterly_financials": data.get("quarterly_financials", []),
            "institutional_holders": data.get("institutional_holders", []),
        }
        self.cache.set(symbol, cache_key, normalized)
        return normalized

    def get_earnings_history(self, symbol: str) -> pd.DataFrame:
        rows = self._load_payload(symbol).get("earnings_history", [])
        return pd.DataFrame(rows) if isinstance(rows, list) else pd.DataFrame()

    def get_earnings_event_window(self, symbol: str) -> pd.DataFrame:
        rows = self._load_payload(symbol).get("earnings_event_window", [])
        return pd.DataFrame(rows) if isinstance(rows, list) else pd.DataFrame()

    def get_eps_growth(self, symbol: str, as_of_date: str = None) -> Optional[float]:
        return _maybe_float(self._load_payload(symbol, as_of_date).get("eps_growth"))

    def get_annual_eps_growth(self, symbol: str, years: int = 5) -> Optional[float]:
        _ = years
        return _maybe_float(self._load_payload(symbol).get("annual_eps_growth"))

    def get_quarterly_financials(self, symbol: str) -> pd.DataFrame:
        rows = self._load_payload(symbol).get("quarterly_financials", [])
        return pd.DataFrame(rows) if isinstance(rows, list) else pd.DataFrame()

    def get_revenue_growth(self, symbol: str, as_of_date: str = None) -> Optional[float]:
        return _maybe_float(self._load_payload(symbol, as_of_date).get("revenue_growth"))

    def get_institutional_holders(self, symbol: str) -> pd.DataFrame:
        rows = self._load_payload(symbol).get("institutional_holders", [])
        return pd.DataFrame(rows) if isinstance(rows, list) else pd.DataFrame()

    def get_institutional_ownership_pct(self, symbol: str) -> Optional[float]:
        return _maybe_float(self._load_payload(symbol).get("institutional_pct"))

    def get_shares_info(self, symbol: str) -> Dict:
        payload = self._load_payload(symbol)
        return {
            "shares_outstanding": _maybe_float(payload.get("shares_outstanding")),
            "float_shares": _maybe_float(payload.get("float_shares")),
            "short_ratio": _maybe_float(payload.get("short_ratio")),
            "short_pct_of_float": _maybe_float(payload.get("short_pct_of_float")),
            "sector": payload.get("sector"),
            "industry": payload.get("industry"),
        }

    def get_fundamentals(self, symbol: str, as_of_date: str = None) -> Dict:
        result = self._load_payload(symbol, as_of_date).copy()
        events = self.get_earnings_event_window(symbol)
        if not events.empty and "date" in events.columns:
            events = events.copy()
            events["date"] = pd.to_datetime(events["date"], errors="coerce").dt.tz_localize(None)
            events = events.dropna(subset=["date"]).sort_values("date").reset_index(drop=True)
            now_ts = pd.Timestamp.now().tz_localize(None)
            past_events = events[events["date"] <= now_ts]
            future_events = events[events["date"] > now_ts]
            result["earnings_event_window"] = events.to_dict("records")
            result["last_earnings_date"] = (
                past_events.iloc[-1]["date"].strftime("%Y-%m-%d") if not past_events.empty else None
            )
            result["next_earnings_date"] = (
                future_events.iloc[0]["date"].strftime("%Y-%m-%d") if not future_events.empty else None
            )
        return result

    def score_canslim_fundamentals(self, fundamentals: Dict) -> Dict:
        scores = {}

        eps_growth = fundamentals.get("eps_growth")
        if eps_growth is None:
            scores["C"] = 0
        elif eps_growth > 50:
            scores["C"] = 2
        elif eps_growth > 25:
            scores["C"] = 1
        else:
            scores["C"] = 0

        annual_growth = fundamentals.get("annual_eps_growth")
        if annual_growth is None:
            scores["A"] = 0
        elif annual_growth > 40:
            scores["A"] = 2
        elif annual_growth > 25:
            scores["A"] = 1
        else:
            scores["A"] = 0

        inst_pct = fundamentals.get("institutional_pct")
        if inst_pct is None:
            scores["I"] = 0
        elif 0.20 <= inst_pct <= 0.60:
            scores["I"] = 2
        elif 0.10 <= inst_pct <= 0.80:
            scores["I"] = 1
        else:
            scores["I"] = 0

        float_shares = fundamentals.get("float_shares")
        if float_shares is None:
            scores["S"] = 0
        elif float_shares < 25_000_000:
            scores["S"] = 2
        elif float_shares < 50_000_000:
            scores["S"] = 1
        else:
            scores["S"] = 0

        scores["fundamental_total"] = scores["C"] + scores["A"] + scores["I"] + scores["S"]
        return scores


def _maybe_float(value) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None
