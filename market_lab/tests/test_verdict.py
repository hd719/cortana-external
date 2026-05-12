from __future__ import annotations

from market_lab.models import CheckResult, CheckSeverity, OptionalEvidence, TradingAgentsReview, TrustVerdict
from market_lab.verdict import decide_trust_verdict


def test_blocker_forces_blocked_even_when_tradingagents_ok():
    verdict, reasons = decide_trust_verdict(
        [CheckResult(code="price_data_stale", severity=CheckSeverity.BLOCKER, message="stale")],
        TradingAgentsReview(status="ok", summary="bullish"),
        OptionalEvidence(history_status="available", fundamentals_status="available", news_status="available", sentiment_status="available"),
    )

    assert verdict == TrustVerdict.BLOCKED
    assert reasons == ["price_data_stale"]


def test_skipped_tradingagents_does_not_change_deterministic_verdict():
    verdict, reasons = decide_trust_verdict(
        [],
        TradingAgentsReview(status="skipped", summary="not configured"),
        OptionalEvidence(history_status="available", fundamentals_status="available", news_status="available", sentiment_status="available"),
    )

    assert verdict == TrustVerdict.TRUSTED
    assert reasons == ["all_required_evidence_passed"]


def test_all_required_evidence_can_be_trusted():
    verdict, reasons = decide_trust_verdict(
        [],
        TradingAgentsReview(status="ok", summary="done"),
        OptionalEvidence(history_status="available", fundamentals_status="available", news_status="available", sentiment_status="available"),
    )

    assert verdict == TrustVerdict.TRUSTED
    assert reasons == ["all_required_evidence_passed"]


def test_missing_optional_evidence_does_not_force_uncertain():
    verdict, reasons = decide_trust_verdict(
        [
            CheckResult(code="news_missing", severity=CheckSeverity.WARNING, message="news missing"),
            CheckResult(code="sentiment_missing", severity=CheckSeverity.WARNING, message="sentiment missing"),
        ],
        TradingAgentsReview(status="skipped", summary="not configured"),
        OptionalEvidence(history_status="available", fundamentals_status="available"),
    )

    assert verdict == TrustVerdict.TRUSTED
    assert reasons == ["all_required_evidence_passed"]


def test_optional_evidence_error_keeps_verdict_uncertain():
    verdict, reasons = decide_trust_verdict(
        [],
        TradingAgentsReview(status="skipped", summary="not configured"),
        OptionalEvidence(history_status="available", fundamentals_status="available", news_status="error", sentiment_status="available"),
    )

    assert verdict == TrustVerdict.UNCERTAIN
    assert reasons == ["news_error"]
