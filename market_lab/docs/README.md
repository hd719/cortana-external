# Market Lab

Market Lab is a new application direction in `cortana-external`, separate from the old backtester workstreams.

Mission statement:

> A system that lets you test, explain, compare, and trust trading decisions before they ever become real alerts or execution candidates.

## Planning Docs

| Version | PRD | Tech Spec | Implementation | QA |
|---------|-----|-----------|----------------|----|
| V0 | [PRD](planning/PRDs/v0-forward-looking-trust-reviews.md) | [Tech Spec](planning/TechSpecs/v0-forward-looking-trust-reviews.md) | [Implementation](planning/Implementation/v0-forward-looking-trust-reviews.md) | [QA](planning/QA/v0-forward-looking-trust-reviews.md) |
| V1 | [PRD](planning/PRDs/v1-codex-analyst-committee.md) | [Tech Spec](planning/TechSpecs/v1-codex-analyst-committee.md) | [Implementation](planning/Implementation/v1-codex-analyst-committee.md) | [QA](planning/QA/v1-codex-analyst-committee.md) |
| V2 | [PRD](planning/PRDs/v2-tradingagents-inspired-market-intelligence.md) | [Tech Spec](planning/TechSpecs/v2-tradingagents-inspired-market-intelligence.md) | [Implementation](planning/Implementation/v2-tradingagents-inspired-market-intelligence.md) | [QA](planning/QA/v2-tradingagents-inspired-market-intelligence.md) |
| V3 | [PRD](planning/PRDs/v3-watchlists-opportunity-board.md) | [Tech Spec](planning/TechSpecs/v3-watchlists-opportunity-board.md) | [Implementation](planning/Implementation/v3-watchlists-opportunity-board.md) | [QA](planning/QA/v3-watchlists-opportunity-board.md) |
| V4 | [PRD](planning/PRDs/v4-portfolio-intelligence.md) | [Tech Spec](planning/TechSpecs/v4-portfolio-intelligence.md) | [Implementation](planning/Implementation/v4-portfolio-intelligence.md) | [QA](planning/QA/v4-portfolio-intelligence.md) |
| V5 | [PRD](planning/PRDs/v5-execution-readiness.md) | [Tech Spec](planning/TechSpecs/v5-execution-readiness.md) | [Implementation](planning/Implementation/v5-execution-readiness.md) | [QA](planning/QA/v5-execution-readiness.md) |

## V0 Status

Implemented in PR #336 on branch `codex/market-lab-v0-implementation-20260510`.

Completed:

- top-level `market_lab/` Python engine
- Pydantic review artifact contracts
- SQLite run index and filesystem artifacts under `.cache/market_lab/`
- market-data service client and deterministic freshness/evidence checks
- Trust Verdict logic: `trusted`, `uncertain`, `blocked`
- Codex-assisted review packets and Mission Control `Ask Codex` handoff
- 1D/5D/20D settlement windows and SPY-relative scoring
- first-class CLI commands plus `pnpm market-lab -- ...`
- Mission Control `/market-lab` page and sidebar nav
- Mission Control API routes for list/create/detail/events/settle
- automated Python and Mission Control test coverage
- live API/CLI smoke proving Mission Control-created runs can be read from CLI

Not included in V0:

- broker execution
- paper trading
- Telegram alerts
- historical as-of-date backtesting
- multi-symbol batch reviews
- replacing or deleting the old backtester

## Naming

- `market_lab/` is the single Market Lab home.
- `market_lab/docs/` contains product and planning docs.
- `market_lab/market_lab/` contains the Python runtime package.
