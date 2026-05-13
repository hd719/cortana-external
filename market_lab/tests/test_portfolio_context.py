from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from market_lab.portfolio_context import PortfolioContextService
from market_lab.schwab_portfolio import SchwabPortfolioClient, normalize_schwab_portfolio


def test_schwab_portfolio_normalizes_positions_without_raw_order_calls():
    context = normalize_schwab_portfolio(
        [{"hashValue": "hash-1", "accountNumber": "1234"}],
        [
            {
                "securitiesAccount": {
                    "accountNumber": "hash-1",
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
