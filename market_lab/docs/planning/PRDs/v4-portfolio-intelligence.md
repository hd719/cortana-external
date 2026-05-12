# Market Lab V4 Portfolio Intelligence PRD

**Document Status:** Draft
**Owner:** Trading systems
**Last Updated:** 2026-05-13
**Depends On:** Market Lab V2 single-symbol intelligence, Market Lab V3 watchlists

## Problem / Opportunity

A stock can be interesting and still be a poor fit for the current portfolio. Portfolio intelligence should be separate from watchlists because it answers a different question.

Watchlists ask:

```text
What should I research next?
```

Portfolio intelligence asks:

```text
What do I already own, and how would this idea affect my exposure?
```

## Goals

- Add read-only portfolio context to Market Lab.
- Use Schwab Trader API account/position endpoints as the first portfolio source.
- Show holdings, exposure, concentration, and overlap when available.
- Keep all execution capability out of Market Lab review code.

## Non-Goals

- Broker execution.
- Paper trading.
- Automated rebalancing.
- Position sizing.
- Strategy code calling broker APIs directly.
- Order placement, preview, cancel, replace, or transaction-history import.

## Requirements

| Requirement | Description |
|-------------|-------------|
| Read-Only Adapter | Load portfolio context without execution methods. |
| Schwab Portfolio Import | Read linked account balances and positions from Schwab when authorized. |
| Account Safety | Store encrypted account hashes/display labels only; never persist raw account numbers. |
| Exposure Summary | Show current symbol/theme exposure when available. |
| Overlap Detection | Note when a reviewed symbol overlaps existing holdings. |
| Missing Safe | Portfolio context can be unavailable without blocking reviews. |
| Manual Fallback | Allow a local/manual portfolio snapshot if Schwab account access is unavailable. |
| UI Panel | Render portfolio context separately from evidence and watchlists. |

## Schwab Read-Only Source

The target Schwab flow is:

1. Reuse the existing Schwab OAuth/token plumbing where possible.
2. Call `GET /trader/v1/accounts/accountNumbers` to resolve account hashes.
3. Call `GET /trader/v1/accounts?fields=positions` for balances and positions.
4. Normalize holdings into a Market Lab portfolio snapshot.
5. Cache the latest snapshot under Market Lab cache.

This is read-only. V4 must not call or wrap Schwab order endpoints.

If Schwab returns `401` or `403`, Market Lab should report `reauth_required` instead of failing the review. That likely means the current token was authorized before account access was enabled or the Schwab app needs the Trader account-access product attached.

## What We Need Before Implementation

- Confirm the Schwab developer app has Trader API account access enabled.
- Confirm the current OAuth token can call account endpoints; otherwise re-auth through the existing Schwab OAuth flow.
- Decide whether V4 imports all linked accounts or one selected brokerage account. Default: all linked accounts, grouped by account label/hash.
- Decide how much account detail to display. Default: symbol, quantity, market value, weight, unrealized P/L if Schwab returns it.
- Add sector/theme enrichment later from market metadata; Schwab positions alone may not include that.

## Success Criteria

- Portfolio context unavailable state is safe and clear.
- Existing holdings render as read-only context.
- Review shows concentration/overlap notes.
- No execution-capable API is introduced.
- Schwab authorization failures produce `reauth_required`, not broken UI.
