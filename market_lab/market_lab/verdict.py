from __future__ import annotations

from .checks import has_blockers
from .models import CheckResult, CheckSeverity, OptionalEvidence, TradingAgentsReview, TrustVerdict


def decide_trust_verdict(
    checks: list[CheckResult],
    tradingagents: TradingAgentsReview,
    optional_evidence: OptionalEvidence,
) -> tuple[TrustVerdict, list[str]]:
    blockers = [check for check in checks if check.severity == CheckSeverity.BLOCKER]
    if blockers:
        return TrustVerdict.BLOCKED, [check.code for check in blockers]

    optional_errors = [
        name
        for name, status in [
            ("history", optional_evidence.history_status),
            ("fundamentals", optional_evidence.fundamentals_status),
            ("news", optional_evidence.news_status),
            ("sentiment", optional_evidence.sentiment_status),
        ]
        if status == "error"
    ]
    if optional_errors:
        return TrustVerdict.UNCERTAIN, [f"{name}_error" for name in optional_errors]

    caution_codes = {check.code for check in checks if check.severity == CheckSeverity.WARNING}
    if "bearish_sentiment_needs_codex_review" in caution_codes:
        return TrustVerdict.UNCERTAIN, ["bearish_sentiment_needs_codex_review"]

    if has_blockers(checks):
        return TrustVerdict.BLOCKED, ["blocked"]
    return TrustVerdict.TRUSTED, ["all_required_evidence_passed"]
