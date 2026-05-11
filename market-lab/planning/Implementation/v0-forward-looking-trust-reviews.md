# Implementation Plan - Market Lab V0 Forward-Looking Trust Reviews

**Document Status:** Implemented in PR #336

## Team

| Role | Assignee |
|------|----------|
| Owner(s) | Hamel |
| Epic | Market Lab V0 |
| Tech Spec | [v0-forward-looking-trust-reviews.md](../TechSpecs/v0-forward-looking-trust-reviews.md) |
| PRD | [v0-forward-looking-trust-reviews.md](../PRDs/v0-forward-looking-trust-reviews.md) |

---

## Dependency Map

| Vertical | Dependencies | Status |
|----------|-------------|--------|
| V1 - Python Project Skeleton And Contracts | Approved PRD/Tech Spec | Done |
| V2 - Storage And Artifact Writes | V1 | Done |
| V3 - Market Data Facts And Checks | V1, V2 | Done |
| V4 - TradingAgents Adapter And Verdict | V1, V2, V3 | Done |
| V5 - Outcome Settlement | V2, V3 | Done |
| V6 - Mission Control API Bridge | V1, V2 | Done |
| V7 - Mission Control Market Lab UI | V6 | Done |
| V8 - CLI Ergonomics And Runtime Wiring | V4, V5, V6 | Done |
| V9 - QA Closeout | V7, V8 | Done |

Implementation branch: `codex/market-lab-v0-implementation-20260510`

PR: #336

Completion snapshot:

- `market_lab/` package created with readable typed Python modules.
- `market_lab.cli` supports `run`, `list`, `show`, `events`, `settle`, and `settle-due`.
- `pnpm market-lab -- ...` delegates to the canonical `uv run --project market_lab python -m market_lab.cli ...` command.
- Mission Control invokes the Python CLI with an argument array, not shell string interpolation.
- Mission Control `/market-lab` renders recent runs, verdicts, facts, timeline, TradingAgents status, checks, settlements, and artifact paths.
- TradingAgents real execution is intentionally behind `MARKET_LAB_TRADINGAGENTS_COMMAND`; fake mode is available with `MARKET_LAB_FAKE_TRADINGAGENTS=1`.
- V0 remains review-only: no broker, paper-trading, Telegram, or old-backtester execution path.

---

## Recommended Execution Order

```text
Sprint 1: V1 + V2 + V3
Sprint 2: V4 + V5 + V6
Sprint 3: V7 + V8 + V9
```

V1-V3 prove that the engine can create understandable artifacts from deterministic data. V4 adds TradingAgents only after the artifact/check boundaries exist. V6-V7 then expose the stable contract to Mission Control.

---

## Sprint 1 - Engine Foundation

### Vertical 1 - Python Project Skeleton And Contracts

**cortana-external: create the isolated Market Lab Python project.**

*Dependencies: None*

#### Jira

- Create `market_lab/pyproject.toml` using `uv` with Python 3.13+ or 3.12+ based on repo compatibility; include `pydantic`, `requests`, `python-dateutil`, and `pytest` dev dependency.
- Create `market_lab/market_lab/models.py` with Pydantic models for `ReviewArtifact`, `RunRecord`, `TimelineEvent`, `PriceFacts`, `OptionalEvidence`, `Interpretation`, `SettlementWindow`, and `TrustVerdict`.
- Create `market_lab/market_lab/cli.py` with placeholder commands: `run`, `show`, `events`, `settle`, `settle-due`.
- Treat the CLI as a first-class product interface, not just a debug fallback. Mission Control and terminal usage must call the same engine and produce the same artifact contract.
- Create `market_lab/README.md` explaining how to read and debug the module.
- Add `market_lab/tests/test_models.py` covering valid/invalid artifact contracts.

#### Testing

- `uv run --project market_lab pytest market_lab/tests/test_models.py`
- Invalid artifact payloads fail with readable Pydantic errors.
- The README names each module and debugging command.

---

### Vertical 2 - Storage And Artifact Writes

**cortana-external: implement SQLite run index and filesystem artifact storage.**

*Dependencies: V1*

#### Jira

- Create `market_lab/market_lab/storage.py` with `MarketLabStore` using stdlib `sqlite3`.
- Create tables `market_lab_runs` and `market_lab_settlements` if missing.
- Implement run creation, status update, artifact path update, run lookup, run listing, event append, log append, and atomic JSON write.
- Store artifacts under `.cache/market_lab/runs/<run_id>/` by default, configurable through `MARKET_LAB_CACHE_DIR`.
- Add `market_lab/tests/test_storage.py` using temporary directories and SQLite files.

#### Testing

- Store creates a run and reloads it by id.
- Artifact writes are atomic and parseable.
- Events append in order as JSONL.
- Failed runs persist `error_message` and log path.

---

### Vertical 3 - Market Data Facts And Checks

**cortana-external: fetch live facts and produce deterministic check results.**

