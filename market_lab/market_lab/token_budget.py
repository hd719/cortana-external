from __future__ import annotations

from typing import Literal

from .models import ReviewArtifact, TokenBudgetSummary

DEFAULT_LIMITS = {
    "quick": 4_000,
    "deep": 12_000,
}


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def build_token_budget(mode: Literal["quick", "deep"], packet_text: str, artifact: ReviewArtifact) -> TokenBudgetSummary:
    included = ["run", "market_facts", "checks", "required_output"]
    omitted: list[str] = []
    if artifact.evidence_snapshot:
        included.append("evidence_snapshot")
    if mode == "deep":
        included.extend(["prior_runs", "settlement_excerpts", "portfolio_context"])
    else:
        omitted.extend(["settlement_excerpts", "portfolio_context_detail"])
    if artifact.sentiment_snapshot:
        included.append("sentiment_sources")
    return TokenBudgetSummary(
        mode=mode,
        estimated_input_tokens=estimate_tokens(packet_text),
        max_input_tokens=DEFAULT_LIMITS[mode],
        included_sections=included,
        omitted_sections=omitted,
    )
