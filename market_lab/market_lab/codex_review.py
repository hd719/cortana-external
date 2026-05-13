from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

from .models import ReviewArtifact, RunRecord

CODEX_SCHEMA = "market-lab-codex-review/v1"


def _missing_context(artifact: ReviewArtifact) -> list[str]:
    missing: list[str] = []
    if artifact.price_facts is None:
        missing.append("symbol_price")
    if artifact.spy_facts is None:
        missing.append("spy_reference")
    for label, status in [
        ("history", artifact.optional_evidence.history_status),
        ("fundamentals", artifact.optional_evidence.fundamentals_status),
        ("news", artifact.optional_evidence.news_status),
        ("sentiment", artifact.optional_evidence.sentiment_status),
    ]:
        if status != "available":
            missing.append(label)
    return missing


def _settlement_summary(settlements: list[dict[str, Any]]) -> str:
    rows = []
    for settlement in settlements[:3]:
        window = settlement.get("window", "n/a")
        status = settlement.get("status", "n/a")
        score = settlement.get("score") or "n/a"
        alpha = settlement.get("alpha_vs_spy_pct")
        alpha_text = f"{float(alpha):.2f}%" if isinstance(alpha, (int, float)) else "n/a"
        rows.append(f"{window}:{status}, score={score}, alpha_vs_spy={alpha_text}")
    return "; ".join(rows) if rows else "none"


def _prior_runs_text(
    prior_runs: list[RunRecord] | None,
    prior_settlements: dict[str, list[dict[str, Any]]] | None,
) -> str:
    if not prior_runs:
        return "- none available"
    rows = []
    for run in prior_runs[:5]:
        settlements = _settlement_summary((prior_settlements or {}).get(run.run_id, []))
        rows.append(
            f"- {run.run_id}: verdict={run.trust_verdict or 'n/a'}, status={run.status}, requested_at={run.requested_at.isoformat()}, settlements={settlements}"
        )
    return "\n".join(rows)


