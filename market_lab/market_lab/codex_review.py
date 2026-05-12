from __future__ import annotations

from pathlib import Path

from .models import ReviewArtifact


def build_codex_packet(artifact: ReviewArtifact) -> str:
    price = artifact.price_facts
    spy = artifact.spy_facts
    checks = "\n".join(f"- {item.severity}: {item.code} - {item.message}" for item in artifact.checks) or "- none"
    reasons = ", ".join(artifact.verdict_reasons) or "none"

    return f"""# Market Lab Codex Review Packet: {artifact.symbol}

## Task

Review this Market Lab run and write a Codex-assisted trading trust review.

Return a clear verdict: `trusted`, `blocked`, or `uncertain`.

Do not recommend placing a trade. This is review-only.

## Run

- Run id: `{artifact.run_id}`
- Symbol: `{artifact.symbol}`
- Current Market Lab verdict: `{artifact.trust_verdict}`
- Current reasons: {reasons}
- Review artifact: `{artifact.artifact_paths.review}`
- Codex review output path: `{artifact.artifact_paths.codex_review}`

## Market Facts

- {artifact.symbol} price: {price.price if price else "n/a"}
- {artifact.symbol} source: {price.source if price else "n/a"}
- {artifact.symbol} timestamp: {price.timestamp.isoformat() if price else "n/a"}
- SPY price: {spy.price if spy else "n/a"}
- SPY source: {spy.source if spy else "n/a"}
- SPY timestamp: {spy.timestamp.isoformat() if spy else "n/a"}

## Evidence Status

- History: {artifact.optional_evidence.history_status}
- Fundamentals: {artifact.optional_evidence.fundamentals_status}
- News: {artifact.optional_evidence.news_status}
- Sentiment: {artifact.optional_evidence.sentiment_status}
- Notes: {", ".join(artifact.optional_evidence.notes) or "none"}

## Checks

{checks}

## Required Output

Write a markdown review to:

`{artifact.artifact_paths.codex_review}`

Use this shape:

```markdown
# Codex Review: {artifact.symbol}

Verdict: trusted|blocked|uncertain

Summary:
...

Bull Case:
- ...

Bear Case:
- ...

Missing Evidence:
- ...

Decision:
...
```

Then attach it to the run:

```bash
uv run --project market_lab python -m market_lab.cli attach-codex-review {artifact.run_id} {artifact.artifact_paths.codex_review} --json
```
"""


def codex_prompt_for_packet(packet_path: str | Path) -> str:
    return f"""You are reviewing a Market Lab trading artifact.

Read this packet:

`{packet_path}`

Follow the packet exactly:
1. Read the Market Lab review artifact it references.
2. Write the Codex review markdown to the requested output path.
3. Run the attach command from the packet.
4. Reply with the final verdict and the file path you wrote.
"""
