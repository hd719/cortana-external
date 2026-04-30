# Conversation Handoff — 2026-04-30

This file is an exportable handoff for the long operator / trading / Mission Control conversation that led up to the current state of `cortana-external`.

It is intentionally specific. The goal is that a new operator or agent can read this once and understand:

- what was built
- why it was built
- what repeatedly broke
- what design decisions were made
- what was intentionally deferred
- how the current live operator surfaces should be interpreted

---

## 1. Scope Of The Conversation

This conversation covered four major workstreams:

1. operator readability and trust for the trading outputs
2. roadmap planning and execution across `backtester`, `external-service`, and `mission-control`
3. repeated full-stack QA and runtime hardening
4. Schwab streaming, provider fallback strategy, and Polymarket operator surfaces

Canonical surfaces referenced throughout:

- runtime repo: `/Users/hd/Developer/cortana-external`
- command-brain repo: `/Users/hd/Developer/cortana`
- live runtime state: `/Users/hd/.openclaw`
- Mission Control: `/Users/hd/Developer/cortana-external/apps/mission-control`
- external-service: `/Users/hd/Developer/cortana-external/apps/external-service`
- backtester: `/Users/hd/Developer/cortana-external/backtester`
- watchdog: `/Users/hd/Developer/cortana-external/watchdog`

---

## 2. Early Operator Output Work

### `cbreadth` was initially too raw

The first issue raised was that `cbreadth` output was technically rich but operator-hostile.

Problems in the original output:

- large raw JSON blobs
- fallback and degraded states were technically correct but hard to interpret
- after-hours snapshots looked ambiguous
- regime text sometimes read fresher than the underlying data justified

### What was changed

The `cbreadth` surface was made more operator-readable by introducing a summary layer with:

- a top-line headline
- plain-language session context
- a regime explanation
- tape freshness / fallback explanation
- focus-list explanation
- human-readable warnings

Important resulting pattern:

- `cbreadth` became the operator-readable summary
- `cbreadth_raw` remained the raw JSON surface

### Important wording fix

You later caught a subtle but important trust issue:

- `Regime: Market regime is CORRECTION (0m old).`

That was misleading when the regime came from an emergency fallback path rather than a genuine fresh live calculation.

The wording was tightened so fallback does not falsely imply a fresh live regime read.

---

## 3. Monthly Fitness Summary Bug

You later surfaced a bug in the fitness monthly summary:

- it used April instead of March
- coverage looked incomplete even though the data should have existed in the Cortana DB

That issue was investigated, fixed, reviewed, and merged.

The important takeaway is that summary generation paths needed both:

- correct month boundary selection
- clearer handling of partial provider coverage

---

## 4. Planning System And Roadmap Execution

The conversation shifted from one-off fixes to structured roadmap execution.

### Templates introduced into the workflow

You pointed to templates for:

- PRDs
- TechSpecs
- implementation plans
- later QA docs

Your requirements for those documents:

- detailed enough for any LLM to implement from them
- not tied to one model or one agent
- explicit subtask structure
- explicit sprint / vertical structure
- checkboxes updated as work completed

### Operating rules you enforced

You repeatedly insisted on the following:

- be explicit about which implementation plan is active
- be explicit about which subtask is active
- keep the main chat as orchestrator whenever possible
- use subagents when appropriate
- close stale subagents
- use separate PRs for clean review boundaries unless you explicitly asked to group work
- mark finished subtasks back in the implementation plan

### Major implementation-plan areas completed

Across the roadmap, implementation work covered:

- trade lifecycle / execution risk / portfolio
- decision brain / narrative / research plane
- governance / validation / model promotion
- operator surfaces / ops highway

After the main roadmap implementation concluded, you shifted the focus into QA and runtime hardening.

---

## 5. Documentation Upgrades

The conversation created or updated several classes of documentation:

- PRDs
- TechSpecs
- implementation plans
- QA docs
- operator study guides
- README files
- roadmap files

### Documentation style you wanted

You explicitly wanted docs that:

- use simple wording
- give concrete workflows
- explain what to do and what to look out for
- avoid vague theory when concrete examples are better
- are useful to you as the operator, not just to a coder

### Workflow scripts replaced alias-heavy operation

You moved away from ad hoc aliases and toward explicit operator scripts, such as:

- `./scripts/operator_workflow.sh premarket`
- `./scripts/operator_workflow.sh open`
- `./scripts/operator_workflow.sh midday`
- `./scripts/operator_workflow.sh close`
- `./scripts/operator_workflow.sh night`
- `./scripts/operator_workflow.sh health`

Dotfiles were later updated to align with that script-first workflow.

---

## 6. Repeated QA And Runtime Hardening

Large parts of the conversation were spent in repeated end-to-end QA loops.

### QA pattern used

The repeated loop was:

1. implement
2. run full QA
3. log defects
4. fix defects
5. rerun QA
6. validate Telegram, endpoints, UI, and workflow behavior

### Surfaces QAed repeatedly

- Mission Control UI
- backtester outputs
- live market-data surfaces
- Schwab auth paths
- Polymarket operator surfaces
- Telegram alert lanes
- watchdog alerts
- launchd-managed runtime behavior

### Important runtime incident: Postgres connection exhaustion

One real production-style incident found during QA:

- Mission Control / DB path hit `too many clients already`

Root cause:

- multiple stale Next.js Mission Control processes were still alive
- each stale process held its own Prisma pool
- DB pressure came from leaked process count, not just one bad request

Resolution:

- stale processes were force-killed
- the restart flow was cleaned up
- Mission Control was restarted cleanly
- DB pressure returned to normal
- run sync recovered

This became an important reliability hardening point.

---

## 7. Mission Control Buildout

You proposed building a UI in the existing Next.js app so you and future LLMs could visually verify whether the system was healthy.

### Main route built

- `/trading-ops`

### Major tabs / surfaces built

- `Overview`
- `Live`
- `Watchlists`
- `System Health`
- `Deep Dive`
- later `Polymarket`

### UX direction you pushed throughout

You repeatedly said the UI should:

- tell you what to read first
- feel less dense
- avoid raw JSON
- stay responsive on mobile
- remain operator-readable first
- avoid looking correct while still being confusing

### Specific Trading Ops additions

- compact `Live now` summary in `Overview`
- full `Live tape`
- `Streamer status`
- `Dip Buyer live watchlist`
- `CANSLIM live watchlist`
- system-health cards for providers
- later a dedicated Polymarket view

---

## 8. Schwab Streaming Integration

Schwab streaming was one of the biggest technical themes in the conversation.

### Initial situation

At first:

- there was some streamer plumbing
- but streamer setup and operator visibility were incomplete
- REST was still carrying too much live-data responsibility
- cooldown behavior and missing streamer metadata were causing confusion

### Important streamer metadata you explicitly called out

You correctly identified that streamer setup needed the equivalent of:

- `getUserPreferences`
- `streamerUrl`
- `customerID`
- `coralID`

### OAuth / callback flow used

The Schwab callback used repeatedly was:

- `https://127.0.0.1:8182/auth/schwab/callback`

You later showed successful callback responses that included:

- `message: Schwab tokens saved successfully`
- `hasRefreshToken: true`
- token paths such as:
  - `/Users/hd/Developer/cortana-external/.cache/market_data/schwab-token.json`
  - `/Users/hd/Developer/cortana-external/.cache/market_data/schwab-streamer-token.json`

### Dedicated streamer credential lane

A major step was creating a second Schwab app specifically for the streamer-capable Accounts and Trading lane.

You created and stored:

- `SCHWAB_CLIENT_STREAMER_ID`
- `SCHWAB_CLIENT_STREAMER_SECRET`

That unlocked the dedicated streamer token lane and allowed live streamer-backed Mission Control features to become real.

---

## 9. Live Data Transport: Polling vs SSE vs WebSocket

You asked whether the live Mission Control view was genuinely live or just repeating GET requests.

### Initial browser behavior

The browser-facing live area initially used repeated GET requests.

### What you wanted

You wanted:

- visibly updating numbers
- a true live feel
- something closer to stream behavior, not just periodic polling

### Final browser-facing decision

We discussed:

- WebSocket
- SSE
- REST polling

The final decision for the browser-facing layer was:

- use SSE

Reason:

- the browser only needed server-to-client streaming
- bidirectional WebSocket semantics were unnecessary for that UI
- SSE fit the operator-surface use case better

Provider calls still remained behind Mission Control rather than going directly from the browser to external services.

