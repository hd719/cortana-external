# Decision review loop

This trading stack now includes a compact **Decision review** block in live operator-facing scan output.

## What it is

The review block is a short audit layer for recent BUY / WATCH / NO_BUY decisions. It exists to help operators review recent decisions and tune the centralized scoring defaults intentionally instead of guessing from raw rank order alone.

It does **not** add a new strategy or override existing veto/gate behavior.

## What it shows

Depending on the available runtime fields, the review block can include:

- action counts (`BUY`, `WATCH`, `NO_BUY`)
- tuning balance summary
  - clean buys
  - risky buy proxy
  - abstains
  - vetoes
  - higher-trade-quality restraint proxy
- grouped detail lines for:
  - risky buys
  - higher-trade-quality restraint
  - abstains
  - vetoes

## How to read it

### Decision review
A compact count of what the live scan surfaced.

### Tuning balance
A compact operator summary for calibration review:
- **clean BUY**: buy candidates without obvious risk/stress flags
- **risky BUY proxy**: buys that still carry elevated uncertainty or stress baggage
- **abstain**: candidates that met enough conditions to surface but explicitly stood down
- **veto**: candidates blocked by harder guardrails such as credit/risk gates
- **higher-tq restraint proxy**: non-BUY names whose trade-quality score still met or exceeded the median BUY trade-quality score

This is a review aid, not a trading instruction by itself.

### Detail lines
The grouped detail lines show why specific names fell into those buckets, using the same live fields already present in the runtime:
- trade quality (`tq`)
- confidence / uncertainty (`conf`, `u`)
- downside + churn penalties (`down/churn`)
- stress label/score (`stress`)
- abstain/veto/reason text where available

## Why it exists

The system now has richer runtime intelligence:
- trade-quality scoring
- uncertainty handling
- downside/churn penalties
- adverse-regime stress
- restraint metrics
- review slices in offline comparison reports

The live decision review loop is the operator-facing complement to those features. It helps answer:
- Did the system buy the clean names?
- Did it abstain for sensible reasons?
- Did vetoes block names that still looked superficially attractive?
- Are the centralized calibration defaults too timid or too generous?

## Tuning workflow

Use the decision review block to inspect a recent live scan, then adjust centralized scoring defaults only after reviewing repeated patterns.

Good reasons to tune:
- too many risky buys survive
- too many high-trade-quality names get restrained in benign conditions
- abstain behavior looks too timid or too loose
- vetoed names consistently look correct/incorrect in hindsight

Bad reasons to tune:
- one emotionally annoying missed trade
- wanting more activity for its own sake
- overriding guardrails because a name looked exciting

## Scope

This review loop is intentionally compact. It is meant to make recent decisions auditable without turning alerts into a wall of telemetry.
