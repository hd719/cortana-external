from __future__ import annotations

import json

from market_lab.sentiment_sources import SentimentSourceClient


class FakeResponse:
    def __init__(self, status_code: int, payload: object | None = None, text: str = "", headers: dict[str, str] | None = None):
        self.status_code = status_code
        self._payload = payload
        self.text = text
        self.headers = headers or {"content-type": "application/json"}

    def json(self):
        return self._payload


def test_stocktwits_429_maps_to_rate_limited(tmp_path):
    client = SentimentSourceClient(cache_dir=tmp_path, request_get=lambda *args, **kwargs: FakeResponse(429, {}))

    result = client.fetch_stocktwits("AAPL")

    assert result.status == "rate_limited"
    assert result.source == "stocktwits"


def test_stocktwits_available_writes_cache_and_reuses_it(tmp_path):
    calls = 0

    def fake_get(*args, **kwargs):
        nonlocal calls
        calls += 1
        return FakeResponse(
            200,
            {"messages": [{"body": "looks strong", "entities": {"sentiment": {"basic": "Bullish"}}}]},
        )

    client = SentimentSourceClient(cache_dir=tmp_path, request_get=fake_get)
    first = client.fetch_stocktwits("AAPL")
    second = client.fetch_stocktwits("AAPL")

    assert first.status == "available"
    assert first.samples == ["Bullish: looks strong"]
    assert second.status == "available"
    assert calls == 1
    assert json.loads((tmp_path / "AAPL" / "stocktwits").glob("*.json").__next__().read_text())


def test_stocktwits_sends_operator_readable_user_agent(tmp_path):
    def fake_get(*args, **kwargs):
        assert kwargs["headers"]["user-agent"] == "market-lab/0.1"
        return FakeResponse(200, {"messages": [{"body": "breakout watch", "entities": {"sentiment": {"basic": "Bullish"}}}]})

    client = SentimentSourceClient(cache_dir=tmp_path, request_get=fake_get)

    result = client.fetch_stocktwits("AAPL")

    assert result.status == "available"


def test_stocktwits_non_json_response_is_operator_readable(tmp_path):
    client = SentimentSourceClient(
        cache_dir=tmp_path,
        request_get=lambda *args, **kwargs: FakeResponse(
            200,
            text="<html>blocked</html>",
            headers={"content-type": "text/html"},
        ),
    )

    result = client.fetch_stocktwits("AAPL")

    assert result.status == "error"
    assert result.error_message
    assert "non-JSON response" in result.error_message
