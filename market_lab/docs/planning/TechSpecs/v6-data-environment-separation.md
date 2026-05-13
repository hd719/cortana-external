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
| Local CLI without env | `dev` or explicit prompt/log warning |
| Automated tests | `ci` |
| Manual QA | `test` |

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
uv run --project market_lab python -m market_lab.cli run AAPL --env test --json
uv run --project market_lab python -m market_lab.cli settle-due --env prod --json
uv run --project market_lab python -m market_lab.cli reset-env --env test --confirm test
```

Rules:

- Print active environment in JSON and non-JSON output.
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

## Mission Control

Mission Control should:

- default to production data
- show a visible environment badge when not production
- exclude test/dev/CI runs from production Run Tape
- offer a local developer-only environment switch only when enabled
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
| Accidental prod deletion | Explicit destructive confirmation. |
| Legacy paths drift | One compatibility loader with warnings, then env-root writes only. |
