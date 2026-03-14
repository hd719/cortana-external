"""Deterministic live-universe selection with lightweight prefilter ranking."""

from __future__ import annotations

import json
import logging
import math
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional

import pandas as pd
import yfinance as yf


LOGGER = logging.getLogger(__name__)

DEFAULT_CACHE_PATH = Path(__file__).parent / "cache" / "live_universe_prefilter.json"
REQUIRED_COLUMNS = ("Open", "High", "Low", "Close", "Volume")


@dataclass(frozen=True)
class UniverseSelectionResult:
    symbols: List[str]
    priority_symbols: List[str]
    ranked_symbols: List[str]
    unscored_symbols: List[str]
    base_universe_size: int
    source: str
    generated_at: Optional[str]
    cache_age_hours: Optional[float]


class RankedUniverseSelector:
    """Choose the live scan universe from pinned priorities + lightweight rank."""

    def __init__(
        self,
        *,
        cache_path: Optional[str | Path] = None,
        max_age_hours: Optional[float] = None,
        chunk_size: int = 64,
    ):
        self.cache_path = Path(
            cache_path
            or os.getenv("TRADING_UNIVERSE_PREFILTER_PATH")
            or DEFAULT_CACHE_PATH
        ).expanduser()
        self.max_age_hours = float(
            max_age_hours
            if max_age_hours is not None
            else os.getenv("TRADING_UNIVERSE_PREFILTER_MAX_AGE_HOURS", "18")
        )
        self.chunk_size = max(int(chunk_size), 1)

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

    def select_live_universe(
        self,
        *,
        base_symbols: Iterable[str],
        priority_symbols: Iterable[str],
        universe_size: int,
        market_regime: str = "unknown",
        refresh: bool = False,
    ) -> UniverseSelectionResult:
        base = self._dedupe(base_symbols)
        pinned = self._dedupe(priority_symbols)
        if universe_size <= 0:
            return UniverseSelectionResult([], [], [], [], len(base), "disabled", None, None)

        if os.getenv("TRADING_UNIVERSE_PREFILTER_ENABLED", "1") == "0":
            ordered = self._dedupe([*pinned, *base])[:universe_size]
            return UniverseSelectionResult(
                symbols=ordered,
                priority_symbols=[sym for sym in ordered if sym in set(pinned)],
                ranked_symbols=[],
                unscored_symbols=[],
                base_universe_size=len(base),
                source="disabled",
                generated_at=None,
                cache_age_hours=None,
            )

        pinned_in_order = pinned[:universe_size]
        remaining_slots = max(universe_size - len(pinned_in_order), 0)
        if remaining_slots == 0:
            return UniverseSelectionResult(
                symbols=pinned_in_order,
                priority_symbols=pinned_in_order,
                ranked_symbols=[],
                unscored_symbols=[],
                base_universe_size=len(base),
                source="priority_only",
                generated_at=None,
                cache_age_hours=None,
            )

        pinned_set = set(pinned_in_order)
        remaining = [symbol for symbol in base if symbol not in pinned_set]
        payload = None if refresh else self._load_cache_payload()
        source = "cache"

        if payload is None:
            payload = self.refresh_cache(base_symbols=base, market_regime=market_regime)
            source = "live_refresh"

        records = {
            str(item.get("symbol", "")).upper(): item
            for item in payload.get("symbols", [])
            if str(item.get("symbol", "")).strip()
        }
        ranked = [
            symbol
            for symbol, _ in sorted(
                (
                    (
                        symbol,
                        records[symbol],
                    )
                    for symbol in remaining
                    if symbol in records
                ),
                key=lambda item: (
                    -float(item[1].get("prefilter_score", 0.0)),
                    str(item[0]),
                ),
            )
        ]
        unscored = sorted(symbol for symbol in remaining if symbol not in records)
        selected = [*pinned_in_order, *ranked[:remaining_slots]]
        if len(selected) < universe_size:
            selected.extend(unscored[: universe_size - len(selected)])

        generated_at = payload.get("generated_at")
        cache_age_hours = self._age_hours(generated_at)
        return UniverseSelectionResult(
            symbols=selected,
            priority_symbols=[symbol for symbol in pinned_in_order if symbol in selected],
            ranked_symbols=ranked[:remaining_slots],
            unscored_symbols=unscored,
            base_universe_size=len(base),
            source=source,
            generated_at=generated_at,
            cache_age_hours=cache_age_hours,
        )

    def refresh_cache(self, *, base_symbols: Iterable[str], market_regime: str = "unknown") -> dict:
        symbols = self._dedupe(base_symbols)
        if not symbols:
            payload = {"schema_version": 1, "generated_at": datetime.now(UTC).isoformat(), "symbols": []}
            self._write_payload(payload)
            return payload

        histories = self._fetch_histories(symbols)
        benchmark = histories.pop("SPY", None)
        benchmark_close = self._series_or_none(benchmark, "Close") if benchmark is not None else None

        scored: List[dict] = []
        for symbol in symbols:
            history = histories.get(symbol)
            if history is None:
                continue
            metrics = self._score_symbol(symbol=symbol, history=history, benchmark_close=benchmark_close, market_regime=market_regime)
            if metrics is not None:
                scored.append(metrics)

        payload = {
            "schema_version": 1,
            "generated_at": datetime.now(UTC).isoformat(),
            "market_regime": market_regime,
            "symbols": scored,
        }
        self._write_payload(payload)
        return payload

    def _fetch_histories(self, symbols: Iterable[str]) -> Dict[str, pd.DataFrame]:
        requested = self._dedupe([*symbols, "SPY"])
        out: Dict[str, pd.DataFrame] = {}
        for start in range(0, len(requested), self.chunk_size):
            chunk = requested[start : start + self.chunk_size]
            try:
                raw = yf.download(
                    tickers=chunk,
                    period="1y",
                    auto_adjust=False,
                    progress=False,
                    threads=False,
                    group_by="ticker",
                )
            except Exception as exc:
                LOGGER.warning("Universe prefilter chunk download failed for %s: %s", ",".join(chunk), exc)
                continue

            for symbol in chunk:
                frame = self._extract_frame(raw, symbol)
                if frame is not None and not frame.empty:
                    out[symbol] = frame
        return out

    @staticmethod
    def _extract_frame(raw: pd.DataFrame, symbol: str) -> Optional[pd.DataFrame]:
        if raw is None or raw.empty:
            return None

        if isinstance(raw.columns, pd.MultiIndex):
            if symbol in raw.columns.get_level_values(0):
                frame = raw[symbol].copy()
            elif symbol in raw.columns.get_level_values(-1):
                frame = raw.xs(symbol, axis=1, level=-1).copy()
            else:
                return None
        else:
            frame = raw.copy()

        if not set(REQUIRED_COLUMNS).issubset(frame.columns):
            return None

        frame = frame[list(REQUIRED_COLUMNS)].copy()
        frame = frame.dropna(subset=["Close", "Volume"])
        return frame.sort_index()

    @staticmethod
    def _series_or_none(frame: Optional[pd.DataFrame], column: str) -> Optional[pd.Series]:
        if frame is None or frame.empty or column not in frame.columns:
            return None
        series = pd.to_numeric(frame[column], errors="coerce").dropna()
        if series.empty:
            return None
        return series

    @staticmethod
    def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
        return max(low, min(high, value))

    def _score_symbol(
        self,
        *,
        symbol: str,
        history: pd.DataFrame,
        benchmark_close: Optional[pd.Series],
        market_regime: str,
    ) -> Optional[dict]:
        if history is None or history.empty or len(history) < 80:
            return None

        close = self._series_or_none(history, "Close")
        high = self._series_or_none(history, "High")
        low = self._series_or_none(history, "Low")
        volume = self._series_or_none(history, "Volume")
        if close is None or high is None or low is None or volume is None:
            return None

        current = float(close.iloc[-1])
        if current <= 0:
            return None

        ma21 = float(close.rolling(21, min_periods=10).mean().iloc[-1])
        ma50 = float(close.rolling(50, min_periods=20).mean().iloc[-1])
        high_52w = float(close.max())
        pct_from_high = current / high_52w if high_52w > 0 else 0.0
        ret_21 = self._period_return(close, 21)
        ret_63 = self._period_return(close, 63)
        benchmark_ret_63 = self._period_return(benchmark_close, 63) if benchmark_close is not None else 0.0
        relative_strength = ret_63 - benchmark_ret_63
        avg_dollar_volume = float((close * volume).rolling(20, min_periods=10).mean().iloc[-1])
        atr_pct = self._atr_pct(high=high, low=low, close=close)

        rs_score = self._clamp((relative_strength + 0.08) / 0.33)
        trend_score = min(
            1.0,
            (0.35 if current > ma21 else 0.0)
            + (0.35 if current > ma50 else 0.0)
            + (0.20 if ma21 > ma50 else 0.0)
            + (0.10 if ret_21 > 0 else 0.0),
        )
        liquidity_score = self._clamp((math.log10(max(avg_dollar_volume, 1.0)) - 6.5) / 2.0)
        proximity_score = (
            1.0 if pct_from_high >= 0.95 else
            0.8 if pct_from_high >= 0.90 else
            0.55 if pct_from_high >= 0.82 else
            0.20 if pct_from_high >= 0.70 else
            0.0
        )

        pullback_depth = max(0.0, 1.0 - pct_from_high)
        if current > ma50 and 0.03 <= pullback_depth <= 0.12:
            pullback_score = 1.0
        elif current > ma21 and pullback_depth < 0.03:
            pullback_score = 0.7
        elif current > ma50 and pullback_depth <= 0.18:
            pullback_score = 0.5
        else:
            pullback_score = 0.0

        if 0.012 <= atr_pct <= 0.065:
            volatility_score = 1.0
        elif 0.006 <= atr_pct <= 0.10:
            volatility_score = 0.6
        elif atr_pct <= 0.14:
            volatility_score = 0.3
        else:
            volatility_score = 0.0

        weights = self._weights_for_regime(market_regime)
        prefilter_score = round(
            100.0
            * (
                rs_score * weights["relative_strength"]
                + trend_score * weights["trend_quality"]
                + liquidity_score * weights["liquidity"]
                + proximity_score * weights["distance_from_high"]
                + pullback_score * weights["pullback_shape"]
                + volatility_score * weights["volatility_sanity"]
            ),
            2,
        )

        return {
            "symbol": symbol,
            "prefilter_score": prefilter_score,
            "relative_strength_score": round(rs_score, 4),
            "trend_quality_score": round(trend_score, 4),
            "liquidity_score": round(liquidity_score, 4),
            "distance_from_high_score": round(proximity_score, 4),
            "pullback_shape_score": round(pullback_score, 4),
            "volatility_sanity_score": round(volatility_score, 4),
            "relative_strength_63d": round(relative_strength, 4),
            "return_63d": round(ret_63, 4),
            "avg_dollar_volume_20d": round(avg_dollar_volume, 2),
            "pct_from_high": round(pct_from_high, 4),
            "atr_pct": round(atr_pct, 4),
        }

    @staticmethod
    def _period_return(series: Optional[pd.Series], bars: int) -> float:
        if series is None or series.empty:
            return 0.0
        idx = min(len(series) - 1, bars)
        if idx <= 0:
            return 0.0
        start = float(series.iloc[-idx - 1])
        end = float(series.iloc[-1])
        if start <= 0:
            return 0.0
        return end / start - 1.0

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
    def _weights_for_regime(market_regime: str) -> dict[str, float]:
        if market_regime == "uptrend_under_pressure":
            return {
                "relative_strength": 0.22,
                "trend_quality": 0.28,
                "liquidity": 0.24,
                "distance_from_high": 0.10,
                "pullback_shape": 0.08,
                "volatility_sanity": 0.08,
            }
        if market_regime == "correction":
            return {
                "relative_strength": 0.18,
                "trend_quality": 0.30,
                "liquidity": 0.25,
                "distance_from_high": 0.07,
                "pullback_shape": 0.08,
                "volatility_sanity": 0.12,
            }
        return {
            "relative_strength": 0.28,
            "trend_quality": 0.26,
            "liquidity": 0.18,
            "distance_from_high": 0.10,
            "pullback_shape": 0.12,
            "volatility_sanity": 0.06,
        }

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
            self.cache_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        except Exception as exc:
            LOGGER.warning("Unable to write universe prefilter cache %s: %s", self.cache_path, exc)

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
