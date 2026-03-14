# PRD: Trading Cron Decoupling and Profit-Oriented System Improvements

**Status:** Draft  
**Owner:** Cortana / OpenClaw trading workflow  
**Scope:** `cortana` trading cron path, `cortana-external` market intelligence and backtester support  
**Intent:** Improve expected trading outcomes by making the system faster, cleaner, and more reliable, while keeping speculative research from breaking the production path.

---

## Why This Exists

The current trading stack is good enough to produce useful signals, but it still mixes together:
- core scan and regime logic
- contextual overlays
- second-opinion logic
- experimental research
- notification formatting

That creates two problems:

1. **Operational fragility**
- optional layers can break the critical market-session cron path
- stale or failed artifacts can distort what gets notified
- failure diagnosis becomes too slow during market hours

2. **Profit drag**
- delayed or failed compute runs reduce usable trading windows
- stale alerts can waste attention on old opportunities
- noisy or overloaded decision paths reduce signal quality
- research logic can contaminate the base engine before it is validated

This PRD defines how to restructure the system so it becomes:
- more reliable in production
- more useful for making money
- better at separating what is proven from what is still experimental

---

## Core Thesis

**The fastest way to improve trading outcomes is not more model cleverness. It is making the signal path cleaner, faster, fresher, and easier to trust.**

Better PnL here should come from:
- more timely signals
- fewer false positives
- better prioritization of what deserves attention
- less operational downtime
- less stale output
- clearer separation of proven logic vs research logic

This is a system-quality edge, not just a feature-count edge.

---

## Main Goal

Build a trading cron architecture where:

1. **Base compute always produces a trustworthy latest artifact**
2. **Optional enrichment never blocks the base compute path**
3. **Notifications always reflect the newest valid run**
4. **Research outputs can improve selection and prioritization without silently owning the strategy**

---

## Profit-Oriented Outcomes

This work should improve money-making potential in practical ways:

### 1. Faster usable signals
- market-session runs complete inside budget more consistently
- fewer missed windows due to cron failures or slow enrichments

### 2. Better trade selection
- base regime/technical signals stay primary
- enrichments improve ranking and context rather than hijacking decisions
- reduces attention spent on low-quality setups

### 3. Cleaner watchlists
- promote only the freshest, latest valid artifact
- stop stale success messages from surfacing after newer failures
- increase confidence that a surfaced name actually matters now

### 4. Better research promotion discipline
- experimental alpha stays separate until it proves itself
- only validated improvements graduate into production
- reduces the risk of “smart-looking but unprofitable” logic leaking into the live path

### 5. Lower operational drag
- less time debugging wrappers and stale runs during market hours
- more time spent deciding whether to act on a setup

---

## Non-Goals

This PRD does **not** mean:
- direct auto-trading
- removing regime or technical controls
- letting Polymarket become the strategy
- letting experimental alpha override core risk gates
- turning the cron path into a market-making or HFT system

---

## Current Problems

### A. Optional logic can break the latest compute artifact

Examples:
- council deliberation session creation failures
- wrapper/path/env failures
- downstream enrichment failures after scans already completed

Impact:
- latest run becomes failed even if most of the compute work succeeded
- Cron B cannot safely notify

### B. Latest signal freshness is not enforced hard enough

Examples:
- notifier previously fell back to older successful runs
- stale content could be delivered after a newer failed compute run

Impact:
- operator sees outdated trade posture
- stale signals can create bad decisions

### C. Research and enrichment are too close to the blocking path

Examples:
- council
- Polymarket overlays
- experimental alpha annotations

Impact:
- useful optional logic becomes a production liability

### D. Promotion from research to production is not strict enough

Impact:
- hard to know what is actually improving PnL versus just adding narrative

### E. The live 120-name scan cap is deterministic, but not quality-ranked

Current behavior in the live CANSLIM / Dip Buyer alert path:
- build a broad base universe
- prepend explicit priority symbols
- prepend watchlist priority
- prepend optional priority file symbols
- dedupe
- truncate to the first `120`

