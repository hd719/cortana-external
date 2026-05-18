# Technical Specification - Market Lab V7 Research Depth And Learning

**Document Status:** Proposed
**PRD:** [v7-research-depth-and-learning.md](../PRDs/v7-research-depth-and-learning.md)

## Development Overview

V7 deepens the research pipeline without changing the safety posture. It adds deterministic evidence before Codex and gives Codex a compact role-based packet instead of a full raw artifact.

The system should keep this order:

```text
collect prices
-> collect source items
-> filter and score source quality
-> collect fundamentals
-> compute momentum versus SPY
-> build compact Codex role packet
-> attach role outputs
-> settle over time
```

## Product Requirement Traceability

This table connects each PRD requirement to the technical contract and the implementation vertical that builds it.

| PRD ID | Product Intent | Tech Spec Concepts | Implementation Vertical |
|--------|----------------|--------------------|--------------------------|
| PRD-R1 | Clean noisy news/social evidence before analysis. | `SourceItem`, `SourceQualitySnapshot`, Source Quality Module | V1 - Source Quality |
| PRD-R2 | Keep every source auditable with links and timestamps. | `SourceItem.url`, `published_at`, `fetched_at`, `source_status`, relevance fields | V1 - Source Quality, V6 - Mission Control |
| PRD-R3 | Explain why source evidence matters. | `SourceQualitySnapshot.why_this_matters`, `cautions`, relevance scoring | V1 - Source Quality, V6 - Mission Control |
| PRD-R4 | Show verified fundamentals, or clearly explain which fields are missing. | `FundamentalsSnapshot`, Fundamentals Module, unavailable-field tracking | V3 - Fundamentals, V6 - Mission Control |
| PRD-R5 | Compute stock-vs-SPY momentum before Codex review. | `MomentumWindow`, `MomentumSnapshot`, Momentum Module | V2 - Momentum, V6 - Mission Control |
| PRD-R6 | Make Codex output role-specific analysis. | `AnalystRoleOutput`, Role Flow | V4 - Compact Codex Roles, V6 - Mission Control |
| PRD-R7 | Keep Codex packets compact and auditable. | Compact Codex Packet, packet caps, role instructions, output schema | V4 - Compact Codex Roles |
| PRD-R8 | Build outcome memory without letting tiny sample sizes drive decisions. | `OutcomeMemorySummary`, sample threshold, Settlement Learning | V5 - Settlement Learning |
| PRD-R9 | Show the new evidence without cluttering Mission Control. | Mission Control rendering for source quality, fundamentals, momentum, roles, memory | V6 - Mission Control |

## Vertical Build Order

| Vertical | Consumes | Produces | Why It Comes Here |
|----------|----------|----------|-------------------|
| V1 - Source Quality | Existing Yahoo/StockTwits/Reddit collectors | Normalized, filtered source evidence | Later Codex roles need clean source evidence first. |
| V2 - Momentum | Schwab/current price and available history | Deterministic relative-strength snapshot | Price analyst needs momentum before role review. |
| V3 - Fundamentals | Selected free/reliable fundamentals provider | Fundamentals snapshot with unavailable fields | Fundamentals analyst needs explicit context or explicit missing data. |
| V4 - Compact Codex Roles | V1, V2, V3, risk flags, outcome memory summary | Compact packet and role outputs | Codex should review the assembled evidence, not raw artifacts. |
| V5 - Settlement Learning | Existing settlement records and role verdicts | Outcome memory summary | Future reviews can see whether prior evidence-ready calls worked. |
| V6 - Mission Control | V1-V5 artifacts | Operator-facing UI panels | UI should render the finished evidence contracts, not invent logic. |
| V7 - QA | All V7 artifacts and UI flows | Verified fixture and live paths | Final validation checks the full chain. |

## Storage Layout

Market Lab uses a local cache root plus a SQLite run index.

- Default cache root: `<repo>/.cache/market_lab`
- Override: `MARKET_LAB_CACHE_DIR`
- Run index database: `<cache-root>/market_lab.sqlite`
- Per-run artifacts: `<cache-root>/runs/<run_id>/`

Prod/dev separation should happen by giving each Mission Control environment a different `MARKET_LAB_CACHE_DIR`:

```text
<repo>/.cache/market_lab/prod
<repo>/.cache/market_lab/dev
<repo>/.cache/market_lab/ci
```

In that setup, a prod run lives at:

