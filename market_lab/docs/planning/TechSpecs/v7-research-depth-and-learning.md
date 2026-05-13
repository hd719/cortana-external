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
