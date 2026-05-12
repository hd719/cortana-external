# QA Plan - Market Lab V1 Codex Analyst Committee

**Document Status:** Draft  
**PRD:** [v1-codex-analyst-committee.md](../PRDs/v1-codex-analyst-committee.md)  
**Tech Spec:** [v1-codex-analyst-committee.md](../TechSpecs/v1-codex-analyst-committee.md)  
**Implementation Plan:** [v1-codex-analyst-committee.md](../Implementation/v1-codex-analyst-committee.md)

## QA Goal

Prove that Codex-assisted Market Lab reviews are structured, role-based, UI-renderable, backward-compatible, and still subordinate to deterministic hard gates.

---

## Automated QA Matrix

| Area | Scenario | Expected Result |
|------|----------|-----------------|
| Models | Valid structured Codex review | Pydantic validates. |
| Models | Confidence below 0 or above 1 | Validation fails. |
| Models | Unknown role name | Validation fails. |
| Packet | Build packet for AAPL run | Packet contains required JSON schema and role list. |
| Packet | Run has blockers | Packet tells Codex blockers force `blocked`. |
| Parser | Markdown has fenced schema JSON | Parser extracts and validates structured object. |
| Parser | Markdown has only `Verdict:` line | Attach succeeds with markdown fallback. |
| Parser | Markdown has invalid JSON | Attach succeeds, records fallback/warning. |
| Attach | Structured verdict is trusted | `review.json.codex_review.structured.verdict` is `trusted`. |
| Attach | Structured verdict exists | `review.json.codex_review.verdict` matches structured verdict. |
| UI | Structured review loaded | Final judge, confidence, horizon, and role cards render. |
| UI | Old review loaded | Existing markdown summary fallback still renders. |
| Safety | Deterministic blocker exists | UI/prompt preserves blocked hard-gate state. |

---

## Required Commands

Run from repo root:

```bash
uv run --project market_lab pytest market_lab/tests
```

Run from Mission Control:

```bash
cd apps/mission-control
pnpm test app/market-lab/market-lab-client.test.tsx
pnpm build
```

Optional focused tests if added:

```bash
uv run --project market_lab pytest market_lab/tests/test_codex_review.py market_lab/tests/test_storage.py
```

---

## Manual Smoke

### Scenario 1 - Happy Path Structured Review

1. Run a new review:

```bash
uv run --project market_lab python -m market_lab.cli run AAPL --json
```

2. Open Mission Control Trading Ops -> Market Lab.
3. Select the new AAPL run.
4. Click `Ask Codex`.
5. Let Codex write and attach `codex-review.md`.
6. Refresh the run detail.

Expected:

- `codex-review.md` contains a fenced `json market-lab-codex-review/v1` block.
- `review.json` contains `codex_review.structured`.
- UI shows verdict, confidence, horizon, and role cards.
- Raw artifact path remains available for debugging.

---

### Scenario 2 - Markdown Fallback

1. Create or use a run.
2. Attach a markdown-only Codex review with a `Verdict:` line.

Expected:

- Attach command succeeds.
- `codex_review.verdict` is parsed if possible.
- `codex_review.structured` is null.
- UI falls back to summary text.

---

### Scenario 3 - Hard Gate Cannot Be Overridden

1. Use a fixture or fake market-data client that produces a stale market-hours quote.
2. Build a Codex packet.
3. Attach a Codex review that tries to say `trusted`.

Expected:

- Deterministic Market Lab verdict remains `blocked`.
- UI shows the hard blocker.
- Codex verdict can be shown as Codex opinion, but it does not rewrite the deterministic verdict.

---

## Regression Checks

- Existing V0 runs without structured Codex data still render.
- `Ask Codex` route still starts sessions.
- `attach-codex-review` still supports existing markdown reviews.
- Settlement display still works.
- No old backtester dependency is introduced.
- No Telegram, paper trading, or broker execution code is added.

---

## QA Exit Criteria

V1 is ready for implementation review when:

- all Python tests pass
- Market Lab UI tests pass
- Mission Control build passes
- one live AAPL/TSLA smoke confirms structured Codex output can be attached and rendered
- old markdown-only artifacts remain readable
- hard-gate precedence is demonstrated in tests

