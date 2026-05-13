# QA Plan - Market Lab V6 Data Environment Separation

**Document Status:** Proposed
**PRD:** [v6-data-environment-separation.md](../PRDs/v6-data-environment-separation.md)
**Tech Spec:** [v6-data-environment-separation.md](../TechSpecs/v6-data-environment-separation.md)
**Implementation Plan:** [v6-data-environment-separation.md](../Implementation/v6-data-environment-separation.md)

## QA Goal

Prove that production Market Lab data cannot be polluted by test, dev, or CI runs.

## Automated Matrix

| Area | Scenario | Expected Result |
|------|----------|-----------------|
| Config | `MARKET_LAB_ENV=prod` | Production root is selected. |
| Config | `MARKET_LAB_ENV=ci` | Fixture-only mode is enforced. |
| Stores | Test run is created | Artifact lands under `.cache/market_lab/test`. |
| Stores | Production run is created | Artifact lands under `.cache/market_lab/prod`. |
| SQLite | Test run persists | Test SQLite receives the row; prod SQLite does not. |
| Artifacts | Review artifact written | Environment metadata is present. |
| Settlement | `settle-due --env prod` | Only production runs are considered. |
| Settlement | `settle-due --env test` | Test results do not update production memory. |
| Alerts | Test run settles | Monitor alert is blocked by default. |
| API | Production response | Non-production data is absent by default. |
| UI | Non-prod environment enabled | Environment badge is visible. |
| Reset | Reset test env | Test data is removed without touching prod. |
| Reset | Reset prod env without confirmation | Command is rejected. |

## Commands

```bash
MARKET_LAB_ENV=ci uv run --project market_lab pytest market_lab/tests
MARKET_LAB_ENV=test uv run --project market_lab python -m market_lab.cli run AAPL --json
MARKET_LAB_ENV=test uv run --project market_lab python -m market_lab.cli settle-due --json
cd apps/mission-control && pnpm build
```

## Manual Smoke

1. Clear only the test environment.
2. Run `AAPL` in `test`.
3. Run `MSFT` in `prod`.
4. Open Mission Control production Market Lab.
5. Confirm only the production run appears.
6. Switch to test mode if enabled.
7. Confirm the test run appears with a non-prod badge.
8. Run `settle-due --env test`.
9. Confirm no monitor alert is sent.
10. Run `settle-due --env prod`.
11. Confirm only production settlement memory changes.

Expected:

- No test data appears in production views.
- No test data affects production learning.
- No test data triggers production monitor alerts.
- Production data cannot be reset accidentally.
