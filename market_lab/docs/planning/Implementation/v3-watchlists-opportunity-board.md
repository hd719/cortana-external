# Implementation Plan - Market Lab V3 Watchlists And Opportunity Board

**Document Status:** Implemented in PR #346
**PRD:** [v3-watchlists-opportunity-board.md](../PRDs/v3-watchlists-opportunity-board.md)
**Tech Spec:** [v3-watchlists-opportunity-board.md](../TechSpecs/v3-watchlists-opportunity-board.md)

## Dependency Map

| Vertical | Dependencies | Outcome |
|----------|--------------|---------|
| V1 - Watchlist Definitions | V2 evidence | Named watchlists can be loaded. |
| V2 - Opportunity Scoring | V1 | Symbols are ranked without Codex. |
| V3 - CLI/API | V1-V2 | Operator and UI can generate boards. |
| V4 - Watchlists Tab UI | V3 | Mission Control renders candidates. |
| V5 - QA/E2E | All | Board flow is verified. |

## Execution Order

```text
Commit 1: Watchlist definitions and fixtures
Commit 2: Opportunity scoring and artifact storage
Commit 3: CLI and API bridge
Commit 4: Mission Control Watchlists tab
Commit 5: Tests and QA
```

## Vertical 1 - Watchlist Definitions

Files:

- `market_lab/market_lab/watchlists.py`
- `market_lab/tests/test_watchlists.py`

Tasks:

- Add default named watchlists.
- Support explicit `--symbols`.
- Validate ticker symbols.

## Vertical 2 - Opportunity Scoring

Files:

- `market_lab/market_lab/opportunities.py`
- `market_lab/market_lab/models.py`
- `market_lab/tests/test_opportunities.py`

Tasks:

- Build evidence snapshot per symbol.
- Score using freshness, blockers, momentum, and outcome memory.
- Add configurable scoring defaults with environment variable overrides.
- Persist score components for every candidate.
- Persist active scoring config with the board artifact.
- Persist `opportunities.json`.
- Avoid Codex calls.

## Vertical 3 - CLI/API

Files:

- `market_lab/market_lab/cli.py`
- `apps/mission-control/lib/market-lab.ts`
- `apps/mission-control/app/api/market-lab/opportunities/route.ts`

Tasks:

- Add `opportunities` CLI command.
- Document that `--watchlist core` scores a saved list and `--symbols AAPL,MSFT,NVDA` scores an ad hoc list.
- Return a board id, generated timestamp, watchlist/source name, ranked candidates, score components, reasons, blockers, and missing context.
- Include active scoring config in `--json` output.
- Add API bridge.
- Return board artifact paths and candidates.
- Add `POST /api/market-lab/opportunities` for Mission Control to generate a board.
- Add `GET /api/market-lab/opportunities/:boardId` for Mission Control to reload a board.
- Keep all scoring logic in Python; TypeScript should bridge and render.

## Vertical 4 - Watchlists Tab UI

Files:

- `apps/mission-control/app/services/tabs/trading-ops-tab.tsx`
- `apps/mission-control/app/market-lab/market-lab-client.test.tsx`

Tasks:

- Replace retired watchlist card.
- Render watchlist selector and candidates.
- Render score component breakdown.
- Add `Run Review` action.
- Keep copy review-focused.

## Vertical 5 - QA/E2E

Commands:

```bash
uv run --project market_lab pytest market_lab/tests
cd apps/mission-control && pnpm test app/market-lab/market-lab-client.test.tsx lib/market-lab.test.ts
cd apps/mission-control && pnpm build
```

Manual smoke:

1. Generate a board for `AAPL,MSFT,NVDA`.
2. Open Watchlists tab.
3. Confirm candidates render.
4. Confirm score components explain ranking.
5. Start a Market Lab review from one candidate.
