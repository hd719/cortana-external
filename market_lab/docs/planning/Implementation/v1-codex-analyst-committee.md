# Implementation Plan - Market Lab V1 Codex Analyst Committee

**Document Status:** Implemented in PR #344  
**PRD:** [v1-codex-analyst-committee.md](../PRDs/v1-codex-analyst-committee.md)  
**Tech Spec:** [v1-codex-analyst-committee.md](../TechSpecs/v1-codex-analyst-committee.md)

## Dependency Map

| Vertical | Dependencies | Outcome |
|----------|--------------|---------|
| V1 - Structured Codex Models | V0 Market Lab | Python can validate role-based Codex output with evidence and context fields. |
| V2 - Context Packet And Parser | V1 | Codex receives richer bounded context and writes parseable committee JSON. |
| V3 - Artifact Attach Upgrade | V1, V2 | `review.json` stores structured Codex review data. |
| V4 - Mission Control Rendering | V3 | UI shows analyst-role panels. |
| V5 - Settlement Operations | V0 settlement storage | UI and launchd can run `settle-due` so history keeps itself current. |
| V6 - QA And E2E Smoke | V1-V5 | A real run can be reviewed, attached, settled, rendered, and built. |

---

## Recommended Execution Order

```text
Commit 1: Structured Python models and parser tests
Commit 2: Codex context packet, schema instructions, and attach flow
Commit 3: Mission Control type/UI rendering
Commit 4: Settle-due UI/API/schedule
Commit 5: QA docs/tests/build cleanup
```

Keep each commit small enough to review independently.

---

## Vertical 1 - Structured Codex Models

Outcome: Market Lab has a typed contract for role-based Codex analysis.

Files:

- `market_lab/market_lab/models.py`
- `market_lab/tests/test_models.py` or `market_lab/tests/test_storage.py`

Tasks:

- Add `CodexRoleReview`.
- Add `CodexStructuredReview`.
- Add role-level `confidence` and `evidence_used`.
- Add structured `context_quality` and `missing_context`.
- Extend `CodexReview` with optional `structured`.
- Keep backward compatibility for old `codex_review` objects without structured data.

Tests:

- Valid structured payload validates.
- Invalid confidence fails.
- Invalid role fails.
- Missing required context quality fails for structured reviews.
- Existing markdown-only attached review still validates.

---

## Vertical 2 - Context Packet And Parser

Outcome: Codex receives clear instructions plus enough bounded context to produce a review that can be trusted, rejected, or measured.

Files:

- `market_lab/market_lab/codex_review.py`
- `market_lab/market_lab/storage.py`
- `market_lab/tests/test_storage.py`
- `market_lab/tests/test_codex_review.py`

Tasks:

- Update `build_codex_packet` to require the fenced JSON block.
- Remove the current packet's old primary output shape: `Summary`, `Bull Case`, `Bear Case`, `Missing Evidence`, `Decision`.
- Replace it with explicit role sections for `price_action`, `fundamentals`, `news_sentiment`, `risk`, and `final_judge`.
- Include role names and expected fields in the packet.
- Add a context inventory section with symbol price, SPY reference, market-hours basis, hard gates, recent movement, risk flags, and missing optional evidence.
- Explain in the packet that SPY is the benchmark and 1D/5D/20D settlement scores stock return versus SPY return.
- Include prior same-symbol runs and settlement summaries when available.
- State explicitly that Codex must not infer missing facts.
- State explicitly that Codex is not trusted because the prompt sounds good; trust depends on evidence, admitted gaps, confidence, and settlement performance.
- Add parser helper for ````json market-lab-codex-review/v1` blocks.
- Validate parsed JSON with `CodexStructuredReview`.
- Preserve existing `Verdict:` regex fallback.

Tests:

- Packet contains `price_action`, `fundamentals`, `news_sentiment`, `risk`, and `final_judge`.
- Packet contains context inventory sections.
- Packet explains SPY benchmark / alpha scoring.
- Packet forbids inventing unavailable news/fundamental/sentiment facts.
- Packet no longer presents the old free-form markdown review as the primary output contract.
- Parser extracts valid JSON from markdown.
- Parser returns null/fallback for markdown-only reviews.

---

## Vertical 3 - Artifact Attach Upgrade

Outcome: Attaching a Codex review enriches `review.json` with structured committee output.

Files:

- `market_lab/market_lab/storage.py`
- `market_lab/market_lab/cli.py`
- `market_lab/tests/test_storage.py`

Tasks:

- On `attach-codex-review`, parse structured block.
- Store `codex_review.structured`.
- Set `codex_review.verdict` from structured verdict when present.
- Persist role evidence, role confidence, `context_quality`, and `missing_context`.
- Append a `codex_review_attached` event as today.
- Optionally append `codex_review_parse_warning` if markdown attaches but JSON is missing/invalid.

Tests:

- Attach valid structured review and assert `review.json` contains role data.
- Attach markdown-only review and assert no hard failure.
- Attach invalid structured review and assert fallback behavior is debuggable.

---

## Vertical 4 - Mission Control Rendering

Outcome: Market Lab UI reads the structured schema, shows a useful analyst committee, and keeps Codex review as an explicit operator action.

Files:

- `apps/mission-control/lib/market-lab.ts`
- `apps/mission-control/app/market-lab/market-lab-client.tsx`
- `apps/mission-control/app/market-lab/market-lab-client.test.tsx`

Tasks:

- Extend TypeScript types for `codex_review.structured`.
- Add final judge strip: verdict, confidence, horizon.
- Add context quality strip: what Codex used and what was missing.
- Add role cards: price action, fundamentals, news/sentiment, risk, final judge.
- Add role confidence and evidence-used rendering.
- Keep `Ask Codex` manual by default.
- Show Codex review state as not requested, requested, attached, or failed.
- Keep current markdown summary fallback for old runs.
- Keep debug artifact paths collapsed by default.

Tests:

- Structured review renders final judge values.
- Role cards render bull/bear/missing evidence.
- Old markdown-only review still renders.

---

## Vertical 5 - Settlement Operations

Outcome: settlement history does not depend on Hamel remembering to click a per-run button.

Files:

- `apps/mission-control/lib/market-lab.ts`
- `apps/mission-control/app/api/market-lab/settle-due/route.ts`
- `apps/mission-control/app/market-lab/market-lab-client.tsx`
- `market_lab/scripts/settle-due.sh`
- `market_lab/launchd/com.cortana.market-lab-settle-due.plist`

Tasks:

- Add a `settleDueMarketLabRuns` bridge for the CLI `settle-due` command.
- Add a same-origin protected API route for `POST /api/market-lab/settle-due`.
- Make per-run `Settle` report whether windows are due, settled, or still not due.
- Add a visible `Settle due` UI action for operator backfill.
- Add a launchd-safe shell wrapper and plist for scheduled after-close settlement.

Tests:

- API route calls the `settle-due` bridge.
- UI calls `Settle due` and reports the result.
- Per-run `Settle` reports a `not_due` result instead of looking like a no-op.

---

## Vertical 6 - QA And E2E Smoke

Outcome: V1 is proven against unit tests, build, one live/manual Codex flow, and settlement operations.

Commands:

```bash
uv run --project market_lab pytest market_lab/tests
cd apps/mission-control && pnpm test app/market-lab/market-lab-client.test.tsx
cd apps/mission-control && pnpm build
```

Manual smoke:

1. Run `uv run --project market_lab python -m market_lab.cli run AAPL --json`.
2. Open Market Lab in Mission Control.
3. Select the AAPL run.
4. Click `Ask Codex`.
5. Confirm Codex writes `codex-review.md`.
6. Confirm attach updates `review.json`.
7. Confirm UI renders final judge, context quality, missing context, role confidence, and role panels.

Implementation note: V1 is implemented as the structured Codex schema, richer bounded packet, attach parser, manual `Ask Codex` guardrail, and Mission Control role rendering. The Mac mini smoke should still be run after the branch is deployed there because it depends on the live market-data and Codex-session environment.

---

## Scope Boundaries

In scope:

- structured Codex review schema
- richer bounded Codex context packet
- role-based prompt output
- manual `Ask Codex` guardrail
- parsing/attachment
- Mission Control rendering
- tests and manual smoke

Out of scope:

- new providers
- Telegram alerts
- execution candidates
- batch scanner
- historical backtesting
- paid API mode for TradingAgents
- automatic Codex review by default
