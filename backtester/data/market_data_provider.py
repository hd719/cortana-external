"""Service-first market data provider with Python cache fallback."""

from __future__ import annotations

import json
import os
import random
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Sequence
from urllib.parse import quote

import pandas as pd
import requests


class MarketDataError(RuntimeError):
    """Market data provider error.

    Attributes:
        transient: whether retry/fallback could reasonably recover.
    """

    def __init__(self, message: str, *, transient: bool = False):
        super().__init__(message)
        self.transient = transient


@dataclass
class MarketHistoryResult:
    frame: pd.DataFrame
    source: str
    status: str = "ok"  # ok|degraded
    degraded_reason: str = ""
    staleness_seconds: float = 0.0


class MarketDataProvider:
    def __init__(
        self,
        provider_order: str = "service",
        service_base_url: str = "http://localhost:3033",
        cache_dir: Optional[str] = None,
        cache_ttl_seconds: int = 1800,
        max_retries: int = 2,
        backoff_base_seconds: float = 0.75,
        backoff_jitter_seconds: float = 0.35,
        cooldown_seconds: int = 45,
    ):
        self.providers = [p.strip().lower() for p in provider_order.split(",") if p.strip()]
        self.service_base_url = os.getenv("MARKET_DATA_SERVICE_URL", service_base_url).rstrip("/")
        self.cache_dir = Path(cache_dir or os.getenv("MARKET_DATA_CACHE_DIR", ".cache/market_data")).expanduser()
        self.cache_ttl_seconds = int(cache_ttl_seconds)
        self.max_retries = int(max_retries)
        self.backoff_base_seconds = float(backoff_base_seconds)
        self.backoff_jitter_seconds = float(backoff_jitter_seconds)
        self.cooldown_seconds = int(cooldown_seconds)

    def get_history(self, symbol: str, period: str = "1y", auto_adjust: bool = False) -> MarketHistoryResult:
        symbol = symbol.upper().strip()
        providers_tried: list[str] = []
        transient_failures: list[str] = []
        fatal_failures: list[str] = []

        for provider in self.providers:
            providers_tried.append(provider)
            try:
                frame, metadata = self._fetch_with_retries(provider, symbol, period, auto_adjust=auto_adjust)
                self._validate_frame(frame, symbol=symbol, provider=provider)
                source = str(metadata.get("source") or provider)
                status = str(metadata.get("status") or "ok")
                degraded_reason = str(metadata.get("degraded_reason") or metadata.get("degradedReason") or "")
                staleness_seconds = float(metadata.get("staleness_seconds") or metadata.get("stalenessSeconds") or 0.0)
                if status not in {"ok", "degraded"}:
                    status = "ok"
                if source == "service":
                    source = provider
                self._write_cache(symbol, period, source, frame)
                return MarketHistoryResult(
                    frame=frame,
                    source=source,
                    status=status,
                    degraded_reason=degraded_reason,
                    staleness_seconds=staleness_seconds,
                )
            except MarketDataError as exc:
                if exc.transient:
                    transient_failures.append(f"{provider}: {exc}")
                else:
                    fatal_failures.append(f"{provider}: {exc}")

        # Live providers all failed: try local cache path.
        cached = self._read_cache(symbol, period)
        if cached is not None:
            cached_frame, cache_source, age_seconds = cached
            return MarketHistoryResult(
                frame=cached_frame,
                source="cache",
                status="degraded",
                degraded_reason=(
                    "Live providers unavailable; using cached data "
                    f"({int(age_seconds)}s old, original_source={cache_source})."
                ),
                staleness_seconds=age_seconds,
            )

        reason_chunks = []
        if transient_failures:
            reason_chunks.append("transient=" + "; ".join(transient_failures))
        if fatal_failures:
            reason_chunks.append("fatal=" + "; ".join(fatal_failures))
        detail = " | ".join(reason_chunks) if reason_chunks else "no provider attempts recorded"
        raise MarketDataError(
            f"Failed to fetch {symbol} ({period}) from providers {','.join(providers_tried)}; {detail}",
            transient=bool(transient_failures) and not fatal_failures,
        )

    def _fetch_with_retries(self, provider: str, symbol: str, period: str, auto_adjust: bool = False) -> tuple[pd.DataFrame, dict]:
        if provider not in {"service", "alpaca", "yahoo"}:
            raise MarketDataError(f"Unknown provider '{provider}'", transient=False)
        attempt = 0
        while True:
            try:
                if provider == "service":
                    return self._fetch_service_history(symbol, period, auto_adjust=auto_adjust)
                if provider in {"alpaca", "yahoo"}:
                    return self._fetch_service_history(symbol, period, auto_adjust=auto_adjust)
                raise MarketDataError(f"Unknown provider '{provider}'", transient=False)
            except MarketDataError as exc:
                if attempt >= self.max_retries or not exc.transient:
                    raise
                delay = self.backoff_base_seconds * (2**attempt) + random.uniform(0, self.backoff_jitter_seconds)
                time.sleep(max(delay, 0))
                attempt += 1

    def _fetch_service_history(self, symbol: str, period: str, auto_adjust: bool = False) -> tuple[pd.DataFrame, dict]:
        safe_symbol = quote(symbol)
        url = f"{self.service_base_url}/market-data/history/{safe_symbol}"
        params = {"period": period, "auto_adjust": str(bool(auto_adjust)).lower()}

        try:
            resp = requests.get(url, params=params, timeout=15)
        except requests.RequestException as exc:
            raise MarketDataError(f"market-data service request failed: {exc}", transient=True) from exc

        if resp.status_code in {404, 429, 500, 502, 503, 504}:
            raise MarketDataError(f"market-data service transient error {resp.status_code}", transient=True)
        if resp.status_code != 200:
            raise MarketDataError(f"market-data service error {resp.status_code}: {resp.text[:180]}", transient=False)

        try:
            payload = resp.json() or {}
        except ValueError as exc:
            raise MarketDataError(f"market-data service returned invalid JSON: {exc}", transient=True) from exc

        frame = self._build_frame_from_service_payload(payload, symbol=symbol)
        metadata = {
            "source": str(payload.get("source") or "service"),
            "status": str(payload.get("status") or "ok"),
            "degradedReason": str(payload.get("degradedReason") or payload.get("degraded_reason") or ""),
            "stalenessSeconds": float(payload.get("stalenessSeconds") or payload.get("staleness_seconds") or 0.0),
            "sourceData": payload.get("sourceData", {}),
            "availability": payload.get("availability"),
        }
        return frame, metadata

    def _fetch_alpaca_history(self, symbol: str, period: str, auto_adjust: bool = False) -> pd.DataFrame:
        frame, _ = self._fetch_service_history(symbol, period, auto_adjust=auto_adjust)
        return frame

    def _fetch_yahoo_history(self, symbol: str, period: str, auto_adjust: bool = False) -> pd.DataFrame:
        frame, _ = self._fetch_service_history(symbol, period, auto_adjust=auto_adjust)
        return frame

    @staticmethod
    def _build_frame_from_service_payload(payload: dict, *, symbol: str) -> pd.DataFrame:
        rows = payload.get("rows")
        if rows is None:
            rows = payload.get("data")
        if rows is None and isinstance(payload.get("data"), dict):
            rows = (
                payload["data"].get("rows")
                or payload["data"].get("history")
                or payload["data"].get("bars")
                or []
            )
        if rows is None and isinstance(payload, dict):
            rows = (
                payload.get("bars")
                or payload.get("history")
                or payload.get("records")
                or []
            )
        if not isinstance(rows, list) or not rows:
            raise MarketDataError(f"market-data service returned no rows for {symbol}", transient=True)

        parsed: list[dict] = []
        date_field_candidates = ["date", "Date", "datetime", "timestamp", "ts", "time"]
        open_field_candidates = ["Open", "open", "o"]
        high_field_candidates = ["High", "high", "h"]
        low_field_candidates = ["Low", "low", "l"]
        close_field_candidates = ["Close", "close", "c"]
        volume_field_candidates = ["Volume", "volume", "v"]
        def _pick(row: dict, keys: Sequence[str]) -> Optional[object]:
            for key in keys:
                if key in row:
                    return row[key]
            return None

        for row in rows:
            if not isinstance(row, dict):
                raise MarketDataError(
                    f"market-data service returned malformed row for {symbol}: {row!r}",
                    transient=True,
                )
            date_value = _pick(row, date_field_candidates)
            if date_value is None:
                raise MarketDataError(f"market-data service row missing date for {symbol}", transient=True)
            open_value = _pick(row, open_field_candidates)
            high_value = _pick(row, high_field_candidates)
            low_value = _pick(row, low_field_candidates)
            close_value = _pick(row, close_field_candidates)
            volume_value = _pick(row, volume_field_candidates)
            if None in {open_value, high_value, low_value, close_value, volume_value}:
                raise MarketDataError(f"market-data service row missing OHLCV fields for {symbol}", transient=True)

            try:
                parsed.append(
                    {
                        "Date": pd.to_datetime(date_value),
                        "Open": float(open_value),
                        "High": float(high_value),
                        "Low": float(low_value),
                        "Close": float(close_value),
                        "Volume": float(volume_value),
                    }
                )
            except (TypeError, ValueError) as exc:
                raise MarketDataError(f"market-data service row had invalid numeric values for {symbol}: {exc}", transient=True) from exc

        frame = pd.DataFrame(parsed).set_index("Date")[["Open", "High", "Low", "Close", "Volume"]]
        return frame.sort_index()

    def _write_cache(self, symbol: str, period: str, source: str, frame: pd.DataFrame) -> None:
        payload = {
            "schema_version": 1,
            "symbol": symbol,
            "period": period,
            "source": source,
            "generated_at_utc": datetime.now(timezone.utc).isoformat(),
            "rows": [
                {
                    "date": idx.isoformat() if hasattr(idx, "isoformat") else str(idx),
                    "Open": float(row["Open"]),
                    "High": float(row["High"]),
                    "Low": float(row["Low"]),
                    "Close": float(row["Close"]),
                    "Volume": float(row["Volume"]),
                }
                for idx, row in frame.iterrows()
            ],
        }

        try:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            self._cache_path(symbol, period).write_text(json.dumps(payload), encoding="utf-8")
        except Exception:
            # Cache write failure should never block live data path.
            return

    def _read_cache(self, symbol: str, period: str) -> Optional[tuple[pd.DataFrame, str, float]]:
        path = self._cache_path(symbol, period)
        if not path.exists():
            return None

        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            generated_raw = payload.get("generated_at_utc")
            generated = datetime.fromisoformat(generated_raw)
            if generated.tzinfo is None:
                generated = generated.replace(tzinfo=timezone.utc)
            age_seconds = max((datetime.now(timezone.utc) - generated).total_seconds(), 0.0)
            if age_seconds > self.cache_ttl_seconds:
                return None

            rows = payload.get("rows") or []
            if not rows:
                return None
            frame = pd.DataFrame(rows)
            frame["date"] = pd.to_datetime(frame["date"])
            frame = frame.set_index("date")[["Open", "High", "Low", "Close", "Volume"]]
            self._validate_frame(frame, symbol=symbol, provider="cache")
            source = str(payload.get("source") or "unknown")
            return frame.sort_index(), source, age_seconds
        except Exception:
            return None

    def _cache_path(self, symbol: str, period: str) -> Path:
        safe_symbol = "".join(c if c.isalnum() else "_" for c in symbol.upper())
        safe_period = "".join(c if c.isalnum() else "_" for c in period)
        return self.cache_dir / f"{safe_symbol}_{safe_period}.json"

    @staticmethod
    def _validate_frame(frame: pd.DataFrame, *, symbol: str, provider: str) -> None:
        if frame is None or frame.empty:
            raise MarketDataError(f"{provider} returned empty history for {symbol}", transient=True)
        needed = {"Open", "High", "Low", "Close", "Volume"}
        if not needed.issubset(set(frame.columns)):
            raise MarketDataError(f"{provider} history missing OHLCV columns for {symbol}", transient=True)

    @staticmethod
    def _period_to_date_range(period: str) -> tuple[str, str]:
        now = datetime.now(timezone.utc)
        p = period.strip().lower()
        if p.endswith("d"):
            days = int(p[:-1] or "1")
            start = now - pd.Timedelta(days=days)
        elif p.endswith("mo"):
            months = int(p[:-2] or "1")
            start = now - pd.Timedelta(days=30 * months)
        elif p.endswith("y"):
            years = int(p[:-1] or "1")
            start = now - pd.Timedelta(days=365 * years)
        elif p in {"max", "all"}:
            start = now - pd.Timedelta(days=365 * 10)
        else:
            # best effort fallback
            start = now - pd.Timedelta(days=365)

        return start.isoformat(), now.isoformat()
