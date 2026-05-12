# QA Plan - Market Lab V0 Forward-Looking Trust Reviews

**Document Status:** Passed for PR #336

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | Hamel |
| Epic | Market Lab V0 |
| PRD | [v0-forward-looking-trust-reviews.md](../PRDs/v0-forward-looking-trust-reviews.md) |
| Tech Spec | [v0-forward-looking-trust-reviews.md](../TechSpecs/v0-forward-looking-trust-reviews.md) |
| Implementation Plan | [v0-forward-looking-trust-reviews.md](../Implementation/v0-forward-looking-trust-reviews.md) |

---

## QA Goal

Prove that Market Lab V0 can run one forward-looking symbol review, save one explainable artifact, render the same truth in Mission Control, and passively settle outcomes without creating execution, paper trading, Telegram, or old-backtester coupling.

This QA plan validates:

1. artifact truth and UI/API parity
2. Trust Verdict correctness for fresh, stale, failed, and mixed-evidence cases
3. TradingAgents second-opinion handling without bypassing hard blockers
4. outcome settlement using raw P/L and alpha vs SPY
5. debuggability through events, logs, CLI commands, and tests
6. CLI and Mission Control parity, so terminal-created and UI-created runs share the same source-of-truth artifacts

---

## V0 QA Result

Status: Passed.

Validated on branch `codex/market-lab-v0-implementation-20260510`.

Representative live smoke run:

- run id: `mlab_20260511T000803Z_AAPL`
- created through Mission Control API
- loaded through Mission Control detail/events APIs
- settled through Mission Control settle API
- inspected through CLI with `uv run --project market_lab python -m market_lab.cli show mlab_20260511T000803Z_AAPL --json`

Automated validation completed:

- `uv run --project market_lab pytest market_lab/tests` — 18 passed
- `cd apps/mission-control && npx vitest run` — 112 files / 483 tests passed
- `cd apps/mission-control && pnpm build` — passed
- `pnpm market-lab -- list --limit 1 --json` — passed
- `git diff --check` — passed

Live E2E validation completed on temporary dev server `127.0.0.1:3100`:

- `GET /market-lab` returned 200
- `GET /api/market-lab/runs?limit=1` returned recent runs
- `POST /api/market-lab/runs` created an AAPL run
- `GET /api/market-lab/runs/:runId` returned matching artifact data
- `GET /api/market-lab/runs/:runId/events` returned queued/running/done timeline
- `POST /api/market-lab/runs/:runId/settle` returned not-due settlement windows
- CLI `show` read the same run created through Mission Control

Known V0 constraints:

- fake TradingAgents mode is the supported smoke-test path
- Codex-assisted review uses the existing Codex session flow and does not require OpenAI API keys in Market Lab
- settlement windows remain `not_due` until their due dates

---

## Scope

In scope:

- one-symbol manual Market Lab reviews
- Python `market_lab/` contracts, storage, checks, verdict, adapter, settlement, CLI
- Mission Control Market Lab page/API
- filesystem artifacts plus SQLite run index
- 1D/5D/20D settlement windows
- raw P/L and alpha vs SPY scoring

Out of scope:

- broker execution
- paper trading
- Telegram alerts
- historical as-of-date backtesting
- multi-symbol batches
- old backtester replacement/deletion
- model/provider bakeoffs

---

## QA Matrix

