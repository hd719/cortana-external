from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from .market_data import MarketDataClient, MarketDataError
from .models import BrokerOrderPreview, BrokerValidationResult, ExecutionIntent


class BrokerAdapter:
    def __init__(
        self,
        *,
        market_data: MarketDataClient | None = None,
        max_price_age_seconds: int = 15,
        preview_ttl_seconds: int = 60,
        max_slippage_pct: float = 0.25,
    ):
        self.market_data = market_data or MarketDataClient()
        self.max_price_age_seconds = max_price_age_seconds
        self.preview_ttl_seconds = preview_ttl_seconds
        self.max_slippage_pct = max_slippage_pct

    def validate_intent(self, intent: ExecutionIntent) -> BrokerValidationResult:
        now = datetime.now(UTC)
        reasons: list[str] = []
        if intent.status != "approved":
            reasons.append("intent_not_approved")
        if intent.proposed_action == "hold":
            reasons.append("non_executable_action")
        if intent.proposed_action == "buy" and (intent.proposed_notional is None or intent.proposed_notional <= 0):
            reasons.append("invalid_buy_notional")
        if intent.expires_at <= now:
            reasons.append("intent_expired")
        evidence_fresh = Path(intent.evidence_snapshot_path).exists()
        if not evidence_fresh:
            reasons.append("evidence_missing")
        portfolio_fresh = True
        if intent.portfolio_context_path:
            portfolio_fresh = Path(intent.portfolio_context_path).exists()
            if not portfolio_fresh:
                reasons.append("portfolio_context_missing")
        account_available = True
        duplicate_order_detected = False
        price_fresh = False
        try:
            quote = self.market_data.get_quote(intent.symbol)
            quote_age = (now - (quote.timestamp if quote.timestamp.tzinfo else quote.timestamp.replace(tzinfo=UTC))).total_seconds()
            price_fresh = quote_age <= self.max_price_age_seconds
            if not price_fresh:
                reasons.append("price_needs_refresh")
            reference_price = self._reference_price(intent)
            if reference_price and reference_price > 0:
                drift_pct = abs(quote.price - reference_price) / reference_price * 100
                if drift_pct > self.max_slippage_pct:
                    reasons.append("price_moved_beyond_limit")
        except MarketDataError:
            reasons.append("price_unavailable")

        status = "valid" if not reasons else ("needs_refresh" if any("refresh" in item or "missing" in item or "moved" in item for item in reasons) else "blocked")
        return BrokerValidationResult(
            intent_id=intent.intent_id,
            checked_at=now,
            status=status,  # type: ignore[arg-type]
            reasons=reasons,
            evidence_fresh=evidence_fresh,
            price_fresh=price_fresh,
            portfolio_fresh=portfolio_fresh,
            account_available=account_available,
            duplicate_order_detected=duplicate_order_detected,
        )

    def preview_order(self, intent: ExecutionIntent) -> BrokerOrderPreview | BrokerValidationResult:
        validation = self.validate_intent(intent)
        if validation.status != "valid":
            return validation
        quote = self.market_data.get_quote(intent.symbol)
        side = "sell" if intent.proposed_action == "sell" else "buy"
        notional = intent.proposed_notional
        quantity = (notional / quote.price) if notional and quote.price > 0 else None
        now = datetime.now(UTC)
        return BrokerOrderPreview(
            intent_id=intent.intent_id,
            preview_id=f"mlab_preview_{now.strftime('%Y%m%dT%H%M%SZ')}_{uuid4().hex[:8]}",
            created_at=now,
            expires_at=now + timedelta(seconds=self.preview_ttl_seconds),
            symbol=intent.symbol,
            side=side,  # type: ignore[arg-type]
            quote_price=quote.price,
            quote_as_of=quote.timestamp,
            estimated_quantity=quantity,
            estimated_notional=notional,
            estimated_cost=notional,
            max_price_age_seconds=self.max_price_age_seconds,
            max_slippage_pct=self.max_slippage_pct,
            warnings=["Preview only. No order was placed."],
        )

    def _reference_price(self, intent: ExecutionIntent) -> float | None:
        try:
            payload = json.loads(Path(intent.evidence_snapshot_path).read_text(encoding="utf-8"))
        except Exception:
            return None
        price = payload.get("price_summary", {}).get("price") if isinstance(payload, dict) else None
        return float(price) if isinstance(price, (int, float)) else None
