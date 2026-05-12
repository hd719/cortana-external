# Market Lab Roadmap

**Document Status:** Lightweight roadmap  
**Last Updated:** 2026-05-13

This file summarizes the version ladder. Each formal version should have the full planning set:

```text
PRD
Tech Spec
Implementation Plan
QA Plan
```

## Formal Planning Sets

V2:

- [PRD](PRDs/v2-tradingagents-inspired-market-intelligence.md)
- [Tech Spec](TechSpecs/v2-tradingagents-inspired-market-intelligence.md)
- [Implementation Plan](Implementation/v2-tradingagents-inspired-market-intelligence.md)
- [QA Plan](QA/v2-tradingagents-inspired-market-intelligence.md)

V3:

- [PRD](PRDs/v3-watchlists-opportunity-board.md)
- [Tech Spec](TechSpecs/v3-watchlists-opportunity-board.md)
- [Implementation Plan](Implementation/v3-watchlists-opportunity-board.md)
- [QA Plan](QA/v3-watchlists-opportunity-board.md)

V4:

- [PRD](PRDs/v4-portfolio-intelligence.md)
- [Tech Spec](TechSpecs/v4-portfolio-intelligence.md)
- [Implementation Plan](Implementation/v4-portfolio-intelligence.md)
- [QA Plan](QA/v4-portfolio-intelligence.md)

V5:

- [PRD](PRDs/v5-execution-readiness.md)
- [Tech Spec](TechSpecs/v5-execution-readiness.md)
- [Implementation Plan](Implementation/v5-execution-readiness.md)
- [QA Plan](QA/v5-execution-readiness.md)

## Future Directions

### V3 - Watchlists / Opportunity Board

Use the existing Mission Control Watchlists tab as the idea-discovery surface.

V3 should answer:

```text
Which symbols from my watchlists deserve review today?
```

Likely scope:

- named watchlists
- deterministic ranking without Codex fanout
- reasons, blockers, and missing context per symbol
- `Run Market Lab Review` action into the one-symbol review flow
- no portfolio holdings logic
- no BUY/SELL language

### V4 - Portfolio Intelligence

Add read-only portfolio awareness as a separate layer from watchlists.

V4 should answer:

```text
What do I already own, and how would this idea affect my exposure?
```

Likely scope:

- read-only holdings/exposure adapter
- Schwab Trader API account/position import first, manual snapshot fallback second
- concentration and overlap context
- portfolio panel inside Market Lab
- no execution-capable APIs

### V5 - Execution Readiness

Define the supervised execution boundary before any broker integration.

V5 should answer:

```text
Could this review ever become an approved execution candidate?
```

Likely scope:

- execution-intent artifact
- approval gates
- broker adapter boundary
- audit trail
- no strategy/review module calling broker APIs directly
