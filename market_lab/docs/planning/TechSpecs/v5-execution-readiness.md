# Technical Specification - Market Lab V5 Execution Readiness

**Document Status:** Draft
**PRD:** [v5-execution-readiness.md](../PRDs/v5-execution-readiness.md)

## Development Overview

V5 introduces an execution-readiness boundary. It does not make Market Lab autonomous. It creates artifacts and approval gates that must exist before any broker adapter can receive a request.

It also defines broker adapter validation and preview. Validation decides whether an approved intent is eligible for a fresh order preview. Preview estimates the order at the current price, expires quickly, and still requires final confirmation. V5 must not place, replace, or cancel orders.

## Data Model

Add:

```python
class ExecutionIntent(Model):
    intent_id: str
    symbol: str
    created_at: str
    expires_at: str
    source_review_id: str
    evidence_snapshot_path: str
    portfolio_context_path: str | None = None
    proposed_action: Literal["buy", "sell", "hold"]
    proposed_notional: float | None = None
    status: Literal["draft", "approved", "rejected", "expired", "submitted"]
    approval: dict[str, Any] | None = None

class BrokerValidationResult(Model):
    intent_id: str
    checked_at: str
    status: Literal["valid", "blocked", "needs_refresh"]
    reasons: list[str] = Field(default_factory=list)
    evidence_fresh: bool
    price_fresh: bool
    portfolio_fresh: bool
    account_available: bool
    duplicate_order_detected: bool

class BrokerOrderPreview(Model):
    intent_id: str
    preview_id: str
    created_at: str
    expires_at: str
    symbol: str
    side: Literal["buy", "sell"]
    quote_price: float
    quote_as_of: str
    estimated_quantity: float | None = None
    estimated_notional: float | None = None
    estimated_cost: float | None = None
    max_price_age_seconds: int
    max_slippage_pct: float
    warnings: list[str] = Field(default_factory=list)
```

## Boundaries

- Review modules may create draft intents only.
- Approval module may approve/reject intents.
- Broker adapter may validate approved intents and return eligibility.
- Broker adapter may preview only valid, approved, unexpired intents.
- Broker adapter is the only module that can talk to broker APIs.

## Broker Adapter Validation

Validation checks:

- intent is approved
- intent is not expired
- source evidence is still fresh
- current price is available
- portfolio snapshot is current
- proposed action is allowed by policy
- proposed notional or quantity is within limits
- broker account is available
- no duplicate pending order exists

Validation output is an artifact, not an order request.

## Broker Adapter Preview

Preview checks:

- validation status is `valid`
- current quote age is within `max_price_age_seconds`
- estimated execution price is within `max_slippage_pct`
- preview receives a short `expires_at`
- final confirmation must reference the latest preview id

Recommended defaults:

```text
max_price_age_seconds = 15
preview_ttl_seconds = 60
max_slippage_pct = 0.25
```

If the preview expires or price moves outside the configured slippage bound, return `needs_refresh`.

## Mission Control

Render:

- draft intents
- approval state
- broker adapter validation state
- preview state and expiry
- expiration state
- audit trail

## Risks

| Risk | Mitigation |
|------|------------|
| Execution leaks into review path | Dependency checks and tests prevent broker imports. |
| Stale evidence executes | Intents expire and revalidate evidence freshness. |
| Approval uses an old price | Preview expires quickly and final confirmation must reference a fresh preview. |
| Approval is ambiguous | Require explicit operator identity/timestamp. |
