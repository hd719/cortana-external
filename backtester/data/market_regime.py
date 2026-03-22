"""Market Regime Detection (M Factor)."""

from __future__ import annotations

import json
import os
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

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
    regime_score: int = 0
    drawdown_pct: float = 0.0
    recent_return_pct: float = 0.0
    price_vs_21d_pct: float = 0.0
    price_vs_50d_pct: float = 0.0
    follow_through_active: bool = False
    premarket_futures_summary: str = ""

    @staticmethod
    def _display_width(text: str) -> int:
        width = 0
        for char in str(text):
            if unicodedata.combining(char):
                continue
            if unicodedata.east_asian_width(char) in {"W", "F"}:
                width += 2
            elif ord(char) >= 0x1F300:
                width += 2
            else:
                width += 1
        return width

    @classmethod
    def _pad_cell(cls, text: str, width: int) -> str:
        value = str(text)
        return value + (" " * max(width - cls._display_width(value), 0))

    @classmethod
    def _boxed(cls, title: str, body_lines: list[str]) -> str:
        inner_width = max(
            [cls._display_width(title), *(cls._display_width(line) for line in body_lines)],
            default=0,
        )
        top = "╔" + ("═" * (inner_width + 2)) + "╗"
        header = "║ " + cls._pad_cell(title, inner_width) + " ║"
        divider = "╠" + ("═" * (inner_width + 2)) + "╣"
        rows = ["║ " + cls._pad_cell(line, inner_width) + " ║" for line in body_lines]
        bottom = "╚" + ("═" * (inner_width + 2)) + "╝"
        return "\n".join([top, header, divider, *rows, bottom])

    def __str__(self) -> str:
        emoji = {
            MarketRegime.CONFIRMED_UPTREND: "🟢",
            MarketRegime.UPTREND_UNDER_PRESSURE: "🟡",
            MarketRegime.RALLY_ATTEMPT: "🟡",
            MarketRegime.CORRECTION: "🔴",
        }
        lines = [
            f"Regime: {emoji.get(self.regime, '')} {self.regime.value.upper()}",
            f"Data Status: {self.status.upper()} ({self.data_source})",
            f"Distribution Days (25d): {self.distribution_days}",
            f"Last Follow-Through: {self.last_ftd or 'None recent'}",
            f"Trend: {self.trend_direction}",
            f"Position Sizing: {self.position_sizing * 100:.0f}%",
            f"Regime Score: {self.regime_score:+d} | Drawdown: {self.drawdown_pct:.1f}% | 20d Return: {self.recent_return_pct:.1f}%",
        ]
        if self.premarket_futures_summary:
            lines.append(f"Premarket futures: {self.premarket_futures_summary}")
        lines.extend(["", f"Notes: {self.notes}"])
        if self.status == "degraded" and self.degraded_reason:
            lines.append(f"Degraded Reason: {self.degraded_reason}")
        if self.snapshot_age_seconds:
            lines.append(f"Snapshot Age: {self.snapshot_age_seconds:.0f}s")
        return "\n" + self._boxed("MARKET STATUS (M Factor)", lines) + "\n"


@dataclass(frozen=True)
class RegimeScorecard:
    """Reusable market-regime score snapshot derived from index price action."""

    distribution_days: int
    trend_direction: str
    trend_score: int
    distribution_penalty: int
    drawdown_penalty: int
    follow_through_bonus: int
    regime_score: int
    drawdown_pct: float
    recent_return_pct: float
    price_vs_21d_pct: float
    price_vs_50d_pct: float
    follow_through_active: bool


class MarketDataFetchError(RuntimeError):
    def __init__(self, message: str, *, transient: bool = False):
        super().__init__(message)
        self.transient = transient


