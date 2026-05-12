# Implementation Plan - Market Lab V4 Portfolio Intelligence

**Document Status:** Draft
**PRD:** [v4-portfolio-intelligence.md](../PRDs/v4-portfolio-intelligence.md)
**Tech Spec:** [v4-portfolio-intelligence.md](../TechSpecs/v4-portfolio-intelligence.md)

## Dependency Map

| Vertical | Dependencies | Outcome |
|----------|--------------|---------|
| V1 - Portfolio Models | Market Lab V2 | Typed read-only portfolio context. |
| V2 - Schwab Read-Only Probe | V1 | Account access can be verified without orders. |
| V3 - Adapter | V2 | Context can be loaded or marked unavailable. |
| V4 - Review Integration | V3 | Review artifacts include context. |
| V5 - UI | V4 | Mission Control renders portfolio context. |
| V6 - QA | All | Safety boundary is verified. |

## Verticals

### V1 - Portfolio Models

Files:

- `market_lab/market_lab/models.py`
- `market_lab/tests/test_portfolio_context.py`

Tasks:

- Add `PortfolioPosition`.
- Add `PortfolioAccount`.
- Add `PortfolioContext`.
- Extend review artifact.

### V2 - Schwab Read-Only Probe

Files:

- `market_lab/market_lab/schwab_portfolio.py`
- `market_lab/tests/test_schwab_portfolio.py`

Tasks:

- Reuse existing Schwab OAuth token cache when available.
- Probe `GET /trader/v1/accounts/accountNumbers`.
- Fetch `GET /trader/v1/accounts?fields=positions`.
- Return `reauth_required` for `401`/`403`.
- Redact raw account numbers from logs and artifacts.

### V3 - Adapter

Files:

- `market_lab/market_lab/portfolio_context.py`
- `market_lab/market_lab/schwab_portfolio.py`

Tasks:

- Add read-only loader.
- Normalize Schwab balances and positions.
- Cache `.cache/market_lab/portfolio/schwab-portfolio-latest.json`.
- Keep local/manual snapshot fallback.
- Return `unavailable` safely.
- Prevent execution methods.

### V4 - Review Integration

Files:

- `market_lab/market_lab/runner.py`
- `market_lab/market_lab/codex_review.py`

Tasks:

- Attach portfolio context to review artifacts.
- Include concise context in deep Codex packet.

### V5 - UI

Files:

- `apps/mission-control/app/services/tabs/trading-ops-tab.tsx`
- `apps/mission-control/lib/market-lab.ts`

Tasks:

- Render portfolio status.
- Show current symbol ownership/overlap.
- Collapse detailed holdings.
- Add read-only refresh action.
- Show `reauth_required` with clear operator wording.

### V6 - QA

Commands:

```bash
uv run --project market_lab pytest market_lab/tests
cd apps/mission-control && pnpm build
```