*Dependencies: V1, V2*

#### Jira

- Create `market_lab/market_lab/market_data.py` to call the existing TS market-data service at `/market-data/quote/:symbol`, `/market-data/history/:symbol`, and `/market-data/fundamentals/:symbol` as needed.
- Use the existing service base convention from `backtester/data/market_data_service_client.py`: `MARKET_DATA_SERVICE_BASE_URL` or default `http://localhost:3033`.
- Create `market_lab/market_lab/checks.py` for freshness, price basis, required field, optional evidence availability, and simple momentum/risk flags.
- Implement 5-10 minute market-hours freshness gate. Technical implementation must choose the exact threshold and document it; default recommendation is 10 minutes.
- Add tests in `market_lab/tests/test_checks.py` for fresh/stale/open/closed scenarios.

#### Testing

- Fresh regular-session quote passes.
- Stale regular-session quote returns a blocking reason.
- Off-hours latest available price passes only with explicit `price_basis`.
- Missing optional news/fundamentals/sentiment marks optional evidence missing but does not automatically block.

---

## Sprint 2 - Review Intelligence And API Bridge

### Vertical 4 - TradingAgents Adapter And Verdict

**cortana-external: call TradingAgents as a second-opinion lane and compute Trust Verdict.**

*Dependencies: V1, V2, V3*

#### Jira

- Create `market_lab/market_lab/tradingagents_adapter.py` that can invoke the local fork at `TRADINGAGENTS_REPO_PATH` or `/Users/hd/Developer/TradingAgents`.
- Start with a subprocess/CLI-style adapter rather than importing TradingAgents internals directly, unless import mode proves clearly simpler and testable.
- Save raw TradingAgents output to `tradingagents.md`.
- Create `market_lab/market_lab/verdict.py` to combine deterministic checks and TradingAgents result into `trusted`, `uncertain`, or `blocked`.
- Create `market_lab/market_lab/runner.py` to orchestrate one review step-by-step and write timeline events.
- Add `market_lab/tests/test_verdict.py` and `market_lab/tests/test_runner.py` with a fake TradingAgents adapter.

#### Testing

- Required TradingAgents failure blocks or fails according to failure timing.
- Deterministic hard blockers cannot be overridden by bullish TradingAgents output.
- Mixed optional evidence can produce `uncertain` without failing the run.
- Runner writes events for each major step.

---

### Vertical 5 - Outcome Settlement

**cortana-external: settle 1D/5D/20D outcomes against SPY.**

*Dependencies: V2, V3*

#### Jira

- Create `market_lab/market_lab/settlement.py` for due-window calculation, close-price lookup, raw return, SPY return, alpha vs SPY, and score labels.
- Use market close prices for symbol and SPY.
- Add `settle` and `settle-due` CLI commands.
- Add `market_lab/tests/test_settlement.py` covering trusted success/failure and blocked/uncertain good/bad avoid.

#### Testing

- Trusted + positive alpha scores success.
- Trusted + non-positive alpha scores failure.
- Blocked/uncertain + symbol underperforms SPY scores good avoid.
- Settlement does not run early for not-due windows.

---

### Vertical 6 - Mission Control API Bridge

**Mission Control: expose run creation, run detail, events/logs, and settle-now.**

*Dependencies: V1, V2*

#### Jira

- Create `apps/mission-control/lib/market-lab.ts` with path resolution, Python process invocation, artifact loading, and response normalization.
- Create route files:
  - `apps/mission-control/app/api/market-lab/runs/route.ts`
  - `apps/mission-control/app/api/market-lab/runs/[runId]/route.ts`
  - `apps/mission-control/app/api/market-lab/runs/[runId]/events/route.ts`
  - `apps/mission-control/app/api/market-lab/runs/[runId]/settle/route.ts`
- Use `requireSameOrigin` or `requireApiAuth` from `apps/mission-control/lib/api-auth.ts` for mutating routes.
- Add `apps/mission-control/lib/market-lab.test.ts` and route tests following existing route test style.

#### Testing

- `POST /api/market-lab/runs` rejects invalid symbols.
- Python spawn uses argument arrays, not shell strings.
- Route returns stable `{ status, data }` shapes.
- Failed Python process returns a readable error and does not corrupt run state.

---

## Sprint 3 - Operator Surface And QA

### Vertical 7 - Mission Control Market Lab UI

**Mission Control: add a new Market Lab page and sidebar entry.**

*Dependencies: V6*

#### Jira

- Create `apps/mission-control/app/market-lab/page.tsx` and `apps/mission-control/app/market-lab/market-lab-client.tsx`.
- Update `apps/mission-control/components/sidebar.tsx` with a `Market Lab` nav item separate from `Trading Ops`.
- UI sections: symbol input, run button, recent runs, timeline, Trust Verdict, facts, interpretation, TradingAgents summary, raw/log links, settlements.
- Add `apps/mission-control/app/market-lab/market-lab-client.test.tsx` covering run submission, status polling, blocked verdict rendering, and settlement display.