class MarketRegimeDetector:
    def __init__(
        self,
        symbol: str = "SPY",
        cache_path: Optional[str] = None,
        cache_ttl_seconds: int = 600,
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
            "schema_version": 2,
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
                "regime_score": status.regime_score,
                "drawdown_pct": status.drawdown_pct,
                "recent_return_pct": status.recent_return_pct,
                "price_vs_21d_pct": status.price_vs_21d_pct,
                "price_vs_50d_pct": status.price_vs_50d_pct,
                "follow_through_active": status.follow_through_active,
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
            regime_score=int(cached.get("regime_score", 0)),
            drawdown_pct=float(cached.get("drawdown_pct", 0.0)),
            recent_return_pct=float(cached.get("recent_return_pct", 0.0)),
            price_vs_21d_pct=float(cached.get("price_vs_21d_pct", 0.0)),
            price_vs_50d_pct=float(cached.get("price_vs_50d_pct", 0.0)),
            follow_through_active=bool(cached.get("follow_through_active", False)),
        )

    def _build_emergency_status(self, failure_reason: str) -> MarketStatus:
        """Conservative last-resort fallback when neither live data nor snapshot cache is available."""
        return MarketStatus(
            regime=MarketRegime.CORRECTION,
            distribution_days=0,
            last_ftd=None,
            trend_direction="unknown",
            position_sizing=0.0,
            notes="Market inputs unavailable. Defaulting to defensive posture until fresh data is restored.",
            data_source="unknown",
            status="degraded",
            degraded_reason=f"{failure_reason}. No snapshot cache available; using conservative emergency fallback.",
            snapshot_age_seconds=0.0,
            next_action=f"Restore market-data service or seed {self.cache_path}.",
            regime_score=-99,
            drawdown_pct=0.0,
            recent_return_pct=0.0,
            price_vs_21d_pct=0.0,
            price_vs_50d_pct=0.0,
            follow_through_active=False,
        )

    def _premarket_futures_summary(self) -> str:
        now_et = datetime.now(ZoneInfo("America/New_York"))
        if now_et.hour > 9 or (now_et.hour == 9 and now_et.minute >= 30):
            return ""

        futures_rows: list[tuple[str, float | None, float | None]] = []
        for symbol in ("/ES", "/NQ"):
            try:
                payload = self.data_provider.get_quote(symbol).quote
            except Exception:
                continue
            try:
                change_pct = float(payload.get("changePercent")) if payload.get("changePercent") is not None else None
            except (TypeError, ValueError):
                change_pct = None
            try:
                price = float(payload.get("price")) if payload.get("price") is not None else None
            except (TypeError, ValueError):
                price = None
            if price is None:
                continue
            futures_rows.append((symbol, change_pct, price))

        if not futures_rows:
            return ""

        comparable_changes = [change for _, change, _ in futures_rows if change is not None]
        supportive = comparable_changes and all(change >= 0.35 for change in comparable_changes)
        weak = comparable_changes and all(change <= -0.35 for change in comparable_changes)
        posture = "supportive" if supportive else "weak" if weak else "mixed"
        detail = []
        for symbol, change, price in futures_rows:
            if change is None:
                detail.append(f"{symbol} {price:.2f}")
            else:
                detail.append(f"{symbol} {change:+.2f}%")
        return f"{posture} | " + " | ".join(detail)

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

    @staticmethod
    def _safe_pct(value: float | int | None) -> float:
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            return 0.0
        if not np.isfinite(numeric):
            return 0.0
        return numeric

    def build_regime_scorecard(self) -> RegimeScorecard:
        """Build a reusable scorecard from recent index internals."""
        if self._data is None:
            self.fetch_data()

        close = self._data["Close"].astype(float)
        current = float(close.iloc[-1])
        sma_21 = float(close.rolling(21, min_periods=5).mean().iloc[-1])
        sma_50 = float(close.rolling(50, min_periods=10).mean().iloc[-1])

        recent_high = float(close.rolling(20, min_periods=5).max().iloc[-1])
        drawdown_pct = self._safe_pct(((current / recent_high) - 1) * 100 if recent_high else 0.0)

        lookback_offset = min(20, len(close) - 1)
        recent_base = float(close.iloc[-1 - lookback_offset]) if lookback_offset > 0 else current
        recent_return_pct = self._safe_pct(((current / recent_base) - 1) * 100 if recent_base else 0.0)

        price_vs_21d_pct = self._safe_pct(((current / sma_21) - 1) * 100 if sma_21 else 0.0)
        price_vs_50d_pct = self._safe_pct(((current / sma_50) - 1) * 100 if sma_50 else 0.0)

        distribution_days = len(self._distribution_days) if self._distribution_days else len(self.count_distribution_days(25))
        ftd_dates = self._ftd_dates if self._ftd_dates else self.find_follow_through_days(60)
        trend_direction = self.get_trend_direction()

        trend_score = 0
        trend_score += 1 if current > sma_21 else -1
        trend_score += 1 if current > sma_50 else -1
        if sma_21 > sma_50:
            trend_score += 1
        elif sma_21 < sma_50:
            trend_score -= 1

        if distribution_days <= 2:
            distribution_penalty = 0
        elif distribution_days <= 4:
            distribution_penalty = 1
        elif distribution_days <= 5:
            distribution_penalty = 2
        else:
            distribution_penalty = 3

        if drawdown_pct >= -3:
            drawdown_penalty = 0
        elif drawdown_pct >= -7:
            drawdown_penalty = 1
        elif drawdown_pct >= -12:
            drawdown_penalty = 2
        else:
            drawdown_penalty = 3

        follow_through_active = bool(ftd_dates and (self._data.index[-1] - ftd_dates[-1]).days <= 15)
        follow_through_bonus = 1 if follow_through_active else 0

        regime_score = trend_score + follow_through_bonus - distribution_penalty - drawdown_penalty

        return RegimeScorecard(
            distribution_days=distribution_days,
            trend_direction=trend_direction,
            trend_score=trend_score,
            distribution_penalty=distribution_penalty,
            drawdown_penalty=drawdown_penalty,
            follow_through_bonus=follow_through_bonus,
            regime_score=regime_score,
            drawdown_pct=drawdown_pct,
            recent_return_pct=recent_return_pct,
            price_vs_21d_pct=price_vs_21d_pct,
            price_vs_50d_pct=price_vs_50d_pct,
            follow_through_active=follow_through_active,
        )

    def get_status(self) -> MarketStatus:
        try:
            self.fetch_data()
        except MarketDataFetchError as exc:
            if exc.transient:
                try:
                    return self._build_degraded_status(str(exc))
                except MarketDataFetchError as degraded_exc:
                    degraded_message = str(degraded_exc)
                    if "No usable market snapshot cache" in degraded_message:
                        return self._build_emergency_status(str(exc))
                    if "transient error 404" in str(exc) and "Cached snapshot is stale" in degraded_message:
                        return self._build_emergency_status(str(exc))
                    raise
            raise

        dist_days = self.count_distribution_days(25)
        ftd_dates = self.find_follow_through_days(60)
        last_ftd = ftd_dates[-1].strftime("%Y-%m-%d") if ftd_dates else None
        scorecard = self.build_regime_scorecard()

        if (
            scorecard.regime_score <= -2
            or (scorecard.trend_direction == "down" and scorecard.drawdown_pct <= -8)
            or scorecard.distribution_days >= 6
        ):
            regime, sizing = MarketRegime.CORRECTION, 0.0
            notes = (
                f"Regime score {scorecard.regime_score:+d}: "
                f"{scorecard.distribution_days} distribution days and {scorecard.drawdown_pct:.1f}% drawdown. Stay defensive."
            )
        elif (
            scorecard.regime_score >= 3
            and scorecard.trend_direction == "up"
            and scorecard.distribution_days <= 2
        ):
            regime, sizing = MarketRegime.CONFIRMED_UPTREND, 1.0
            notes = (
                f"Regime score {scorecard.regime_score:+d}: trend intact, "
                f"{scorecard.distribution_days} distribution days."
            )
        elif (
            scorecard.trend_direction == "sideways"
            and scorecard.regime_score <= 1
            and scorecard.distribution_days <= 2
        ):
            regime, sizing = MarketRegime.RALLY_ATTEMPT, 0.5
            notes = (
                f"Regime score {scorecard.regime_score:+d}: sideways action with "
                f"{scorecard.drawdown_pct:.1f}% drawdown. Wait for confirmation."
            )
        else:
            sizing = 0.75 if scorecard.regime_score >= 1 else 0.5
            regime = MarketRegime.UPTREND_UNDER_PRESSURE
            notes = (
                f"Regime score {scorecard.regime_score:+d}: trend still tradable, "
                f"but {scorecard.distribution_days} distribution days require selectivity."
            )

        status = MarketStatus(
            regime=regime,
            distribution_days=len(dist_days),
            last_ftd=last_ftd,
            trend_direction=scorecard.trend_direction,
            position_sizing=sizing,
            notes=notes,
            data_source=self.last_data_source,
            snapshot_age_seconds=self.last_data_staleness_seconds,
            regime_score=scorecard.regime_score,
            drawdown_pct=scorecard.drawdown_pct,
            recent_return_pct=scorecard.recent_return_pct,
            price_vs_21d_pct=scorecard.price_vs_21d_pct,
            price_vs_50d_pct=scorecard.price_vs_50d_pct,
            follow_through_active=scorecard.follow_through_active,
            premarket_futures_summary=self._premarket_futures_summary(),
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
