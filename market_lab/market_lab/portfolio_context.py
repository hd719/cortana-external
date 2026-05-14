from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .market_data import MarketDataClient
from .models import PortfolioContext
from .environment import artifact_environment
from .schwab_portfolio import SchwabPortfolioClient
from .storage import default_cache_dir


class PortfolioContextService:
    def __init__(
        self,
        *,
        cache_dir: Path | str | None = None,
        schwab: SchwabPortfolioClient | None = None,
        market_data: MarketDataClient | None = None,
    ):
        self.cache_dir = Path(cache_dir).expanduser().resolve() if cache_dir else default_cache_dir() / "portfolio"
        self.environment = artifact_environment()
        self.schwab = schwab or SchwabPortfolioClient()
        self.market_data = market_data or MarketDataClient()

    @property
    def latest_path(self) -> Path:
        return self.cache_dir / "schwab-portfolio-latest.json"

    def latest(self) -> PortfolioContext:
        if not self.latest_path.exists():
            return PortfolioContext(
                environment=self.environment,
                status="unavailable",
                source="schwab",
                generated_at=datetime.now(UTC),
                message="No cached Schwab portfolio snapshot yet.",
            )
        try:
            return PortfolioContext.model_validate(json.loads(self.latest_path.read_text(encoding="utf-8"))).model_copy(
                update={"environment": self.environment}
            )
        except Exception as exc:
            return PortfolioContext(environment=self.environment, status="error", source="schwab", generated_at=datetime.now(UTC), message=str(exc))

    def refresh(self) -> PortfolioContext:
        context = self.schwab.fetch_context().model_copy(update={"environment": self.environment})
        cached = self.latest()
        if context.status != "available" and cached.status == "available":
            reason = context.message or f"Schwab refresh returned {context.status}."
            return cached.model_copy(
                update={
                    "message": f"{reason} Showing latest cached Schwab portfolio instead.",
                    "artifact_path": str(self.latest_path),
                }
            )
        context = self._enrich_quotes(context)
        context = self._add_overlap_notes(context)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        context = context.model_copy(update={"artifact_path": str(self.latest_path)})
        self.latest_path.write_text(context.model_dump_json(indent=2), encoding="utf-8")
        return context

    def context_for_symbol(self, symbol: str) -> PortfolioContext:
        context = self.latest()
        return self._add_overlap_notes(context, symbol=symbol)

    def _add_overlap_notes(self, context: PortfolioContext, *, symbol: str | None = None) -> PortfolioContext:
        if context.status != "available":
            return context
        notes = list(context.overlap_notes)
        if symbol:
            normalized = symbol.strip().upper()
            owned = [item for item in context.positions if item.symbol == normalized]
            if owned:
                total_value = sum((item.market_value or 0.0) for item in owned)
                notes.append(f"{normalized} is already owned; current market value ${total_value:,.2f}.")
            else:
                notes.append(f"{normalized} is not currently in the cached Schwab portfolio.")
        summary = f"{len(context.positions)} positions across {len(context.accounts)} account(s)."
        exposure_notes = [summary, *[note for note in context.exposure_notes if note != summary]]
        return context.model_copy(update={"overlap_notes": notes, "exposure_notes": exposure_notes})

    def _enrich_quotes(self, context: PortfolioContext) -> PortfolioContext:
        if context.status != "available" or not context.positions:
            return context
        symbols = [position.symbol for position in context.positions]
        try:
            quotes = self.market_data.get_quote_batch(symbols)
        except Exception as exc:
            return context.model_copy(update={"exposure_notes": [*context.exposure_notes, f"Quote changes unavailable: {exc}"]})

        positions = []
        for position in context.positions:
            item = quotes.get(position.symbol)
            data = item.get("data") if isinstance(item, dict) and isinstance(item.get("data"), dict) else {}
            if not isinstance(item, dict) or not data:
                positions.append(position)
                continue
            quote_price = _first_number(data, "price", "last", "lastPrice", "last_price", "mark")
            day_change = _first_number(data, "change", "netChange", "regularMarketChange")
            day_change_pct = _first_number(data, "changePercent", "regularMarketChangePercent")
            if day_change is None and quote_price is not None and day_change_pct is not None and day_change_pct != -100:
                previous_close = quote_price / (1 + (day_change_pct / 100))
                day_change = quote_price - previous_close

            current_price = quote_price if quote_price is not None else position.current_price
            market_value = current_price * position.quantity if current_price is not None and position.quantity else position.market_value
            positions.append(
                position.model_copy(
                    update={
                        "current_price": current_price,
                        "day_change": day_change,
                        "day_change_pct": day_change_pct,
                        "quote_source": str(item.get("source") or data.get("source") or "") or None,
                        "quote_status": str(item.get("status") or "") or None,
                        "quote_timestamp": _parse_quote_timestamp(data.get("timestamp")),
                        "market_value": market_value,
                    }
                )
            )

        total_value = sum((position.market_value or 0.0) for position in positions)
        if total_value:
            positions = [
                position.model_copy(update={"weight_pct": (position.market_value / total_value * 100) if position.market_value else None})
                for position in positions
            ]
        return context.model_copy(update={"positions": positions})


def _first_number(payload: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value)
            except ValueError:
                continue
    return None


def _parse_quote_timestamp(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, str) and value.strip():
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if isinstance(value, (int, float)):
        seconds = value / 1000 if value > 10_000_000_000 else value
        return datetime.fromtimestamp(seconds, tz=UTC)
    return None