---

## 10. Provider Strategy, Cooldowns, And Fallback

You noticed Schwab REST cooldown behavior and asked whether Alpaca, FRED, or other providers should take more responsibility.

### Your core concern

You did not want:

- to miss important market moves because Schwab REST was cooling down
- to quietly mix numbers from Schwab and Alpaca in a way that damages operator trust
- to keep a high-fanout request-path REST dashboard forever

### Core design decision

The main operator tape should prefer pure Schwab semantics.

For the live market tape in Mission Control, the agreed model became:

1. show fresh Schwab
2. then stale Schwab
3. then unavailable
4. do not silently substitute Alpaca row-by-row
5. only use Alpaca if the whole surface intentionally enters fallback mode

### Why Alpaca still mattered

You were correct that Alpaca existed partly to take load off Schwab REST in the broader system.

But we separated two concerns:

- system-wide provider diversification can be useful
- the operator-facing live tape must preserve source trust

### Planning docs created for fallback strategy

You asked for formal docs for provider-mode fallback:

- PRD
- TechSpec
- implementation plan
- QA doc

Open questions in those docs were then answered explicitly.

Important settled positions:

- provider mode should be chosen at the run boundary, not ad hoc per symbol
- cache is sometimes better than Alpaca for continuity-sensitive paths
- some workflows should remain Schwab-only plus cache
- fallback design must preserve operator trust, not just keep data on screen

---

## 11. Live Tape Hardening

Live tape hardening consumed a large portion of the later conversation.

### Problems you observed

You repeatedly showed cases where:

- symbols appeared, disappeared, then reappeared
- some rows stayed healthy while others errored
- REST fallback appeared unexpectedly
- cold page loads flashed scary states
- after-hours symbols looked broken when they were really just quiet

### Core hardening rules we settled on

1. healthy streamer rows should survive even if some symbols fail
2. after-hours behavior should stay calm
3. last-known Schwab quotes can be retained as stale/degraded when justified
4. if nothing trustworthy exists, show unavailable clearly
5. avoid request-path REST fanout as the steady-state model
6. use bounded startup grace for stream bootstrap and reconnects

### State vocabulary that emerged

The UI evolved around these state labels:

- `live`
- `stale`
- `waiting`
- `rest`
- `unavailable`
- `degraded`

Interpretation:

- `live` = fresh live data
- `stale` = retained but still trustable enough to show
- `waiting` = no recent tick for a quieter symbol, but not necessarily broken
- `rest` = REST-derived fallback
- `unavailable` = nothing usable exists
- `degraded` = panel is working but not in its preferred operating mode

---

## 12. Polymarket Buildout

Polymarket became its own major operator surface.

### Main Polymarket sections built

- `Live stream`
- `Pinned`
- `Top events`
- `Top sports`
- `Account`
- `Signal overlay`
- `Linked watchlist`
- `Results`

### What that Polymarket surface combined

- Polymarket event-market data
- private account stream data
- pinned market management
- event and sports boards
- linked-watchlist concepts
- settlement/result summaries

### Major confusion point you raised

Later in the conversation you asked what a specific Polymarket-linked stock/signal card was actually doing.

Your concerns were:

- it looked like stock data was being shown inside Polymarket
- the meaning of “signal” and “spread” was unclear
- it was not obvious how trustworthy or actionable that surface was

The correct explanation was:

- it was not showing stock quotes
- it was showing stock-symbol context derived from linked Polymarket event markets
- “signal” and “spread” were coming from the event-market logic, not from stock-price data

Because that card created more confusion than value, you chose to remove it.

That was the correct operator-first decision.

---

## 13. Specific Polymarket UI PRs Discussed Late In The Thread

### PR #258

Removed the confusing Polymarket-linked stock-context card.

### PR #259

Changed the top Polymarket layout so the main panels stack vertically rather than sitting side by side.

Reason:

- side-by-side looked crowded and harder to scan
- stacked layout was easier to interpret

### PR #260

Softened Polymarket cold-start states.

Reason:

- first-load behavior jumped to scary states too quickly
- you wanted a neutral state first

### PR #261

Added bounded Polymarket startup grace.

Reason:

- the first reconnecting payload represented a real startup failure mode
- the UI needed a warm-up window before treating reconnect data as settled truth

