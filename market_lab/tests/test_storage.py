from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from market_lab.models import ArtifactPaths, CodexStructuredReview, Interpretation, ReviewArtifact, RunStatus, TradingAgentsReview, TrustVerdict
from market_lab.storage import MarketLabStore, default_cache_dir, parse_structured_codex_review


def test_store_creates_and_reloads_run(tmp_path):
    store = MarketLabStore(tmp_path)

    run = store.create_run("aapl", run_id="mlab_test_AAPL")
    loaded = store.get_run(run.run_id)

    assert loaded.symbol == "AAPL"
    assert loaded.status == "queued"
    assert Path(loaded.events_path).exists()
    assert Path(loaded.logs_path).exists()


def test_default_cache_dir_is_environment_scoped(tmp_path, monkeypatch):
    monkeypatch.setenv("MARKET_LAB_DATA_ROOT", str(tmp_path))
    monkeypatch.setenv("MARKET_LAB_ENV", "dev")

    store = MarketLabStore()
    run = store.create_run("AAPL", run_id="mlab_env_AAPL")

    assert default_cache_dir() == tmp_path / "dev"
    assert store.cache_dir == tmp_path / "dev"
    assert run.environment.environment == "dev"
    assert run.environment.is_test_data is True
    assert Path(run.run_dir).is_relative_to(tmp_path / "dev")


def test_explicit_environment_controls_default_cache_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("MARKET_LAB_DATA_ROOT", str(tmp_path))
    monkeypatch.delenv("MARKET_LAB_ENV", raising=False)

    store = MarketLabStore(environment="test")

    assert store.cache_dir == tmp_path / "test"


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
    review_file.write_text("# Codex: trust review\n\nVerdict: trusted\n\nEvidence is coherent.\n", encoding="utf-8")
    updated = store.attach_codex_review(run.run_id, review_file, session_id="session-1")

    assert packet.exists()
    assert updated.codex_review is not None
    assert updated.codex_review.summary == "# Codex: trust review"
    assert updated.codex_review.verdict == TrustVerdict.TRUSTED
    assert updated.codex_review.session_id == "session-1"
    assert updated.artifact_paths.codex_review == str(review_file.resolve())


def test_due_settlements_includes_legacy_not_due_rows(tmp_path):
    store = MarketLabStore(tmp_path)
    run = store.create_run("AAPL", run_id="mlab_test_AAPL")
    store.upsert_settlement(
        run.run_id,
        "1d",
        {
            "status": "not_due",
            "due_at": (datetime.now(UTC) - timedelta(days=1)).isoformat(),
            "symbol_entry_price": 100,
            "spy_entry_price": 100,
        },
    )

    due = store.due_settlements()

    assert due[0]["run_id"] == run.run_id
    assert due[0]["status"] == "not_due"


def structured_review_markdown(verdict: str = "trusted", confidence: float = 0.72) -> str:
    return f"""# Codex Review: AAPL

```json market-lab-codex-review/v1
{{
  "schema_version": "market-lab-codex-review/v1",
  "verdict": "{verdict}",
  "confidence": {confidence},
  "horizon": "5d",
  "summary": "AAPL has usable price evidence and missing optional context is disclosed.",
  "hard_gate_assessment": "No blocker checks are present.",
  "context_quality": "Price and SPY are available; news and sentiment are missing.",
  "missing_context": ["news", "sentiment"],
  "roles": [
    {{
      "role": "price_action",
      "stance": "bullish",
      "confidence": 0.7,
      "summary": "Price evidence is usable.",
      "evidence_used": ["symbol_price", "spy_reference"],
      "bull_points": ["Required price evidence is present."],
      "bear_points": [],
      "missing_evidence": []
    }},
    {{
      "role": "fundamentals",
      "stance": "neutral",
      "confidence": 0.4,
      "summary": "Fundamentals are missing.",
      "evidence_used": [],
      "bull_points": [],
      "bear_points": [],
      "missing_evidence": ["fundamentals"]
    }},
    {{
      "role": "news_sentiment",
      "stance": "neutral",
      "confidence": 0.4,
      "summary": "News and sentiment are missing.",
      "evidence_used": [],
      "bull_points": [],
      "bear_points": [],
      "missing_evidence": ["news", "sentiment"]
    }},
    {{
      "role": "risk",
      "stance": "neutral",
      "confidence": 0.6,
      "summary": "No blocker checks are present.",
      "evidence_used": ["checks"],
      "bull_points": [],
      "bear_points": [],
      "missing_evidence": []
    }},
    {{
      "role": "final_judge",
      "stance": "bullish",
      "confidence": 0.72,
      "summary": "Trusted for review-only consideration.",
      "evidence_used": ["price_action", "risk"],
      "bull_points": ["Required evidence passed."],
      "bear_points": ["Optional context is missing."],
      "missing_evidence": ["news", "sentiment"]
    }}
  ],
  "what_would_change_verdict": ["A blocker check appears."],
  "operator_note": "Review-only note. Do not execute from this review."
}}
```
"""


def test_parse_structured_codex_review_requires_all_roles():
    structured = parse_structured_codex_review(structured_review_markdown())

    assert isinstance(structured, CodexStructuredReview)
    assert structured.verdict == TrustVerdict.TRUSTED
    assert {role.role for role in structured.roles} == {
        "price_action",
        "fundamentals",
        "news_sentiment",
        "risk",
        "final_judge",
    }


def test_parse_structured_codex_review_rejects_invalid_confidence():
    with pytest.raises(ValueError):
        parse_structured_codex_review(structured_review_markdown(confidence=1.5))


def test_attach_codex_review_persists_structured_payload(tmp_path):
    store = MarketLabStore(tmp_path)
    run = store.create_run("AAPL", run_id="mlab_test_AAPL")
    now = datetime.now(UTC)
    artifact = ReviewArtifact(
        run_id=run.run_id,
        symbol="AAPL",
        requested_at=now,
        completed_at=now,
        status=RunStatus.DONE,
        trust_verdict=TrustVerdict.TRUSTED,
        verdict_reasons=["all_required_evidence_passed"],
        interpretation=Interpretation(summary="Review is trusted."),
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
    review_file = Path(run.run_dir) / "codex-review.md"
    review_file.write_text(structured_review_markdown(), encoding="utf-8")

    updated = store.attach_codex_review(run.run_id, review_file)

    assert updated.codex_review is not None
    assert updated.codex_review.verdict == TrustVerdict.TRUSTED
    assert updated.codex_review.structured is not None
    assert updated.codex_review.structured.context_quality.startswith("Price and SPY")
    assert updated.codex_review.structured.roles[-1].role == "final_judge"
