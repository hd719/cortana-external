from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from market_lab.models import PortfolioAccount, PortfolioContext, PortfolioPosition
from market_lab.portfolio_context import PortfolioContextService
from market_lab.schwab_portfolio import SchwabPortfolioClient, normalize_schwab_portfolio


def test_schwab_portfolio_normalizes_positions_without_raw_order_calls():
    context = normalize_schwab_portfolio(
        [{"hashValue": "hash-1", "accountNumber": "1234"}],
        [
            {
                "securitiesAccount": {
                    "accountNumber": "1234",
                    "type": "MARGIN",
                    "currentBalances": {"liquidationValue": 1000, "cashBalance": 100},
                    "positions": [
                        {
                            "longQuantity": 2,
                            "marketValue": 300,
                            "instrument": {"symbol": "aapl", "assetType": "EQUITY"},
                        }
                    ],
                }
            }
        ],
    )

    assert context.status == "available"
    assert context.accounts[0].account_hash == "hash-1"
    assert context.positions[0].symbol == "AAPL"
    assert context.positions[0].account_hash == "hash-1"
    assert context.positions[0].current_price == 150
    assert context.positions[0].weight_pct == 30


def test_portfolio_context_unavailable_without_cache(tmp_path):
    context = PortfolioContextService(cache_dir=tmp_path).latest()

    assert context.status == "unavailable"


def test_schwab_portfolio_prefers_fresh_accounts_trading_token(tmp_path):
    expired = tmp_path / "schwab-token.json"
    fresh = tmp_path / "schwab-streamer-token.json"
    expired.write_text(json.dumps({"accessToken": "market-data-token", "expiresAt": 1}), encoding="utf-8")
    fresh.write_text(
        json.dumps({"accessToken": "accounts-trading-token", "expiresAt": int((datetime.now(UTC) + timedelta(minutes=5)).timestamp() * 1000)}),
        encoding="utf-8",
    )

    client = SchwabPortfolioClient(token_path=expired)
    client.token_paths = [expired, fresh]

    assert client._access_token() == "accounts-trading-token"


def test_schwab_portfolio_refreshes_expired_accounts_trading_token(tmp_path, monkeypatch):
    token_path = tmp_path / "schwab-streamer-token.json"
    token_path.write_text(json.dumps({"accessToken": "expired", "expiresAt": 1, "refreshToken": "refresh-1"}), encoding="utf-8")
    monkeypatch.setenv("SCHWAB_CLIENT_STREAMER_ID", "client-id")
    monkeypatch.setenv("SCHWAB_CLIENT_STREAMER_SECRET", "client-secret")

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"access_token": "fresh-token", "expires_in": 1800, "refresh_token": "refresh-2"}

    def fake_post(url, **kwargs):
        assert url == "https://api.schwabapi.com/v1/oauth/token"
        assert kwargs["data"]["grant_type"] == "refresh_token"
        assert kwargs["data"]["refresh_token"] == "refresh-1"
        return FakeResponse()

    client = SchwabPortfolioClient(token_path=token_path, request_post=fake_post)

    assert client._access_token() == "fresh-token"
    cached = json.loads(token_path.read_text(encoding="utf-8"))
    assert cached["accessToken"] == "fresh-token"
    assert cached["refreshToken"] == "refresh-2"


def test_portfolio_refresh_enriches_positions_with_batch_quote_changes(tmp_path):
    class FakeSchwab:
        def fetch_context(self):
            return PortfolioContext(
                status="available",
                source="schwab",
                generated_at=datetime.now(UTC),
                accounts=[PortfolioAccount(account_hash="hash-1", liquidation_value=1000, cash_value=100)],
                positions=[
                    PortfolioPosition(
                        account_hash="hash-1",
                        symbol="AAPL",
                        quantity=2,
                        average_price=100,
                        current_price=150,
                        market_value=300,
                    )
                ],
            )

    class FakeMarketData:
        def get_quote_batch(self, symbols):
            assert symbols == ["AAPL"]
            return {
                "AAPL": {
                    "source": "schwab_streamer",
                    "status": "ok",
                    "data": {
                        "symbol": "AAPL",
                        "price": 155,
                        "change": 5,
                        "changePercent": 3.33,
                        "timestamp": "2026-05-13T17:00:00Z",
                    },
                }
            }

    context = PortfolioContextService(cache_dir=tmp_path, schwab=FakeSchwab(), market_data=FakeMarketData()).refresh()

    position = context.positions[0]
    assert position.current_price == 155
    assert position.market_value == 310
    assert position.day_change == 5
    assert position.day_change_pct == 3.33
    assert position.quote_source == "schwab_streamer"
    assert position.quote_status == "ok"


def test_portfolio_refresh_preserves_cached_snapshot_when_schwab_refresh_fails(tmp_path):
    cached = PortfolioContext(
        status="available",
        source="schwab",
        generated_at=datetime.now(UTC),
        accounts=[PortfolioAccount(account_hash="hash-1", liquidation_value=1000, cash_value=100)],
        positions=[PortfolioPosition(account_hash="hash-1", symbol="AAPL", quantity=2, market_value=300)],
    )
    latest_path = tmp_path / "schwab-portfolio-latest.json"
    latest_path.write_text(cached.model_dump_json(), encoding="utf-8")

    class FakeSchwab:
        def fetch_context(self):
            return PortfolioContext(
                status="reauth_required",
                source="schwab",
                generated_at=datetime.now(UTC),
                message="Schwab account endpoints returned 401/403.",
            )

    context = PortfolioContextService(cache_dir=tmp_path, schwab=FakeSchwab()).refresh()

    assert context.status == "available"
    assert context.positions[0].symbol == "AAPL"
    assert "Showing latest cached Schwab portfolio" in (context.message or "")
    persisted = PortfolioContext.model_validate(json.loads(latest_path.read_text(encoding="utf-8")))
    assert persisted.status == "available"
    assert persisted.positions[0].symbol == "AAPL"
