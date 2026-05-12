from __future__ import annotations

from datetime import UTC, datetime, timedelta

from .market_data import MarketDataClient
from .models import ReviewArtifact, SettlementScore, SettlementStatus, SettlementWindow, TrustVerdict
from .monitor_alerts import OpenClawMonitorTelegramNotifier, SettlementAlertNotifier
from .storage import MarketLabStore, utc_now

WINDOW_DAYS = {"1d": 1, "5d": 5, "20d": 20}


def build_pending_windows(
    *,
    requested_at: datetime,
    symbol_entry_price: float | None,
    spy_entry_price: float | None,
) -> list[SettlementWindow]:
    windows: list[SettlementWindow] = []
    for window, days in WINDOW_DAYS.items():
        due_at = requested_at + timedelta(days=days)
        windows.append(
            SettlementWindow(
                window=window,  # type: ignore[arg-type]
                status=SettlementStatus.PENDING,
                due_at=due_at,
                symbol_entry_price=symbol_entry_price,
                spy_entry_price=spy_entry_price,
            )
        )
    return windows


def pct_return(entry: float, exit_price: float) -> float:
    if entry <= 0:
        raise ValueError("entry price must be positive")
    return ((exit_price - entry) / entry) * 100


def score_settlement(verdict: TrustVerdict | str, alpha_vs_spy_pct: float) -> SettlementScore:
    normalized = str(verdict)
    if normalized == TrustVerdict.TRUSTED.value:
        return SettlementScore.SUCCESS if alpha_vs_spy_pct > 0 else SettlementScore.FAILURE
    return SettlementScore.BAD_AVOID if alpha_vs_spy_pct > 0 else SettlementScore.GOOD_AVOID


def settle_window(
    window: SettlementWindow,
    *,
    verdict: TrustVerdict | str,
    symbol_settlement_price: float,
    spy_settlement_price: float,
    now: datetime | None = None,
) -> SettlementWindow:
    if window.symbol_entry_price is None or window.spy_entry_price is None:
        return window.model_copy(update={"status": SettlementStatus.FAILED, "error_message": "missing entry prices"})
    current = now or utc_now()
    if current < window.due_at:
        return window
    raw = pct_return(window.symbol_entry_price, symbol_settlement_price)
    spy = pct_return(window.spy_entry_price, spy_settlement_price)
    alpha = raw - spy
    return window.model_copy(
        update={
            "status": SettlementStatus.SETTLED,
            "symbol_settlement_price": symbol_settlement_price,
            "spy_settlement_price": spy_settlement_price,
            "raw_return_pct": raw,
            "spy_return_pct": spy,
            "alpha_vs_spy_pct": alpha,
            "score": score_settlement(verdict, alpha),
            "settled_at": current,
        }
    )


class SettlementService:
    def __init__(
        self,
        store: MarketLabStore | None = None,
        market_data: MarketDataClient | None = None,
        notifier: SettlementAlertNotifier | None = None,
    ):
        self.store = store or MarketLabStore()
        self.market_data = market_data or MarketDataClient()
        self.notifier = notifier or OpenClawMonitorTelegramNotifier()

    def settle_run(self, run_id: str, *, now: datetime | None = None) -> ReviewArtifact:
        review = self.store.read_review(run_id)
        if review is None:
            raise KeyError(f"review artifact not found for {run_id}")
        artifact = ReviewArtifact.model_validate(review)
        symbol_quote = self.market_data.get_quote(artifact.symbol)
        spy_quote = self.market_data.get_quote("SPY")
        current = now or datetime.now(UTC)
        settled: list[SettlementWindow] = []
        newly_settled: list[SettlementWindow] = []
        for window in artifact.settlements:
            if window.status == SettlementStatus.SETTLED:
                settled.append(window)
                continue
            result = settle_window(
                window,
                verdict=artifact.trust_verdict,
                symbol_settlement_price=symbol_quote.price,
                spy_settlement_price=spy_quote.price,
                now=current,
            )
            settled.append(result)
            if window.status != SettlementStatus.SETTLED and result.status == SettlementStatus.SETTLED:
                newly_settled.append(result)
            self.store.upsert_settlement(
                run_id,
                result.window,
                {
                    "status": result.status,
                    "due_at": result.due_at.isoformat(),
                    "symbol_entry_price": result.symbol_entry_price,
                    "spy_entry_price": result.spy_entry_price,
                    "symbol_settlement_price": result.symbol_settlement_price,
                    "spy_settlement_price": result.spy_settlement_price,
                    "raw_return_pct": result.raw_return_pct,
                    "spy_return_pct": result.spy_return_pct,
                    "alpha_vs_spy_pct": result.alpha_vs_spy_pct,
                    "score": result.score,
                    "settled_at": result.settled_at.isoformat() if result.settled_at else None,
                    "error_message": result.error_message,
                },
            )
        updated = artifact.model_copy(update={"settlements": settled})
        self.store.write_review(updated)
        for result in newly_settled:
            self.notifier.send_settlement_alert(updated, result)
        return updated

    def settle_due(self) -> list[str]:
        settled_run_ids: list[str] = []
        for row in self.store.due_settlements():
            run_id = str(row["run_id"])
            if run_id in settled_run_ids:
                continue
            self.settle_run(run_id)
            settled_run_ids.append(run_id)
        return settled_run_ids
