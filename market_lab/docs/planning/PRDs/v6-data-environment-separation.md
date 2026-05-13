# Market Lab V6 Data Environment Separation PRD

**Document Status:** Proposed
**Owner:** Trading systems
**Last Updated:** 2026-05-13
**Depends On:** Market Lab V2-V5

## Problem / Opportunity

Market Lab now produces real review artifacts, Codex reviews, settlement history, portfolio context, and monitor alerts. Test runs and smoke runs must not pollute production run history or learning data.

V6 creates a hard separation between production data and testing data so Market Lab can keep learning from real runs without confusing them with QA experiments.

## Goals

- Separate production, test, CI, and local-dev Market Lab data.
- Keep test runs out of production Run Tape, settlement memory, opportunity scoring, and monitor alerts.
- Make every artifact self-identify its data environment.
- Keep production as the default in Mission Control runtime.
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
| Scheduler Safety | Scheduled settlement and monitor alerts run only against `prod` unless explicitly overridden. |
| Learning Safety | Opportunity scoring and settlement memory ignore test/dev/CI data by default. |
| Reset Safety | Test data can be reset easily; production reset requires explicit confirmation. |

## Expected Flow

```text
Operator runs Market Lab
-> config resolves MARKET_LAB_ENV
-> stores resolve .cache/market_lab/<env>/
-> run artifact includes environment metadata
-> UI/API/CLI expose environment
-> settlement and learning read only the matching environment
```

## Success Criteria

- A test run never appears in the production Run Tape.
- A CI run cannot write into `.cache/market_lab/prod`.
- `settle-due` processes production runs only by default.
- Monitor alerts are not sent for test/dev/CI runs by default.
- Mission Control clearly shows when it is reading non-production data.
- Production reset cannot happen without an explicit destructive confirmation.
