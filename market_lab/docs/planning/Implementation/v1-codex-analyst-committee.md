# Implementation Plan - Market Lab V1 Codex Analyst Committee

**Document Status:** Draft  
**PRD:** [v1-codex-analyst-committee.md](../PRDs/v1-codex-analyst-committee.md)  
**Tech Spec:** [v1-codex-analyst-committee.md](../TechSpecs/v1-codex-analyst-committee.md)

## Dependency Map

| Vertical | Dependencies | Outcome |
|----------|--------------|---------|
| V1 - Structured Codex Models | V0 Market Lab | Python can validate role-based Codex output. |
| V2 - Packet And Parser | V1 | Codex is instructed to write parseable committee JSON. |
| V3 - Artifact Attach Upgrade | V1, V2 | `review.json` stores structured Codex review data. |
| V4 - Mission Control Rendering | V3 | UI shows analyst-role panels. |
| V5 - QA And E2E Smoke | V1-V4 | A real run can be reviewed, attached, rendered, and built. |

---

## Recommended Execution Order

```text
Commit 1: Structured Python models and parser tests
Commit 2: Codex packet schema instructions and attach flow
Commit 3: Mission Control type/UI rendering
Commit 4: QA docs/tests/build cleanup
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
- Extend `CodexReview` with optional `structured`.
- Keep backward compatibility for old `codex_review` objects without structured data.

Tests:

- Valid structured payload validates.
- Invalid confidence fails.
- Invalid role fails.
- Existing markdown-only attached review still validates.

---

## Vertical 2 - Packet And Parser

Outcome: Codex receives clear instructions and Market Lab can parse the JSON contract.

Files:

- `market_lab/market_lab/codex_review.py`
- `market_lab/market_lab/storage.py`
- `market_lab/tests/test_storage.py`
- `market_lab/tests/test_codex_review.py`

Tasks:

- Update `build_codex_packet` to require the fenced JSON block.
- Include role names and expected fields in the packet.
- Add parser helper for ````json market-lab-codex-review/v1` blocks.
- Validate parsed JSON with `CodexStructuredReview`.
- Preserve existing `Verdict:` regex fallback.

Tests:

- Packet contains `price_action`, `fundamentals`, `news_sentiment`, `risk`, and `final_judge`.
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
- Append a `codex_review_attached` event as today.
- Optionally append `codex_review_parse_warning` if markdown attaches but JSON is missing/invalid.

Tests:

- Attach valid structured review and assert `review.json` contains role data.
- Attach markdown-only review and assert no hard failure.
- Attach invalid structured review and assert fallback behavior is debuggable.

---

## Vertical 4 - Mission Control Rendering

Outcome: Market Lab UI reads the structured schema and shows a useful analyst committee.

Files:

- `apps/mission-control/lib/market-lab.ts`
- `apps/mission-control/app/market-lab/market-lab-client.tsx`
- `apps/mission-control/app/market-lab/market-lab-client.test.tsx`

Tasks:

- Extend TypeScript types for `codex_review.structured`.
- Add final judge strip: verdict, confidence, horizon.
- Add role cards: price action, fundamentals, news/sentiment, risk, final judge.
- Keep current markdown summary fallback for old runs.
- Keep debug artifact paths collapsed by default.

Tests:

- Structured review renders final judge values.
- Role cards render bull/bear/missing evidence.
- Old markdown-only review still renders.

---

## Vertical 5 - QA And E2E Smoke

Outcome: V1 is proven against unit tests, build, and one live/manual Codex flow.

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
7. Confirm UI renders final judge and role panels.

---

## Scope Boundaries

In scope:

- structured Codex review schema
- role-based prompt output
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

