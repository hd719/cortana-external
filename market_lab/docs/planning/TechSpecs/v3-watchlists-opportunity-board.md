# Technical Specification - Market Lab V3 Watchlists And Opportunity Board

**Document Status:** Draft
**PRD:** [v3-watchlists-opportunity-board.md](../PRDs/v3-watchlists-opportunity-board.md)

## Development Overview

V3 adds a watchlist ranking layer that uses V2 evidence and memory without invoking Codex for every symbol. The Python runtime owns scoring and artifacts. Mission Control renders the Watchlists tab and starts one-symbol reviews from candidates.

## New Python Modules

| Module | Responsibility |
|--------|----------------|
| `watchlists.py` | Load named watchlist definitions. |
| `opportunities.py` | Rank symbols from bounded watchlists. |

## Data Model

Add to `market_lab/market_lab/models.py`:

```python
class WatchlistDefinition(Model):
    name: str
    symbols: list[str]
    description: str | None = None

class OpportunityCandidate(Model):
    symbol: str
    rank: int
    score: float
    score_components: dict[str, float] = Field(default_factory=dict)
    review_label: str
    reasons: list[str] = Field(default_factory=list)
    blockers: list[str] = Field(default_factory=list)
    missing_context: list[str] = Field(default_factory=list)
    evidence_snapshot_path: str | None = None
    outcome_memory_summary: dict[str, Any] | None = None

class OpportunityBoardArtifact(Model):
    schema_version: str = "market-lab-opportunity-board/v1"
    board_id: str
    watchlist: str
    generated_at: str
    candidates: list[OpportunityCandidate]
```

Add:

```python
class OpportunityScoringConfig(Model):
    fresh_price_spy_points: float = 20
    no_hard_blockers_points: float = 10
    momentum_min_points: float = -10
    momentum_max_points: float = 25
    outcome_memory_min_points: float = -10
    outcome_memory_max_points: float = 20
    missing_context_max_penalty: float = 15
    risk_flags_max_penalty: float = 30
    high_threshold: float = 80
    medium_threshold: float = 60
    low_threshold: float = 40
```

## Scoring Contract

Default formula:

```text
candidate_score =
  fresh_price_spy_points
  + no_hard_blockers_points
  + momentum_points
  + outcome_memory_points
  - missing_context_penalty
  - risk_flags_penalty
```

Hard blockers bypass normal scoring and label the candidate `Blocked`.

The scorer must persist `score_components` so Mission Control can explain the rank.

Default components:

| Component | Default | Env var |
|-----------|---------|---------|
| Fresh price + SPY | `20` | `MARKET_LAB_OPP_FRESH_PRICE_SPY_POINTS` |
| No hard blockers | `10` | `MARKET_LAB_OPP_NO_HARD_BLOCKERS_POINTS` |
| Momentum min | `-10` | `MARKET_LAB_OPP_MOMENTUM_MIN_POINTS` |
| Momentum max | `25` | `MARKET_LAB_OPP_MOMENTUM_MAX_POINTS` |
| Outcome memory min | `-10` | `MARKET_LAB_OPP_OUTCOME_MEMORY_MIN_POINTS` |
| Outcome memory max | `20` | `MARKET_LAB_OPP_OUTCOME_MEMORY_MAX_POINTS` |
| Missing context max penalty | `15` | `MARKET_LAB_OPP_MISSING_CONTEXT_MAX_PENALTY` |
| Risk flags max penalty | `30` | `MARKET_LAB_OPP_RISK_FLAGS_MAX_PENALTY` |
| High threshold | `80` | `MARKET_LAB_OPP_HIGH_THRESHOLD` |
| Medium threshold | `60` | `MARKET_LAB_OPP_MEDIUM_THRESHOLD` |
| Low threshold | `40` | `MARKET_LAB_OPP_LOW_THRESHOLD` |

Environment overrides should be parsed once at runtime and validated. Invalid values should fall back to defaults and add a warning to the board artifact.

## Storage

Persist board artifacts under:

```text
.cache/market_lab/opportunities/<board_id>/opportunities.json
```

SQLite indexing can be added later if board history becomes useful.

## CLI

Add:

```bash
uv run --project market_lab python -m market_lab.cli opportunities --watchlist core --json
uv run --project market_lab python -m market_lab.cli opportunities --symbols AAPL,MSFT,NVDA --json
```

Purpose:

- `--watchlist core` loads a saved named watchlist, scores every symbol in it, and writes a ranked opportunity board artifact.
- `--symbols AAPL,MSFT,NVDA` skips saved watchlists and scores only the ad hoc symbols supplied by the operator.
- Both commands are for operator/debug/dev workflows and should be safe to run from the terminal.
- Neither command starts Codex.
- Neither command produces BUY/SELL recommendations.

Conceptual JSON output:

```json
{
  "board_id": "mlab_opp_20260513_core",
  "watchlist": "core",
  "generated_at": "2026-05-13T14:05:00Z",
  "candidates": [
    {
      "symbol": "NVDA",
      "rank": 1,
      "score": 82,
      "review_label": "Review Priority High",
      "reasons": ["fresh data", "outperforming SPY", "strong prior outcomes"],
      "blockers": [],
      "missing_context": []
    },
    {
      "symbol": "AAPL",
      "rank": 2,
      "score": 65,
      "review_label": "Review Priority Medium",
      "reasons": ["fresh data", "stable momentum"],
      "blockers": [],
      "missing_context": ["sentiment"]
    }
  ]
}
```

## API

Add:

```text
POST /api/market-lab/opportunities
GET /api/market-lab/opportunities/:boardId
```

Purpose:

- `POST /api/market-lab/opportunities` is the Mission Control version of the CLI generation command. The Watchlists tab calls it when the operator refreshes or scores a watchlist.
- `GET /api/market-lab/opportunities/:boardId` reloads a previously generated board so the UI can render the same ranked candidates again.
- The API exists for the UI workflow; the CLI exists for local/debug/operator workflow.
- API handlers should call the same Python CLI/bridge path as other Market Lab APIs so scoring logic stays in Python.

## Mission Control

Update:

- `apps/mission-control/lib/market-lab.ts`
- `apps/mission-control/app/services/tabs/trading-ops-tab.tsx`
- `apps/mission-control/app/api/market-lab/opportunities/route.ts`

The Watchlists tab should show:

- watchlist selector
- ranked candidates
- score/reasons/blockers/missing context
- score component breakdown
- `Run Review` action

## Risks

| Risk | Mitigation |
|------|------------|
| Ranking looks like a trade signal | Use review-priority language only. |
| Slow watchlists | Bound list size and avoid Codex fanout. |
| Missing data creates noisy rankings | Show missing context and downgrade confidence. |
| Scoring knobs become confusing | Keep defaults documented and persist active config with each board. |
