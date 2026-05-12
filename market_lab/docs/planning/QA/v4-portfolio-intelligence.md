# QA Plan - Market Lab V4 Portfolio Intelligence

**Document Status:** Draft
**PRD:** [v4-portfolio-intelligence.md](../PRDs/v4-portfolio-intelligence.md)
**Tech Spec:** [v4-portfolio-intelligence.md](../TechSpecs/v4-portfolio-intelligence.md)
**Implementation Plan:** [v4-portfolio-intelligence.md](../Implementation/v4-portfolio-intelligence.md)

## QA Goal

Prove portfolio context is useful, read-only, and cannot execute trades.

## Automated Matrix

| Area | Scenario | Expected Result |
|------|----------|-----------------|
| Adapter | Context unavailable | Review continues. |
| Adapter | Context available | Positions parse. |
| Schwab | `401` / `403` from accounts API | Status is `reauth_required`; review continues. |
| Schwab | Account numbers response includes hashes | Hashes persist; raw account numbers do not. |
| Schwab | Positions response fixture | Balances and positions normalize into `PortfolioContext`. |
| Safety | Adapter inspected | No execution methods exist. |
| Safety | Schwab client inspected | No order, preview, replace, cancel endpoint is called. |
| Review | Symbol is owned | Overlap note appears. |
| Review | Symbol not owned | Context still renders. |
| UI | Context unavailable | Clear unavailable state. |
| UI | Context available | Exposure notes render. |
| UI | Reauth required | Operator sees clear re-auth message. |

## Commands

```bash
uv run --project market_lab pytest market_lab/tests
cd apps/mission-control && pnpm build
```

## Manual Smoke

1. Run a review with portfolio context unavailable.
2. Run a review with a Schwab fixture showing an owned symbol.
3. Run a portfolio refresh against a mocked Schwab `401`.
4. Open Market Lab.

Expected:

- Reviews do not fail when portfolio context is missing.
- Owned symbol context is visible.
- Schwab auth failures ask for re-auth instead of breaking the panel.
- No execution controls appear.

## Safety Checks

- Search implementation for `/orders`, `previewOrder`, `DELETE`, `PUT`, and broker submit verbs.
- Confirm only read-only Schwab account endpoints are used.
- Confirm raw account numbers are not present in cached artifacts.
