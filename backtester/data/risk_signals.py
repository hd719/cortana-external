"""
Risk Signals Module

Service-first loader for macro risk indicators used by the Dip Buyer strategy.

Normal runtime path:
- TS market-data service for VIX/SPY history
- TS market-data service for FRED high-yield spreads
- TS market-data service for CBOE put/call data
- local cache fallback

Legacy direct provider fallback remains opt-in for diagnostics only.
"""

from __future__ import annotations

import io
import json
import logging
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict

import numpy as np
import pandas as pd
import requests
import yfinance as yf
import time


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
        risk_service_base_url: str | None = None,
        cache_dir: str | None = None,
    ):
        self.vix_symbol = vix_symbol
        self.spy_symbol = spy_symbol
        self.fred_series = fred_series
        self.logger = logging.getLogger(__name__)
        self.service_base_url = (risk_service_base_url or os.getenv("MARKET_DATA_SERVICE_BASE_URL", "http://localhost:3033")).rstrip("/")
        self.service_timeout_seconds = float(os.getenv("MARKET_DATA_SERVICE_TIMEOUT_SECONDS", "1.5"))
        self.service_enabled = os.getenv("RISK_SIGNALS_USE_SERVICE", "1").strip().lower() not in {"0", "false", "no", "off"}
        self.legacy_fallback_enabled = os.getenv("RISK_SIGNALS_LEGACY_FALLBACK", "0").strip().lower() in {"1", "true", "yes", "on"}
        self.cache_dir = Path(cache_dir or (Path(__file__).parent / "cache"))
        self.cache_dir.mkdir(exist_ok=True)
        self.cache_ttl_hours = float(os.getenv("RISK_CACHE_TTL_HOURS", "12"))
        self.fred_api_key = self._resolve_fred_api_key(os.getenv(fred_api_key_env))
        self.fred_retries = int(os.getenv("RISK_FRED_RETRIES", "3"))
        self.fred_timeout_seconds = float(os.getenv("RISK_FRED_TIMEOUT_SECONDS", "12"))
        self.fred_backoff_seconds = float(os.getenv("RISK_FRED_BACKOFF_SECONDS", "1.5"))
        self._hy_spread_meta = {
            "source": "unknown",
            "fallback": False,
            "warning": "",
        }

    def _resolve_fred_api_key(self, raw_value: str | None) -> str | None:
        if raw_value is None:
            self.logger.warning(
                "FRED_API_KEY is missing. Proceeding with unauthenticated FRED access (stricter limits may apply)."
            )
            return None

        value = raw_value.strip()
        if not value:
            self.logger.warning(
                "FRED_API_KEY is invalid (blank). Proceeding with unauthenticated FRED access."
            )
            return None
        if any(char.isspace() for char in value):
            self.logger.warning(
                "FRED_API_KEY is invalid (contains whitespace). Proceeding with unauthenticated FRED access."
            )
            return None
        return value

    def _risk_history_cache_path(self, days: int) -> Path:
        return self.cache_dir / f"risk_history_{int(days)}d.json"

    def _risk_snapshot_cache_path(self) -> Path:
        return self.cache_dir / "risk_snapshot.json"

    def _read_cache_payload(self, path: Path, *, max_age_hours: float) -> dict | None:
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            generated_at = datetime.fromisoformat(str(payload.get("generated_at")))
            age_seconds = (datetime.now() - generated_at).total_seconds()
            if age_seconds > max_age_hours * 3600:
                return None
            return payload
        except Exception:
            return None

    def _write_cache_payload(self, path: Path, payload: dict) -> None:
        try:
            payload = dict(payload or {})
            payload["generated_at"] = datetime.now().isoformat()
            path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        except Exception:
            pass

    @staticmethod
    def _coerce_series_values(series: pd.Series) -> pd.Series:
        if not isinstance(series, pd.Series):
            return pd.Series(dtype=float)
        return pd.to_numeric(series, errors="coerce")

    def _service_request(self, path: str, method: str = "GET", **kwargs) -> tuple[dict | None, int]:
        if not self.service_enabled:
            return None, 0
        url = f"{self.service_base_url}{path}"
        try:
            if method == "POST":
                response = requests.post(url, timeout=self.service_timeout_seconds, **kwargs)
            else:
                response = requests.get(url, timeout=self.service_timeout_seconds, **kwargs)
        except Exception as exc:
            self.logger.debug("Risk service request failed for %s: %s", path, exc)
            return None, 0

        if response is None or response.status_code != 200:
            self.logger.debug("Risk service error for %s: %s", path, getattr(response, "status_code", None))
            return None, 0 if response is None else response.status_code

        try:
            return response.json(), response.status_code
        except Exception as exc:
            self.logger.debug("Risk service response parse failed for %s: %s", path, exc)
            return None, response.status_code

    def _extract_risk_rows(self, payload: dict) -> list[dict]:
        if not isinstance(payload, dict):
            return []

        data = payload.get("data", payload)
        if isinstance(data, dict):
            rows = data.get("rows") or data.get("history") or data.get("points")
        else:
            rows = data
        if rows is None:
            rows = payload.get("rows")

        return rows if isinstance(rows, list) else []

    @classmethod
    def _select_float_col(cls, frame: pd.DataFrame, options: list[str], *, default_name: str) -> pd.Series:
        for option in options:
            if option in frame.columns:
                return cls._coerce_series_values(pd.to_numeric(frame[option], errors="coerce")).rename(default_name)
        return pd.Series(dtype=float, name=default_name)

    def _load_history_from_service(self, days: int) -> pd.DataFrame:
        payload, status_code = self._service_request(f"/market-data/risk/history?days={int(days)}")
        if payload is None:
            return pd.DataFrame()

        status = str(payload.get("status") or "").lower()
        if status and status not in {"ok", "degraded"}:
            return pd.DataFrame()

        rows = self._extract_risk_rows(payload)
        if not rows:
            return pd.DataFrame()

        frame = pd.DataFrame(rows)
        if frame.empty:
            return pd.DataFrame()

        date_candidates = ["date", "timestamp", "time", "Date", "datetime"]
        date_col = next((c for c in date_candidates if c in frame.columns), None)
        if date_col is None:
            return pd.DataFrame()
        frame["date"] = pd.to_datetime(frame[date_col], errors="coerce")
        frame = frame[frame["date"].notna()].copy()
        if frame.empty:
            return pd.DataFrame()

        frame["vix"] = self._select_float_col(
            frame,
            ["vix", "vixIndex", "vix_close", "vixValue", "vix_level"],
            default_name="vix",
        )
        frame["spy_close"] = self._select_float_col(
            frame,
            ["spy_close", "spyClose", "spy", "benchmark_close"],
            default_name="spy_close",
        )
        frame["hy_spread"] = self._select_float_col(
            frame,
            ["hy_spread", "hySpread", "high_yield_spread", "baml_hy_spread"],
            default_name="hy_spread",
        )
        frame["put_call"] = self._select_float_col(
            frame,
            ["put_call", "putCall", "put_call_ratio", "pc_ratio"],
            default_name="put_call",
        )
        frame["vix_percentile"] = self._select_float_col(
            frame,
            ["vix_percentile", "vixPercentile"],
            default_name="vix_percentile",
        )
        frame["hy_spread_percentile"] = self._select_float_col(
            frame,
            ["hy_spread_percentile", "hySpreadPercentile", "hy_percentile"],
            default_name="hy_spread_percentile",
        )
        frame["spy_distance_score"] = self._select_float_col(
            frame,
            ["spy_distance_score", "spyDistanceScore", "spy_distance"],
            default_name="spy_distance_score",
        )
        frame["fear_greed"] = self._select_float_col(
            frame,
            ["fear_greed", "fearGreed", "fear_greed_score", "mfactor", "mFactor", "m_factor"],
            default_name="fear_greed",
        )

        frame = frame.set_index(pd.to_datetime(frame["date"]).tz_localize(None))
        return frame.sort_index().tail(days)[[
            "vix",
            "spy_close",
            "hy_spread",
            "put_call",
            "vix_percentile",
            "hy_spread_percentile",
            "spy_distance_score",
            "fear_greed",
        ]]

    def _load_snapshot_from_service(self) -> Dict:
        payload, status_code = self._service_request("/market-data/risk/snapshot")
        if payload is None:
            return {}

        status = str(payload.get("status") or "").lower()
        if status and status not in {"ok", "degraded"}:
            return {}

        data = payload.get("data", payload)
        if not isinstance(data, dict):
            return {}

        snapshot = {
            "snapshotDate": data.get("snapshotDate"),
            "timestamp": data.get("snapshotDate"),
            "mFactor": data.get("mFactor"),
            "warnings": data.get("warnings"),
        }
        if not snapshot["warnings"] and data.get("warning"):
            snapshot["warnings"] = [data.get("warning")]

        source_meta = {
            "source": data.get("source") or payload.get("source"),
            "status": data.get("status") or payload.get("status"),
            "degradedReason": data.get("degradedReason") or data.get("degraded_reason") or payload.get("degradedReason"),
            "stalenessSeconds": data.get("stalenessSeconds", payload.get("stalenessSeconds")),
        }
        return {"snapshot": snapshot, "metadata": source_meta}

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

        last_error = "unknown error"
        for attempt in range(1, self.fred_retries + 1):
            try:
                response = requests.get(url, params=params, timeout=self.fred_timeout_seconds)
                response.raise_for_status()
                payload = response.json()

                if isinstance(payload, dict) and payload.get("error_code"):
                    last_error = str(payload.get("error_message", payload.get("error_code")))
                    self.logger.warning(
                        "FRED API error for %s (attempt %d/%d): %s",
                        series_id,
                        attempt,
                        self.fred_retries,
                        last_error,
                    )
                else:
                    observations = payload.get("observations", [])
                    if observations:
                        df = pd.DataFrame(observations)
                        if "date" in df.columns and "value" in df.columns:
                            df['value'] = pd.to_numeric(df['value'], errors='coerce')
                            df['date'] = pd.to_datetime(df['date'], errors='coerce')
                            series = df.set_index('date')['value'].dropna()
                            series.name = series_id
                            series.index = pd.to_datetime(series.index).tz_localize(None)
                            return series
                    last_error = "FRED returned no usable observations"
            except Exception as exc:
                last_error = str(exc)
                self.logger.warning(
                    "FRED fetch failed for %s (attempt %d/%d): %s",
                    series_id,
                    attempt,
                    self.fred_retries,
                    exc,
                )

            if attempt < self.fred_retries:
                sleep_seconds = self.fred_backoff_seconds * attempt
                time.sleep(sleep_seconds)

        self.logger.error(
            "FRED fetch exhausted retries for %s. Using neutral HY fallback (450 bps). Last error: %s",
            series_id,
            last_error,
        )
        return pd.Series(dtype=float, name=series_id)

    def _validate_put_call_series(self, series: pd.Series) -> pd.Series:
        if series.empty:
            return series

        series = pd.to_numeric(series, errors='coerce')
        invalid_mask = (series < 0.3) | (series > 3.0)
        if invalid_mask.any():
            self.logger.warning(
                "Put/Call ratio out of sanity bounds [0.3, 3.0] for %d rows; defaulting to neutral 1.0.",
                int(invalid_mask.sum()),
            )
            series = series.mask(invalid_mask, 1.0)

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
        return self._validate_put_call_series(series)

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
                return self._validate_put_call_series(series)

        return pd.Series(dtype=float, name="put_call")

    def _fetch_put_call_from_yfinance_options(self, start: datetime, end: datetime) -> pd.Series:
        """Fallback PCR proxy using SPY option chain volume (snapshot-based proxy)."""
        try:
            ticker = yf.Ticker(self.spy_symbol)
            expirations = ticker.options or []
            if not expirations:
                return pd.Series(dtype=float, name="put_call")

            put_volume = 0.0
            call_volume = 0.0
            for expiry in expirations[:3]:
                chain = ticker.option_chain(expiry)
                if chain.puts is not None and not chain.puts.empty:
                    put_volume += pd.to_numeric(chain.puts.get('volume', 0), errors='coerce').fillna(0).sum()
                if chain.calls is not None and not chain.calls.empty:
                    call_volume += pd.to_numeric(chain.calls.get('volume', 0), errors='coerce').fillna(0).sum()

            if call_volume <= 0:
                return pd.Series(dtype=float, name="put_call")

            ratio = float(put_volume / call_volume)
            ratio = self._validate_put_call_series(pd.Series([ratio])).iloc[0]
            idx = pd.date_range(start=start, end=end, freq='B')
            return pd.Series(ratio, index=idx, name="put_call")
        except Exception as exc:
            self.logger.warning("yfinance option-chain PCR proxy failed: %s", exc)
            return pd.Series(dtype=float, name="put_call")

    def _fetch_put_call_history(self, start: datetime, end: datetime) -> pd.Series:
        series = self._fetch_put_call_from_cboe(start, end)
        if not series.empty:
            return series

        series = self._fetch_put_call_from_yfinance_options(start, end)
        if not series.empty:
            return series

        for symbol in ["^PCR", "PUT", "PCCE", "^PCC", "PCC"]:
            hist = self._fetch_yfinance_history(symbol, start, end)
            if hist.empty or 'Close' not in hist.columns:
                continue
            series = self._validate_put_call_series(hist['Close'].dropna().rename("put_call"))
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

    def _normalize_risk_history(self, frame: pd.DataFrame) -> pd.DataFrame:
        if frame.empty:
            return frame

        frame = frame.copy()
        for col in [
            "vix",
            "spy_close",
            "hy_spread",
            "put_call",
            "vix_percentile",
            "hy_spread_percentile",
            "spy_distance_score",
            "fear_greed",
        ]:
            if col not in frame.columns:
                frame[col] = np.nan

        if frame["hy_spread"].isna().all():
            frame["hy_spread"] = 450.0
            self._hy_spread_meta = {
                "source": "fallback_default_450",
                "fallback": True,
                "warning": "FRED HY spread unavailable after retries; using neutral 450 bps fallback (credit gate may be less sensitive).",
            }
        else:
            frame["hy_spread"] = frame["hy_spread"].ffill().fillna(450.0)
            if self._hy_spread_meta.get("source", "unknown") == "unknown":
                self._hy_spread_meta = {
                    "source": "fallback_default_450",
                    "fallback": False,
                    "warning": "",
                }

        if frame["vix"].isna().all():
            frame["vix"] = 20.0
        else:
            frame["vix"] = frame["vix"].ffill()

        if frame["spy_close"].isna().all():
            frame["spy_close"] = 400.0
        else:
            frame["spy_close"] = frame["spy_close"].ffill()

        if frame["put_call"].isna().all():
            frame["put_call"] = 1.0
        else:
            frame["put_call"] = self._validate_put_call_series(frame["put_call"]).ffill().fillna(1.0)

        if frame["vix_percentile"].isna().all():
            frame["vix_percentile"] = self._percentile_series(frame["vix"])
        if frame["spy_distance_score"].isna().all():
            frame["spy_distance_score"] = self._spy_distance_score(frame["spy_close"])
        if frame["hy_spread_percentile"].isna().all():
            frame["hy_spread_percentile"] = self._percentile_series(frame["hy_spread"])

        frame["vix_percentile"] = self._percentile_series(frame["vix"]).where(frame["vix_percentile"].isna(), frame["vix_percentile"])
        frame["spy_distance_score"] = self._spy_distance_score(frame["spy_close"]).where(
            frame["spy_distance_score"].isna(),
            frame["spy_distance_score"],
        )
        frame["hy_spread_percentile"] = self._percentile_series(frame["hy_spread"]).where(
            frame["hy_spread_percentile"].isna(),
            frame["hy_spread_percentile"],
        )

        composite_fear = (
            frame["vix_percentile"] + frame["hy_spread_percentile"] + frame["spy_distance_score"]
        ) / 3
        simple_fear = (frame["vix_percentile"] + frame["spy_distance_score"]) / 2
        frame["fear_greed"] = pd.to_numeric(composite_fear.where(composite_fear.notna(), simple_fear), errors="coerce")
        frame["fear_greed"] = frame["fear_greed"].clip(lower=0, upper=100).fillna(50.0)

        return frame

    def _hydrate_cache_metadata(self, frame: pd.DataFrame, metadata: dict) -> None:
        hy_meta = metadata.get("hy_spread_meta") if isinstance(metadata, dict) else None
        if isinstance(hy_meta, dict) and {
            "source",
            "fallback",
            "warning",
        } <= set(hy_meta.keys()):
            self._hy_spread_meta = {
                "source": hy_meta.get("source", "unknown"),
                "fallback": bool(hy_meta.get("fallback", False)),
                "warning": str(hy_meta.get("warning", "")),
            }
            return

        if frame.empty or "hy_spread" not in frame.columns:
            return

        hy_spread = pd.to_numeric(frame["hy_spread"], errors="coerce")
        if hy_spread.dropna().empty:
            self._hy_spread_meta = {
                "source": "fallback_default_450",
                "fallback": True,
                "warning": "FRED HY spread unavailable after retries; using neutral 450 bps fallback (credit gate may be less sensitive).",
            }
            return

        finite = hy_spread.dropna()
        if not finite.empty and finite.nunique(dropna=True) == 1 and float(finite.iloc[0]) == 450.0:
            self._hy_spread_meta = {
                "source": "fallback_default_450",
                "fallback": True,
                "warning": "FRED HY spread unavailable after retries; using neutral 450 bps fallback (credit gate may be less sensitive).",
            }
            return

        self._hy_spread_meta = {
            "source": "history_cache",
            "fallback": False,
            "warning": "",
        }

    def _build_history_from_fallback(self, days: int) -> pd.DataFrame:
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
        df['hy_spread'] = hy_spread.reindex(df.index).ffill().fillna(np.nan)
        if hy_spread.empty:
            self._hy_spread_meta = {
                "source": "fallback_default_450",
                "fallback": True,
                "warning": "FRED HY spread unavailable after retries; using neutral 450 bps fallback (credit gate may be less sensitive).",
            }
        else:
            self._hy_spread_meta = {
                "source": "fred",
                "fallback": False,
                "warning": "",
            }

        df['put_call'] = put_call.reindex(df.index).ffill() if not put_call.empty else pd.Series(dtype=float)
        df = self._normalize_risk_history(df)
        return df.tail(days)

    def _load_history(self, days: int) -> pd.DataFrame:
        cached_payload = self._read_cache_payload(
            self._risk_history_cache_path(days),
            max_age_hours=self.cache_ttl_hours,
        )
        if isinstance(cached_payload, dict):
            cached_data = cached_payload.get("data")
            if isinstance(cached_data, list):
                cached_df = pd.DataFrame(cached_data)
                if not cached_df.empty and "date" in cached_df.columns:
                    cached_df["date"] = pd.to_datetime(cached_df["date"], errors="coerce")
                    cached_df = cached_df.dropna(subset=["date"]).set_index("date").sort_index()
                    if not cached_df.empty:
                        cached_df = self._normalize_risk_history(cached_df.tail(days))
                        self._hydrate_cache_metadata(cached_df, cached_payload.get("metadata", {}))
                        return cached_df

        history = self._load_history_from_service(days)
        if history.empty:
            history = self._build_history_from_fallback(days) if self.legacy_fallback_enabled else self._build_neutral_history(days)

        cache_rows = []
        for row in history.reset_index().to_dict(orient="records"):
            row_copy = dict(row)
            date_value = row_copy.pop("index", row_copy.pop("date", None))
            if date_value is None:
                continue
            try:
                date_text = pd.to_datetime(date_value).isoformat()
            except Exception:
                date_text = str(date_value)
            cache_rows.append(
                {
                    "date": date_text,
                    **{key: float(value) if pd.notna(value) else np.nan for key, value in row_copy.items()},
                }
            )
        self._write_cache_payload(
            self._risk_history_cache_path(days),
            {
                "data": cache_rows,
                "metadata": {
                    "hy_spread_meta": self._hy_spread_meta,
                },
            }
        )

        return history

    def _build_neutral_history(self, days: int) -> pd.DataFrame:
        index = pd.date_range(end=datetime.now(), periods=max(days, 30), freq="B")
        df = pd.DataFrame(index=pd.to_datetime(index))
        df["vix"] = 20.0
        df["spy_close"] = 500.0
        df["hy_spread"] = 450.0
        df["put_call"] = 1.0
        self._hy_spread_meta = {
            "source": "fallback_default_450",
            "fallback": True,
            "warning": "Risk service unavailable; using neutral local defaults.",
        }
        df = self._normalize_risk_history(df)
        return df.tail(days)

    def _build_history(self, days: int) -> pd.DataFrame:
        history = self._load_history(days)
        return self._normalize_risk_history(history).tail(days)

    # ---------------------------------------------------------------------
    # Public API
    # ---------------------------------------------------------------------

    def get_history(self, days: int = 90) -> pd.DataFrame:
        """Return historical risk data for the last N business days."""
        return self._build_history(days)

    def get_snapshot(self) -> Dict:
        """Return the latest risk snapshot as a dict."""
        cached_snapshot = self._read_cache_payload(self._risk_snapshot_cache_path(), max_age_hours=self.cache_ttl_hours)
        if isinstance(cached_snapshot, dict) and isinstance(cached_snapshot.get("snapshot"), dict):
            snap = cached_snapshot.get("snapshot", {})
            if snap:
                result = self._finalize_snapshot_payload(snap)
                if result:
                    return result

        payload = self._load_snapshot_from_service()
        if payload:
            snapshot = payload.get("snapshot") or {}
            self._write_cache_payload(self._risk_snapshot_cache_path(), {"snapshot": snapshot, "metadata": payload.get("metadata", {})})
            return self._finalize_snapshot_payload(snapshot)

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
            'hy_spread_source': self._hy_spread_meta.get('source', 'unknown'),
            'hy_spread_fallback': bool(self._hy_spread_meta.get('fallback', False)),
            'hy_spread_warning': self._hy_spread_meta.get('warning', ''),
        }

    def _finalize_snapshot_payload(self, payload: dict) -> Dict:
        if not isinstance(payload, dict):
            return {}

        warnings = payload.get("warnings")
        if isinstance(warnings, list):
            warning_text = "; ".join([str(item) for item in warnings if item is not None])
        elif warnings:
            warning_text = str(warnings)
        else:
            warning_text = ""

        return {
            "timestamp": str(payload.get("timestamp") or payload.get("snapshotDate") or payload.get("date") or ""),
            "vix": float(payload.get("vix", np.nan)),
            "put_call": float(payload.get("put_call", np.nan)),
            "hy_spread": float(payload.get("hy_spread", np.nan)),
            "fear_greed": float(payload.get("mFactor", payload.get("fear_greed", np.nan))),
            "vix_percentile": float(payload.get("vix_percentile", np.nan)),
            "hy_spread_percentile": float(payload.get("hy_spread_percentile", np.nan)),
            "spy_distance_score": float(payload.get("spy_distance_score", np.nan)),
            "hy_spread_change_10d": float(payload.get("hy_spread_change_10d", np.nan))
            if payload.get("hy_spread_change_10d") is not None and pd.notna(payload.get("hy_spread_change_10d"))
            else np.nan,
            "hy_spread_source": str(payload.get("hy_spread_source", self._hy_spread_meta.get("source", "unknown"))),
            "hy_spread_fallback": bool(payload.get("hy_spread_fallback", self._hy_spread_meta.get("fallback", False))),
            "hy_spread_warning": str(
                payload.get("hy_spread_warning", warning_text or self._hy_spread_meta.get("warning", ""))
            ),
        }


if __name__ == "__main__":
    fetcher = RiskSignalFetcher()
    snapshot = fetcher.get_snapshot()
    print("=== Risk Snapshot ===")
    for key, value in snapshot.items():
        print(f"{key}: {value}")
