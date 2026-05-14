# Implementation Plan - Market Lab V6 Data Environment Separation

**Document Status:** Implemented
**PRD:** [v6-data-environment-separation.md](../PRDs/v6-data-environment-separation.md)
**Tech Spec:** [v6-data-environment-separation.md](../TechSpecs/v6-data-environment-separation.md)

## Dependency Map

| Phase | Dependencies | Outcome |
|-------|--------------|---------|
| 1 - Environment Config | Existing Market Lab config | One source of truth for env resolution. |
| 2 - Environment Stores | Phase 1 | Separate cache/database roots. |
| 3 - Artifact Metadata | Phase 1-2 | Runs and settlements self-identify environment. |
| 4 - CLI/API Boundaries | Phase 1-3 | Commands and routes cannot mix prod/test data silently. |
| 5 - Launchd Profiles | Phase 1 | Prod and dev Mission Control run side by side. |
| 6 - UI/Scheduler Safety | Phase 1-5 | Mission Control and scheduled jobs read/write the right env. |
| 7 - QA | All | Production and test data separation is proven. |

## Verticals

### Phase 1 - Environment Config

Files:

- `market_lab/market_lab/environment.py`
- `market_lab/market_lab/models.py`

Tasks:

- Add `MARKET_LAB_ENV`.
- Add config validation for `prod`, `test`, `ci`, and `dev`.
- Add explicit booleans for live data, Codex, and alerts in non-prod envs.
- Make server-side env resolution authoritative for API writes.

### Phase 2 - Environment Stores

Files:

- `market_lab/market_lab/storage.py`

Tasks:

- Resolve data paths under `.cache/market_lab/<env>/`.
- Use separate SQLite files per environment.
- Ensure new writes target `.cache/market_lab/<env>/`.

### Phase 3 - Artifact Metadata

Files:

- `market_lab/market_lab/models.py`
- `market_lab/market_lab/runner.py`
- `market_lab/market_lab/settlement.py`
- `market_lab/market_lab/opportunities.py`
- `market_lab/market_lab/portfolio_context.py`
- `market_lab/market_lab/execution_intents.py`

Tasks:

- Add environment metadata to persisted artifacts.
- Mark test/dev/CI artifacts with `is_test_data=true`.
- Ensure settlement memory excludes non-prod by default.

### Phase 4 - CLI/API Boundaries

Files:

- `market_lab/market_lab/cli.py`
- `apps/mission-control/app/api/market-lab/**/route.ts`
- `apps/mission-control/lib/market-lab.ts`

Tasks:

- Add `--env` to Market Lab CLI commands.
- Reject manual CLI runs that have neither `--env` nor `MARKET_LAB_ENV`.
- Include active environment in CLI/API output.
- Reject unsafe env mixing.
- Add `reset-env --env test` for disposable QA data.
- Add `GET /api/market-lab/environments` for prod/dev runtime health.
- Ensure browser requests cannot override server env unless a future explicit admin-only test mode is added.

### Phase 5 - Launchd Profiles

Files:

- `apps/mission-control/scripts/restart-mission-control.sh`
- `apps/mission-control/scripts/install-launch-agent.ts`
- `apps/mission-control/lib/launch-agent.ts`
- `apps/mission-control/scripts/start-mission-control.sh`

Tasks:

- Add `--env prod|dev` to restart script.
- Map `prod` to label `com.cortana.mission-control`, port `3000`, and `MARKET_LAB_ENV=prod`.
- Map `dev` to label `com.cortana.mission-control-dev`, port `3001`, and `MARKET_LAB_ENV=dev`.
- Make port cleanup profile-specific instead of hardcoded to `3000`.
- Make health URL profile-specific.
- Make plist/log paths profile-specific.
- Pass `MARKET_LAB_ENV` through LaunchAgent environment variables.

### Phase 6 - UI/Scheduler Safety

Files:

- `apps/mission-control/app/market-lab/market-lab-client.tsx`
- `apps/mission-control/lib/market-lab.ts`
- `apps/mission-control/app/api/market-lab/environments/route.ts`
- `market_lab/scripts/settle-due.sh`

Tasks:

- Show non-prod environment badge.
- Show prod and dev environment health in production Mission Control.
- Hide non-prod runs from production views.
- Pass the resolved environment through scheduled settlement jobs.
- Block monitor alerts for non-prod runs unless explicitly enabled.

### Phase 7 - QA

Commands:

```bash
MARKET_LAB_ENV=ci uv run --project market_lab pytest market_lab/tests
cd apps/mission-control && pnpm build
```

Manual smoke:

- run one test review
- run one production review
- restart prod with `restart-mission-control.sh --env prod`
- restart dev with `restart-mission-control.sh --env dev`
- verify prod listens on `3000`
- verify dev listens on `3001`
- verify prod UI shows both environment healths
- verify they land in separate roots
- verify production UI hides test data
- verify test settlement does not send monitor alerts