#### Testing

- User can submit `AAPL` and see running status.
- Timeline renders queued/running/done/failed events.
- Facts and interpretation render as separate sections.
- Settlement windows render pending and settled states.

---

### Vertical 8 - CLI Ergonomics And Runtime Wiring

**cortana-external: make terminal usage easy while keeping `uv` as the canonical command.**

*Dependencies: V4, V5, V6*

#### Jira

- Document canonical CLI commands in `market_lab/README.md`:
  - `uv run --project market_lab python -m market_lab.cli run AAPL`
  - `uv run --project market_lab python -m market_lab.cli show <run_id>`
  - `uv run --project market_lab python -m market_lab.cli events <run_id>`
  - `uv run --project market_lab python -m market_lab.cli settle <run_id>`
  - `uv run --project market_lab python -m market_lab.cli settle-due`
- Add optional convenience scripts or package commands that still delegate to the canonical `uv run --project market_lab ...` commands.
- Add optional Mac mini shell aliases to the docs only, not as required hidden setup: `mlab-run`, `mlab-show`, `mlab-events`, `mlab-settle`, and `mlab-settle-due`.
- Ensure `run AAPL --json` returns machine-readable output that Mission Control can consume.
- Ensure non-json CLI output remains readable for Hamel when run manually.
- Add a Market Lab smoke command to documentation, not launchd, for v0.

#### Testing

- `uv run --project market_lab python -m market_lab.cli --help`
- `uv run --project market_lab python -m market_lab.cli run AAPL --json`
- `uv run --project market_lab python -m market_lab.cli show <run_id>`
- `uv run --project market_lab python -m market_lab.cli events <run_id>`
- `uv run --project market_lab python -m market_lab.cli settle <run_id>`
- Optional aliases/scripts produce the same output shape as the canonical `uv` commands.

---

### Vertical 9 - QA Closeout

**cortana-external: prove the full vertical path and keep old backtester untouched.**

*Dependencies: V7, V8*

#### Jira

- Run one local manual review on the Mac mini with a known symbol when TradingAgents keys are configured.
- Verify `.cache/market_lab/runs/<run_id>/` contains `review.json`, `events.jsonl`, `tradingagents.md`, and `logs.txt`.
- Verify Mission Control page and API read the same Trust Verdict as `review.json`.
- Verify CLI `show`, `events`, and `settle` read the same run created by Mission Control.
- Verify Mission Control can read a run created from the CLI.
- Document any required local environment variables in `market_lab/README.md`.

#### Testing

- `uv run --project market_lab pytest`
- `cd apps/mission-control && npx vitest run`
- `cd apps/mission-control && pnpm build`
- Manual one-symbol review from Mission Control if provider keys are configured.
- Manual one-symbol review from CLI if provider keys are configured.

---

## Dependency Notes

### V1 before all engine work

The Pydantic contracts define the artifact shape. Checks, storage, settlement, and UI should depend on that contract rather than inventing local shapes.

### V2 before V6

Mission Control APIs need a stable run index and artifact paths. Building routes before storage risks fake UI state.

### V3 before V4

TradingAgents should be a second opinion layered onto deterministic facts. The facts/checks lane must exist before the agent opinion can be interpreted safely.

### V6 before V7

The UI should render API responses and artifacts, not reach directly into Python/cache paths.

---

## Scope Boundaries

### In Scope (This Plan)

- new top-level `market_lab/` Python project
- Pydantic review artifact contract
- filesystem artifacts and SQLite index
- one-symbol live review runs
- TradingAgents second-opinion adapter
- Trust Verdict calculation
- 1D/5D/20D settlement math
- Mission Control Market Lab APIs and page
- first-class CLI commands and optional aliases/scripts

### External Dependencies

- Local TS market-data service at `http://127.0.0.1:3033`
- TradingAgents fork at `/Users/hd/Developer/TradingAgents` or configured path
- LLM provider keys for real TradingAgents reviews

### Integration Points

- `apps/external-service/src/market-data/routes.ts` owns market-data HTTP routes.
- `apps/mission-control/lib/api-auth.ts` owns route auth helpers.
- `apps/mission-control/components/sidebar.tsx` owns Mission Control nav.
- `TradingAgents` fork owns agent review implementation.

---

## Realistic Delivery Notes

- **Biggest risks:** TradingAgents runtime latency, provider-key setup, ambiguous market-data quote timestamps, and accidentally copying old backtester complexity into the new module.
- **Assumptions:** one-symbol reviews are enough for v0; SQLite and filesystem artifacts are enough; no launchd service is required; old backtester code remains untouched except possible read-only reference.
- **Smallest credible path:** build Python contracts/storage/checks first, then fake TradingAgents adapter, then Mission Control API/UI, then replace fake adapter with real TradingAgents invocation.
