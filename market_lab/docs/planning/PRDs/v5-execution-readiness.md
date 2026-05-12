# Market Lab V5 Execution Readiness PRD

**Document Status:** Draft
**Owner:** Trading systems
**Last Updated:** 2026-05-13
**Depends On:** Market Lab V2, V3, and V4

## Problem / Opportunity

Market Lab is review-only. If it ever moves toward real execution candidates, that must happen behind explicit approval, policy, and broker boundaries. V5 defines that safety layer before any broker integration.

V5 is the permission layer, not the trading layer:

```text
Market Lab review
-> draft execution intent
-> operator approves or rejects
-> approved intent becomes eligible for broker adapter validation
-> broker adapter may preview at the current price
-> operator gives final confirmation
-> future execution layer may place an order
```

## Goals

- Define supervised execution-readiness artifacts.
- Require human approval before broker interaction.
- Define broker-adapter validation and preview checks for approved intents.
- Ensure review/watchlist/Codex modules cannot call broker APIs directly.
- Preserve an audit trail from evidence to approval.

## Non-Goals

- Fully autonomous trading.
- Paper trading.
- Direct broker calls from strategy/review code.
- Unapproved execution.
- Actual order placement, cancel, or replace.
- Position sizing without portfolio policy.

## Requirements

| Requirement | Description |
|-------------|-------------|
| Execution Intent | Create an artifact that references evidence, Codex review, portfolio context, and proposed action. |
| Approval Gate | Require explicit human approval before broker adapter receives anything. |
| Broker Boundary | Broker adapter accepts only approved intents. |
| Broker Validation | Broker adapter validates freshness, portfolio, price, duplicate-order, and account checks before preview. |
| Order Preview | Broker adapter can produce a time-limited preview at the current price without placing an order. |
| Final Confirmation | Operator must confirm the fresh preview before any future order placement path. |
| Audit Trail | Persist every step from review to approval to broker request. |
| Expiration | Intents expire if evidence becomes stale. |

## Accepted vs Rejected Flow

Rejected intents:

- never reach broker code
- preserve the rejection reason and operator timestamp
- remain linked to the source Market Lab review as history
- may be used later for learning/outcome analysis

Accepted intents:

- do not automatically trade
- become approved execution candidates
- must pass broker-adapter validation before preview
- must receive a fresh broker preview before final confirmation
- still expire if evidence, price, or portfolio context becomes stale

## Broker Adapter Validation And Preview

Validation belongs inside the broker adapter, not a separate service. The adapter should reject an approved intent unless all required checks pass:

- intent is approved
- intent is not expired
- source evidence is still fresh
- current price is available
- portfolio snapshot is current
- proposed action is allowed by policy
- proposed notional or quantity is within limits
- broker account is available
- no duplicate pending order exists

The adapter should return `valid`, `blocked`, or `needs_refresh`.

If validation is `valid`, the adapter may create an order preview. Preview is still not execution. It should include:

- current quote used
- quote timestamp
- estimated quantity or notional
- estimated cost
- warnings
- `preview_expires_at`
- `max_price_age_seconds`
- `max_slippage_pct`

If the preview expires or the price moves beyond the configured slippage limit, the adapter returns `needs_refresh` and requires a new preview.

## Success Criteria

- No review module imports broker clients.
- Broker adapter rejects unapproved intents.
- Broker adapter blocks stale, duplicate, or policy-invalid intents.
- Broker preview expires quickly and requires final confirmation.
- Expired/stale intents cannot execute.
- Mission Control shows approved/rejected/expired status.
