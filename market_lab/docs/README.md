# Market Lab

Market Lab is a new application direction in `cortana-external`, separate from the old backtester workstreams.

Mission statement:

> A system that lets you test, explain, compare, and trust trading decisions before they ever become real alerts or execution candidates.

## Planning Docs

- PRD: [planning/PRDs/v0-forward-looking-trust-reviews.md](planning/PRDs/v0-forward-looking-trust-reviews.md)
- Tech Spec: [planning/TechSpecs/v0-forward-looking-trust-reviews.md](planning/TechSpecs/v0-forward-looking-trust-reviews.md)
- Implementation Plan: [planning/Implementation/v0-forward-looking-trust-reviews.md](planning/Implementation/v0-forward-looking-trust-reviews.md)
- QA Plan: [planning/QA/v0-forward-looking-trust-reviews.md](planning/QA/v0-forward-looking-trust-reviews.md)

## V0 Status

Implemented in PR #336 on branch `codex/market-lab-v0-implementation-20260510`.

Completed:

- top-level `market_lab/` Python engine
- Pydantic review artifact contracts
- SQLite run index and filesystem artifacts under `.cache/market_lab/`
- market-data service client and deterministic freshness/evidence checks
- Trust Verdict logic: `trusted`, `uncertain`, `blocked`
- TradingAgents adapter boundary with fake-mode smoke support
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