```text
<repo>/.cache/market_lab/prod/runs/<run_id>/
```

V7 artifacts should live with the run whenever they are specific to that run:

| Artifact | Producer | Consumer |
|----------|----------|----------|
| `source-quality.json` | Source Quality Module | News analyst, Mission Control |
| `fundamentals.json` | Fundamentals Module | Fundamentals analyst, Mission Control |
| `momentum.json` | Momentum Module | Price analyst, Mission Control |
| `outcome-memory.json` | Settlement Learning | Final judge, Mission Control |
| `codex-review-packet.md` | Compact Codex Packet | Codex session |
| `codex-review.md` | Codex attach flow | Mission Control |
| `review.json` | Market Lab run orchestrator | Mission Control/API |

Reusable caches can stay outside a single run:

- Sentiment/source cache: `<cache-root>/sentiment/<symbol>/<source>/`
- Opportunity board cache: `<cache-root>/opportunities/<board_id>/opportunities.json`
- Evidence snapshots: `<cache-root>/evidence/<symbol>/<timestamp>.json`
- Schwab portfolio cache: `<cache-root>/portfolio/schwab-portfolio-latest.json`
- Raw Schwab payloads: `<cache-root>/portfolio/raw/`

## Ledger Update Flow

The SQLite database is the run ledger index. The run folder is the human-readable evidence packet.

| Entry Point | CLI Equivalent | Storage Updates |
|-------------|----------------|-----------------|
| `POST /api/market-lab/runs` | `uv run --project market_lab python -m market_lab.cli run AAPL --json` | Inserts `market_lab_runs` row, creates `<cache-root>/runs/<run_id>/`, writes `review.json`, `events.jsonl`, and `logs.txt`. |
| Source/fundamental/momentum collection | internal runner modules | Writes run-scoped V7 artifacts and updates `review.json` before Codex review. |
| `POST /api/market-lab/runs/:runId/codex-review` | `market_lab.cli codex-packet` plus `attach-codex-review` | Writes `codex-review-packet.md`, records session/attach state, writes `codex-review.md`, and updates `review.json`. |
| `POST /api/market-lab/runs/:runId/settle` | `market_lab.cli settle <run_id> --json` | Updates `market_lab_settlements` rows for that run and refreshes settlement data in `review.json`. |
| `POST /api/market-lab/settle-due` | `market_lab.cli settle-due --json` | Finds due 1D/5D/20D windows, updates settlement rows, and refreshes affected run artifacts. |
| `POST /api/market-lab/portfolio/refresh` | `market_lab.cli portfolio --refresh --json` | Writes `portfolio/schwab-portfolio-latest.json` and optional raw Schwab payloads. |

Mission Control should use SQLite-backed APIs for run lists and run lookup, then read artifact files for the detailed review, Codex packet, Codex review, timeline, and V7 evidence panels.

## New Models

```python
class SourceItem(Model):
    source: str
    symbol: str
    title: str
    url: str | None = None
    published_at: str | None = None
    fetched_at: str
    excerpt: str | None = None
    relevance_score: float
    sentiment: Literal["bullish", "bearish", "neutral", "mixed", "unknown"]
    quality_flags: list[str] = Field(default_factory=list)

class SourceQualitySnapshot(Model):
    symbol: str
    created_at: str
    items: list[SourceItem]
    source_status: dict[str, str]
    why_this_matters: str | None = None
    cautions: list[str] = Field(default_factory=list)

class FundamentalsSnapshot(Model):
    symbol: str
    created_at: str
    source: str
    valuation: dict[str, float | str | None]
    earnings: dict[str, float | str | None]
    growth: dict[str, float | str | None]
    margins: dict[str, float | str | None]
    analyst: dict[str, float | str | None]
    unavailable_fields: list[str] = Field(default_factory=list)

class MomentumWindow(Model):
    window: Literal["1D", "5D", "20D", "3M"]
    symbol_return_pct: float | None
    spy_return_pct: float | None
    relative_return_pct: float | None
    status: Literal["available", "partial", "missing"]

class MomentumSnapshot(Model):
    symbol: str
    created_at: str
    windows: list[MomentumWindow]

class AnalystRoleOutput(Model):
    role: Literal["price", "news", "fundamentals", "risk", "final_judge"]
    stance: Literal["bullish", "bearish", "neutral", "mixed"]
    confidence: float
    summary: str
    key_reasons: list[str] = Field(default_factory=list)
    missing_evidence: list[str] = Field(default_factory=list)
    blockers: list[str] = Field(default_factory=list)
```

