"""Market Regime Detection (M Factor)."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from data.market_data_provider import MarketDataError, MarketDataProvider


class MarketRegime(Enum):
    CONFIRMED_UPTREND = "confirmed_uptrend"
    UPTREND_UNDER_PRESSURE = "uptrend_under_pressure"
    CORRECTION = "correction"
    RALLY_ATTEMPT = "rally_attempt"


@dataclass
class MarketStatus:
    regime: MarketRegime
    distribution_days: int
    last_ftd: str
    trend_direction: str
    position_sizing: float
    notes: str
    data_source: str = "unknown"  # alpaca|yahoo|cache
    status: str = "ok"  # ok|degraded
    degraded_reason: str = ""
    snapshot_age_seconds: float = 0.0
    next_action: str = ""

    def __str__(self) -> str:
        emoji = {
            MarketRegime.CONFIRMED_UPTREND: "🟢",
            MarketRegime.UPTREND_UNDER_PRESSURE: "🟡",
            MarketRegime.RALLY_ATTEMPT: "🟡",
            MarketRegime.CORRECTION: "🔴",
        }
        degraded_reason = f"\n║ Degraded Reason: {self.degraded_reason}" if self.status == "degraded" else ""
        age_line = f"\n║ Snapshot Age: {self.snapshot_age_seconds:.0f}s" if self.snapshot_age_seconds else ""
        return f"""