def build_codex_packet(
    artifact: ReviewArtifact,
    *,
    prior_runs: list[RunRecord] | None = None,
    prior_settlements: dict[str, list[dict[str, Any]]] | None = None,
    mode: Literal["quick", "deep"] = "quick",
) -> str:
    price = artifact.price_facts
    spy = artifact.spy_facts
    checks = "\n".join(f"- {item.severity}: {item.code} - {item.message}" for item in artifact.checks) or "- none"
    reasons = ", ".join(artifact.verdict_reasons) or "none"
    blockers = [item.code for item in artifact.checks if item.severity == "blocker"]
    missing_context = _missing_context(artifact)
    context_sections = _context_sections(artifact, mode)

    return f"""# Market Lab Codex Review Packet: {artifact.symbol}

## Task

Review this Market Lab run as a structured Codex analyst committee.

Return a clear verdict: `trusted`, `blocked`, or `uncertain`.

Do not recommend placing a trade. This is review-only.

Codex is not trusted because the response sounds confident. Trust comes from cited evidence, admitted missing context, calibrated confidence, and later settlement performance.

Verdict guidance:

- `blocked`: use only when a blocker check exists, required price evidence is unusable, or the artifact is internally inconsistent.
- `trusted`: use when required live/latest price evidence is usable and the review is coherent, even if optional v0 news or sentiment evidence is missing.
- `uncertain`: use when evidence is mixed, contradictory, materially thin beyond known optional v0 gaps, or needs a human decision.
- Deterministic blocker checks must force `blocked`.
- Missing optional news/sentiment/fundamentals must be listed as missing context. Do not infer unavailable facts.
- Do not claim Yahoo Finance, StockTwits, Reddit, or X/Twitter sentiment unless source data appears in this packet.
- Compare this run against prior same-symbol outcome memory when available.
- The old free-form `Summary / Bull Case / Bear Case / Decision` shape is not the primary contract. The JSON block below is the contract.

## Run

- Run id: `{artifact.run_id}`
- Symbol: `{artifact.symbol}`
- Current Market Lab verdict: `{artifact.trust_verdict}`
- Current reasons: {reasons}
- Full review artifact: omitted from this Codex packet; use the packet as the bounded source of truth.
- Codex review output path: `{artifact.artifact_paths.codex_review}`
- Hard blockers: {", ".join(blockers) or "none"}
- Packet mode: `{mode}`
- Token budget: `{_json_for_packet(artifact.token_budget.model_dump(mode="json") if artifact.token_budget else None)}`

## Benchmark And Settlement Logic

- SPY is the benchmark because it represents the broad market alternative.
- A trusted review is later scored over 1D, 5D, and 20D by comparing {artifact.symbol} return against SPY return.
- Alpha versus SPY = {artifact.symbol} return minus SPY return.
- A review is more useful if the stock-specific idea beats SPY, not just if the stock rises with the market.

## Context Inventory

### Market Facts

- {artifact.symbol} price: {price.price if price else "n/a"}
- {artifact.symbol} source: {price.source if price else "n/a"}
- {artifact.symbol} timestamp: {price.timestamp.isoformat() if price else "n/a"}
- {artifact.symbol} price basis: {price.price_basis if price else "n/a"}
- SPY price: {spy.price if spy else "n/a"}
- SPY source: {spy.source if spy else "n/a"}
- SPY timestamp: {spy.timestamp.isoformat() if spy else "n/a"}
- SPY price basis: {spy.price_basis if spy else "n/a"}

### Evidence Status

- History: {artifact.optional_evidence.history_status}
- Fundamentals: {artifact.optional_evidence.fundamentals_status}
- News: {artifact.optional_evidence.news_status}
- Sentiment: {artifact.optional_evidence.sentiment_status}
- Notes: {", ".join(artifact.optional_evidence.notes) or "none"}
- Missing context: {", ".join(missing_context) or "none"}

### Prior Same-Symbol Runs

{_prior_runs_text(prior_runs, prior_settlements)}

{context_sections}

### Checks

{checks}

## Required Output

Write a markdown review to:

`{artifact.artifact_paths.codex_review}`

Use this shape:

```markdown
# Codex Review: {artifact.symbol}

```json {CODEX_SCHEMA}
{{
  "schema_version": "{CODEX_SCHEMA}",
  "verdict": "trusted|blocked|uncertain",
  "confidence": 0.0,
  "horizon": "1d|5d|20d|mixed",
  "summary": "One concise operator-readable conclusion.",
  "hard_gate_assessment": "State whether deterministic blockers exist and how they affect the verdict.",
  "context_quality": "State what context is strong, weak, or missing.",
  "missing_context": ["news", "sentiment"],
  "roles": [
    {{
      "role": "price_action",
      "stance": "bullish|bearish|neutral|mixed",
      "confidence": 0.0,
      "summary": "Price action view.",
      "evidence_used": ["symbol_price", "spy_reference", "market_hours_state"],
      "bull_points": [],
      "bear_points": [],
      "missing_evidence": []
    }},
    {{
      "role": "fundamentals",
      "stance": "bullish|bearish|neutral|mixed",
      "confidence": 0.0,
      "summary": "Fundamentals view.",
      "evidence_used": [],
      "bull_points": [],
      "bear_points": [],
      "missing_evidence": []
    }},
    {{
      "role": "news_sentiment",
      "stance": "bullish|bearish|neutral|mixed",
      "confidence": 0.0,
      "summary": "News and sentiment view.",
      "evidence_used": [],
      "bull_points": [],
      "bear_points": [],
      "missing_evidence": []
    }},
    {{
      "role": "risk",
      "stance": "bullish|bearish|neutral|mixed",
      "confidence": 0.0,
      "summary": "Risk view.",
      "evidence_used": [],
      "bull_points": [],
      "bear_points": [],
      "missing_evidence": []
    }},
    {{
      "role": "final_judge",
      "stance": "bullish|bearish|neutral|mixed",
      "confidence": 0.0,
      "summary": "Final committee judgment.",
      "evidence_used": [],
      "bull_points": [],
      "bear_points": [],
      "missing_evidence": []
    }}
  ],
  "what_would_change_verdict": [],
  "operator_note": "Review-only note. Do not execute from this review."
}}
```

## Human Notes

Add concise prose only after the JSON block if useful.
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
1. Use the packet as the review source of truth.
2. Write the Codex review markdown to the requested output path.
3. Run the attach command from the packet.
4. Reply with the final verdict and the file path you wrote.

Do not open the full review.json or portfolio cache unless the packet is internally inconsistent and you need to debug corruption.
"""


