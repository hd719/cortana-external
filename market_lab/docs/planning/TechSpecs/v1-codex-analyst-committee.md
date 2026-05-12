# Technical Specification - Market Lab V1 Codex Analyst Committee

**Document Status:** Draft  
**PRD:** [v1-codex-analyst-committee.md](../PRDs/v1-codex-analyst-committee.md)

## Development Overview

V1 upgrades the existing Codex-assisted review lane from markdown summary to structured analyst committee output. The Python package remains the source of truth for artifacts. Mission Control continues to trigger Codex through the existing session bridge and renders the parsed artifact.

Key current files:

- `market_lab/market_lab/codex_review.py` builds the Codex packet and prompt.
- `market_lab/market_lab/models.py` defines `CodexReview` and `ReviewArtifact`.
- `market_lab/market_lab/storage.py` attaches `codex-review.md` and parses the current verdict.
- `market_lab/market_lab/runner.py` writes `codex-review-packet.md` for every run.
- `apps/mission-control/lib/market-lab.ts` bridges Next.js routes to the Python CLI.
- `apps/mission-control/app/market-lab/market-lab-client.tsx` renders the Market Lab cockpit.
- `apps/mission-control/app/api/market-lab/runs/[runId]/codex-review/route.ts` starts the Codex session flow.

The V1 change should not require a new service. It is an artifact/schema/UI upgrade.

---

## Data Model Changes

Update `market_lab/market_lab/models.py`.

Add:

```python
class CodexRoleReview(Model):
    role: Literal["price_action", "fundamentals", "news_sentiment", "risk", "final_judge"]
    stance: Literal["bullish", "bearish", "neutral", "mixed"]
    summary: str
    bull_points: list[str] = Field(default_factory=list)
    bear_points: list[str] = Field(default_factory=list)
    missing_evidence: list[str] = Field(default_factory=list)

class CodexStructuredReview(Model):
    verdict: TrustVerdict
    confidence: float = Field(ge=0, le=1)
    horizon: Literal["1d", "5d", "20d", "mixed"]
    summary: str
    hard_gate_assessment: str
    roles: list[CodexRoleReview] = Field(default_factory=list)
    what_would_change_verdict: list[str] = Field(default_factory=list)
    operator_note: str
```

Extend:

```python
class CodexReview(Model):
    status: Literal["pending", "attached"]
    summary: str
    verdict: TrustVerdict | None = None
    structured: CodexStructuredReview | None = None
    output_path: str | None = None
    session_id: str | None = None
```

Schema version can remain `market-lab-review/v0` for the full review artifact if backward compatibility is desired, but the embedded Codex schema should identify itself in markdown and parsed JSON as `market-lab-codex-review/v1`.

---

## Artifact Format

`codex-review.md` should include one fenced JSON block that can be parsed deterministically:

````markdown
# Codex Review: AAPL

```json market-lab-codex-review/v1
{
  "verdict": "trusted",
  "confidence": 0.72,
  "horizon": "5d",
  "summary": "...",
  "hard_gate_assessment": "...",
  "roles": [
    {
      "role": "price_action",
      "stance": "bullish",
      "summary": "...",
      "bull_points": ["..."],
      "bear_points": ["..."],
      "missing_evidence": []
    }
  ],
  "what_would_change_verdict": ["..."],
  "operator_note": "Review-only note. Do not execute from this review."
}
```

## Human Notes

...
````

The markdown can include readable prose, but the JSON block is the UI contract.

---

## Behavior Changes

### Codex Packet

Update `market_lab/market_lab/codex_review.py`:

- Include explicit role instructions.
- Require the fenced JSON block.
- State that optional missing news/sentiment is not by itself a hard blocker.
- State that deterministic blocker checks must force `blocked`.
- Keep “review-only, no trade placement” language.

### Attach Flow

Update `market_lab/market_lab/storage.py`:

- Parse the fenced JSON block.
- Validate it with `CodexStructuredReview`.
- Store it under `artifact.codex_review.structured`.
- Continue storing markdown `summary`, `verdict`, `output_path`, and `session_id`.
- If JSON parsing fails, attach markdown as today but set `structured` to null and append a warning event.

### UI

Update `apps/mission-control/app/market-lab/market-lab-client.tsx`:

- Add structured Codex type fields.
- Render Codex final judge: verdict, confidence, horizon.
- Render role cards for price action, fundamentals, news/sentiment, risk, final judge.
- Keep raw/debug paths collapsed by default.
- Preserve current fallback for older runs without structured data.

### API Bridge

Update `apps/mission-control/lib/market-lab.ts`:

- Extend `MarketLabReview.codex_review` type with `structured`.
- No new API endpoint required.

---

## Process Changes

No scheduler change. V1 remains operator-triggered:

1. Run or select a Market Lab review.
2. Click `Ask Codex`.
3. Codex writes and attaches `codex-review.md`.
4. Mission Control refreshes and renders structured committee output.

---

## Test Plan

Python:

- `market_lab/tests/test_storage.py`
  - parses valid fenced Codex JSON into `CodexStructuredReview`
  - preserves markdown-only fallback
  - rejects invalid confidence or invalid role values
- `market_lab/tests/test_codex_review.py`
  - packet contains required role names
  - packet contains fenced JSON schema requirement
  - packet includes hard-gate guidance

Mission Control:

- `apps/mission-control/app/market-lab/market-lab-client.test.tsx`
  - renders structured Codex verdict/confidence/horizon
  - renders role cards
  - falls back for older markdown-only reviews
- `apps/mission-control/lib/market-lab.test.ts`
  - accepts structured `codex_review` response shape

Manual:

- Run AAPL.
- Ask Codex.
- Confirm `codex-review.md` includes JSON block.
- Confirm `review.json` has `codex_review.structured`.
- Confirm Market Lab UI shows role panels.

---

## Risks

| Risk | Mitigation |
|------|------------|
| Codex emits invalid JSON | Keep markdown fallback and show “structured parse missing” warning. |
| UI becomes too dense | Render final judge first; collapse raw/debug content. |
| Codex over-trusts thin data | Deterministic blockers remain authoritative; optional gaps remain visible. |
| Schema changes break older runs | Treat `structured` as optional and maintain fallback rendering. |

---

## Open Questions

1. Should V1 include `news_sentiment` as a role even while source evidence is optional/missing? Recommendation: yes, so Codex explicitly says what is missing.
2. Should confidence be allowed for `blocked` verdicts? Recommendation: yes; confidence then means confidence in the block.
3. Should final judge be both a role and top-level verdict? Recommendation: yes; top-level fields are for UI/query, final judge role is for narrative.

