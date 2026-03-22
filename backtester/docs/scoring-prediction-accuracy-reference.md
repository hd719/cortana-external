# Scoring and Prediction Accuracy Reference

Operator reference for understanding what gets logged, what gets settled later, and how to read the accuracy artifacts.

## What gets logged

The live and research paths record the same broad decision shape:

- symbol or candidate name
- action such as `BUY`, `WATCH`, or `NO_BUY`
- score or rank inputs
- confidence and penalty context
- strategy or regime notes when available
- the final decision reason

The point is traceability, not just the headline recommendation.

## What gets settled

Settled records are the later outcome checks for old research snapshots.

They answer:

- did the idea resolve into a measurable outcome
- did it hit the intended horizon
- what return or hit/miss result did it produce
- was there enough history to count the sample

If you see `no_settled_records`, the history exists but no old snapshots have matured into settled samples yet.

## How to read accuracy

Use these rules of thumb:

- a strong score is only useful if the settled outcomes support it
- a clean `BUY` is better than a noisy one with heavy risk or stress context
- repeated `WATCH` calls can still be useful if settled outcomes show restraint was correct
- `NO_BUY` is not a failure when the later settled record shows the name was weak or noisy

## Practical interpretation

- If logged decisions look good but settled accuracy is weak, the scoring is overconfident.
- If settled accuracy is good but few names are logged as actionable, the system may be too conservative.
- If a strategy's score improves but settled results do not, the tuning changed ranking without improving selection.

## Where to look

- `buy_decision_calibration.py` for settled-history summaries
- `experimental_alpha.py` for research snapshots and settlement
- `decision-review-loop.md` for operator-facing live decision review

Keep the focus on settled history, not just one-day output.
