# QA Plan - Market Lab V3 Watchlists And Opportunity Board

**Document Status:** Implemented in PR #346
**PRD:** [v3-watchlists-opportunity-board.md](../PRDs/v3-watchlists-opportunity-board.md)
**Tech Spec:** [v3-watchlists-opportunity-board.md](../TechSpecs/v3-watchlists-opportunity-board.md)
**Implementation Plan:** [v3-watchlists-opportunity-board.md](../Implementation/v3-watchlists-opportunity-board.md)

## QA Goal

Prove that watchlists rank review candidates without Codex fanout, without BUY/SELL language, and with a clean handoff into one-symbol Market Lab review.

## Automated Matrix

| Area | Scenario | Expected Result |
|------|----------|-----------------|
| Watchlists | Default watchlist loads | Symbols are returned. |
| Watchlists | Invalid symbol appears | Validation catches or excludes it. |
| Scoring | Fresh evidence exists | Candidate receives reasons and score. |
| Scoring | Hard blocker exists | Candidate shows blocker and lower score. |
| Scoring | Optional context missing | Missing context is visible. |
| Scoring | Default weights used | Score matches the documented component formula. |
| Scoring | Env var overrides weight | Score changes according to override. |
| Scoring | Invalid env var override | Default is used and warning is recorded. |
| Codex | Board is generated | No Codex session starts. |
| CLI | `--watchlist core` runs | Saved watchlist is scored and board id is returned. |
| CLI | `--symbols AAPL,MSFT,NVDA` runs | Ad hoc symbols are scored and board id is returned. |
| API | `POST /api/market-lab/opportunities` runs | Board is generated through the same Python scoring path. |
| API | `GET /api/market-lab/opportunities/:boardId` runs | Existing board is returned without re-scoring. |
| UI | Watchlists tab opens | Retired legacy card is gone. |
| UI | Candidate selected | `Run Review` action is available. |
| UI | Candidate expanded | Score components are visible. |
| Copy | Candidate renders | No BUY/SELL language. |

## Commands

```bash
uv run --project market_lab pytest market_lab/tests
cd apps/mission-control && pnpm test app/market-lab/market-lab-client.test.tsx lib/market-lab.test.ts
cd apps/mission-control && pnpm build
```

## Manual Smoke

1. Run:

```bash
uv run --project market_lab python -m market_lab.cli opportunities --symbols AAPL,MSFT,NVDA --json
```

2. Open Trading Ops -> Watchlists.
3. Confirm ranked candidates render.
4. Click `Run Review` for one candidate.

Expected:

- Board artifact exists.
- Candidate reasons/blockers are visible.
- Candidate score components are visible.
- Market Lab review starts for the selected symbol.

## Scoring Fixture

Use a deterministic fixture:

```text
Fresh price + SPY: +20
No hard blockers: +10
Momentum vs SPY: +18
Outcome memory: +12
Missing sentiment: -5
Risk flags: 0
Expected score: 55
Expected label: Review Priority Low
```

Then override one env var:

```bash
MARKET_LAB_OPP_MOMENTUM_MAX_POINTS=35
```

Expected:

- score changes only through the momentum component
- board artifact records the active config
- UI still explains the components
