from __future__ import annotations

from datetime import UTC, datetime

from market_lab.evidence import build_evidence_snapshot
from market_lab.models import CheckResult, CheckSeverity, OptionalEvidence, PriceFacts


def test_evidence_snapshot_labels_missing_optional_context():
    now = datetime.now(UTC)
    snapshot = build_evidence_snapshot(
        symbol="aapl",
        price_facts=PriceFacts(symbol="AAPL", price=100, timestamp=now, source="fake"),
        spy_facts=PriceFacts(symbol="SPY", price=500, timestamp=now, source="fake"),
        checks=[
            CheckResult(code="price_present", severity=CheckSeverity.INFO, message="price exists"),
            CheckResult(code="news_missing", severity=CheckSeverity.WARNING, message="news missing"),
        ],
        optional_evidence=OptionalEvidence(history_status="available"),
    )

    assert snapshot.symbol == "AAPL"
    assert snapshot.price_summary["price"] == 100
    assert snapshot.benchmark_summary["symbol"] == "SPY"
    assert "news" in snapshot.missing_context
    assert "news_missing" in snapshot.risk_flags
