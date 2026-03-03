"""X/Twitter sentiment analyzer using bird CLI."""

from __future__ import annotations

import json
import subprocess
import time
from typing import Dict, List, TypedDict


class SentimentResult(TypedDict):
    ticker: str
    sentiment: str
    bearish_pct: float
    bullish_pct: float
    neutral_pct: float
    tweet_count: int
    sample_tweets: List[str]


class XSentimentAnalyzer:
    BEARISH_KEYWORDS = {
        "crash", "dump", "sell", "overvalued", "bubble", "puts", "short", "tank",
        "plunge", "disaster", "avoid", "terrible", "dead", "rip", "bag", "exit", "collapsing",
    }
    BULLISH_KEYWORDS = {
        "buy", "calls", "long", "undervalued", "discount", "opportunity", "moon", "breakout",
        "accumulate", "bullish", "dip", "steal", "load", "cheap",
    }

    def __init__(self, cache_ttl_seconds: int = 1800, rate_limit_seconds: float = 2.0):
        self.cache_ttl_seconds = cache_ttl_seconds
        self.rate_limit_seconds = rate_limit_seconds
        self._cache: Dict[str, tuple[float, SentimentResult]] = {}
        self._last_request_ts = 0.0

    def _default_result(self, ticker: str) -> SentimentResult:
        return {
            "ticker": ticker,
            "sentiment": "UNAVAILABLE",
            "bearish_pct": 0.0,
            "bullish_pct": 0.0,
            "neutral_pct": 0.0,
            "tweet_count": 0,
            "sample_tweets": [],
        }

    @staticmethod
    def _tweet_text(item: object) -> str:
        if not isinstance(item, dict):
            return ""

        text = item.get("text")
        if isinstance(text, str) and text.strip():
            return text.strip()

        legacy = item.get("legacy")
        if isinstance(legacy, dict):
            legacy_text = legacy.get("full_text") or legacy.get("text")
            if isinstance(legacy_text, str) and legacy_text.strip():
                return legacy_text.strip()

        tweet = item.get("tweet")
        if isinstance(tweet, dict):
            nested_text = tweet.get("text")
            if isinstance(nested_text, str) and nested_text.strip():
                return nested_text.strip()

        return ""

    def _extract_texts(self, payload: object) -> List[str]:
        items: List[object]
        if isinstance(payload, list):
            items = payload
        elif isinstance(payload, dict):
            if isinstance(payload.get("tweets"), list):
                items = payload["tweets"]
            elif isinstance(payload.get("data"), list):
                items = payload["data"]
            else:
                items = [payload]
        else:
            items = []

        texts: List[str] = []
        for item in items:
            text = self._tweet_text(item)
            if text:
                texts.append(text)
        return texts

    def _score_tweet(self, text: str) -> int:
        tokens = set(text.lower().split())
        bearish_hits = len(tokens.intersection(self.BEARISH_KEYWORDS))
        bullish_hits = len(tokens.intersection(self.BULLISH_KEYWORDS))

        if bearish_hits > bullish_hits:
            return -1
        if bullish_hits > bearish_hits:
            return 1
        return 0

    @staticmethod
    def _overall_label(bearish_pct: float, bullish_pct: float) -> str:
        if bearish_pct > 60:
            return "VERY_BEARISH"
        if bearish_pct > 40:
            return "BEARISH"
        if bullish_pct > 60:
            return "VERY_BULLISH"
        if bullish_pct > 40:
            return "BULLISH"
        return "NEUTRAL"

    def _relevant_samples(self, tweets: List[str]) -> List[str]:
        scored = []
        for text in tweets:
            tokens = set(text.lower().split())
            relevance = len(tokens.intersection(self.BEARISH_KEYWORDS | self.BULLISH_KEYWORDS))
            scored.append((relevance, text))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [text for _, text in scored[:3]]

    def _run_bird_search(self, ticker: str) -> str:
        # Required command format per integration contract.
        cmd_limit = ["bird", "search", f"${ticker}", "--limit", "20", "--json", "--plain"]
        try:
            proc = subprocess.run(cmd_limit, capture_output=True, text=True, check=True)
            return proc.stdout
        except Exception:
            # Compatibility fallback for bird versions using --count.
            cmd_count = ["bird", "search", f"${ticker}", "--count", "20", "--json", "--plain"]
            proc = subprocess.run(cmd_count, capture_output=True, text=True, check=True)
            return proc.stdout

    def analyze(self, ticker: str) -> SentimentResult:
        symbol = ticker.upper().strip()
        now = time.time()

        cached = self._cache.get(symbol)
        if cached and (now - cached[0] <= self.cache_ttl_seconds):
            return cached[1]

        wait = self.rate_limit_seconds - (now - self._last_request_ts)
        if wait > 0:
            time.sleep(wait)

        try:
            output = self._run_bird_search(symbol)
            payload = json.loads(output)
            tweets = self._extract_texts(payload)
        except Exception:
            self._last_request_ts = time.time()
            return self._default_result(symbol)

        self._last_request_ts = time.time()

        if not tweets:
            result: SentimentResult = {
                "ticker": symbol,
                "sentiment": "NEUTRAL",
                "bearish_pct": 0.0,
                "bullish_pct": 0.0,
                "neutral_pct": 100.0,
                "tweet_count": 0,
                "sample_tweets": [],
            }
            self._cache[symbol] = (time.time(), result)
            return result

        scores = [self._score_tweet(t) for t in tweets]
        total = len(scores)
        bearish_count = sum(1 for s in scores if s < 0)
        bullish_count = sum(1 for s in scores if s > 0)
        neutral_count = total - bearish_count - bullish_count

        bearish_pct = round((bearish_count / total) * 100, 1)
        bullish_pct = round((bullish_count / total) * 100, 1)
        neutral_pct = round((neutral_count / total) * 100, 1)

        result = {
            "ticker": symbol,
            "sentiment": self._overall_label(bearish_pct, bullish_pct),
            "bearish_pct": bearish_pct,
            "bullish_pct": bullish_pct,
            "neutral_pct": neutral_pct,
            "tweet_count": total,
            "sample_tweets": self._relevant_samples(tweets),
        }

        self._cache[symbol] = (time.time(), result)
        return result
