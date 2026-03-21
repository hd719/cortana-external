from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from data.market_data_provider import MarketDataError
from data.market_regime import MarketDataFetchError, MarketRegime, MarketRegimeDetector


def _write_snapshot(path: Path, *, generated_at: datetime) -> None:
    payload = {
        "schema_version": 1,
        "symbol": "SPY",
        "generated_at_utc": generated_at.isoformat(),
        "ttl_seconds": 1800,
        "market_status": {
            "regime": MarketRegime.CORRECTION.value,
            "distribution_days": 6,
            "last_ftd": "2026-02-20",
            "trend_direction": "down",
            "position_sizing": 0.0,
            "notes": "Cached correction snapshot.",
            "data_source": "alpaca",
        },
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_rate_limit_uses_fresh_cache_and_returns_degraded_status(tmp_path):
    cache_path = tmp_path / "market_snapshot.json"
    _write_snapshot(cache_path, generated_at=datetime.now(timezone.utc) - timedelta(minutes=10))

    detector = MarketRegimeDetector(cache_path=str(cache_path), cache_ttl_seconds=1800)
    detector.data_provider.get_history = lambda *args, **kwargs: (_ for _ in ()).throw(MarketDataError("rate limit", transient=True))  # type: ignore[method-assign]

    status = detector.get_status()

    assert status.status == "degraded"
    assert status.regime == MarketRegime.CORRECTION
    assert status.data_source == "cache"
    assert status.snapshot_age_seconds > 0


def test_stale_cache_raises_with_staleness_message(tmp_path):
    cache_path = tmp_path / "market_snapshot.json"
    _write_snapshot(cache_path, generated_at=datetime.now(timezone.utc) - timedelta(hours=3))

    detector = MarketRegimeDetector(cache_path=str(cache_path), cache_ttl_seconds=60)
    detector.data_provider.get_history = lambda *args, **kwargs: (_ for _ in ()).throw(MarketDataError("rate limit", transient=True))  # type: ignore[method-assign]

    with pytest.raises(MarketDataFetchError) as exc_info:
        detector.get_status()

    msg = str(exc_info.value).lower()
    assert "stale" in msg
    assert "ttl=" in msg


def test_missing_cache_uses_conservative_emergency_status(tmp_path):
    cache_path = tmp_path / "market_snapshot.json"

    detector = MarketRegimeDetector(cache_path=str(cache_path), cache_ttl_seconds=1800)
    detector.data_provider.get_history = lambda *args, **kwargs: (_ for _ in ()).throw(MarketDataError("service unavailable", transient=True))  # type: ignore[method-assign]

    status = detector.get_status()

    assert status.status == "degraded"
    assert status.regime == MarketRegime.CORRECTION
    assert status.data_source == "unknown"
    assert status.position_sizing == 0.0
    assert "emergency fallback" in status.degraded_reason.lower()