╔══════════════════════════════════════════════════════════════╗
║                    MARKET STATUS (M Factor)                  ║
╠══════════════════════════════════════════════════════════════╣
║ Regime: {emoji.get(self.regime, '')} {self.regime.value.upper()}
║ Data Status: {self.status.upper()} ({self.data_source})
║ Distribution Days (25d): {self.distribution_days}
║ Last Follow-Through: {self.last_ftd or 'None recent'}
║ Trend: {self.trend_direction}
║ Position Sizing: {self.position_sizing * 100:.0f}%
║
║ Notes: {self.notes}{degraded_reason}{age_line}
╚══════════════════════════════════════════════════════════════╝
"""


class MarketDataFetchError(RuntimeError):
    def __init__(self, message: str, *, transient: bool = False):
        super().__init__(message)
        self.transient = transient


class MarketRegimeDetector:
    def __init__(
        self,
        symbol: str = "SPY",
        cache_path: Optional[str] = None,
        cache_ttl_seconds: int = 1800,
        max_retries: int = 2,
        backoff_base_seconds: float = 0.75,
        backoff_jitter_seconds: float = 0.35,
        cooldown_seconds: int = 45,
    ):
        self.symbol = symbol
        self._data: Optional[pd.DataFrame] = None
        self._distribution_days: List[datetime] = []
        self._ftd_dates: List[datetime] = []
        safe_symbol = "".join(c if c.isalnum() else "_" for c in symbol.upper())
        default_cache = Path(".cache") / f"market_regime_snapshot_{safe_symbol}.json"
        self.cache_path = Path(cache_path or os.getenv("MARKET_REGIME_CACHE_PATH", str(default_cache))).expanduser()
        self.cache_ttl_seconds = int(os.getenv("MARKET_REGIME_CACHE_TTL_SECONDS", str(cache_ttl_seconds)))
        self.cooldown_seconds = int(os.getenv("MARKET_REGIME_FETCH_COOLDOWN_SECONDS", str(cooldown_seconds)))
        self.data_provider = MarketDataProvider(
            cache_ttl_seconds=self.cache_ttl_seconds,
            max_retries=int(os.getenv("MARKET_REGIME_FETCH_MAX_RETRIES", str(max_retries))),
            backoff_base_seconds=float(os.getenv("MARKET_REGIME_BACKOFF_BASE_SECONDS", str(backoff_base_seconds))),
            backoff_jitter_seconds=float(os.getenv("MARKET_REGIME_BACKOFF_JITTER_SECONDS", str(backoff_jitter_seconds))),
            cooldown_seconds=self.cooldown_seconds,
        )
        self.last_data_source = "unknown"
        self.last_data_staleness_seconds = 0.0

    @staticmethod
    def _age_to_human(seconds: float) -> str:
        seconds = max(seconds, 0.0)
        if seconds < 60:
            return f"{int(seconds)}s"
        if seconds < 3600:
            return f"{int(seconds // 60)}m"
        return f"{seconds / 3600:.1f}h"

    def _write_snapshot_cache(self, status: MarketStatus) -> None:
        payload = {
            "schema_version": 1,
            "symbol": self.symbol,
            "generated_at_utc": datetime.now(timezone.utc).isoformat(),
            "ttl_seconds": self.cache_ttl_seconds,
            "market_status": {
                "regime": status.regime.value,
                "distribution_days": status.distribution_days,
                "last_ftd": status.last_ftd,
                "trend_direction": status.trend_direction,
                "position_sizing": status.position_sizing,
                "notes": status.notes,
                "data_source": status.data_source,
            },
        }
        try:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            self.cache_path.write_text(json.dumps(payload), encoding="utf-8")
        except Exception:
            return

    def _read_snapshot_cache(self) -> Optional[dict]:
        if not self.cache_path.exists():
            return None
        try:
            return json.loads(self.cache_path.read_text(encoding="utf-8"))
        except Exception:
            return None

    def _build_degraded_status(self, failure_reason: str) -> MarketStatus:
        payload = self._read_snapshot_cache()
        if not payload:
            raise MarketDataFetchError(f"{failure_reason}. No usable market snapshot cache at {self.cache_path}.", transient=True)

        generated_at_raw = payload.get("generated_at_utc")
        cached = payload.get("market_status") or {}
        ttl_seconds = int(payload.get("ttl_seconds") or self.cache_ttl_seconds)
        try:
            generated_at = datetime.fromisoformat(generated_at_raw)
            if generated_at.tzinfo is None:
                generated_at = generated_at.replace(tzinfo=timezone.utc)
        except Exception as exc:
            raise MarketDataFetchError(f"{failure_reason}. Snapshot timestamp invalid.", transient=True) from exc

        age_seconds = max((datetime.now(timezone.utc) - generated_at).total_seconds(), 0.0)
        if age_seconds > ttl_seconds:
            raise MarketDataFetchError(
                f"{failure_reason}. Cached snapshot is stale ({self._age_to_human(age_seconds)} old, ttl={ttl_seconds}s).",
                transient=True,
            )

        try:
            regime = MarketRegime(cached["regime"])
        except Exception as exc:
            raise MarketDataFetchError(f"{failure_reason}. Cached regime invalid.", transient=True) from exc

        stale_age = self._age_to_human(age_seconds)
        return MarketStatus(
            regime=regime,
            distribution_days=int(cached.get("distribution_days", 0)),
            last_ftd=cached.get("last_ftd"),
            trend_direction=cached.get("trend_direction", "sideways"),
            position_sizing=float(cached.get("position_sizing", 0.0)),
            notes=f"{cached.get('notes', '')} [DEGRADED: cached market inputs, age={stale_age}]".strip(),
            data_source="cache",
            status="degraded",
            degraded_reason=f"{failure_reason}. Using cached market snapshot ({stale_age} old).",
            snapshot_age_seconds=age_seconds,
            next_action=f"Retry market fetch after cooldown ({self.cooldown_seconds}s) or refresh cache.",
        )

    def fetch_data(self, days: int = 90) -> pd.DataFrame:
        try:
            result = self.data_provider.get_history(self.symbol, period=f"{days}d")
            self._data = result.frame
            self.last_data_source = result.source
            self.last_data_staleness_seconds = result.staleness_seconds
            return self._data
        except MarketDataError as exc:
            raise MarketDataFetchError(str(exc), transient=exc.transient) from exc

    def count_distribution_days(self, lookback: int = 25) -> List[datetime]:
        if self._data is None:
            self.fetch_data()
        data = self._data.tail(lookback + 1)
        distribution_days: List[datetime] = []
        for i in range(1, len(data)):
            today = data.iloc[i]
            yesterday = data.iloc[i - 1]
            daily_return = (today["Close"] - yesterday["Close"]) / yesterday["Close"]
            if daily_return < -0.002 and today["Volume"] > yesterday["Volume"]:
                distribution_days.append(data.index[i])
        self._distribution_days = distribution_days
        return distribution_days

    def find_follow_through_days(self, lookback: int = 60) -> List[datetime]:
        if self._data is None:
            self.fetch_data()
        data = self._data.tail(lookback)
        ftd_dates: List[datetime] = []
        for i in range(4, len(data)):
            today = data.iloc[i]
            yesterday = data.iloc[i - 1]
            daily_return = (today["Close"] - yesterday["Close"]) / yesterday["Close"]
            if daily_return > 0.015 and today["Volume"] > yesterday["Volume"]:
                ftd_dates.append(data.index[i])
        self._ftd_dates = ftd_dates
        return ftd_dates

    def get_trend_direction(self) -> str:
        if self._data is None:
            self.fetch_data()
        close = self._data["Close"]
        sma_20 = close.rolling(20).mean()
        sma_50 = close.rolling(50).mean()
        current, s20, s50 = close.iloc[-1], sma_20.iloc[-1], sma_50.iloc[-1]
        if current > s20 > s50:
            return "up"
        if current < s20 < s50:
            return "down"
        return "sideways"

    def get_status(self) -> MarketStatus:
        try:
            self.fetch_data()
        except MarketDataFetchError as exc:
            if exc.transient:
                return self._build_degraded_status(str(exc))
            raise

        dist_days = self.count_distribution_days(25)
        dist_count = len(dist_days)
        ftd_dates = self.find_follow_through_days(60)
        last_ftd = ftd_dates[-1].strftime("%Y-%m-%d") if ftd_dates else None
        trend = self.get_trend_direction()

        if dist_count >= 5:
            if trend == "down":
                regime, sizing, notes = MarketRegime.CORRECTION, 0.0, f"{dist_count} distribution days + downtrend. Stay out."
            else:
                regime, sizing, notes = MarketRegime.UPTREND_UNDER_PRESSURE, 0.5, f"{dist_count} distribution days. Reduce exposure."
        elif dist_count >= 3:
            regime, sizing, notes = MarketRegime.UPTREND_UNDER_PRESSURE, 0.75, f"{dist_count} distribution days. Be cautious."
        else:
            if trend == "up":
                regime, sizing, notes = MarketRegime.CONFIRMED_UPTREND, 1.0, "Market healthy. Full position sizing."
            elif trend == "sideways":
                regime, sizing, notes = MarketRegime.RALLY_ATTEMPT, 0.5, "Market sideways. Wait for confirmation."
            else:
                regime, sizing, notes = MarketRegime.CORRECTION, 0.0, "Downtrend. No new buys."

        status = MarketStatus(
            regime=regime,
            distribution_days=dist_count,
            last_ftd=last_ftd,
            trend_direction=trend,
            position_sizing=sizing,
            notes=notes,
            data_source=self.last_data_source,
            snapshot_age_seconds=self.last_data_staleness_seconds,
        )
        self._write_snapshot_cache(status)
        return status

    def should_buy(self) -> Tuple[bool, float]:
        status = self.get_status()
        if status.regime == MarketRegime.CORRECTION:
            return False, 0.0
        return True, status.position_sizing

    def get_distribution_day_count(self) -> int:
        if not self._distribution_days:
            self.count_distribution_days()
        return len(self._distribution_days)

    def get_distribution_calendar(self, lookback: int = 25) -> pd.DataFrame:
        """Backward-compatible distribution-day table used by advisor CLI output."""
        days = self.count_distribution_days(lookback)
        return pd.DataFrame({"Date": pd.to_datetime(days).date})



def get_market_status() -> MarketStatus:
    return MarketRegimeDetector().get_status()



def can_buy() -> Tuple[bool, float]:
    return MarketRegimeDetector().should_buy()


if __name__ == "__main__":
    detector = MarketRegimeDetector()
    status = detector.get_status()
    print(status)
    can_buy_flag, size = detector.should_buy()
    if can_buy_flag:
        print(f"\n✅ Can buy. Recommended position size: {size * 100:.0f}%")
    else:
        print("\n❌ Market in correction. Do not buy.")
