"""Cached liquidity/slippage overlay built from stable OHLCV proxies."""

from __future__ import annotations

import json
import logging
import math
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional

import pandas as pd

from data.market_data_provider import MarketDataError, MarketDataProvider


LOGGER = logging.getLogger(__name__)

DEFAULT_CACHE_PATH = Path(__file__).parent / "cache" / "liquidity_overlay.json"
REQUIRED_COLUMNS = ("Open", "High", "Low", "Close", "Volume")
KNOWN_ETF_SYMBOLS = {
    "ARKK",
    "BITO",
    "DIA",
    "GLD",
    "IWM",
    "QQQ",
    "SLV",
    "SMH",
    "SOXX",
    "SPY",
    "TLT",
    "USO",
    "XLB",
    "XLC",
    "XLE",
    "XLF",
    "XLI",
    "XLK",
    "XLP",
    "XLRE",
    "XLU",
    "XLV",
}


class LiquidityOverlayModel:
    """Build and cache a lightweight symbol-level liquidity quality overlay."""

    def __init__(
        self,
        *,
        cache_path: Optional[str | Path] = None,
        max_age_hours: Optional[float] = None,
        chunk_size: int = 64,
        market_data: Optional[MarketDataProvider] = None,
    ):
        self.cache_path = Path(
            cache_path
            or os.getenv("TRADING_LIQUIDITY_OVERLAY_PATH")
            or DEFAULT_CACHE_PATH
        ).expanduser()
        self.max_age_hours = float(
            max_age_hours
            if max_age_hours is not None
            else os.getenv("TRADING_LIQUIDITY_OVERLAY_MAX_AGE_HOURS", "30")
        )
        self.chunk_size = max(int(chunk_size), 1)
        self.market_data = market_data or MarketDataProvider()

    @staticmethod
    def _dedupe(symbols: Iterable[str]) -> List[str]:
        seen = set()
        ordered: List[str] = []
        for raw in symbols:
            symbol = str(raw or "").strip().upper()
            if symbol and symbol not in seen:
                seen.add(symbol)
                ordered.append(symbol)
        return ordered

    def refresh_cache(
        self,
        *,
        base_symbols: Iterable[str],
        histories: Optional[Dict[str, pd.DataFrame]] = None,
    ) -> dict:
        symbols = self._dedupe(base_symbols)
        if not symbols:
            payload = {
                "schema_version": 1,
                "generated_at": datetime.now(UTC).isoformat(),
                "symbols": [],
            }
            self._write_payload(payload)
            return payload

        symbol_histories = histories or self._fetch_histories(symbols)
        overlays: List[dict] = []
        for symbol in symbols:
            overlay = self._build_overlay(symbol=symbol, history=symbol_histories.get(symbol))
            if overlay is not None:
                overlays.append(overlay)

        payload = {
            "schema_version": 1,
            "generated_at": datetime.now(UTC).isoformat(),
            "summary": self._summarize_overlays(overlays),
            "symbols": overlays,
        }
        self._write_payload(payload)
        return payload

    def load_overlay_map(self) -> tuple[Optional[str], Dict[str, dict]]:
        payload = self._load_cache_payload()
        if payload is None:
            return None, {}
        out = {
            str(item.get("symbol", "")).strip().upper(): item
            for item in payload.get("symbols", [])
            if str(item.get("symbol", "")).strip()
        }
        return payload.get("generated_at"), out

    def _fetch_histories(self, symbols: Iterable[str]) -> Dict[str, pd.DataFrame]:
        requested = self._dedupe(symbols)
        out: Dict[str, pd.DataFrame] = {}
        for symbol in requested:
            try:
                frame = self.market_data.get_history(symbol, period="1y", auto_adjust=False).frame
            except MarketDataError as exc:
                LOGGER.warning("Liquidity overlay history fetch failed for %s: %s", symbol, exc)
                continue
            if frame is not None and not frame.empty:
                out[symbol] = frame
        return out

    def _build_overlay(self, *, symbol: str, history: Optional[pd.DataFrame]) -> Optional[dict]:
        if history is None or history.empty or len(history) < 60:
            return None

        open_px = self._series_or_none(history, "Open")
        high = self._series_or_none(history, "High")
        low = self._series_or_none(history, "Low")
        close = self._series_or_none(history, "Close")
        volume = self._series_or_none(history, "Volume")
        if open_px is None or high is None or low is None or close is None or volume is None:
            return None

        current = float(close.iloc[-1])
        if current <= 0:
            return None

        avg_dollar_volume = float((close * volume).rolling(20, min_periods=10).mean().iloc[-1])
        atr_pct = self._atr_pct(high=high, low=low, close=close)
        gapiness_pct = self._gapiness_pct(open_px=open_px, close=close)
        spread_proxy_pct = self._spread_proxy_pct(high=high, low=low, close=close)
        is_probable_etf = symbol in KNOWN_ETF_SYMBOLS
        is_probable_adr = self._is_probable_adr(symbol)

        adv_score = self._clamp((math.log10(max(avg_dollar_volume, 1.0)) - 6.0) / 2.3)
        if 0.012 <= atr_pct <= 0.06:
            atr_score = 1.0
        elif 0.006 <= atr_pct <= 0.09:
            atr_score = 0.7
        elif atr_pct <= 0.13:
            atr_score = 0.35
        else:
            atr_score = 0.0
        gap_score = self._clamp(1.0 - (gapiness_pct / 0.045))
        spread_score = self._clamp(1.0 - (spread_proxy_pct / 0.05))

        quality_score = (
            100.0
            * (
                adv_score * 0.46
                + atr_score * 0.20
                + gap_score * 0.20
                + spread_score * 0.14
            )
        )
        if avg_dollar_volume < 2_000_000:
            quality_score -= 10.0
        if is_probable_adr:
            quality_score -= 8.0
        quality_score = round(self._clamp(quality_score / 100.0) * 100.0, 2)

        if quality_score >= 78:
            tier = "high"
        elif quality_score >= 58:
            tier = "medium"
        elif quality_score >= 38:
            tier = "low"
        else:
            tier = "illiquid"

        slippage_bps = (
            6.0
            + (spread_proxy_pct * 10_000.0 * 0.42)
            + (gapiness_pct * 10_000.0 * 0.24)
            + (atr_pct * 10_000.0 * 0.08)
            + max(0.0, (8.5 - math.log10(max(avg_dollar_volume, 1.0))) * 7.0)
        )
        if is_probable_adr:
            slippage_bps += 6.0
        if is_probable_etf:
            slippage_bps -= 2.0
        slippage_bps = round(max(slippage_bps, 2.0), 2)
        execution_quality = self._execution_quality_label(quality_score)
        liquidity_label = tier
        slippage_band = self._slippage_band(slippage_bps)
        annotation = (
            f"{execution_quality} liquidity | {liquidity_label} | slippage {slippage_band} "
            f"({slippage_bps:.1f}bps)"
        )

        return {
            "symbol": symbol,
            "liquidity_quality_score": quality_score,
            "liquidity_tier": tier,
            "execution_quality": execution_quality,
            "quality_label": execution_quality,
            "liquidity_quality": execution_quality,
            "liquidity_posture": liquidity_label,
            "liquidity_label": liquidity_label,
            "liquidity": liquidity_label,
            "estimated_slippage_bps": slippage_bps,
            "slippage_risk": slippage_band,
            "slippage_label": slippage_band,
            "slippage_band": slippage_band,
            "avg_dollar_volume_20d": round(avg_dollar_volume, 2),
            "atr_pct_14d": round(atr_pct, 4),
            "gapiness_pct_20d": round(gapiness_pct, 4),
            "spread_proxy_pct_20d": round(spread_proxy_pct, 4),
            "annotation": annotation,
            "summary": annotation,
            "note": annotation,
            "flags": {
                "is_probable_etf": is_probable_etf,
                "is_probable_adr": is_probable_adr,
            },
        }

    @staticmethod
    def _series_or_none(frame: pd.DataFrame, column: str) -> Optional[pd.Series]:
        if frame is None or frame.empty or column not in frame.columns:
            return None
        series = pd.to_numeric(frame[column], errors="coerce").dropna()
        if series.empty:
            return None
        return series

    @staticmethod
    def _execution_quality_label(quality_score: float) -> str:
        if quality_score >= 78:
            return "good"
        if quality_score >= 58:
            return "moderate"
        if quality_score >= 38:
            return "weak"
        return "poor"

    @staticmethod
    def _slippage_band(slippage_bps: float) -> str:
        if slippage_bps <= 12.0:
            return "low"
        if slippage_bps <= 30.0:
            return "medium"
        return "high"

    @staticmethod
    def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
        return max(low, min(high, value))

    @staticmethod
    def _atr_pct(high: pd.Series, low: pd.Series, close: pd.Series) -> float:
        tr = pd.concat(
            [
                (high - low).abs(),
                (high - close.shift(1)).abs(),
                (low - close.shift(1)).abs(),
            ],
            axis=1,
        ).max(axis=1)
        atr = float(tr.rolling(14, min_periods=5).mean().iloc[-1])
        current = float(close.iloc[-1])
        if current <= 0:
            return 0.0
        return atr / current

    @staticmethod
    def _gapiness_pct(open_px: pd.Series, close: pd.Series) -> float:
        prev_close = close.shift(1)
        gap = (open_px - prev_close).abs() / prev_close.replace(0.0, pd.NA)
        gap = pd.to_numeric(gap, errors="coerce").dropna()
        if gap.empty:
            return 0.0
        return float(gap.tail(20).mean())

    @staticmethod
    def _spread_proxy_pct(high: pd.Series, low: pd.Series, close: pd.Series) -> float:
        spread = (high - low).abs() / close.replace(0.0, pd.NA)
        spread = pd.to_numeric(spread, errors="coerce").dropna()
        if spread.empty:
            return 0.0
        return float(spread.tail(20).median())

    @staticmethod
    def _is_probable_adr(symbol: str) -> bool:
        clean = str(symbol or "").strip().upper()
        if len(clean) < 4 or len(clean) > 5:
            return False
        return clean.endswith("Y") or clean.endswith("F")

    def _load_cache_payload(self) -> Optional[dict]:
        if not self.cache_path.exists():
            return None
        try:
            payload = json.loads(self.cache_path.read_text(encoding="utf-8"))
        except Exception:
            return None

        generated_at = payload.get("generated_at")
        age_hours = self._age_hours(generated_at)
        if age_hours is None or age_hours > self.max_age_hours:
            return None
        return payload

    def _write_payload(self, payload: dict) -> None:
        try:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            tmp_path = self.cache_path.with_suffix(f"{self.cache_path.suffix}.tmp")
            tmp_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
            tmp_path.replace(self.cache_path)
        except Exception as exc:
            LOGGER.warning("Unable to write liquidity overlay cache %s: %s", self.cache_path, exc)

    @staticmethod
    def _age_hours(generated_at: Optional[str]) -> Optional[float]:
        if not generated_at:
            return None
        try:
            parsed = datetime.fromisoformat(generated_at)
        except Exception:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return max((datetime.now(UTC) - parsed).total_seconds(), 0.0) / 3600.0

    @staticmethod
    def _summarize_overlays(overlays: List[dict]) -> dict:
        if not overlays:
            return {
                "median_estimated_slippage_bps": None,
                "high_quality_count": 0,
                "illiquid_count": 0,
            }

        slippage = [float(item.get("estimated_slippage_bps", 0.0)) for item in overlays]
        high_quality_count = sum(
            1 for item in overlays if str(item.get("liquidity_tier", "")).lower() == "high"
        )
        illiquid_count = sum(
            1 for item in overlays if str(item.get("liquidity_tier", "")).lower() == "illiquid"
        )
        return {
            "median_estimated_slippage_bps": round(float(pd.Series(slippage).median()), 2),
            "high_quality_count": high_quality_count,
            "illiquid_count": illiquid_count,
        }