Important nuance:
- this is deterministic, which is good
- but it is still mostly order-based, not quality-ranked
- after explicit priority names, the remaining symbols come from the broad universe ordering rather than a lightweight ranking model

Impact:
- the system may spend expensive per-symbol analysis on mediocre names
- stronger candidates can be excluded simply because they appear later in the deterministic ordering
- the live 120-name scan is not currently the best 120 by quality

---

## Target Architecture

## 1. Base Compute Path

This is the production-critical path.

It should do only what is required to answer:
- What is the regime?
- What did CANSLIM find?
- What did Dip Buyer find?
- What is the final production-safe trade posture right now?

Responsibilities:
- regime snapshot
- base strategy scans
- core guardrails
- compact unified summary
- artifact persistence

Outputs:
- `summary.json`
- `message.txt`
- `stdout.txt`
- `stderr.txt`
- `metrics.json`

Rules:
- must complete without optional enrichments
- must own the official latest run state
- must be the thing Cron B trusts first

## 2. Enrichment Path

This is optional and fail-open.

Possible enrichments:
- council deliberation
- Polymarket context overlays
- experimental alpha notes
- research ranking or trade annotations

Outputs:
- separate enrichment artifacts
- run-id linked
- freshness stamped

Rules:
- may annotate the base run
- may not invalidate the base run
- failure should be visible but non-blocking

## 3. Notify Path

This is the only component that talks to the user.

Rules:
- only consider the latest completed run
- only notify from the latest successful run by default
- never fall back to an older success after a newer failure
- only merge enrichment if it is fresh and belongs to the same base run

---

## What Should Change First

## A. Make base compute path minimal and deterministic

Move out of the blocking path:
- council session creation and vote orchestration
- experimental alpha annotations
- optional deep research overlays

Keep in the blocking path:
- regime
- base scans
- core risk gates
- compact summary generation

This is the highest-value reliability improvement.

## B. Keep latest-run semantics strict

Notification policy should be:
- latest completed run wins
- if latest run failed, do not silently notify from an older success
- optionally alert failure separately if desired

This protects signal freshness and trust.

## C. Promote only validated research

Research should move through stages:

1. `paper-only`
2. `annotation-only`
3. `bounded ranking modifier`
4. `production decision input`

No direct promotion without evidence.

## D. Make the 120-name live scan quality-ranked before expensive analysis

The live alert path should stop behaving like:
- `priority + broad universe + truncate`

It should behave like:
1. build the full base universe
2. reserve slots for explicit priority symbols
3. run a cheap, deterministic pre-screen over the remaining names
4. rank the remaining names by lightweight quality
5. fill the rest of the 120 cap from that ranked list
6. run full CANSLIM / Dip Buyer analysis only on the final ranked 120

This preserves:
- determinism
- explainability
- explicit operator priority control

While improving:
- relevance of scanned names
- efficiency of compute budget
- likelihood that the alert surface contains the strongest candidates

---

## Improvements That Can Actually Improve PnL

Below are the concrete improvements most likely to matter financially.

## 1. Better latest-run reliability

Expected gain:
- more usable alerts during market hours
- fewer missed opportunities due to failed compute

Why it matters:
- an alpha signal that misses the window is not alpha

## 2. Better signal ranking

Improve ranking based on:
- technical quality
- regime alignment
- liquidity / execution friendliness
- freshness
- overlap across scanners
- validated contextual support

Expected gain:
- better focus on top names
- less time wasted on second-tier setups

## 3. More disciplined correction-mode behavior

Correction-mode output should:
- stay fast
- surface only highest-value shadow watch names
- avoid flooding the operator with false hope

Expected gain:
- less forced trading in weak tape
- better readiness for regime turn

## 4. Better event and research overlays as ranking modifiers, not triggers

Validated enrichments can improve:
- which `WATCH` names get examined first
- which marginal `BUY` names get extra scrutiny
- when to lean selective instead of aggressive

Expected gain:
- better filtering
- better sizing discipline
- fewer bad longs in bad context

