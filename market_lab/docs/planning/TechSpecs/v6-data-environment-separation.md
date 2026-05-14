# Technical Specification - Market Lab V6 Data Environment Separation

**Document Status:** Proposed
**PRD:** [v6-data-environment-separation.md](../PRDs/v6-data-environment-separation.md)

## Development Overview

V6 introduces an environment boundary for all Market Lab data. The boundary is both physical and logical:

- physical: separate cache/database roots per environment
- logical: every artifact carries environment metadata

This keeps QA runs useful without contaminating production learning.

## Configuration

Add one config object that all CLI, API, scheduler, and UI loaders use:

```text
MARKET_LAB_ENV=prod|test|ci|dev
MARKET_LAB_DATA_ROOT=.cache/market_lab
MARKET_LAB_ALLOW_LIVE_DATA_IN_TEST=false
MARKET_LAB_ALLOW_CODEX_IN_TEST=false
MARKET_LAB_ALLOW_ALERTS_IN_TEST=false
```

Recommended defaults:

| Runtime | Default |
|---------|---------|
| Mission Control on Mac mini | `prod` |
| Local CLI without env | reject with a hint to pass `--env` or set `MARKET_LAB_ENV` |
| Automated tests | `ci` |
| Manual QA | `test` |

## Mission Control Launchd Profiles

Mission Control should support environment profiles through the existing restart path:

```bash
./apps/mission-control/scripts/restart-mission-control.sh --env prod
./apps/mission-control/scripts/restart-mission-control.sh --env dev
```

The operator should not pass a port manually. The restart script maps the environment to the launchd label, port, plist, logs, health URL, and `MARKET_LAB_ENV`.

| Env | Label | Port | Plist | Health URL |
|-----|-------|------|-------|------------|
| `prod` | `com.cortana.mission-control` | `3000` | `~/Library/LaunchAgents/com.cortana.mission-control.plist` | `http://127.0.0.1:3000/api/heartbeat-status` |
| `dev` | `com.cortana.mission-control-dev` | `3002` | `~/Library/LaunchAgents/com.cortana.mission-control-dev.plist` | `http://127.0.0.1:3002/api/heartbeat-status` |

The current `start-mission-control.sh` already honors `PORT`; V6 should ensure the LaunchAgent actually passes the correct `PORT` and `MARKET_LAB_ENV`.

### LaunchAgent Changes

Update the launch-agent helpers to make label and profile explicit:

```ts
type MissionControlRuntimeProfile = {
  env: "prod" | "dev";
  label: string;
  port: string;
  marketLabEnv: "prod" | "dev";
  stdoutPath: string;
  stderrPath: string;
  healthUrl: string;
};
```

Required changes:

- `install-launch-agent.ts` accepts `--env prod|dev`.
- `buildMissionControlLaunchAgentPlist` accepts `label`, `stdoutPath`, and `stderrPath`.
- `getMissionControlLaunchAgentEnvironment` includes `MARKET_LAB_ENV`.
- `restart-mission-control.sh` accepts `--env prod|dev`.
- port cleanup uses the selected profile port, not hardcoded `3000`.
- health check uses the selected profile health URL.

## Store Layout

Use physically separate paths:

```text
.cache/market_lab/
  prod/
    runs/
    market_lab.sqlite
  test/
    runs/
    market_lab.sqlite
  ci/
    runs/
    market_lab.sqlite
  dev/
    runs/
    market_lab.sqlite
```

Legacy `.cache/market_lab/runs` and `.cache/market_lab/market_lab.sqlite` should be migrated or read through a compatibility loader only once. New writes must use the environment root.

## Data Model

Add environment metadata to core artifacts:

```python
class ArtifactEnvironment(Model):
    environment: Literal["prod", "test", "ci", "dev"]
    source_mode: Literal["live", "fixture", "mock", "mixed"]
    is_test_data: bool
    created_by: str | None = None
```

Attach this to:

- review artifacts
- Codex packet metadata
- Codex review metadata
- settlement records
- opportunity board artifacts
- portfolio snapshots
- execution-intent artifacts
- monitor-alert receipts

## CLI Contract

Add:

```bash
uv run --project market_lab python -m market_lab.cli run AAPL --env prod --json
uv run --project market_lab python -m market_lab.cli run AAPL --env test --json
uv run --project market_lab python -m market_lab.cli settle-due --env prod --json
uv run --project market_lab python -m market_lab.cli reset-env --env test --confirm test
```

Rules:

- Print active environment in JSON and non-JSON output.
- Prefer explicit `--env` for manual CLI runs.
- Reject `ci` live-data calls.
- Block alerts outside `prod` unless `MARKET_LAB_ALLOW_ALERTS_IN_TEST=true`.
- Require a destructive confirmation for `prod` reset.

## API Contract

Every Market Lab API response should include:

```json
{
  "environment": "prod",
  "sourceMode": "live",
  "isTestData": false
}
```

API routes should reject writes where requested environment conflicts with the server environment unless explicitly configured for test mode.

The browser should not decide the environment. A run request from `localhost:3000` writes to the server's configured environment, and a run request from `localhost:3002` writes to that server's configured environment.

Add:

```text
GET /api/market-lab/environments
```

Response shape:

```json
{
  "current": "prod",
  "environments": [
    {
      "environment": "prod",
      "status": "healthy",
      "url": "http://127.0.0.1:3000",
      "port": 3000,
      "runCount": 42,
      "latestRunAt": "2026-05-14T12:00:00Z"
    },
    {
      "environment": "dev",
      "status": "healthy",
      "url": "http://127.0.0.1:3002",
      "port": 3002,
      "runCount": 7,
      "latestRunAt": "2026-05-14T11:50:00Z"
    }
  ]
}
```

## Mission Control

Mission Control should:

- default to production data
- show a visible environment badge for every runtime
- show prod and dev environment health in production Mission Control
- exclude test/dev/CI runs from production Run Tape
- avoid a browser-side environment switch by default
- never send monitor alerts from non-production views by default

## Scheduler And Alerts

Scheduled jobs must pass `--env prod` explicitly.

`settle-due` should ignore non-production runs unless invoked with a matching environment. Monitor alerts should require:

```text
environment == prod
is_test_data == false
alerts_enabled == true
```

## Risks

| Risk | Mitigation |
|------|------------|
| Hidden test data affects learning | Separate SQLite files and env metadata. |
| CI writes to prod cache | Tests force `MARKET_LAB_ENV=ci` and temporary roots. |
| UI confusion | Production-only default plus visible non-prod badge. |
| Two launchd agents conflict | Env-specific labels, ports, plist paths, and log paths. |
| Browser changes env accidentally | Server-owned env; no default UI switch. |
| Accidental prod deletion | Explicit destructive confirmation. |
| Legacy paths drift | One compatibility loader with warnings, then env-root writes only. |
