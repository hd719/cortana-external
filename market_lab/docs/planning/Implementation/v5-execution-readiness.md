# Implementation Plan - Market Lab V5 Execution Readiness

**Document Status:** Draft
**PRD:** [v5-execution-readiness.md](../PRDs/v5-execution-readiness.md)
**Tech Spec:** [v5-execution-readiness.md](../TechSpecs/v5-execution-readiness.md)

## Dependency Map

| Vertical | Dependencies | Outcome |
|----------|--------------|---------|
| V1 - Intent Model | V4 portfolio context | Draft execution intent can be represented. |
| V2 - Approval Gate | V1 | Intents can be approved/rejected. |
| V3 - Broker Boundary | V2 | Adapter validates and previews only approved intents. |
| V4 - Mission Control | V1-V3 | Operator can inspect intent state. |
| V5 - QA | All | Safety boundary is verified. |

## Verticals

### V1 - Intent Model

Files:

- `market_lab/market_lab/models.py`
- `market_lab/market_lab/execution_intents.py`

Tasks:

- Add `ExecutionIntent`.
- Persist draft intents.
- Link to source review and evidence artifact.

### V2 - Approval Gate

Files:

- `market_lab/market_lab/approvals.py`

Tasks:

- Approve/reject intents.
- Store operator, timestamp, and note.
- Expire stale intents.

### V3 - Broker Boundary

Files:

- `market_lab/market_lab/broker_adapter.py`

Tasks:

- Define adapter interface.
- Reject non-approved or expired intents.
- Add `validateIntent(intent) -> valid / blocked / needs_refresh`.
- Add `previewOrder(intent) -> preview only`.
- Add preview expiry and price-drift rules.
- Keep implementation stubbed until broker choice is explicit.

### V4 - Mission Control

Files:

- `apps/mission-control/lib/market-lab.ts`
- `apps/mission-control/app/services/tabs/trading-ops-tab.tsx`

Tasks:

- Render intent status.
- Show approval history.
- Show validation and preview status.
- Require final confirmation after fresh preview.
- Do not add one-click execution without approval.

### V5 - QA

Commands:

```bash
uv run --project market_lab pytest market_lab/tests
cd apps/mission-control && pnpm build
```