`FundamentalsSnapshot` is a structured company fact sheet, not a verdict. It gives the Fundamentals analyst verified context about valuation, earnings, growth, margins, and analyst data. Missing or unreliable metrics go into `unavailable_fields`; the system should never infer or fabricate them.

## Source Quality Module

Files:

- `market_lab/market_lab/source_quality.py`
- `market_lab/market_lab/sentiment.py`
- `market_lab/tests/test_source_quality.py`

Responsibilities:

- Normalize Yahoo, StockTwits, and Reddit items into `SourceItem`.
- Deduplicate by URL, normalized title, and message hash.
- Score relevance using symbol, company name, ticker cashtag, recency, and source type.
- Filter StockTwits noise before it reaches Codex.
- Persist source-level failures without failing the whole review.

## Fundamentals Module

Files:

- `market_lab/market_lab/fundamentals.py`
- `market_lab/tests/test_fundamentals.py`

Responsibilities:

- Fetch fundamentals through provider adapters.
- Prefer free/reliable sources.
- Document source, timestamp, and unavailable fields.
- Never fabricate missing metrics.
- Keep provider failures isolated from price evidence.

Provider choice must be confirmed during implementation. No paid API should be introduced without explicit approval.

## Momentum Module

Files:

- `market_lab/market_lab/momentum.py`
- `market_lab/tests/test_momentum.py`

Responsibilities:

- Fetch or load daily price history for symbol and SPY.
- Compute 1D, 5D, 20D, and 3M returns.
- Compute relative return versus SPY.
- Return `partial` or `missing` when history is incomplete.

Formula:

```text
return_pct = ((latest_close - prior_close) / prior_close) * 100
relative_return_pct = symbol_return_pct - spy_return_pct
```

## Compact Codex Packet

Files:

- `market_lab/market_lab/codex_packet.py`
- `market_lab/market_lab/codex_review.py`
- `market_lab/tests/test_codex_packet.py`

Packet sections:

```text
symbol summary
price evidence
momentum snapshot
news/source-quality snapshot
fundamentals snapshot
risk flags
outcome memory summary
portfolio context summary
role instructions
output schema
```

Rules:

- Do not embed full raw `review.json`.
- Do not embed full portfolio payload.
- Cap source items per source.
- Prefer summaries plus links over long copied text.
- Include enough data for role outputs to be auditable.

## Role Flow

Codex may run in one session, but output must be structured as role outputs:

1. Price analyst reviews price freshness and momentum.
2. News analyst reviews filtered source items.
3. Fundamentals analyst reviews valuation and earnings context.
4. Risk analyst checks blockers, missing context, and portfolio risk.
5. Final judge decides trusted, blocked, or uncertain.

The important change is not necessarily multiple Codex calls. The important change is explicit role evidence, role output, and final-judge reasoning.

## Settlement Learning

Files:

- `market_lab/market_lab/settlement.py`
- `market_lab/market_lab/outcome_memory.py`
- `market_lab/tests/test_outcome_memory.py`

Add aggregate memory:

```python
class OutcomeMemorySummary(Model):
    symbol: str
    sample_count: int
    evidence_ready_count: int
    beat_spy_1d_rate: float | None
    beat_spy_5d_rate: float | None
    beat_spy_20d_rate: float | None
    avg_relative_return_1d: float | None
    avg_relative_return_5d: float | None
    avg_relative_return_20d: float | None
    min_sample_threshold_met: bool
```

Recommended threshold:

```text
min_sample_count = 10
```

Before the threshold is met, display memory as early evidence only. Do not let it materially change trust scoring.

## Mission Control

Market Lab should show:

- compact timeline near the top
- expanded news analysis with links and timestamps
- fundamentals panel
- momentum versus SPY panel
- role outputs
- settlement/outcome memory

The UI should keep debug artifacts collapsed and avoid making source noise look like confidence.

## Risks

| Risk | Mitigation |
|------|------------|
| Token bloat | Compact packet, capped source items, no raw artifacts. |
| Noisy sentiment | Source filters, relevance score, quality flags. |
| Missing fundamentals | Mark unavailable fields explicitly. |
| Overfitting settlement memory | Minimum sample threshold. |
| Source provider instability | Provider isolation and source-level failure status. |
