from __future__ import annotations

from datetime import UTC, datetime

from market_lab.memory import build_outcome_memory_summary
from market_lab.models import RunRecord, RunStatus, TrustVerdict


def _run(run_id: str, verdict: TrustVerdict) -> RunRecord:
    now = datetime.now(UTC)
    return RunRecord(
        run_id=run_id,
        symbol="AAPL",
        requested_at=now,
        status=RunStatus.DONE,
        trust_verdict=verdict,
        run_dir="/tmp/run",
        review_path="/tmp/review.json",
        events_path="/tmp/events.jsonl",
        logs_path="/tmp/logs.txt",
        created_at=now,
        updated_at=now,
    )


def test_outcome_memory_counts_settled_success_and_alpha():
    summary = build_outcome_memory_summary(
        symbol="AAPL",
        prior_runs=[_run("r1", TrustVerdict.TRUSTED), _run("r2", TrustVerdict.BLOCKED)],
        prior_settlements={
            "r1": [
                {"status": "settled", "score": "success", "alpha_vs_spy_pct": 2.0},
                {"status": "pending", "score": None, "alpha_vs_spy_pct": None},
            ],
        },
    )

    assert summary.evidence_ready_count == 1
    assert summary.blocked_count == 1
    assert summary.settled_count == 1
    assert summary.evidence_ready_success_rate == 1.0
    assert summary.evidence_ready_avg_alpha_vs_spy_pct == 2.0
