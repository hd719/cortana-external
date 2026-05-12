# Market Lab V1 Codex Analyst Committee PRD

**Document Status:** Draft  
**Owner:** Trading systems  
**Last Updated:** 2026-05-12  
**Depends On:** Market Lab V0, Codex CLI/session bridge, Schwab market-data lane

## Team

| Role | Assignee |
|------|----------|
| Primary Owner | Hamel |
| Epic | Market Lab V1 |

---

## Problem / Opportunity

Market Lab V0 created the clean slate: one-symbol reviews, Schwab-backed market facts, Codex packets, Mission Control rendering, and passive settlement. The next gap is analysis quality. A single free-form Codex review is useful, but it is not yet structured enough to compare across runs, learn from outcomes, or feel like an investment committee.

TradingAgents is useful as inspiration because it separates viewpoints: analysts, researchers, risk, and final decision. V1 should bring that shape into Market Lab using Codex, without adding API spend, broker execution, paper trading, or old backtester coupling.

V1 goal:

> Make Codex reviews structured, role-based, comparable, and measurable while keeping Market Lab review-only.

---

## Insights

1. Market Lab should get closer to a TradingAgents-style committee by using explicit Codex roles instead of one broad essay.
2. The role output must be machine-readable enough for UI panels and later scoring.
3. Codex should not override hard gates. Stale/missing core market data still blocks trust.
4. The first version should improve prompt/schema/UI before adding more data providers.
5. Settlements remain the truth loop: analysis is only good if later outcomes support it.

---

## Current State

Already implemented:

- `market_lab/` Python package with CLI, storage, checks, verdict, settlement, and Codex packet generation.
- Mission Control Market Lab tab embedded in Trading Ops.
- `Ask Codex` action through existing Codex session APIs.
- `codex-review.md` attachment and parsed Codex verdict.
- 1D/5D/20D settlement windows with SPY-relative scoring.
- Old backtester dependency removed from the active trading cockpit.

Current pain:

- Codex output is markdown-first and lightly parsed.
- Market Lab stores only a thin `codex_review` summary/verdict.
- The UI cannot show distinct analyst views.
- It is hard to compare why AAPL was trusted today versus yesterday.
- The prompt is too dependent on the current packet narrative instead of a durable schema.

---

## Success Metrics

Product success:

- A user can ask Codex for one Market Lab run and receive role-based sections: price action, fundamentals, news/sentiment, risk, final judge.
- Mission Control renders the Codex review as structured panels, not only a markdown summary.
- The final Codex verdict includes confidence, horizon, and reasons.
- Missing optional evidence is visible without making every review uncertain.
- Hard blockers remain impossible to override through Codex wording.

Measurement success:

- Structured Codex verdict fields are persisted on the artifact.
- Settled runs can be grouped by Codex verdict and confidence band.
- Future comparison work can answer: “Did Codex trusted reviews beat SPY more often than uncertain reviews?”

---

## Assumptions

- Codex CLI/session flow remains the preferred review engine because Hamel already has ChatGPT/Codex subscription access.
- Market Lab should not require OpenAI API credits for V1.
- V1 keeps one-symbol manual reviews.
- Schwab market data remains the only required market-data provider.
- News/sentiment can stay optional until a concrete source is chosen.
- Python owns artifact truth; TypeScript renders artifacts and starts sessions.

---

## Out of Scope

V1 does not include:

- broker execution
- paper trading
- Telegram alerts
- multi-symbol scans
- historical backtesting
- old backtester resurrection
- direct TradingAgents API/provider integration
- automatic BUY/SELL alerts
- additional paid LLM API usage

---

## High-Level Requirements

| Requirement | Description |
|-------------|-------------|
| Structured Codex Schema | Codex review output must include stable fields for verdict, confidence, horizon, roles, missing evidence, and decision notes. |
| Role-Based Analysis | Codex must produce separate role sections similar to a lightweight analyst committee. |
| Artifact Persistence | Parsed Codex schema must be saved into `review.json`, not only markdown. |
| Mission Control Rendering | Market Lab UI must show role panels and final judge details. |
| Comparison-Ready Fields | Review artifacts must expose fields that later comparison/scoring code can aggregate. |
| Hard Gate Safety | Codex cannot turn blocked hard gates into trusted reviews. |

---

## User Stories

| Status | User story | Notes |
|--------|------------|-------|
| Accepted | As Hamel, I want Codex to review a stock through multiple analyst lenses so that the review feels more like a committee than a blob of text. | Roles: price action, fundamentals, news/sentiment, risk, final judge. |
| Accepted | As Hamel, I want each role to state bullish evidence, bearish evidence, and missing evidence so that I can see why the verdict happened. | Keep concise and UI-friendly. |
| Accepted | As Hamel, I want Codex to provide confidence and horizon so that trusted reviews are not all treated equally. | Confidence should be numeric, 0-1. |
| Accepted | As Hamel, I want the UI to show Codex role panels directly inside Market Lab. | No digging through markdown for normal use. |
| Accepted | As Hamel, I want raw markdown preserved so that I can inspect the full review when debugging. | Structured data and markdown both matter. |
| Accepted | As Hamel, I want hard market-data blockers to stay blocked even if Codex is optimistic. | Deterministic safety gates win. |
| Accepted | As Hamel, I want the fields stored in a way future settlement analytics can use. | Prepare for V2 comparison/scoring. |

---

## Product Shape

Codex should return:

- `verdict`: `trusted | uncertain | blocked`
- `confidence`: number from `0` to `1`
- `horizon`: `1d | 5d | 20d | mixed`
- `summary`: short operator-readable conclusion
- `roles`: one object per role with stance, bull points, bear points, missing evidence
- `hard_gate_assessment`: whether any deterministic blocker exists
- `what_would_change_verdict`: concise list
- `operator_note`: review-only next step

Mission Control should render:

- Final judge strip: verdict, confidence, horizon
- Analyst role grid
- Missing evidence
- What would change the verdict
- Raw markdown/debug path collapsed by default

---

## Non-Negotiables

- No execution language that implies “place trade now.”
- No paper trading.
- No stale data trust.
- No hidden prompt-only schema. If the UI depends on it, the artifact contract must define it.
- No old backtester imports or artifacts.

