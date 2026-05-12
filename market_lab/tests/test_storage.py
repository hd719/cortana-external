from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from market_lab.models import ArtifactPaths, Interpretation, ReviewArtifact, RunStatus, TradingAgentsReview, TrustVerdict
from market_lab.storage import MarketLabStore


def test_store_creates_and_reloads_run(tmp_path):
    store = MarketLabStore(tmp_path)

    run = store.create_run("aapl", run_id="mlab_test_AAPL")
    loaded = store.get_run(run.run_id)

    assert loaded.symbol == "AAPL"
    assert loaded.status == "queued"
    assert Path(loaded.events_path).exists()
    assert Path(loaded.logs_path).exists()


def test_store_appends_events_and_logs(tmp_path):
    store = MarketLabStore(tmp_path)
    run = store.create_run("AAPL", run_id="mlab_test_AAPL")

    store.append_event(run.run_id, "queued", "Run queued")
    store.append_log(run.run_id, "hello")

    assert store.read_events(run.run_id)[0]["event"] == "queued"
    assert "hello" in store.read_logs(run.run_id)


def test_store_writes_review_and_updates_run(tmp_path):
    store = MarketLabStore(tmp_path)
    run = store.create_run("AAPL", run_id="mlab_test_AAPL")
    now = datetime.now(UTC)
    artifact = ReviewArtifact(
        run_id=run.run_id,
        symbol="AAPL",
        requested_at=now,
        completed_at=now,
        status=RunStatus.DONE,
        trust_verdict=TrustVerdict.UNCERTAIN,
        verdict_reasons=["tradingagents_skipped"],
        interpretation=Interpretation(summary="Review is uncertain."),
        tradingagents=TradingAgentsReview(status="skipped", summary="Not configured."),
        artifact_paths=ArtifactPaths(
            review=str(Path(run.run_dir) / "review.json"),
            events=run.events_path,
            logs=run.logs_path,
        ),
    )

    review_path = store.write_review(artifact)
    loaded = store.get_run(run.run_id)

    assert review_path.exists()
    assert loaded.status == "done"
    assert loaded.trust_verdict == "uncertain"
    assert store.read_review(run.run_id)["trust_verdict"] == "uncertain"


def test_store_writes_packet_and_attaches_codex_review(tmp_path):
    store = MarketLabStore(tmp_path)
    run = store.create_run("AAPL", run_id="mlab_test_AAPL")
    now = datetime.now(UTC)
    artifact = ReviewArtifact(
        run_id=run.run_id,
        symbol="AAPL",
        requested_at=now,
        completed_at=now,
        status=RunStatus.DONE,
        trust_verdict=TrustVerdict.UNCERTAIN,
        verdict_reasons=["codex_review_pending"],
        interpretation=Interpretation(summary="Review is uncertain."),
        tradingagents=TradingAgentsReview(status="skipped", summary="Not configured."),
        artifact_paths=ArtifactPaths(
            review=str(Path(run.run_dir) / "review.json"),
            events=run.events_path,
            logs=run.logs_path,
            codex_packet=str(Path(run.run_dir) / "codex-review-packet.md"),
            codex_review=str(Path(run.run_dir) / "codex-review.md"),
        ),
    )
    store.write_review(artifact)

    packet = store.write_codex_packet(run.run_id, "# packet")
    review_file = Path(run.run_dir) / "codex-review.md"
    review_file.write_text("# Codex: keep uncertain\n\nEvidence is incomplete.\n", encoding="utf-8")
    updated = store.attach_codex_review(run.run_id, review_file, session_id="session-1")

    assert packet.exists()
    assert updated.codex_review is not None
    assert updated.codex_review.summary == "# Codex: keep uncertain"
    assert updated.codex_review.session_id == "session-1"
    assert updated.artifact_paths.codex_review == str(review_file.resolve())
