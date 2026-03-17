# PRD: Next-Gen Profit Advancements for Trading Stack

**Status:** Draft  
**Owner:** Cortana / OpenClaw trading workflow  
**Scope:** `cortana` trading cron + `cortana-external` intel inputs (read-only)  
**Intent:** Push the current decoupled architecture toward institutional-grade selection, sizing, and execution readiness to maximize PnL without breaking reliability.

---

## Why

The decoupled base/enrichment/notify stack is stable. To materially improve PnL, we need higher-quality selection, better risk-adjusted sizing, and execution-aware surfacing—without reintroducing fragility.

---

## Objectives

1) Improve selection quality inside the scan cap  
2) Improve risk-adjusted sizing and exposure discipline  
3) Reduce execution drag and forced errors  
4) Use cross-asset/context signals to time aggression and filtering  
5) Keep reliability: base compute stays minimal; enrichments fail-open; notify stays strict/idempotent

---

## Proposed Capability Set

### A) Regime/Vol-Aware Sizing & Risk Budget Meter
- Inputs: realized/imp vol (SPY, QQQ), VIX term structure, HY spreads, drawdown stats
- Outputs: aggression dial + recommended exposure cap; mark “risk budget remaining” in alerts
- Placement: enrichment (annotation-only); base sizing rules remain intact

### B) Liquidity & Slippage Modeling
- Compute per-name liquidity quality: spread × size × volatility; average dollar volume; halt/ADR flags
- Filter or down-rank illiquid names; surface expected slippage/impact next to BUYs
- Placement: enrichment ranking modifier + alert annotations

### C) Factor Tilt Overlay
- Lightweight cross-sectional tilts (quality, momentum, low-vol, value proxies)
- Rank marginal BUY/WATCH names by factor alignment and portfolio overexposure
- Placement: enrichment ranking modifier; cap factor concentrations

### D) Event/Earnings-Aware Scheduling
- Down-rank or flag names with imminent earnings/lockups unless event-driven
- Mark binary-event proximity in alerts
- Placement: enrichment annotation + optional veto for short-horizon holds

### E) Cross-Asset Confirmation/Divergence
- Inputs: ES/NQ futures, credit (CDX/HY), rates (2s/10s), vol surface (VIX/VVIX/term), crypto beta for proxies
- Outputs: risk-on/off boost/veto for marginal names; aggression timing cues
- Placement: enrichment; never overrides base gates

### F) Stop/Target Policy Suggestions
- Suggest ATR/structure-based stops and first targets for BUY names
- Placement: enrichment annotations only (operator guidance)

### G) Short/Hedge Candidates
- Surface clean hedge candidates (index/sector/ETF) when regime/vol triggers risk-off posture
- Placement: enrichment-only list; no auto sizing

### H) Outcome Tracking & Adaptive Weights
- Daily/weekly settlement of BUY/WATCH outcomes (1d/5d/10d)
- Learn which buckets (regime, factor, liquidity, event proximity, Polymarket posture) are hot/cold
- Adjust ranking weights and “turn down” cold buckets automatically
- Placement: enrichment + weight file consumed by ranking modifiers; base untouched

### I) Execution Readiness Signals
- Mark illiquid windows (first/last 10m), halts, extreme spreads
- Placement: enrichment annotations in alerts

### J) Adaptive Scan Cadence
- Slow scans in dead markets; speed up when vol/event risk is high
- Placement: scheduler/config; keep base contract stable

---

## Architecture Rules (unchanged)
- Base compute stays minimal: regime + CANSLIM/Dip Buyer core + gating + metrics + message
- Enrichments are fail-open, run by `run_id`, write to `enrichments/`, never flip base status
- Notify merges only fresh, matching run_id artifacts and stays strict/idempotent

---

## Phased Rollout (recommended)

Phase 1 (Low risk, high value)  
- Liquidity/slippage scoring + alert annotations  
- Risk budget meter (vol/regime-aware aggression)  
- Delivery audit artifact (already added) extended to include merge flags

Phase 2 (Selection quality)  
- Factor tilt overlay + concentration caps  
- Event proximity flags and down-rank  
- Cross-asset confirmation/divegence cues

Phase 3 (Execution & hedging)  
- Stop/target suggestions  
- Hedge candidate surfacing in risk-off regimes  
- Adaptive scan cadence knobs

Phase 4 (Learning loop)  
- Outcome settlement + bucket hit rates  
- Adaptive weights for ranking modifiers

---

## Success Criteria
- Higher hit rate / return per BUY and WATCH buckets vs. current baseline
- Lower slippage/impact on executed names (measured via liquidity score bins)
- Fewer bad longs during adverse cross-asset signals (tracked in outcome settlement)
- No increase in cron failures or notify false greens

---

## Risks / Mitigations
- Overfitting: keep adaptive weight changes bounded and reviewable
- Latency: heavy data fetch must stay out of base; use cached/overnight precomputation
- Complexity creep: each enrichment must be optional; base must succeed alone

---

## Notes on Data Sources
- Prefer cached/precomputed inputs where possible; avoid live multi-API fanout in market session
- Use Polymarket only as context/rank modifier, never as a hard gate
- Use existing MarketDataProvider caches for liquidity/vol metrics when feasible