def _json_for_packet(payload: Any) -> str:
    if payload is None:
        return "null"
    return json.dumps(payload, indent=2, default=str)


def _compact_evidence(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    if not payload:
        return None
    return {
        "symbol": payload.get("symbol"),
        "price_summary": payload.get("price_summary"),
        "benchmark_summary": payload.get("benchmark_summary"),
        "missing_context": payload.get("missing_context", []),
        "risk_flags": payload.get("risk_flags", []),
    }


def _compact_sentiment(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    if not payload:
        return None
    sources = []
    for source in payload.get("sources", []) or []:
        samples = source.get("samples", []) if isinstance(source, dict) else []
        sources.append(
            {
                "source": source.get("source"),
                "status": source.get("status"),
                "sample_count": source.get("sample_count"),
                "fetch_method": source.get("fetch_method"),
                "summary": source.get("summary"),
                "error": source.get("error_message") or source.get("error"),
                "samples": samples[:3],
            }
        )
    return {
        "symbol": payload.get("symbol"),
        "status": payload.get("status"),
        "generated_at": payload.get("generated_at"),
        "sources": sources,
        "notes": payload.get("notes", []),
    }


def _compact_portfolio(payload: dict[str, Any] | None, *, symbol: str) -> dict[str, Any] | None:
    if not payload:
        return None
    normalized = symbol.strip().upper()
    positions = payload.get("positions", []) or []
    symbol_positions = [
        {
            "symbol": position.get("symbol"),
            "asset_type": position.get("asset_type"),
            "quantity": position.get("quantity"),
            "current_price": position.get("current_price"),
            "day_change": position.get("day_change"),
            "day_change_pct": position.get("day_change_pct"),
            "market_value": position.get("market_value"),
            "unrealized_pnl": position.get("unrealized_pnl"),
            "weight_pct": position.get("weight_pct"),
            "quote_source": position.get("quote_source"),
            "quote_status": position.get("quote_status"),
            "quote_timestamp": position.get("quote_timestamp"),
        }
        for position in positions
        if str(position.get("symbol") or "").strip().upper() == normalized
    ]
    return {
        "status": payload.get("status"),
        "source": payload.get("source"),
        "generated_at": payload.get("generated_at"),
        "accounts_count": len(payload.get("accounts", []) or []),
        "positions_count": len(positions),
        "holds_symbol": bool(symbol_positions),
        "symbol_positions": symbol_positions,
        "exposure_notes": payload.get("exposure_notes", []),
        "overlap_notes": payload.get("overlap_notes", []),
        "message": payload.get("message"),
    }


def _context_sections(artifact: ReviewArtifact, mode: Literal["quick", "deep"]) -> str:
    evidence = artifact.evidence_snapshot.model_dump(mode="json") if artifact.evidence_snapshot else None
    outcome_memory = artifact.outcome_memory.model_dump(mode="json") if artifact.outcome_memory else None
    sentiment = artifact.sentiment_snapshot.model_dump(mode="json") if artifact.sentiment_snapshot else None
    portfolio = artifact.portfolio_context.model_dump(mode="json") if artifact.portfolio_context else None
    if mode == "deep":
        return f"""### Evidence Snapshot

```json
{_json_for_packet(evidence)}
```

### Outcome Memory

```json
{_json_for_packet(outcome_memory)}
```

### Sentiment Sources

```json
{_json_for_packet(_compact_sentiment(sentiment))}
```

### Redacted Portfolio Context

```json
{_json_for_packet(_compact_portfolio(portfolio, symbol=artifact.symbol))}
```
"""
    return f"""### Compact Evidence Snapshot

```json
{_json_for_packet(_compact_evidence(evidence))}
```

### Sentiment Sources Summary

```json
{_json_for_packet(_compact_sentiment(sentiment))}
```

### Outcome Memory Summary

```json
{_json_for_packet(outcome_memory)}
```
"""
