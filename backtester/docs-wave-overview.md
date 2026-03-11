# Market Intelligence Waves Overview

This document explains the practical trading-system buildout completed on top of the original backtester.

The goal was **not** to replace the trading system with academic prediction theater.
The goal was to make the existing CANSLIM + Buy Dip workflow smarter, more context-aware, and more defensible.

## Core philosophy

Keep the system practical:
- simple, reviewable scoring over exotic black boxes
- market context and risk controls over blind prediction
- confidence layering over one-shot model worship
- better labels and evaluation before more model complexity

## Base system

Original strengths:
- CANSLIM-style growth scoring
- market regime gate
- Dip Buyer scan / alert path
- backtesting framework
- Telegram-ready alert output

Weaknesses before the wave buildout:
- limited outcome labeling
- shallow regime context
- weaker distinction between healthy dip vs falling knife
- no structured breakout follow-through layer
- limited sentiment/context integration
- no disciplined model comparison harness

## What was built

## Wave 1 — foundation

### Scope
1. Better outcome labeling
2. Market regime classifier improvements / reusable regime layer
3. Dip recovery / falling-knife filter support

### Main additions
- `outcomes.py`
- enhanced `data/market_regime.py`
- Dip Buyer scoring updates in `strategies/dip_buyer.py`
- integration updates in `advisor.py`

### Why it matters
Wave 1 created the basic context layer needed for smarter decisions:
- what kind of market we are in
- what kind of dip we are looking at
- what outcome labels should be tracked for evaluation

## Wave 2 — contextual scoring

### Scope
1. Breakout follow-through score
2. Sentiment overlay
3. Exit risk score

### Main additions
- `data/wave2.py`
- advisor integration for breakout/sentiment/exit scoring
- tests for Wave 2 scoring and advisor integration

### Why it matters
Wave 2 upgraded the system from pure entry scoring into a more complete decision process:
- breakout quality assessment
- sentiment as an overlay/filter rather than a magical main brain
- exit/risk information in the recommendation path

## Wave 3 — sizing and context refinement

### Scope
1. Position sizing by confidence + regime
2. Sector-relative strength context
3. Catalyst / event weighting

### Main additions
- `data/wave3.py`
- `data/fundamentals.py` extensions
- advisor integration for sizing, sector, and catalyst context
- tests covering Wave 3 behavior

### Why it matters
Wave 3 improved decision quality by making sizing and prioritization more context-aware:
- stronger setups can size bigger when regime supports it
- weak sector context can penalize otherwise tempting names
- catalyst/event context can influence conviction without becoming the whole thesis

## Wave 4 — model comparison harness

### Scope
1. Compare simple practical scoring/model families
2. Add evaluation scaffolding before deeper sequence work
3. Avoid academic overbuild until evidence justifies it

### Main additions
- `evaluation/`
- comparison/reporting hooks in `advisor.py`
- Wave 4 comparison tests

### Why it matters
Wave 4 is the discipline layer.
It helps answer:
- do the new layers actually help?
- does the enhanced stack beat the baseline?
- are we improving signal or just adding moving parts?

## Current system architecture

## Decision flow
1. **Base screens**
   - CANSLIM / Dip Buyer core filters
2. **Market context**
   - regime state
   - sector context
   - catalyst context
3. **Scoring overlays**
   - breakout follow-through
   - dip recovery / knife filter
   - sentiment overlay
   - exit risk
4. **Decision shaping**
   - action guidance
   - confidence
   - position sizing
5. **Evaluation layer**
   - compare baseline vs enhanced stack
   - measure whether additions are earning their keep

## Important modules

### Advisor / orchestration
- `advisor.py` — main recommendation and scan orchestration

### Core context and scoring
- `data/market_regime.py` — regime logic
- `outcomes.py` — outcome labeling
- `data/wave2.py` — breakout / sentiment / exit-risk scoring
- `data/wave3.py` — sizing / sector / catalyst logic
- `strategies/dip_buyer.py` — Dip Buyer strategy logic
- `data/fundamentals.py` — fundamentals + context support

### Evaluation
- `evaluation/comparison.py` — model/scoring comparison harness

## Practical use

### Existing operational commands
- `python advisor.py --market`
- `python advisor.py --symbol NVDA`
- `python advisor.py --quick`
- `python canslim_alert.py --limit 8 --min-score 6`

### What the enhancements are trying to improve
- fewer fake breakouts
- fewer knife catches disguised as buyable dips
- better confidence ranking
- better sizing behavior
- better awareness of regime / sector / catalyst context
- cleaner comparison of baseline vs enhanced decision layers

## What this system is not

This is **not**:
- a giant deep-learning stock oracle
- a pure price-prediction project
- an academic benchmark vanity machine

It is a practical decision-support system for:
- CANSLIM-style growth setups
- Buy-the-dip scanning
- smarter risk/context filters
- eventually measuring whether each added layer actually improves trading decisions

## Recommended next use

Do not add more feature layers blindly.
Use the Wave 4 harness to evaluate:
- baseline vs enhanced stack
- by market regime
- by drawdown / false positives / expectancy

Only after that should deeper modeling work be considered.

## Short version

Wave 1–4 built:
- better labels
- better regime awareness
- better dip quality assessment
- breakout/sentiment/exit scoring
- confidence/regime-based sizing
- sector and catalyst context
- and a comparison harness to decide what is real edge versus decorative complexity.
