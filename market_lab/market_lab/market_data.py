from __future__ import annotations

import os
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

import requests
from dateutil.parser import isoparse

from .models import OptionalEvidence, PriceFacts


def _parse_timestamp(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, (int, float)):
        if value > 10_000_000_000:
            value = value / 1000
        return datetime.fromtimestamp(value, tz=UTC)
    if isinstance(value, str) and value.strip():
        try:
            parsed = isoparse(value)
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
        except ValueError:
            return None
    return None


def _first_number(payload: dict[str, Any], keys: list[str]) -> float | None:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, dict):
            nested = _first_number(value, keys)
            if nested is not None:
                return nested
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value)
            except ValueError:
                pass
    return None


def _first_timestamp(payload: dict[str, Any]) -> datetime | None:
    keys = [
        "timestamp",
        "quoteTime",
        "quote_time",
        "lastTradeTime",
        "last_trade_time",
        "asOf",
        "as_of",
        "updatedAt",
        "updated_at",
    ]
    for key in keys:
        if key in payload:
            parsed = _parse_timestamp(payload[key])
            if parsed:
                return parsed
    for value in payload.values():
        if isinstance(value, dict):
            parsed = _first_timestamp(value)
            if parsed:
                return parsed
    return None


def extract_data(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None
    data = payload.get("data")
    if isinstance(data, dict):
        nested = data.get("payload")
        return nested if isinstance(nested, dict) else data
    return payload


class MarketDataError(RuntimeError):
    pass


class MarketDataClient:
    def __init__(self, *, base_url: str | None = None, timeout_seconds: float | None = None):
        self.base_url = (
            base_url
            or os.getenv("MARKET_DATA_SERVICE_BASE_URL")
            or os.getenv("MARKET_DATA_SERVICE_URL")
            or "http://127.0.0.1:3033"
        ).rstrip("/")
        self.timeout_seconds = timeout_seconds or float(os.getenv("MARKET_DATA_SERVICE_TIMEOUT_SECONDS", "4.0"))

    def get_payload(self, path: str, *, params: dict[str, Any] | None = None) -> dict[str, Any]:
        try:
            response = requests.get(f"{self.base_url}{path}", params=params, timeout=self.timeout_seconds)
            payload = response.json()
        except Exception as exc:
            raise MarketDataError(f"market data request failed for {path}: {exc}") from exc
        if response.status_code >= 400:
            reason = payload.get("degradedReason") or payload.get("error") or response.text
            raise MarketDataError(f"market data request failed for {path}: {reason}")
        if not isinstance(payload, dict):
            raise MarketDataError(f"market data response was not an object for {path}")
        return payload

    def get_quote(self, symbol: str) -> PriceFacts:
        normalized = symbol.strip().upper()
        payload = self.get_payload(f"/market-data/quote/{quote(normalized)}")
        data = extract_data(payload) or {}
        price = _first_number(
            data,
            ["price", "last", "lastPrice", "last_price", "mark", "regularMarketPrice", "close", "Close"],
        )
        if price is None:
            raise MarketDataError(f"quote for {normalized} did not include a price")
        timestamp = _first_timestamp(data) or _first_timestamp(payload) or datetime.now(UTC)
        volume = _first_number(data, ["volume", "totalVolume", "regularMarketVolume"])
        return PriceFacts(
            symbol=normalized,
            price=price,
            timestamp=timestamp,
            source=str(payload.get("source") or data.get("source") or "market-data-service"),
            provider_mode=payload.get("providerMode") if isinstance(payload.get("providerMode"), str) else None,
            price_basis=str(data.get("price_basis") or data.get("priceBasis") or "live"),
            volume=volume,
            raw_payload=payload,
        )

    def get_quote_batch(self, symbols: list[str]) -> dict[str, dict[str, Any]]:
        normalized = []
        seen: set[str] = set()
        for symbol in symbols:
            item = symbol.strip().upper()
            if item and item not in seen:
                normalized.append(item)
                seen.add(item)
        if not normalized:
            return {}
        payload = self.get_payload(
            "/market-data/quote/batch",
            params={"symbols": ",".join(normalized), "subsystem": "portfolio"},
        )
        data = extract_data(payload) or {}
        items = data.get("items") if isinstance(data, dict) else None
        if not isinstance(items, list):
            return {}
        quotes: dict[str, dict[str, Any]] = {}
        for item in items:
            if not isinstance(item, dict):
                continue
            item_data = item.get("data") if isinstance(item.get("data"), dict) else {}
            symbol = str(item.get("symbol") or item_data.get("symbol") or "").strip().upper()
            if symbol:
                quotes[symbol] = item
        return quotes

    def get_history(self, symbol: str, *, period: str = "3mo") -> dict[str, Any] | None:
        try:
            return self.get_payload(f"/market-data/history/{quote(symbol.strip().upper())}", params={"period": period})
        except MarketDataError:
            return None

    def get_fundamentals(self, symbol: str) -> dict[str, Any] | None:
        try:
            return self.get_payload(f"/market-data/fundamentals/{quote(symbol.strip().upper())}")
        except MarketDataError:
            return None

    def get_optional_evidence(self, symbol: str) -> OptionalEvidence:
        history = self.get_history(symbol)
        fundamentals = self.get_fundamentals(symbol)
        return OptionalEvidence(
            history_status="available" if history else "missing",
            fundamentals_status="available" if fundamentals else "missing",
            news_status="missing",
            sentiment_status="missing",
            notes=[],
        )
