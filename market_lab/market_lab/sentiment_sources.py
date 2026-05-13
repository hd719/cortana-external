from __future__ import annotations

import hashlib
import json
import os
import xml.etree.ElementTree as ET
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Callable

import requests

from .models import SentimentSnapshot, SentimentSourceResult
from .storage import default_cache_dir

SOURCES = ("yahoo_finance_news", "stocktwits", "reddit")


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _safe_symbol(symbol: str) -> str:
    return symbol.strip().upper()


def _cache_key(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


class SentimentSourceClient:
    def __init__(
        self,
        *,
        cache_dir: Path | str | None = None,
        ttl_minutes: int | None = None,
        timeout_seconds: float | None = None,
        request_get: Callable[..., requests.Response] | None = None,
    ):
        self.cache_dir = Path(cache_dir).expanduser().resolve() if cache_dir else default_cache_dir() / "sentiment"
        self.ttl = timedelta(minutes=ttl_minutes or int(os.getenv("MARKET_LAB_SENTIMENT_CACHE_TTL_MINUTES", "45")))
        self.timeout_seconds = timeout_seconds or float(os.getenv("MARKET_LAB_SENTIMENT_TIMEOUT_SECONDS", "2.5"))
        self.request_get = request_get or requests.get

    def fetch(self, symbol: str) -> SentimentSnapshot:
        normalized = _safe_symbol(symbol)
        if os.getenv("MARKET_LAB_SENTIMENT_ENABLED", "1").strip().lower() in {"0", "false", "no"}:
            return SentimentSnapshot(
                status="missing",
                missing_sources=list(SOURCES),
                notes=["sentiment fetching disabled by MARKET_LAB_SENTIMENT_ENABLED"],
            )

        results = [
            self.fetch_yahoo_news(normalized),
            self.fetch_stocktwits(normalized),
            self.fetch_reddit(normalized),
        ]
        available = [item for item in results if item.status == "available"]
        errors = [item for item in results if item.status in {"error", "rate_limited"}]
        missing = [item.source for item in results if item.status != "available"]
        if available and errors:
            status = "partial"
        elif available:
            status = "available"
        elif errors:
            status = "error"
        else:
            status = "missing"
        return SentimentSnapshot(
            status=status,
            sources=results,
            missing_sources=missing,
            notes=["X/Twitter is deferred in V2."],
        )

    def fetch_yahoo_news(self, symbol: str) -> SentimentSourceResult:
        # yfinance is optional; keep the runtime dependency-free if it is absent.
        try:
            import yfinance as yf  # type: ignore[import-not-found]

            news = yf.Ticker(symbol).get_news(count=5)
            if news:
                summary = "; ".join(str(item.get("title") or item.get("content", {}).get("title") or "") for item in news[:5])
                raw_path = self._write_raw(symbol, "yahoo_finance_news", {"items": news})
                return SentimentSourceResult(
                    source="yahoo_finance_news",
                    status="available",
                    fetched_at=_utc_now(),
                    sample_count=len(news),
                    fetch_method="yfinance.Ticker.get_news",
                    summary=summary[:500],
                    raw_artifact_path=str(raw_path),
                )
        except Exception:
            pass

        url = f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={symbol}&region=US&lang=en-US"
        return self._fetch_rss(symbol, "yahoo_finance_news", url, "yahoo_finance_rss")

    def fetch_stocktwits(self, symbol: str) -> SentimentSourceResult:
        url = f"https://api.stocktwits.com/api/2/streams/symbol/{symbol}.json"
        cached = self._read_cached(symbol, "stocktwits", url)
        if cached:
            return cached
        try:
            response = self.request_get(url, timeout=self.timeout_seconds, headers={"accept": "application/json"})
            if response.status_code == 429:
                return self._result("stocktwits", "rate_limited", "stocktwits_public_stream", url, error="HTTP 429")
            if response.status_code >= 400:
                return self._result("stocktwits", "error", "stocktwits_public_stream", url, error=f"HTTP {response.status_code}")
            content_type = str(getattr(response, "headers", {}).get("content-type", "")).lower()
            text = str(getattr(response, "text", "") or "")
            if "json" not in content_type and not text.lstrip().startswith(("{", "[")):
                return self._result(
                    "stocktwits",
                    "error",
                    "stocktwits_public_stream",
                    url,
                    error="StockTwits returned a non-JSON response; public stream may be blocked or temporarily unavailable.",
                )
            try:
                payload = response.json()
            except Exception:
                return self._result(
                    "stocktwits",
                    "error",
                    "stocktwits_public_stream",
                    url,
                    error="StockTwits returned malformed JSON; public stream may be blocked or temporarily unavailable.",
                )
            messages = payload.get("messages") if isinstance(payload, dict) else None
            if not isinstance(messages, list) or not messages:
                return self._result("stocktwits", "empty", "stocktwits_public_stream", url, sample_count=0)
            samples = []
            for item in messages[:10]:
                if not isinstance(item, dict):
                    continue
                body = str(item.get("body") or "").strip()
                sentiment = item.get("entities", {}).get("sentiment") if isinstance(item.get("entities"), dict) else None
                sentiment_label = sentiment.get("basic") if isinstance(sentiment, dict) else None
                samples.append(f"{sentiment_label or 'unlabeled'}: {body}")
            raw_path = self._write_raw(symbol, "stocktwits", payload)
            result = SentimentSourceResult(
                source="stocktwits",
                status="available",
                fetched_at=_utc_now(),
                sample_count=len(messages),
                fetch_method="stocktwits_public_stream",
                request_url=url,
                summary="; ".join(samples)[:500],
                raw_artifact_path=str(raw_path),
            )
            self._write_cached(symbol, "stocktwits", url, result)
            return result
        except Exception as exc:
            return self._result("stocktwits", "error", "stocktwits_public_stream", url, error=str(exc))

    def fetch_reddit(self, symbol: str) -> SentimentSourceResult:
        query = f"{symbol} stock"
        url = (
            "https://www.reddit.com/r/stocks/search.rss?"
            f"q={query.replace(' ', '+')}&restrict_sr=1&sort=new&t=week"
        )
        return self._fetch_rss(symbol, "reddit", url, "reddit_rss_search")

    def _fetch_rss(
        self,
        symbol: str,
        source: str,
        url: str,
        fetch_method: str,
    ) -> SentimentSourceResult:
        cached = self._read_cached(symbol, source, url)
        if cached:
            return cached
        try:
            response = self.request_get(url, timeout=self.timeout_seconds, headers={"user-agent": "market-lab/0.1"})
            if response.status_code == 429:
                return self._result(source, "rate_limited", fetch_method, url, error="HTTP 429")
            if response.status_code >= 400:
                return self._result(source, "error", fetch_method, url, error=f"HTTP {response.status_code}")
            root = ET.fromstring(response.text)
            titles = [node.text.strip() for node in root.findall(".//item/title") if node.text and node.text.strip()]
            if not titles:
                titles = [node.text.strip() for node in root.findall(".//{http://www.w3.org/2005/Atom}entry/{http://www.w3.org/2005/Atom}title") if node.text and node.text.strip()]
            if not titles:
                return self._result(source, "empty", fetch_method, url, sample_count=0)
            raw_path = self._write_raw(symbol, source, {"rss": response.text[:20_000]})
            result = SentimentSourceResult(
                source=source,  # type: ignore[arg-type]
                status="available",
                fetched_at=_utc_now(),
                sample_count=len(titles),
                fetch_method=fetch_method,
                request_url=url,
                summary="; ".join(titles[:10])[:500],
                raw_artifact_path=str(raw_path),
            )
            self._write_cached(symbol, source, url, result)
            return result
        except Exception as exc:
            return self._result(source, "error", fetch_method, url, error=str(exc))

    def _result(
        self,
        source: str,
        status: str,
        fetch_method: str,
        request_url: str | None,
        *,
        sample_count: int = 0,
        error: str | None = None,
    ) -> SentimentSourceResult:
        return SentimentSourceResult(
            source=source,  # type: ignore[arg-type]
            status=status,  # type: ignore[arg-type]
            fetched_at=_utc_now(),
            sample_count=sample_count,
            fetch_method=fetch_method,
            request_url=request_url,
            error_message=error,
        )

    def _cache_path(self, symbol: str, source: str, url: str) -> Path:
        return self.cache_dir / symbol / source / f"{_cache_key(url)}.json"

    def _raw_path(self, symbol: str, source: str) -> Path:
        stamp = _utc_now().strftime("%Y%m%dT%H%M%SZ")
        return self.cache_dir / symbol / source / f"{stamp}-raw.json"

    def _read_cached(self, symbol: str, source: str, url: str) -> SentimentSourceResult | None:
        path = self._cache_path(symbol, source, url)
        if not path.exists():
            return None
        if _utc_now() - datetime.fromtimestamp(path.stat().st_mtime, tz=UTC) > self.ttl:
            return None
        try:
            return SentimentSourceResult.model_validate(json.loads(path.read_text(encoding="utf-8")))
        except Exception:
            return None

    def _write_cached(self, symbol: str, source: str, url: str, result: SentimentSourceResult) -> None:
        path = self._cache_path(symbol, source, url)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(result.model_dump_json(indent=2), encoding="utf-8")

    def _write_raw(self, symbol: str, source: str, payload: dict[str, Any]) -> Path:
        path = self._raw_path(symbol, source)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
        return path