Behavior after that change:

- remain neutral during bounded warm-up
- exit immediately if streams become truly healthy
- only show degraded/error once the grace window expires and the stream is still not ready

---

## 14. Restart / Launchd / Runtime Discipline

You repeatedly emphasized that:

- source code and runtime are different things
- local dev server behavior is not the same as launchd-managed runtime behavior

### Mission Control restart path

The primary restart script used repeatedly was:

- `/Users/hd/Developer/cortana-external/apps/mission-control/scripts/restart-mission-control.sh`

### External-service restart path

You also pointed out that the external service has its own intended restart flow and should not be casually run with ad hoc commands when the launchd-managed service is the live truth.

General principle used:

- launchd-managed runtime is authoritative
- validate using health endpoints after restart
- do not assume `pnpm start` or ad hoc local runs match deployed behavior

---

## 15. Watchdog / Canary / Lane-Readiness Investigation

You later surfaced a watchdog Telegram alert that said the pre-open canary was degraded.

The message was:

- `Pre-open canary is degraded. Trading lane may not be fully ready for the open.`
- specifically citing:
  - live market regime path degraded
  - reduced CANSLIM strategy smoke degraded

### Exact artifact investigated

- `/Users/hd/Developer/cortana-external/backtester/var/readiness/pre-open-canary-latest.json`

### What the artifact actually contained

Timestamp:

- `2026-04-22T08:03:18.686224+00:00`
- roughly `4:03 AM ET`

Overall status:

- `result: warn`
- `status: degraded`

Detailed checks:

- `service_ready: pass`
- `quote_smoke: pass`
- `regime_path: warn`
- `strategy_smoke: warn`

### Why it warned

`regime_path` warned because:

- it used `cache`
- the cached fallback was older than the live TTL
- age was about `44,396s`, roughly `12.3h`

`strategy_smoke` warned because:

- reduced CANSLIM was on a degraded-safe path
- scanned `12`
- evaluated `0`
- BUY `0`
- WATCH `0`
- NO_BUY `0`

### Correct interpretation

This was not a full lane-down event.

It meant:

- service was reachable
- quote smoke was working
- regime input quality was degraded
- reduced CANSLIM pre-open signal quality was degraded

You explicitly decided to leave that alone for the moment.

---

## 16. Telegram Lane Validation

Telegram alert quality was checked multiple times.

One important example you surfaced was a live trading alert that correctly showed:

- priority / urgency
- decision
- confidence
- risk
- regime line
- summary counts
- focus symbol
- calibration block
- watchlist summaries
- guardrail block counts
- related detections

Telegram was repeatedly treated as part of end-to-end QA rather than a secondary concern.

---

## 17. System Health Surface

You asked for a consolidated financial services health area so you could see the status of major providers in one place.

### Services you explicitly wanted surfaced

- Alpaca
- FRED
- CoinMarketCap
- Schwab REST
- Schwab streamer
- Polymarket REST
- Polymarket streamer

Reason:

- you wanted to see which financial services were healthy, degraded, or misconfigured without jumping between tools

This was built into Mission Control’s financial-services health surface.

Later:

- Alpaca briefly showed a `401 unauthorized`
- after reauth / key correction, Alpaca later showed healthy again

---

## 18. Branch / PR Discipline You Enforced

You repeatedly enforced these rules:

- every change should ship through a branch and PR
- use the `cortana-hd` path for PR review
- sync `main` after merge
- restart live UI after merge if runtime-visible behavior changed

One important slip occurred:

- a commit accidentally landed on local `main` first during one of the Polymarket changes
- it was then moved onto the correct PR branch before publish
- local `main` was later reset back to match `origin/main`

That was corrected, but it is important context because branch discipline matters heavily in this repo.

---

## 19. Most Important Architectural Decisions Made In The Conversation

### Decision 1

Mission Control live tape should prefer pure Schwab semantics.

Meaning:

- fresh Schwab first
- then stale Schwab
- then unavailable
- no silent Alpaca row-level substitution

### Decision 2

After-hours behavior should be calmer.

Meaning:

- quieter symbols should not immediately look broken
- retain last-known Schwab values when appropriate
- show stale or waiting rather than immediate hard failure

### Decision 3

Use SSE, not browser WebSocket, for the Mission Control browser-facing live layer.