| Area | Scenario | Expected Result |
|------|----------|-----------------|
| Symbol input | Submit valid `AAPL` | API creates a run and returns `runId`. |
| Symbol input | Submit invalid symbol text | API returns `400` and no run directory is created. |
| Run lifecycle | Start one review | SQLite row moves through queued/running/done or failed. |
| Timeline | Review progresses | `events.jsonl` records major steps in order. |
| Artifact | Review completes | `review.json` validates against Pydantic schema. |
| UI/API parity | Load run detail | Mission Control verdict and reasons match `review.json`. |
| Freshness | Market-hours quote is fresh | Freshness check passes. |
| Freshness | Market-hours quote is stale | Trust Verdict is `blocked` with explicit stale-price reason. |
| Off-hours | Market closed latest price | Review may proceed with clear `price_basis`. |
| Optional evidence | News/fundamentals/sentiment missing | Missing optional evidence is visible and does not automatically block. |
| TradingAgents | Adapter succeeds | Raw/summary output saved to `tradingagents.md` and artifact. |
| TradingAgents | Adapter fails before required review | Review is blocked or failed with clear reason. |
| Verdict | Hard blocker plus bullish agent output | Final verdict remains `blocked`. |
| Verdict | Mixed evidence, valid artifact | Final verdict can be `uncertain`. |
| Settlement | Trusted review beats SPY | Settlement score is `success`. |
| Settlement | Trusted review underperforms SPY | Settlement score is `failure`. |
| Settlement | Blocked/uncertain review underperforms SPY | Settlement score is `good_avoid`. |
| Settlement | Settle before due date | Window remains `not_due` or `pending`. |
| Logs | Python exception occurs | `logs.txt` and run error message contain debuggable failure info. |
| CLI run | Run `AAPL` from terminal | CLI creates the same run/artifact shape as Mission Control. |
| CLI show | Inspect a UI-created run | CLI shows the same verdict, artifact path, and settlement status as Mission Control. |
| CLI aliases | Use optional documented aliases/scripts | Aliases delegate to the canonical `uv run --project market_lab ...` commands. |
| Sidebar | Mission Control nav | Market Lab appears separately from Trading Ops. |
| Non-goals | V0 review completes | No broker, paper-trade, Telegram, or execution artifact is produced. |

---

## Required Automated Coverage

Add or update tests around these areas when implementation starts:

- `market_lab/tests/test_models.py`
- `market_lab/tests/test_storage.py`
- `market_lab/tests/test_checks.py`
- `market_lab/tests/test_verdict.py`
- `market_lab/tests/test_runner.py`
- `market_lab/tests/test_settlement.py`
- `apps/mission-control/lib/market-lab.test.ts`
- `apps/mission-control/app/api/market-lab/runs/route.test.ts`
- `apps/mission-control/app/api/market-lab/runs/[runId]/route.test.ts`
- `apps/mission-control/app/market-lab/market-lab-client.test.tsx`

Suggested test cases:

- Valid review artifact with pending settlements validates.
- Missing `trust_verdict` on a done run fails artifact validation.
- Stale market-hours quote maps to blocked verdict.
- Off-hours latest close maps to non-blocked if required fields exist.
- Optional sentiment failure maps to uncertain or visible warning, not automatic blocked.
- Fake TradingAgents success writes `tradingagents.md`.
- Fake TradingAgents failure records event/log and blocks/fails cleanly.
- Settlement alpha calculation is exact for symbol and SPY fixtures.
- Mission Control route rejects shell-like symbol input.
- UI renders facts and interpretation in separate regions.
- CLI `run --json` returns machine-readable output containing `run_id`, `status`, and artifact path.
- CLI `show` and Mission Control route return the same verdict and settlement state for the same run fixture.

---

## Manual / Live Validation

### Scenario 1 - One Symbol Happy Path

Setup:

- Mac mini has `cortana-external` on the Market Lab implementation branch.
- `apps/external-service` is healthy at `http://127.0.0.1:3033/market-data/ready`.
- TradingAgents fork is present at `/Users/hd/Developer/TradingAgents`.
- Required LLM provider key is configured locally.

Checks:

- Open Mission Control and navigate to Market Lab.
- Submit `AAPL`.
- Watch the timeline progress.
- Confirm API returns a run id.
- Confirm `.cache/market_lab/runs/<run_id>/review.json` exists.
- Confirm Mission Control and `review.json` show the same Trust Verdict.

Success:

- Run completes or fails with a clear debuggable reason.
- No old backtester scan, Telegram alert, paper trade, or broker action is triggered.

