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

    reasons: list[str] = []
    warnings = [check.code for check in checks if check.severity == CheckSeverity.WARNING]
    reasons.extend(warnings)

    missing_optional = [
        name
        for name, status in [
            ("history", optional_evidence.history_status),
            ("fundamentals", optional_evidence.fundamentals_status),
            ("news", optional_evidence.news_status),
            ("sentiment", optional_evidence.sentiment_status),
        ]
        if status != "available"
    ]
    reasons.extend(f"{name}_optional_missing" for name in missing_optional)

    if reasons:
        return TrustVerdict.UNCERTAIN, sorted(set(reasons))

    if has_blockers(checks):
        return TrustVerdict.BLOCKED, ["blocked"]
    return TrustVerdict.TRUSTED, ["all_required_evidence_passed"]
