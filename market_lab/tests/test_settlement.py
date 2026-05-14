from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from market_lab.models import (
    ArtifactPaths,
    Interpretation,
    PriceFacts,
    ReviewArtifact,
    RunStatus,
    SettlementScore,
    SettlementStatus,
    SettlementWindow,
    TradingAgentsReview,
    TrustVerdict,
)
from market_lab.monitor_alerts import build_settlement_alert_text
from market_lab.settlement import SettlementService, score_settlement, settle_window
from market_lab.storage import MarketLabStore


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


def test_not_due_window_stays_pending():
    pending = SettlementWindow(
        window="1d",
        status=SettlementStatus.PENDING,
        due_at=datetime.now(UTC) + timedelta(days=1),
        symbol_entry_price=100,
        spy_entry_price=100,
    )

    result = settle_window(pending, verdict=TrustVerdict.TRUSTED, symbol_settlement_price=110, spy_settlement_price=105)

    assert result.status == SettlementStatus.PENDING


class FakeMarketData:
    def get_quote(self, symbol: str) -> PriceFacts:
        price = 105 if symbol == "SPY" else 110
        return PriceFacts(symbol=symbol, price=price, timestamp=datetime.now(UTC), source="fake")


class FakeNotifier:
    def __init__(self):
        self.sent: list[tuple[ReviewArtifact, SettlementWindow]] = []

    def send_settlement_alert(self, artifact: ReviewArtifact, settlement: SettlementWindow) -> None:
        self.sent.append((artifact, settlement))


def _artifact(run_id: str, run_dir: Path) -> ReviewArtifact:
    now = datetime.now(UTC) - timedelta(days=2)
    return ReviewArtifact(
        run_id=run_id,
        symbol="AAPL",
        requested_at=now,
        completed_at=now,
        status=RunStatus.DONE,
        trust_verdict=TrustVerdict.TRUSTED,
        verdict_reasons=["all_required_evidence_passed"],
        price_facts=PriceFacts(symbol="AAPL", price=100, timestamp=now, source="fake"),
        spy_facts=PriceFacts(symbol="SPY", price=100, timestamp=now, source="fake"),
        interpretation=Interpretation(summary="trusted"),
        tradingagents=TradingAgentsReview(status="skipped", summary="skipped"),
        settlements=[
            SettlementWindow(
                window="1d",
                status=SettlementStatus.PENDING,
                due_at=now + timedelta(days=1),
                symbol_entry_price=100,
                spy_entry_price=100,
            )
        ],
        artifact_paths=ArtifactPaths(
            review=str(run_dir / "review.json"),
            events=str(run_dir / "events.jsonl"),
            logs=str(run_dir / "logs.txt"),
        ),
    )


def test_settle_run_alerts_only_newly_settled_windows(tmp_path):
    store = MarketLabStore(tmp_path, environment="prod")
    run = store.create_run("AAPL", run_id="mlab_test_AAPL")
    store.write_review(_artifact(run.run_id, Path(run.run_dir)))
    notifier = FakeNotifier()
    service = SettlementService(store=store, market_data=FakeMarketData(), notifier=notifier)

    service.settle_run(run.run_id, now=datetime.now(UTC))
    service.settle_run(run.run_id, now=datetime.now(UTC))

    assert len(notifier.sent) == 1
    _, settlement = notifier.sent[0]
    assert settlement.window == "1d"
    assert settlement.alpha_vs_spy_pct == 5


def test_settle_run_blocks_nonprod_alerts_by_default(tmp_path, monkeypatch):
    monkeypatch.setenv("MARKET_LAB_ENV", "test")
    store = MarketLabStore(tmp_path, environment="test")
    run = store.create_run("AAPL", run_id="mlab_test_AAPL")
    store.write_review(_artifact(run.run_id, Path(run.run_dir)))
    notifier = FakeNotifier()
    service = SettlementService(store=store, market_data=FakeMarketData(), notifier=notifier)

    service.settle_run(run.run_id, now=datetime.now(UTC))

    assert notifier.sent == []


def test_settle_run_accepts_and_preserves_structured_codex_review(tmp_path):
    store = MarketLabStore(tmp_path)
    run = store.create_run("AAPL", run_id="mlab_test_AAPL")
    store.write_review(_artifact(run.run_id, Path(run.run_dir)))
    review_path = Path(run.run_dir) / "review.json"
    raw = json.loads(review_path.read_text(encoding="utf-8"))
    raw["codex_review_structured"] = {
        "schema_version": "market-lab-codex-review/v1",
        "summary": "Codex says this review is coherent.",
        "analyst_reviews": {"technical": {"verdict": "trusted"}},
    }
    review_path.write_text(json.dumps(raw, indent=2), encoding="utf-8")
    service = SettlementService(store=store, market_data=FakeMarketData(), notifier=FakeNotifier())

    service.settle_run(run.run_id, now=datetime.now(UTC))

    updated = json.loads(review_path.read_text(encoding="utf-8"))
    assert updated["codex_review_structured"]["schema_version"] == "market-lab-codex-review/v1"
    assert updated["settlements"][0]["status"] == "settled"


def test_settlement_alert_text_shows_spy_difference():
    artifact = _artifact("mlab_test_AAPL", Path("/tmp/mlab_test_AAPL"))
    settlement = settle_window(
        artifact.settlements[0],
        verdict=TrustVerdict.TRUSTED,
        symbol_settlement_price=110,
        spy_settlement_price=105,
        now=datetime.now(UTC),
    )

    text = build_settlement_alert_text(artifact, settlement)

    assert "Market Lab Settlement" in text
    assert "beat SPY by +5.00%" in text
    assert "AAPL: +10.00% | SPY: +5.00% | Alpha: +5.00%" in text
