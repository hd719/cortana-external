# Technical Specification - Market Lab V4 Portfolio Intelligence

**Document Status:** Implemented in PR #346
**PRD:** [v4-portfolio-intelligence.md](../PRDs/v4-portfolio-intelligence.md)

## Development Overview

V4 adds read-only portfolio context to Market Lab reviews. It must not introduce broker execution or position-changing APIs.

Schwab Trader API is the first live portfolio source. Manual/local snapshots remain the fallback.

## New Module

Add:

```text
market_lab/market_lab/portfolio_context.py
market_lab/market_lab/schwab_portfolio.py
```

## Data Model

Add to `market_lab/market_lab/models.py`:

```python
class PortfolioPosition(Model):
    account_hash: str | None = None
    symbol: str
    asset_type: str | None = None
    quantity: float | None = None
    average_price: float | None = None
    current_price: float | None = None
    cost_basis: float | None = None
    unrealized_pnl: float | None = None
    market_value: float | None = None
    weight_pct: float | None = None
    sector: str | None = None
    themes: list[str] = Field(default_factory=list)

class PortfolioAccount(Model):
    account_hash: str
    display_name: str | None = None
    account_type: str | None = None
    cash_value: float | None = None
    liquidation_value: float | None = None

class PortfolioContext(Model):
    status: Literal["available", "unavailable", "reauth_required", "error"]
    source: str
    generated_at: str
    accounts: list[PortfolioAccount] = Field(default_factory=list)
    positions: list[PortfolioPosition] = Field(default_factory=list)
    exposure_notes: list[str] = Field(default_factory=list)
    overlap_notes: list[str] = Field(default_factory=list)
```

Extend `ReviewArtifact` with optional `portfolio_context`.

## Schwab Read-Only Adapter

`schwab_portfolio.py` should wrap only read endpoints:

```text
GET /trader/v1/accounts/accountNumbers
GET /trader/v1/accounts?fields=positions
GET /trader/v1/accounts/{accountNumber}?fields=positions
```

The adapter may reuse the existing Schwab OAuth token cache if the token is authorized for Trader account access. If Schwab returns `401` or `403`, return a `PortfolioContext` with `status="reauth_required"` and an operator-facing message.

Do not add methods for:

```text
POST /trader/v1/accounts/{accountNumber}/orders
PUT /trader/v1/accounts/{accountNumber}/orders/{orderId}
DELETE /trader/v1/accounts/{accountNumber}/orders/{orderId}
POST /trader/v1/accounts/{accountNumber}/previewOrder
```

## Adapter Boundary

The adapter may read from configured local files or read-only service endpoints. It must not expose submit/cancel/order methods.

## Cache

Persist the latest normalized snapshot:

```text
.cache/market_lab/portfolio/schwab-portfolio-latest.json
```

Optional raw responses may be stored under:

```text
.cache/market_lab/portfolio/raw/
```

Raw account numbers must never be written. Account hashes and user-friendly labels are allowed.

## Mission Control API

Add read-only portfolio routes:

```text
POST /api/market-lab/portfolio/refresh
GET /api/market-lab/portfolio/latest
```

`refresh` may trigger Schwab import. It must not place, preview, replace, or cancel orders.

## Mission Control

Render:

- portfolio context status
- current position if symbol is owned
- concentration/overlap notes
- unavailable state

## Risks

| Risk | Mitigation |
|------|------------|
| Execution leaks into review code | Adapter interface has read methods only. |
| Account token lacks portfolio permission | Return `reauth_required` and keep review running. |
| Raw account numbers leak into artifacts | Persist hashes/display labels only. |
| Portfolio unavailable blocks reviews | Treat as missing context, not blocker. |
| UI becomes noisy | Collapse detailed holdings by default. |
