# Technical Specification - Market Lab V2 TradingAgents-Inspired Market Intelligence

**Document Status:** Draft
**PRD:** [v2-tradingagents-inspired-market-intelligence.md](../PRDs/v2-tradingagents-inspired-market-intelligence.md)

## Development Overview

V2 adds a richer single-symbol intelligence layer on top of the existing Market Lab loop. It should not rewrite V0/V1. It should add narrow modules that build evidence packets, summarize settled memory, control Codex packet size, and render the results in Mission Control.

Current files to build from:

- `market_lab/market_lab/runner.py` owns run orchestration.
- `market_lab/market_lab/market_data.py` fetches Schwab-backed market facts.
- `market_lab/market_lab/checks.py` owns deterministic checks.
- `market_lab/market_lab/verdict.py` owns trust verdict calculation.
- `market_lab/market_lab/codex_review.py` builds Codex packets.
- `market_lab/market_lab/settlement.py` scores 1D/5D/20D outcomes.
- `market_lab/market_lab/storage.py` persists run artifacts and SQLite rows.
- `market_lab/market_lab/models.py` owns artifact contracts.
- `apps/mission-control/lib/market-lab.ts` bridges Next.js to the Python CLI.
- `apps/mission-control/app/services/tabs/trading-ops-tab.tsx` renders Trading Ops and the Market Lab tab.

The V2 shape:

```text
single symbol
  -> deterministic evidence snapshot
  -> outcome memory
  -> optional quick/deep Codex review
  -> settlement memory
  -> Mission Control review
```

---

## New Python Modules

Add these modules under `market_lab/market_lab/`:

| Module | Responsibility |
|--------|----------------|
| `evidence.py` | Builds bounded evidence snapshots for one symbol. |
| `memory.py` | Summarizes prior same-symbol and same-verdict settlement outcomes. |
| `sentiment_sources.py` | Fetches grounded Yahoo Finance, StockTwits, and Reddit sentiment inputs. |
| `token_budget.py` | Defines quick/deep packet limits and records estimated context size. |

Do not add broker execution calls to Market Lab.

---

## Data Model Changes

Update `market_lab/market_lab/models.py`.

Add:

```python
class EvidenceSnapshot(Model):
    symbol: str
    generated_at: str
    price_summary: dict[str, Any]
    benchmark_summary: dict[str, Any]
    momentum_summary: dict[str, Any] | None = None
    fundamentals_summary: dict[str, Any] | None = None
    news_summary: dict[str, Any] | None = None
    sentiment_summary: dict[str, Any] | None = None
    risk_flags: list[str] = Field(default_factory=list)
    missing_context: list[str] = Field(default_factory=list)

class OutcomeMemorySummary(Model):
    symbol: str
    lookback_runs: int
    evidence_ready_count: int
    needs_more_context_count: int
    blocked_count: int
    settled_count: int
    evidence_ready_success_rate: float | None = None
    evidence_ready_avg_alpha_vs_spy_pct: float | None = None
    common_missing_context: list[str] = Field(default_factory=list)

class TokenBudgetSummary(Model):
    mode: Literal["quick", "deep"]
    estimated_input_tokens: int | None = None
    max_input_tokens: int
    included_sections: list[str] = Field(default_factory=list)
    omitted_sections: list[str] = Field(default_factory=list)
```

Add:

```python
class SentimentSourceResult(Model):
    source: Literal["yahoo_finance_news", "stocktwits", "reddit"]
    status: Literal["available", "empty", "missing", "rate_limited", "error"]
    fetched_at: str
    sample_count: int = 0
    fetch_method: str
    request_url: str | None = None
    summary: str | None = None
    raw_artifact_path: str | None = None

class SentimentSnapshot(Model):
    status: Literal["available", "partial", "missing", "error"]
    sources: list[SentimentSourceResult] = Field(default_factory=list)
    missing_sources: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
```

Extend `ReviewArtifact` with optional:

- `evidence_snapshot`
- `outcome_memory`
- `token_budget`

Keep all new fields optional so older V0/V1 artifacts still load.

---

## Storage Changes

SQLite remains local under `.cache/market_lab/market_lab.sqlite`.

Initial implementation can store optional evidence snapshots as files:

```text
.cache/market_lab/evidence/<symbol>/<timestamp>.json
```

The review artifact remains the source of truth for one-symbol reviews.

---

## Evidence Sources

V2 should start with adapters that can be missing without breaking the app.

Required:

- Schwab current/last price
- SPY benchmark
- market-hours/off-hours basis
- deterministic checks
- prior Market Lab run history
- prior settlement outcomes

Optional:

- fundamentals snapshot
- earnings/date facts
- news summary from Yahoo Finance
- sentiment summary from StockTwits and Reddit
- volatility/risk summary

Adapters must return explicit `available`, `missing`, or `error` states. Codex packets must not invent missing evidence.

Initial grounded sentiment sources:

| Source | Fetch method | Cost / auth | Rate-limit reality | V2 behavior |
|--------|--------------|-------------|--------------------|-------------|
| Yahoo Finance news | `yfinance.Ticker(symbol).news` / `get_news`; optional RSS fallback if `yfinance` fails. | Free, no key. `yfinance` is unofficial and intended for personal/research use. | No reliable public unlimited guarantee; can fail, throttle, or change. | Optional but preferred. Cache per symbol. Missing lowers context quality. |
| StockTwits | Public symbol stream: `https://api.stocktwits.com/api/2/streams/symbol/{SYMBOL}.json`. | Free/no key for current public stream access. New API app registration is currently under review. | Historical/public limits are not a safe contract; endpoint can throttle or change. | Optional. Include sample count, sentiment tags when present, message timestamps, and `rate_limited` status on 429. |
| Reddit | Start with official RSS/search support on subreddit search/listing endpoints, for example `/r/{subreddit}/search.rss?q=$SYMBOL&restrict_sr=1&sort=new&t=week`; use OAuth/PRAW later only if RSS is unreliable. | RSS is free/no key; OAuth/PRAW is free but requires app credentials. | RSS can be blocked/throttled; OAuth API has rate-limit headers. | Optional. Include subreddit, score/comment metadata when available, excerpts, and source status. |
| X/Twitter | Deferred. | N/A. | API cost/access is not worth V2 complexity yet. | Do not implement in V2. |

The sentiment adapter should degrade gracefully. Network failures, empty results, or rate limits should produce a clear source-level status instead of failing the review.

### Fetch Policy

- Make at most one request per source per symbol per run unless reading cached data.
- Cache source responses under `.cache/market_lab/sentiment/<symbol>/<source>/`.
- Use a freshness TTL, initially 30-60 minutes, so repeated reviews do not hammer free endpoints.
- Store raw source snippets and normalized summaries separately.
- Capture HTTP status, provider error, and rate-limit headers when available.
- Mark source status as `rate_limited` on HTTP 429 or provider-specific throttling text.
- Never scrape browser pages if a no-key feed/API path is available.
- Never bypass provider protections with rotating identities or aggressive scraping.

### Source References

- yfinance documents `Ticker.get_news` / `Ticker.news`, while also stating it is not affiliated with Yahoo and that Yahoo Finance data is for personal use.
- StockTwits public symbol stream currently returns no-key JSON, but their developer page says new app registrations are paused while APIs/docs/terms are under review.
- Reddit API docs mark search/listing endpoints as RSS-supported and cap listing `limit` values; OAuth API clients expose rate-limit headers.

---

## Codex Packet Changes

Update `market_lab/market_lab/codex_review.py`:

- Add `mode=quick|deep`.
- Include `TokenBudgetSummary`.
- Include `EvidenceSnapshot`.
- Include `OutcomeMemorySummary`.
- Include `SentimentSnapshot` when available.
- Tell Codex to compare the current review against prior same-symbol outcomes.
- Tell Codex to state whether missing evidence should lower confidence.
- Tell Codex not to claim Reddit, StockTwits, Yahoo, or X/Twitter sentiment unless the packet contains fetched source data.
- Keep hard gates authoritative.
- Prefer product labels `evidence_ready`, `needs_more_context`, and `blocked` in new context fields and UI copy.

Quick mode:

- current price/SPY
- hard gates
- missing context
- compact prior outcome summary
- analyst committee output

Deep mode:

- all quick context
- richer evidence snapshot
- prior same-symbol reviews
- prior settlement excerpts
- expanded analyst role reasoning

---

## Mission Control Changes

Update:

- `apps/mission-control/lib/market-lab.ts`
- `apps/mission-control/app/services/tabs/trading-ops-tab.tsx`
- `apps/mission-control/app/api/market-lab/*` routes as needed

UI additions:

- Evidence quality section on selected review.
- Prior outcome memory section.
- Token mode badge.
- Safer verdict copy: `Evidence Ready`, `Needs More Context`, `Blocked`.

Keep raw debug artifacts collapsed by default.

---

## API Changes

No new watchlist or portfolio APIs in V2. Existing Market Lab run/detail/Codex APIs should be extended only as needed to expose evidence, outcome memory, and token budget fields.

---

## Process Changes

Default operator flow:

1. Open Market Lab.
2. Run or select one symbol.
3. Ask Codex in quick or deep mode.
4. Let settlement cron score outcomes.
5. Use memory summaries to improve future reviews.

Codex remains manual by default.

---

## Risks

| Risk | Mitigation |
|------|------------|
| Token usage grows too fast | Require quick/deep modes and log context size. |
| Evidence adapters become messy | Keep each provider behind an adapter with explicit availability status. |
| UI becomes too dense | Show final summary first; collapse debug and raw evidence. |
| Prior outcomes overfit small samples | Show sample size and confidence caveats. |
