from __future__ import annotations

from datetime import UTC, datetime, time
from zoneinfo import ZoneInfo

from .models import CheckResult, CheckSeverity, OptionalEvidence, PriceFacts

MARKET_TZ = ZoneInfo("America/New_York")
DEFAULT_FRESHNESS_MINUTES = 10


def is_market_hours(now: datetime | None = None) -> bool:
    current = (now or datetime.now(UTC)).astimezone(MARKET_TZ)
    if current.weekday() >= 5:
        return False
    return time(9, 30) <= current.time() <= time(16, 0)


def quote_age_minutes(facts: PriceFacts, now: datetime | None = None) -> float:
    current = now or datetime.now(UTC)
    if current.tzinfo is None:
        current = current.replace(tzinfo=UTC)
    timestamp = facts.timestamp if facts.timestamp.tzinfo else facts.timestamp.replace(tzinfo=UTC)
    return max(0.0, (current - timestamp).total_seconds() / 60)


def evaluate_price_facts(
    facts: PriceFacts | None,
    *,
    now: datetime | None = None,
    freshness_minutes: int = DEFAULT_FRESHNESS_MINUTES,
) -> list[CheckResult]:
    if facts is None:
        return [
            CheckResult(
                code="price_missing",
                severity=CheckSeverity.BLOCKER,
                message="Required price data is missing.",
            )
        ]

    checks = [
        CheckResult(
            code="price_present",
            severity=CheckSeverity.INFO,
            message=f"{facts.symbol} price is available from {facts.source}.",
        )
    ]
    if facts.price <= 0:
        checks.append(
            CheckResult(
                code="price_invalid",
                severity=CheckSeverity.BLOCKER,
                message="Required price data is not usable because price is non-positive.",
            )
        )

    age = quote_age_minutes(facts, now=now)
    if is_market_hours(now) and age > freshness_minutes:
        checks.append(
            CheckResult(
                code="price_data_stale",
                severity=CheckSeverity.BLOCKER,
                message=f"Market-hours quote is {age:.1f} minutes old, above the {freshness_minutes} minute threshold.",
            )
        )
    elif not is_market_hours(now) and facts.price_basis == "live":
        checks.append(
            CheckResult(
                code="off_hours_price_basis_labeled",
                severity=CheckSeverity.WARNING,
                message="Market is closed; latest available price is allowed but should be treated as off-hours/latest.",
            )
        )

    return checks


def evaluate_optional_evidence(evidence: OptionalEvidence) -> list[CheckResult]:
    checks: list[CheckResult] = []
    for field, label in [
        ("history_status", "history"),
        ("fundamentals_status", "fundamentals"),
        ("news_status", "news"),
        ("sentiment_status", "sentiment"),
    ]:
        status = getattr(evidence, field)
        if status != "available":
            checks.append(
                CheckResult(
                    code=f"{label}_{status}",
                    severity=CheckSeverity.WARNING,
                    message=f"Optional {label} evidence is {status}.",
                )
            )
    return checks


def has_blockers(checks: list[CheckResult]) -> bool:
    return any(check.severity == CheckSeverity.BLOCKER for check in checks)
