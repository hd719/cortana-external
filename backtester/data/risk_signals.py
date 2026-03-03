"""
Risk Signals Module

Fetches macro risk indicators used by the Dip Buyer strategy:
- VIX (volatility) via yfinance
- High yield spreads (credit risk) via FRED
- Put/Call ratio (sentiment) via CBOE with fallbacks
- Fear & Greed proxy composite
"""

from __future__ import annotations

import io
import os
from datetime import datetime, timedelta
from typing import Dict, Optional

import numpy as np
import pandas as pd
import requests
import yfinance as yf


class RiskSignalFetcher:
    """
    Fetches macro risk signals for dip-buying decisions.

    Provides current snapshot and historical time series for:
    - VIX
    - High-yield credit spreads (BAMLH0A0HYM2)
    - Put/Call ratio
    - Fear & Greed proxy composite
    """

    def __init__(
        self,
        vix_symbol: str = "^VIX",
        spy_symbol: str = "SPY",
        fred_series: str = "BAMLH0A0HYM2",
        fred_api_key_env: str = "FRED_API_KEY",
    ):
        self.vix_symbol = vix_symbol
        self.spy_symbol = spy_symbol
        self.fred_series = fred_series
        self.fred_api_key = os.getenv(fred_api_key_env)

    # ---------------------------------------------------------------------
    # Fetch helpers
    # ---------------------------------------------------------------------

    def _fetch_yfinance_history(self, symbol: str, start: datetime, end: datetime) -> pd.DataFrame:
        try:
            hist = yf.Ticker(symbol).history(start=start, end=end)
        except Exception:
            return pd.DataFrame()

        if hist is None or hist.empty:
            return pd.DataFrame()

        hist = hist.copy()
        hist.index = pd.to_datetime(hist.index).tz_localize(None)
        return hist

    def _fetch_vix_history(self, start: datetime, end: datetime) -> pd.Series:
        hist = self._fetch_yfinance_history(self.vix_symbol, start, end)
        if hist.empty or 'Close' not in hist.columns:
            return pd.Series(dtype=float, name="vix")
        return hist['Close'].rename("vix")

    def _fetch_spy_history(self, start: datetime, end: datetime) -> pd.Series:
        hist = self._fetch_yfinance_history(self.spy_symbol, start, end)
        if hist.empty or 'Close' not in hist.columns:
            return pd.Series(dtype=float, name="spy_close")
        return hist['Close'].rename("spy_close")

    def _fetch_fred_series(
        self,
        series_id: str,
        start: datetime,
        end: datetime,
    ) -> pd.Series:
        url = "https://api.stlouisfed.org/fred/series/observations"
        params = {
            "series_id": series_id,
            "file_type": "json",
            "observation_start": start.strftime("%Y-%m-%d"),
            "observation_end": end.strftime("%Y-%m-%d"),
        }
        if self.fred_api_key:
            params["api_key"] = self.fred_api_key

        try:
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
        except Exception:
            return pd.Series(dtype=float, name=series_id)

        payload = response.json()
        observations = payload.get("observations", [])
        if not observations:
            return pd.Series(dtype=float, name=series_id)

        df = pd.DataFrame(observations)
        if "date" not in df.columns or "value" not in df.columns:
            return pd.Series(dtype=float, name=series_id)

        df['value'] = pd.to_numeric(df['value'], errors='coerce')
        df['date'] = pd.to_datetime(df['date'], errors='coerce')
        series = df.set_index('date')['value'].dropna()
        series.name = series_id
        series.index = pd.to_datetime(series.index).tz_localize(None)
        return series

    def _extract_put_call_series(self, df: pd.DataFrame) -> pd.Series:
        date_col = None
        for col in df.columns:
            if 'date' in col.lower():
                date_col = col
                break

        if date_col is None:
            return pd.Series(dtype=float, name="put_call")

        ratio_cols = []
        for col in df.columns:
            low = col.lower()
            if col == date_col:
                continue
            if "ratio" in low or "put/call" in low or "put_call" in low or "p/c" in low:
                ratio_cols.append(col)

        if not ratio_cols:
            return pd.Series(dtype=float, name="put_call")

        ratio_col = None
        for col in ratio_cols:
            if "total" in col.lower():
                ratio_col = col
                break
        if ratio_col is None:
            ratio_col = ratio_cols[0]

        dates = pd.to_datetime(df[date_col], errors='coerce')
        values = pd.to_numeric(df[ratio_col], errors='coerce')
        series = pd.Series(values.values, index=dates).dropna()
        series.name = "put_call"
        series.index = pd.to_datetime(series.index).tz_localize(None)
        return series

    def _fetch_put_call_from_cboe(self, start: datetime, end: datetime) -> pd.Series:
        endpoints = [
            "https://cdn.cboe.com/api/global/us_indices/market_statistics/put_call_ratio.csv",
            "https://cdn.cboe.com/api/global/us_indices/market_statistics/daily_options_data.csv",
            "https://cdn.cboe.com/api/global/us_indices/market_statistics/put_call_ratio/daily.csv",
            "https://cdn.cboe.com/api/global/us_indices/market_statistics/put_call_ratio.json",
        ]

        for url in endpoints:
            try:
                response = requests.get(url, timeout=10)
                response.raise_for_status()
            except Exception:
                continue

            content_type = response.headers.get("Content-Type", "").lower()
            df = None

            if "json" in content_type or url.endswith(".json"):
                try:
                    payload = response.json()
                    if isinstance(payload, dict) and "data" in payload:
                        df = pd.DataFrame(payload["data"])
                    else:
                        df = pd.DataFrame(payload)
                except Exception:
                    df = None
            else:
                try:
                    df = pd.read_csv(io.StringIO(response.text))
                except Exception:
                    df = None

            if df is None or df.empty:
                continue

            series = self._extract_put_call_series(df)
            if series.empty:
                continue

            series = series[(series.index >= start) & (series.index <= end)]
            if not series.empty:
                return series

        return pd.Series(dtype=float, name="put_call")

    def _fetch_put_call_history(self, start: datetime, end: datetime) -> pd.Series:
        series = self._fetch_put_call_from_cboe(start, end)
        if not series.empty:
            return series

        for symbol in ["^PCR", "PUT", "PCCE", "^PCC", "PCC"]:
            hist = self._fetch_yfinance_history(symbol, start, end)
            if hist.empty or 'Close' not in hist.columns:
                continue
            series = hist['Close'].dropna().rename("put_call")
            if not series.empty:
                return series

        return pd.Series(dtype=float, name="put_call")

    # ---------------------------------------------------------------------
    # Calculations
    # ---------------------------------------------------------------------

    @staticmethod
    def _percentile_series(series: pd.Series) -> pd.Series:
        cleaned = series.dropna()
        if cleaned.empty:
            return pd.Series(index=series.index, data=np.nan)
        ranks = series.rank(pct=True) * 100
        return ranks

    @staticmethod
    def _spy_distance_score(spy_close: pd.Series) -> pd.Series:
        sma_125 = spy_close.rolling(125).mean()
        distance_pct = (sma_125 - spy_close) / sma_125 * 100
        distance_score = (distance_pct + 10) / 20 * 100
        return distance_score.clip(lower=0, upper=100)

    def _build_history(self, days: int) -> pd.DataFrame:
        end = datetime.now()
        lookback_days = max(days, 160)
        start = end - timedelta(days=lookback_days * 2)

        vix = self._fetch_vix_history(start, end)
        spy = self._fetch_spy_history(start, end)
        hy_spread = self._fetch_fred_series(self.fred_series, start, end)
        put_call = self._fetch_put_call_history(start, end)

        if not spy.empty:
            base_index = spy.index
        elif not vix.empty:
            base_index = vix.index
        elif not hy_spread.empty:
            base_index = hy_spread.index
        else:
            base_index = pd.date_range(start=start, end=end, freq='B')

        df = pd.DataFrame(index=pd.to_datetime(base_index))

        df['vix'] = vix.reindex(df.index).ffill()
        df['spy_close'] = spy.reindex(df.index).ffill()
        df['hy_spread'] = hy_spread.reindex(df.index).ffill()

        if put_call.empty:
            df['put_call'] = 1.0
        else:
            df['put_call'] = put_call.reindex(df.index).ffill()

        df['vix_percentile'] = self._percentile_series(df['vix'])
        df['hy_spread_percentile'] = self._percentile_series(df['hy_spread'])
        df['spy_distance_score'] = self._spy_distance_score(df['spy_close'])
        df['fear_greed'] = (
            df['vix_percentile'] + df['hy_spread_percentile'] + df['spy_distance_score']
        ) / 3

        return df.tail(days)

    # ---------------------------------------------------------------------
    # Public API
    # ---------------------------------------------------------------------

    def get_history(self, days: int = 90) -> pd.DataFrame:
        """Return historical risk data for the last N business days."""
        return self._build_history(days)

    def get_snapshot(self) -> Dict:
        """Return the latest risk snapshot as a dict."""
        history = self._build_history(200)
        if history.empty:
            return {}

        latest = history.iloc[-1]
        hy_change_10d = history['hy_spread'].diff(10).iloc[-1]

        return {
            'timestamp': history.index[-1].strftime('%Y-%m-%d'),
            'vix': float(latest.get('vix', np.nan)),
            'put_call': float(latest.get('put_call', np.nan)),
            'hy_spread': float(latest.get('hy_spread', np.nan)),
            'fear_greed': float(latest.get('fear_greed', np.nan)),
            'vix_percentile': float(latest.get('vix_percentile', np.nan)),
            'hy_spread_percentile': float(latest.get('hy_spread_percentile', np.nan)),
            'spy_distance_score': float(latest.get('spy_distance_score', np.nan)),
            'hy_spread_change_10d': float(hy_change_10d) if pd.notna(hy_change_10d) else np.nan,
        }


if __name__ == "__main__":
    fetcher = RiskSignalFetcher()
    snapshot = fetcher.get_snapshot()
    print("=== Risk Snapshot ===")
    for key, value in snapshot.items():
        print(f"{key}: {value}")
