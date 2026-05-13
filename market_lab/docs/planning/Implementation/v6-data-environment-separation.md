# Implementation Plan - Market Lab V6 Data Environment Separation

**Document Status:** Proposed
**PRD:** [v6-data-environment-separation.md](../PRDs/v6-data-environment-separation.md)
**Tech Spec:** [v6-data-environment-separation.md](../TechSpecs/v6-data-environment-separation.md)

## Dependency Map

| Vertical | Dependencies | Outcome |
|----------|--------------|---------|
| V1 - Environment Config | Existing Market Lab config | One source of truth for env resolution. |
| V2 - Environment Stores | V1 | Separate cache/database roots. |
| V3 - Artifact Metadata | V1-V2 | Runs and settlements self-identify environment. |
| V4 - CLI/API Boundaries | V1-V3 | Commands and routes cannot mix prod/test data silently. |
| V5 - UI/Scheduler Safety | V1-V4 | Mission Control and scheduled jobs read/write the right env. |
| V6 - QA | All | Production and test data separation is proven. |

## Verticals

### V1 - Environment Config

Files:

- `market_lab/market_lab/config.py`
- `market_lab/market_lab/models.py`

Tasks:

- Add `MARKET_LAB_ENV`.
- Add config validation for `prod`, `test`, `ci`, and `dev`.
- Add explicit booleans for live data, Codex, and alerts in non-prod envs.

### V2 - Environment Stores

Files:

- `market_lab/market_lab/store.py`
- `market_lab/market_lab/repository.py`

Tasks:

- Resolve data paths under `.cache/market_lab/<env>/`.
- Use separate SQLite files per environment.
- Add compatibility read for legacy root paths.
- Ensure new writes never target the legacy root.

### V3 - Artifact Metadata

Files:

- `market_lab/market_lab/models.py`
- `market_lab/market_lab/review.py`
- `market_lab/market_lab/settlement.py`
- `market_lab/market_lab/opportunities.py`
- `market_lab/market_lab/portfolio.py`
- `market_lab/market_lab/execution_intents.py`

Tasks:

- Add environment metadata to persisted artifacts.
- Mark test/dev/CI artifacts with `is_test_data=true`.
- Ensure settlement memory excludes non-prod by default.

### V4 - CLI/API Boundaries

Files:

- `market_lab/market_lab/cli.py`
- `apps/mission-control/app/api/market-lab/**/route.ts`
- `apps/mission-control/lib/market-lab.ts`

Tasks:

- Add `--env` to Market Lab CLI commands.
- Include active environment in CLI/API output.
- Reject unsafe env mixing.
- Add `reset-env --env test` for disposable QA data.

### V5 - UI/Scheduler Safety

Files:

- `apps/mission-control/app/services/tabs/trading-ops-tab.tsx`
- `apps/mission-control/scripts/restart-mission-control.sh`
- scheduler or cron definitions that invoke Market Lab

Tasks:

- Show non-prod environment badge.
- Hide non-prod runs from production views.
- Pass `--env prod` in scheduled production jobs.
- Block monitor alerts for non-prod runs unless explicitly enabled.

### V6 - QA

Commands:

```bash
MARKET_LAB_ENV=ci uv run --project market_lab pytest market_lab/tests
cd apps/mission-control && pnpm build
```

Manual smoke:

- run one test review
- run one production review
- verify they land in separate roots
- verify production UI hides test data
- verify test settlement does not send monitor alerts
