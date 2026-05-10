from __future__ import annotations

from datetime import UTC, datetime, timedelta

from market_lab.checks import evaluate_optional_evidence, evaluate_price_facts
from market_lab.models import CheckSeverity, OptionalEvidence, PriceFacts


def test_fresh_regular_session_quote_passes():
    now = datetime(2026, 5, 8, 14, 0, tzinfo=UTC)
    facts = PriceFacts(symbol="AAPL", price=200, timestamp=now - timedelta(minutes=5))

    checks = evaluate_price_facts(facts, now=now)

    assert not any(check.severity == CheckSeverity.BLOCKER for check in checks)


def test_stale_regular_session_quote_blocks():
    now = datetime(2026, 5, 8, 14, 0, tzinfo=UTC)
    facts = PriceFacts(symbol="AAPL", price=200, timestamp=now - timedelta(minutes=20))

    checks = evaluate_price_facts(facts, now=now)

    assert any(check.code == "price_data_stale" and check.severity == CheckSeverity.BLOCKER for check in checks)


def test_off_hours_latest_price_warns_but_does_not_block():
    now = datetime(2026, 5, 9, 14, 0, tzinfo=UTC)
    facts = PriceFacts(symbol="AAPL", price=200, timestamp=now - timedelta(hours=10), price_basis="latest_close")

    checks = evaluate_price_facts(facts, now=now)

    assert not any(check.severity == CheckSeverity.BLOCKER for check in checks)


def test_missing_optional_evidence_warns_not_blocks():
    checks = evaluate_optional_evidence(OptionalEvidence())

    assert checks
    assert all(check.severity == CheckSeverity.WARNING for check in checks)
