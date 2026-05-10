from __future__ import annotations

from datetime import UTC, datetime, timedelta

from market_lab.models import SettlementScore, SettlementStatus, SettlementWindow, TrustVerdict
from market_lab.settlement import score_settlement, settle_window


def _window() -> SettlementWindow:
    return SettlementWindow(
        window="1d",
        status=SettlementStatus.PENDING,
        due_at=datetime.now(UTC) - timedelta(days=1),
        symbol_entry_price=100,
        spy_entry_price=100,
    )


def test_trusted_positive_alpha_scores_success():
    result = settle_window(_window(), verdict=TrustVerdict.TRUSTED, symbol_settlement_price=110, spy_settlement_price=105)

    assert result.status == SettlementStatus.SETTLED
    assert result.score == SettlementScore.SUCCESS
    assert result.alpha_vs_spy_pct == 5


def test_trusted_non_positive_alpha_scores_failure():
    assert score_settlement(TrustVerdict.TRUSTED, 0) == SettlementScore.FAILURE


def test_blocked_underperformance_scores_good_avoid():
    assert score_settlement(TrustVerdict.BLOCKED, -1) == SettlementScore.GOOD_AVOID


def test_not_due_window_does_not_settle():
    pending = SettlementWindow(
        window="1d",
        status=SettlementStatus.PENDING,
        due_at=datetime.now(UTC) + timedelta(days=1),
        symbol_entry_price=100,
        spy_entry_price=100,
    )

    result = settle_window(pending, verdict=TrustVerdict.TRUSTED, symbol_settlement_price=110, spy_settlement_price=105)

    assert result.status == SettlementStatus.NOT_DUE
