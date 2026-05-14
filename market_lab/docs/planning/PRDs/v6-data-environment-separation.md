# Market Lab V6 Data Environment Separation PRD

**Document Status:** Implemented
**Owner:** Trading systems
**Last Updated:** 2026-05-14
**Depends On:** Market Lab V2-V5

## Problem / Opportunity

Market Lab now produces real review artifacts, Codex reviews, settlement history, portfolio context, and monitor alerts. Test runs and smoke runs must not pollute production run history or learning data.

V6 creates a hard separation between production data and testing data so Market Lab can keep learning from real runs without confusing them with QA experiments.

## Goals

- Separate production, test, CI, and local-dev Market Lab data.
- Keep test runs out of production Run Tape, settlement memory, opportunity scoring, and monitor alerts.
- Make every artifact self-identify its data environment.
- Keep production as the default in Mission Control runtime.
- Run production and development Mission Control side by side.
- Let production Mission Control show whether both production and development environments are healthy.
- Make test mode easy from CLI and API without risky manual cleanup.

## Non-Goals

- Deleting historical production runs automatically.
- Changing Market Lab verdict logic.
- Replacing Schwab, Codex, or settlement workflows.
- Reintroducing old backtester data.
- Creating paper-trading or simulated execution.

## Definitions

| Environment | Purpose | Live Data | Codex | Alerts | Retention |
|-------------|---------|-----------|-------|--------|-----------|
| `prod` | Real Market Lab decisions and learning | Allowed | Allowed | Allowed | Durable |
| `test` | Manual QA and end-to-end smoke runs | Explicit only | Optional | Blocked by default | Disposable |
| `ci` | Automated test fixtures | Blocked | Blocked | Blocked | Temporary |
| `dev` | Local development experiments | Explicit only | Optional | Blocked by default | Disposable |

## Requirements

| Requirement | Description |
|-------------|-------------|
| Environment Config | Add a single `MARKET_LAB_ENV` source of truth. |
| Physical Data Separation | Store each environment under a separate cache/database root. |
| Artifact Tagging | Every artifact includes `environment`, `source_mode`, and `is_test_data`. |
| UI Filtering | Mission Control hides test/dev/CI data by default in production views. |
| CLI Safety | CLI commands accept `--env` and print the active environment. |
| API Safety | API responses include the active environment and reject unsafe env mixing. |
| Launchd Profiles | Mission Control restart accepts `--env prod` or `--env dev` and maps the environment to the correct launchd label and port. |
| Environment Health | Production Mission Control shows health for both `prod` and `dev` runtimes. |
| Scheduler Safety | Scheduled settlement and monitor alerts run only against `prod` unless explicitly overridden. |
| Learning Safety | Opportunity scoring and settlement memory ignore test/dev/CI data by default. |
| Reset Safety | Test data can be reset easily; production reset requires explicit confirmation. |

## Answered Decisions

| Question | Decision |
|----------|----------|
| How does the UI decide prod vs dev? | It does not. The server process decides from `MARKET_LAB_ENV`. |
| How does `localhost:3000` differ from `localhost:3002`? | `3000` is production Mission Control. `3002` is development Mission Control. |
| Should the operator pass ports manually? | No. Restart uses `--env prod` or `--env dev`; the script maps ports internally. |
| Should there be a prod/dev switch inside the UI? | No by default. The UI shows the active environment but does not let the browser change it. |
| How do CLI runs choose an environment? | CLI runs use `--env` or `MARKET_LAB_ENV`; manual CLI should print the resolved environment. |
| Should prod know dev is healthy? | Yes. Production Mission Control should render an environment health panel for prod and dev. |
| Should dev runs alert or affect learning? | No. Dev/test/CI runs do not alert or update production learning by default. |

## Expected UI Flow

```text
Operator opens localhost:3000 or localhost:3002
-> browser calls Mission Control API
-> server process reads MARKET_LAB_ENV
-> stores resolve .cache/market_lab/<env>/
-> run artifact includes environment metadata
-> UI/API expose the active environment
-> settlement and learning read only the matching environment
```

## Expected Launch Flow

```bash
./apps/mission-control/scripts/restart-mission-control.sh --env prod
./apps/mission-control/scripts/restart-mission-control.sh --env dev
```

The script owns the mapping:

| Restart Env | Launchd Label | Port | Market Lab Env |
|-------------|---------------|------|----------------|
| `prod` | `com.cortana.mission-control` | `3000` | `prod` |
| `dev` | `com.cortana.mission-control-dev` | `3002` | `dev` |

## Success Criteria

- A test run never appears in the production Run Tape.
- A CI run cannot write into `.cache/market_lab/prod`.
- `restart-mission-control.sh --env prod` restarts production on `3000`.
- `restart-mission-control.sh --env dev` restarts development on `3002`.
- The production UI shows both prod and dev runtime health.
- A browser request cannot silently override the server environment.
- `settle-due` processes production runs only by default.
- Monitor alerts are not sent for test/dev/CI runs by default.
- Mission Control clearly shows when it is reading non-production data.
- Production reset cannot happen without an explicit destructive confirmation.

## Implementation Notes

- Market Lab writes new data under `.cache/market_lab/<env>/`.
- `MARKET_LAB_ENV` or `--env` is required for CLI commands.
- Mission Control APIs inherit the server process environment; the browser cannot switch environments.
- Production and development launchd profiles are separate labels and ports.
