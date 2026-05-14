# QA Plan - Market Lab V6 Data Environment Separation

**Document Status:** Implemented
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
| API | `GET /api/market-lab/environments` | Prod and dev health are reported. |
| UI | Non-prod environment enabled | Environment badge is visible. |
| UI | Production Mission Control | Shows prod and dev environment health. |
| Launchd | Restart prod | `3000` is healthy with `MARKET_LAB_ENV=prod`. |
| Launchd | Restart dev | `3002` is healthy with `MARKET_LAB_ENV=dev`. |
| Launchd | Restart dev | Prod process on `3000` is not killed. |
| Launchd | Restart prod | Dev process on `3002` is not killed. |
| Reset | Reset test env | Test data is removed without touching prod. |
| Reset | Reset prod env without confirmation | Command is rejected. |

## Commands

```bash
MARKET_LAB_ENV=ci uv run --project market_lab pytest market_lab/tests
MARKET_LAB_ENV=test uv run --project market_lab python -m market_lab.cli run AAPL --json
MARKET_LAB_ENV=test uv run --project market_lab python -m market_lab.cli settle-due --json
./apps/mission-control/scripts/restart-mission-control.sh --env prod --skip-build
./apps/mission-control/scripts/restart-mission-control.sh --env dev --skip-build
curl -fsS http://127.0.0.1:3000/api/heartbeat-status
curl -fsS http://127.0.0.1:3002/api/heartbeat-status
curl -fsS http://127.0.0.1:3000/api/market-lab/environments
cd apps/mission-control && pnpm build
```

## Verified In PR

- `MARKET_LAB_ENV=ci uv run --project market_lab pytest market_lab/tests`
- `cd apps/mission-control && pnpm test -- app/market-lab/market-lab-client.test.tsx lib/market-lab.test.ts lib/launch-agent.test.ts`
- `cd apps/mission-control && pnpm build`
- `bash -n apps/mission-control/scripts/restart-mission-control.sh`
- `bash -n market_lab/scripts/settle-due.sh`
- `plutil -lint market_lab/launchd/com.cortana.market-lab-settle-due.plist`
- CLI env smoke checks for `list`, missing env rejection, and `reset-env`.

## Manual Smoke

1. Clear only the test environment.
2. Run `AAPL` in `test`.
3. Run `MSFT` in `prod`.
4. Restart production Mission Control with `--env prod`.
5. Restart development Mission Control with `--env dev`.
6. Open `http://127.0.0.1:3000/trading-ops`.
7. Confirm production shows `prod` as current.
8. Confirm production shows both prod and dev health.
9. Open `http://127.0.0.1:3002/trading-ops`.
10. Confirm development shows `dev` as current.
11. Confirm only the production run appears in production Run Tape.
12. Confirm the test/dev run appears only in the matching non-prod view.
13. Run `settle-due --env test`.
14. Confirm no monitor alert is sent.
15. Run `settle-due --env prod`.
16. Confirm only production settlement memory changes.

Expected:

- No test data appears in production views.
- No test data affects production learning.
- No test data triggers production monitor alerts.
- Prod and dev Mission Control can run at the same time.
- Production Mission Control shows both environment healths.
- Production data cannot be reset accidentally.
