from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

from market_lab.broker_adapter import BrokerAdapter
from market_lab.models import ApprovalRecord, ExecutionIntent, PriceFacts


class FakeMarketData:
    def __init__(self, *, price: float = 100, seconds_old: int = 0):
        self.price = price
        self.seconds_old = seconds_old

    def get_quote(self, symbol: str) -> PriceFacts:
        return PriceFacts(
            symbol=symbol,
            price=self.price,
            timestamp=datetime.now(UTC) - timedelta(seconds=self.seconds_old),
            source="fake",
        )


def _intent(tmp_path: Path, *, status: str = "approved") -> ExecutionIntent:
    evidence = tmp_path / "evidence.json"
    evidence.write_text('{"price_summary":{"price":100}}', encoding="utf-8")
    now = datetime.now(UTC)
    return ExecutionIntent(
        intent_id="intent-1",
        symbol="AAPL",
        created_at=now,
        expires_at=now + timedelta(minutes=5),
        source_review_id="run-1",
        evidence_snapshot_path=str(evidence),
        proposed_action="buy",
        proposed_notional=500,
        status=status,  # type: ignore[arg-type]
        approval=ApprovalRecord(operator="hamel", decided_at=now, decision="approved") if status == "approved" else None,
    )


def test_broker_adapter_blocks_unapproved_intent(tmp_path):
    result = BrokerAdapter(market_data=FakeMarketData()).validate_intent(_intent(tmp_path, status="draft"))

    assert result.status == "blocked"
    assert "intent_not_approved" in result.reasons


def test_broker_adapter_preview_is_not_order_placement(tmp_path):
    preview = BrokerAdapter(market_data=FakeMarketData()).preview_order(_intent(tmp_path))

    assert getattr(preview, "preview_id")
    assert any("No order was placed." in warning for warning in preview.warnings)


def test_broker_adapter_does_not_preview_hold_intent(tmp_path):
    intent = _intent(tmp_path).model_copy(update={"proposed_action": "hold"})
    result = BrokerAdapter(market_data=FakeMarketData()).preview_order(intent)

    assert result.status == "blocked"
    assert "non_executable_action" in result.reasons


def test_broker_adapter_requires_refresh_when_price_moves(tmp_path):
    result = BrokerAdapter(market_data=FakeMarketData(price=120), max_slippage_pct=1).validate_intent(_intent(tmp_path))

    assert result.status == "needs_refresh"
    assert "price_moved_beyond_limit" in result.reasons
