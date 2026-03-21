"""Lightweight client for the local TS market-data service."""

from __future__ import annotations

import os
from typing import Any, Dict, Optional
from urllib.parse import quote

import requests


class MarketDataServiceClient:
    def __init__(
        self,
        *,
        base_url: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
        enabled: Optional[bool] = None,
    ):
        self.base_url = (
            base_url
            or os.getenv("MARKET_DATA_SERVICE_BASE_URL")
            or os.getenv("MARKET_DATA_SERVICE_URL")
            or "http://localhost:3033"
        ).rstrip("/")
        self.timeout_seconds = float(
            timeout_seconds
            if timeout_seconds is not None
            else os.getenv("MARKET_DATA_SERVICE_TIMEOUT_SECONDS", "2.0")
        )
        if enabled is None:
            raw = os.getenv("MARKET_DATA_SERVICE_ENABLED", "1").strip().lower()
            self.enabled = raw not in {"0", "false", "no", "off"}
        else:
            self.enabled = enabled

    def get_payload(self, path: str, *, params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        if not self.enabled:
            return None
        url = f"{self.base_url}{path}"
        try:
            response = requests.get(url, params=params, timeout=self.timeout_seconds)
        except Exception:
            return None
        if response.status_code != 200:
            return None
        try:
            payload = response.json()
        except Exception:
            return None
        if not isinstance(payload, dict):
            return None
        status = str(payload.get("status") or "").lower()
        if status and status not in {"ok", "degraded"}:
            return None
        return payload

    def get_symbol_payload(
        self,
        route: str,
        symbol: str,
        *,
        params: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        safe_symbol = quote(symbol.upper().strip())
        return self.get_payload(f"/market-data/{route}/{safe_symbol}", params=params)

    @staticmethod
    def extract_data(payload: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if not isinstance(payload, dict):
            return None
        data = payload.get("data")
        if isinstance(data, dict):
            if isinstance(data.get("payload"), dict):
                return data["payload"]
            return data
        return payload