## 5. Outcome tracking and promotion gates

Every promoted improvement should be measurable.

Track:
- hit rate
- return after 1d / 5d / 10d
- regret rate
- false positive rate
- regime-specific behavior

Expected gain:
- gradual improvement from evidence instead of anecdotes

## 6. Better universe selection before the 120 cap

Expected gain:
- fewer wasted scan slots
- better top-name quality
- more useful WATCH and BUY candidates

Why it matters:
- if the system chooses the wrong 120 names, the downstream scoring quality cannot fully recover from that mistake
- ranking should start before the expensive analysis stage, not after

---

## Production vs Research Boundary

### Production-safe
- regime engine
- CANSLIM / Dip Buyer base logic
- compact alert generation
- freshness enforcement
- latest-run notifier discipline
- validated ranking modifiers

### Research-only until proven
- experimental alpha formulas
- aggressive Polymarket-based conviction boosts
- council as a hard gate
- anything requiring extra subprocess/model orchestration during market-session compute

---

## Proposed Rollout

### Phase 1: Reliability foundation
- strict latest-run notification
- separate base compute from enrichment
- keep latest successful run clean and trustworthy

### Phase 2: Safe enrichment layering
- council as post-compute enrichment
- research artifacts attached by run id
- freshness validation on merge

### Phase 3: Profit-oriented ranking improvements
- overlap ranking
- regime-aware prioritization
- validated context modifiers
- improved watchlist buckets

### Phase 4: Research promotion
- promote only what clears measurable gates
- keep experimental alpha paper-only until proven

---

## Acceptance Criteria

This work is successful when:

1. Cron A reliably produces the newest usable base artifact.
2. Cron B only notifies from the latest valid run.
3. A failed enrichment no longer prevents a production-safe alert.
4. Stale older successful runs are never sent after a newer failure.
5. Research outputs can improve prioritization without silently owning trade decisions.
6. We can point to at least one measurable quality improvement:
   - faster successful runs
   - fewer stale alerts
   - better ranked top names
   - better post-trade outcome stats

---

## Recommended Next Improvements

If the goal is “make more money” in a disciplined way, the next best improvements are:

1. **Outcome-linked ranking**
- rank names by expected usefulness based on historical post-alert outcomes

2. **Freshness scoring**
- downrank any artifact or context that is even slightly stale during market hours

3. **Regime-aware alert density**
- fewer names in bad markets
- slightly broader surface in supportive markets

4. **Execution-friendliness overlay**
- prioritize names with cleaner liquidity, spreads, and lower churn risk

5. **Promotion gates for research**
- no production promotion without hit-rate and return evidence

6. **Two-stage live universe selection**
- keep explicit priority names pinned first
- score the remaining universe with a cheap prefilter
- fill the live 120 with the best remaining candidates instead of the first remaining candidates

Suggested cheap prefilter factors:
- relative strength versus `SPY` or `QQQ`
- medium-term trend quality
- dollar volume / liquidity
- distance from 52-week highs
- constructive pullback shape
- volatility sanity
- sector leadership
- optional regime-aware weighting

Guardrails:
- keep it deterministic
- keep it explainable
- avoid slow or flaky inputs in the prefilter
- do not use fundamentals scrapes, sentiment, or heavy research calls here

Recommended implementation shape:
- reserve slots for `TRADING_PRIORITY_SYMBOLS` and explicit watchlist priorities
- run a lightweight pre-screen on the rest of the base universe
- store prefilter component scores for auditability
- feed the final ranked 120 into the existing CANSLIM / Dip Buyer analysis path

Success condition:
- the live 120-name scan becomes “best 120 by cheap quality model” rather than “first 120 by deterministic ordering”

---

## Bottom Line

The best system improvement is not “more complexity.”

It is:
- cleaner latest-run semantics
- more reliable production compute
- better prioritization
- disciplined research promotion

That is how this system gets more useful for making money:
- fresher signals
- fewer false positives
- less operational drag
- more trust in what reaches Telegram
