# QA Plan - Market Lab V5 Execution Readiness

**Document Status:** Draft
**PRD:** [v5-execution-readiness.md](../PRDs/v5-execution-readiness.md)
**Tech Spec:** [v5-execution-readiness.md](../TechSpecs/v5-execution-readiness.md)
**Implementation Plan:** [v5-execution-readiness.md](../Implementation/v5-execution-readiness.md)

## QA Goal

Prove that execution readiness is supervised, audited, and isolated from review logic.

## Automated Matrix

| Area | Scenario | Expected Result |
|------|----------|-----------------|
| Intent | Draft intent created | Links to source review and evidence. |
| Approval | Intent approved | Operator/timestamp/note persist. |
| Approval | Intent rejected | Broker adapter cannot submit it. |
| Expiration | Intent is stale | Intent expires. |
| Broker Boundary | Unapproved intent submitted | Adapter rejects it. |
| Broker Boundary | Approved intent validated | Adapter returns `valid`, `blocked`, or `needs_refresh`. |
| Preview | Valid intent previewed | Preview includes quote timestamp and expiry. |
| Preview | Preview expired | Adapter returns `needs_refresh`. |
| Preview | Price moves beyond slippage | Adapter returns `needs_refresh`. |
| Imports | Review modules inspected | No broker client imports. |
| UI | Intent exists | Status and audit trail render. |

## Commands

```bash
uv run --project market_lab pytest market_lab/tests
cd apps/mission-control && pnpm build
```

## Manual Smoke

1. Create a draft intent from a review fixture.
2. Reject it.
3. Try to submit it through the adapter.
4. Approve a fresh fixture intent.
5. Validate it through the adapter.
6. Generate a preview fixture.
7. Confirm Mission Control shows the audit trail and preview expiry.

Expected:

- Rejected intent cannot submit.
- Approved intent can be validated and previewed.
- Expired preview requires refresh.
- No actual broker call is made unless explicitly configured later.
