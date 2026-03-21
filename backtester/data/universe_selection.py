"""Deterministic live-universe selection with lightweight prefilter ranking."""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional

import pandas as pd

from data.feature_snapshot import build_feature_snapshot, extract_feature_records
from data.liquidity_model import LiquidityOverlayModel
from data.market_data_provider import MarketDataError, MarketDataProvider


LOGGER = logging.getLogger(__name__)

DEFAULT_CACHE_PATH = Path(__file__).parent / "cache" / "live_universe_prefilter.json"
DEFAULT_OVERLAY_REGISTRY_PATH = Path(__file__).parent / "overlay_registry.json"
DEFAULT_OVERLAY_PROMOTION_STATE_PATH = Path(__file__).parent / "cache" / "overlay-promotion-state.json"
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
        liquidity_model: Optional[LiquidityOverlayModel] = None,
        market_data: Optional[MarketDataProvider] = None,
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
        self.market_data = market_data or MarketDataProvider()
        self.liquidity_model = liquidity_model or LiquidityOverlayModel(market_data=self.market_data)
        self.overlay_registry_path = Path(
            os.getenv("TRADING_OVERLAY_REGISTRY_PATH") or DEFAULT_OVERLAY_REGISTRY_PATH
        ).expanduser()
        self.overlay_promotion_state_path = Path(
            os.getenv("TRADING_OVERLAY_PROMOTION_STATE_PATH") or DEFAULT_OVERLAY_PROMOTION_STATE_PATH
        ).expanduser()
        self.overlay_promotion_max_age_hours = float(
            os.getenv("TRADING_OVERLAY_PROMOTION_MAX_AGE_HOURS", "36")
        )
        self.rank_modifier_cap_pct_default = float(
            os.getenv("TRADING_OVERLAY_RANK_MODIFIER_CAP_PCT", "0.05")
        )

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
        allow_inline_refresh: bool = False,
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
            if refresh:
                payload = self.refresh_cache(base_symbols=base, market_regime=market_regime)
                source = "live_refresh"
            else:
                selected = [*pinned_in_order, *remaining[:remaining_slots]]
                return UniverseSelectionResult(
                    symbols=selected,
                    priority_symbols=[symbol for symbol in pinned_in_order if symbol in selected],
                    ranked_symbols=[],
                    unscored_symbols=remaining,
                    base_universe_size=len(base),
                    source="fallback",
                    generated_at=None,
                    cache_age_hours=None,
                )

        _, liquidity_records = self.liquidity_model.load_overlay_map()

        promotion_policy = self._load_rank_modifier_policy()

        def combined_rank(record: dict, symbol: str) -> float:
            prefilter_score = float(record.get("prefilter_score", 0.0))
            liquidity = liquidity_records.get(symbol)
            if liquidity is None:
                return prefilter_score

            modifier = self._liquidity_rank_modifier(
                prefilter_score=prefilter_score,
                liquidity=liquidity,
                policy=promotion_policy,
            )
            return prefilter_score + modifier

        feature_records = extract_feature_records(payload)
        records = {
            str(item.get("symbol", "")).upper(): item
            for item in feature_records
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
                    -combined_rank(item[1], item[0]),
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
        generated_at = datetime.now(UTC)
        if not symbols:
            liquidity_payload = self.liquidity_model.refresh_cache(base_symbols=symbols)
            feature_snapshot = build_feature_snapshot(
                symbols=symbols,
                histories={},
                market_regime=market_regime,
                source="ranked_universe_selector.refresh_cache",
                generated_at=generated_at,
            )
            payload = {
                "schema_version": 2,
                "generated_at": feature_snapshot.get("generated_at"),
                "symbols": [],
                "feature_snapshot": feature_snapshot,
                "liquidity_overlay": {
                    "path": str(self.liquidity_model.cache_path),
                    "generated_at": liquidity_payload.get("generated_at"),
                    "symbol_count": len(liquidity_payload.get("symbols", [])),
                    "summary": liquidity_payload.get("summary", {}),
                },
            }
            self._write_payload(payload)
            return payload

        histories = self._fetch_histories(symbols)
        feature_snapshot = build_feature_snapshot(
            symbols=symbols,
            histories=histories,
            market_regime=market_regime,
            source="ranked_universe_selector.refresh_cache",
            generated_at=generated_at,
        )
        scored = extract_feature_records({"feature_snapshot": feature_snapshot})

        liquidity_payload = self.liquidity_model.refresh_cache(base_symbols=symbols, histories=histories)
        payload = {
            "schema_version": 2,
            "generated_at": feature_snapshot.get("generated_at"),
            "market_regime": market_regime,
            "symbols": scored,
            "feature_snapshot": feature_snapshot,
            "liquidity_overlay": {
                "path": str(self.liquidity_model.cache_path),
                "generated_at": liquidity_payload.get("generated_at"),
                "symbol_count": len(liquidity_payload.get("symbols", [])),
                "summary": liquidity_payload.get("summary", {}),
            },
        }
        self._write_payload(payload)
        return payload

    def _fetch_histories(self, symbols: Iterable[str]) -> Dict[str, pd.DataFrame]:
        requested = self._dedupe([*symbols, "SPY"])
        out: Dict[str, pd.DataFrame] = {}
        for symbol in requested:
            try:
                frame = self.market_data.get_history(symbol, period="1y", auto_adjust=False).frame
            except MarketDataError as exc:
                LOGGER.warning("Universe prefilter history fetch failed for %s: %s", symbol, exc)
                continue
            if frame is not None and not frame.empty:
                out[symbol] = frame
        return out

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

    def _load_rank_modifier_policy(self) -> dict:
        registry = self._read_json(self.overlay_registry_path)
        state = self._load_fresh_promotion_state()
        fallback_cap_pct = self._clamp(self.rank_modifier_cap_pct_default, 0.01, 0.05)
        fallback = {
            "enforced": False,
            "enabled": True,
            "cap_pct": fallback_cap_pct,
            "source": "fallback",
        }

        if not registry or not state:
            return fallback

        execution = self._overlay_policy_entry(
            overlay_name="execution_quality",
            registry=registry,
            state=state,
            default_cap=fallback_cap_pct,
        )
        liquidity = self._overlay_policy_entry(
            overlay_name="liquidity_tier",
            registry=registry,
            state=state,
            default_cap=fallback_cap_pct,
        )
        enabled = execution["enabled"] and liquidity["enabled"]
        cap_pct = min(execution["cap_pct"], liquidity["cap_pct"])
        return {
            "enforced": True,
            "enabled": enabled,
            "cap_pct": self._clamp(cap_pct, 0.01, 0.05),
            "source": "promotion_state",
            "execution_quality": execution,
            "liquidity_tier": liquidity,
        }

    def _overlay_policy_entry(
        self,
        *,
        overlay_name: str,
        registry: dict,
        state: dict,
        default_cap: float,
    ) -> dict:
        registry_entry = self._lookup_overlay_entry(registry, overlay_name) or {}
        state_entry = self._lookup_overlay_entry(state, overlay_name) or {}

        stage = str(
            state_entry.get("stage")
            or registry_entry.get("stage")
            or "logged"
        ).strip().lower()
        allowlisted = bool(
            state_entry.get("allow_rank_modifier")
            if "allow_rank_modifier" in state_entry
            else (
                state_entry.get("rank_modifier_eligible")
                if "rank_modifier_eligible" in state_entry
                else (
                    registry_entry.get("allow_rank_modifier")
                    if "allow_rank_modifier" in registry_entry
                    else registry_entry.get("rank_modifier_eligible", False)
                )
            )
        )
        cap_pct = state_entry.get("max_effect_pct")
        if cap_pct is None:
            cap_pct = registry_entry.get("max_effect_pct")
        if cap_pct is None:
            modifier_bounds = state_entry.get("modifier_bounds")
            if isinstance(modifier_bounds, dict):
                cap_pct = modifier_bounds.get("max")
        if cap_pct is None:
            modifier_bounds = registry_entry.get("modifier_bounds")
            if isinstance(modifier_bounds, dict):
                cap_pct = modifier_bounds.get("max")
        if cap_pct is None:
            rank_modifier = registry_entry.get("rank_modifier")
            if isinstance(rank_modifier, dict):
                cap_pct = rank_modifier.get("max_effect_pct")
        try:
            cap_pct_value = float(cap_pct)
        except (TypeError, ValueError):
            cap_pct_value = default_cap

        enabled = allowlisted and stage == "rank_modifier"
        return {
            "enabled": enabled,
            "stage": stage,
            "allow_rank_modifier": allowlisted,
            "cap_pct": self._clamp(cap_pct_value, 0.01, 0.05),
        }

    @staticmethod
    def _lookup_overlay_entry(payload: dict, overlay_name: str) -> Optional[dict]:
        overlays = payload.get("overlays")
        if isinstance(overlays, dict):
            entry = overlays.get(overlay_name)
            return entry if isinstance(entry, dict) else None
        if isinstance(overlays, list):
            for entry in overlays:
                if not isinstance(entry, dict):
                    continue
                name = str(entry.get("name") or entry.get("overlay") or "").strip().lower()
                if name == overlay_name:
                    return entry
        return None

    def _load_fresh_promotion_state(self) -> Optional[dict]:
        payload = self._read_json(self.overlay_promotion_state_path)
        if not payload:
            return None
        generated_at = payload.get("generated_at")
        age_hours = self._age_hours(generated_at)
        if age_hours is None or age_hours > self.overlay_promotion_max_age_hours:
            return None
        return payload

    @staticmethod
    def _read_json(path: Path) -> Optional[dict]:
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return None
        return payload if isinstance(payload, dict) else None

    def _liquidity_rank_modifier(
        self,
        *,
        prefilter_score: float,
        liquidity: dict,
        policy: dict,
    ) -> float:
        if policy.get("enforced") and not policy.get("enabled"):
            return 0.0

        quality_score = float(liquidity.get("liquidity_quality_score", 50.0))
        tier = str(liquidity.get("liquidity_tier", "")).lower()
        raw_modifier = (quality_score - 50.0) * 0.06
        if tier == "illiquid":
            raw_modifier -= 3.0
        elif tier == "high":
            raw_modifier += 0.5

        cap_pct = self._clamp(float(policy.get("cap_pct", self.rank_modifier_cap_pct_default)), 0.01, 0.05)
        cap_points = max(abs(prefilter_score) * cap_pct, 0.5)
        return self._clamp(raw_modifier, -cap_points, cap_points)

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