### Decision 4

Fallback strategy must preserve operator trust, not just keep numbers visible.

### Decision 5

If an operator-facing card is technically clever but confusing, remove it rather than trying to explain around the confusion.

### Decision 6

Request-path REST fanout should not be the long-term live dashboard model.

### Decision 7

The main chat should orchestrate; deeper implementation work can route into subagents or specialist lanes when appropriate.

---

## 20. Current System Shape At The End Of The Conversation

By the end of the thread:

- `cbreadth` and related operator summaries were much easier to read
- planning docs and QA docs existed for the roadmap work
- Mission Control was the primary operator UI for Trading Ops
- Schwab streamer support existed and had been authenticated through a dedicated streamer app
- live tape behavior was substantially hardened
- provider-mode fallback strategy was documented and partially implemented
- Polymarket had its own operator tab and major UI surface
- the confusing linked stock-context card had been removed
- Polymarket startup behavior had a bounded grace window
- system health exposed multiple financial services
- Mission Control restart flow was script and launchd based
- watchdog and canary alerts had been interpreted correctly when they surfaced
- some warn-level issues were intentionally left alone rather than over-fixed prematurely

---

## 21. Frequently Used Files And Commands

### High-signal files

- `/Users/hd/Developer/cortana-external/apps/mission-control/scripts/restart-mission-control.sh`
- `/Users/hd/Developer/cortana-external/backtester/docs/source/guide/backtester-study-guide.md`
- `/Users/hd/Developer/cortana-external/backtester/docs/source/guide/session-handoff.md`
- `/Users/hd/Developer/cortana-external/backtester/docs/source/roadmap/roadmap.md`
- `/Users/hd/Developer/cortana-external/backtester/docs/source/roadmap/polymarket-v2-trade-loop.md`
- `/Users/hd/Developer/cortana-external/backtester/var/readiness/pre-open-canary-latest.json`
- `/Users/hd/Developer/cortana-external/watchdog/watchdog.sh`

### Important callback

- `https://127.0.0.1:8182/auth/schwab/callback`

### Important runtime ports

- Mission Control: `http://127.0.0.1:3000`
- external-service: `http://127.0.0.1:3033`

### Common operator scripts

- `./apps/mission-control/scripts/restart-mission-control.sh`
- `./scripts/operator_workflow.sh premarket`
- `./scripts/operator_workflow.sh open`
- `./scripts/operator_workflow.sh midday`
- `./scripts/operator_workflow.sh close`
- `./scripts/operator_workflow.sh night`
- `./scripts/operator_workflow.sh health`

---

## 22. Best Plain-English Summary

This conversation took Cortana from “powerful but noisy and brittle” to “much more operator-usable and much closer to a real live trading workstation.”

The biggest wins were:

- readable operator summaries instead of raw JSON walls
- formal planning docs across the roadmap
- repeated QA with real bug discovery
- a real Mission Control UI for Trading Ops
- Schwab streaming instead of pure REST dependence
- a clearer, more trustworthy fallback strategy
- much better Polymarket visibility
- stronger launchd / runtime discipline

The biggest recurring risk themes were:

- source vs runtime drift
- streamer auth and reconnect behavior
- request-path REST fallback pressure
- operator confusion from technically correct but poorly framed UI states

---

## 23. Last Known Intentional Deferrals

Some things were intentionally left alone at different points in the conversation:

- not every warn-level watchdog / canary issue was immediately “fixed”
- some degraded-safe paths were allowed to remain while the system observed real-world behavior
- some surfaces were simplified by removal rather than expanded into more complex explanation
- Polymarket V2 roadmap work was intentionally deferred so the live system could “breathe” for a while and reveal real issues first

---

## 24. If A New Agent Picks Up From Here

The safest assumptions are:

- Mission Control is the primary operator surface
- launchd-managed runtime is more important than local dev assumptions
- live market tape should be interpreted through the Schwab-first trust model
- Polymarket is its own operator domain and should not fake stock semantics
- if the UI is technically working but confusing, it still needs work
- source code alone does not prove runtime truth

The first things to inspect should be:

1. Mission Control health
2. external-service health
3. launchd state for Mission Control and external-service
4. current live tape / streamer state
5. latest readiness / canary artifacts
6. whether the issue is source, runtime, auth, or operator framing