---

### Scenario 2 - Stale Data Block

Setup:

- Use a fixture/fake market-data response or test mode that returns a market-hours quote older than the freshness threshold.

Checks:

- Run a review for a test symbol.
- Inspect `review.json`.
- Inspect Mission Control verdict panel.

Success:

- Trust Verdict is `blocked`.
- Reason explicitly says price data is stale.
- TradingAgents output, if present, does not override the hard blocker.

---

### Scenario 3 - Settlement Now

Setup:

- Seed or choose a run with a due settlement window.
- Ensure market-data service can provide symbol and SPY close prices for the due date.

Checks:

- Trigger settle-now from Mission Control or CLI.
- Inspect SQLite settlement row.
- Inspect Mission Control settlement panel.

Success:

- Raw P/L, SPY return, and alpha vs SPY are populated.
- Trusted reviews score by alpha vs SPY.
- Blocked/uncertain reviews score good/bad avoid by SPY-relative performance.

---

### Scenario 4 - Debug From CLI

Setup:

- Use a run id created by Mission Control.

Checks:

```bash
uv run --project market_lab python -m market_lab.cli show <run_id>
uv run --project market_lab python -m market_lab.cli events <run_id>
uv run --project market_lab python -m market_lab.cli settle <run_id>
```

Success:

- CLI output explains run state, artifact path, events, logs, and settlement status without requiring UI access.
- CLI output matches the same run state shown in Mission Control.

---

### Scenario 5 - Create From CLI, Review In Mission Control

Setup:

- Market-data service is healthy.
- TradingAgents adapter is configured or fake-adapter mode is available.

Checks:

```bash
uv run --project market_lab python -m market_lab.cli run AAPL --json
uv run --project market_lab python -m market_lab.cli show <run_id>
```

- Open Mission Control Market Lab.
- Load the run created by the CLI.
- Compare Mission Control verdict, reasons, artifact path, events, and settlement windows to CLI output.

Success:

- Mission Control can render a CLI-created run without a special import step.
- CLI-created and UI-created runs are indistinguishable at the artifact/API boundary.

---

## Acceptance Criteria

The release is QA-complete when all of the following are true:

- Python tests pass with `uv run --project market_lab pytest`.
- Mission Control tests pass with `npx vitest run` from `apps/mission-control`.
- Mission Control builds with `pnpm build`.
- One live or fake-adapter Market Lab run can be started from Mission Control.
- One live or fake-adapter Market Lab run can be started from CLI.
- `review.json` is the source of truth for the rendered verdict.
- CLI `show/events/settle` and Mission Control read the same `review.json`, `events.jsonl`, logs, and SQLite rows.
- Events and logs are persisted for both successful and failed runs.
- Stale market-hours price data is blocked.
- Off-hours latest price basis is labeled clearly.
- Settlement math shows raw P/L and alpha vs SPY.
- No broker, paper-trading, Telegram, or old-backtester execution path is touched.

---

## Release Risks To Watch

- TradingAgents runtime may be slow or require provider keys that are absent on the Mac mini.
- Market-data service quote timestamps may be ambiguous, making freshness harder than expected.
- Mission Control process spawning could accidentally become shell-based if not tested.
- UI could drift into recreating old Trading Ops density instead of a clear one-run review page.
- Settlement windows need a reliable market-calendar interpretation for weekends/holidays.

---

## Sign-Off Checklist

- [ ] Automated coverage added or updated
- [ ] Artifact parity verified
- [ ] Operator-surface truth verified
- [ ] Degraded and fallback states verified
- [ ] Out-of-scope paths remain out of scope
- [ ] No execution, paper trading, or Telegram behavior added
- [ ] CLI start-review path verified
- [ ] CLI-created run renders in Mission Control
- [ ] UI-created run is inspectable from CLI
- [ ] CLI debugging path verified
- [ ] Market Lab remains framed as a new application, not W15
