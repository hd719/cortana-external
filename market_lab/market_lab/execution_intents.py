from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from .environment import artifact_environment
from .models import ApprovalRecord, ExecutionIntent, ReviewArtifact
from .storage import MarketLabStore, default_cache_dir


class ExecutionIntentService:
    def __init__(self, *, store: MarketLabStore | None = None, cache_dir: Path | str | None = None):
        self.store = store or MarketLabStore()
        self.cache_dir = Path(cache_dir).expanduser().resolve() if cache_dir else default_cache_dir() / "execution_intents"
        self.environment = artifact_environment()
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def create_draft(
        self,
        *,
        run_id: str,
        proposed_action: str = "hold",
        proposed_notional: float | None = None,
        ttl_minutes: int = 60,
    ) -> ExecutionIntent:
        raw = self.store.read_review(run_id)
        if raw is None:
            raise KeyError(f"Review not found: {run_id}")
        review = ReviewArtifact.model_validate(raw)
        if not review.artifact_paths.evidence_snapshot:
            raise ValueError("Review has no evidence snapshot path")
        now = datetime.now(UTC)
        intent = ExecutionIntent(
            environment=self.environment,
            intent_id=f"mlab_intent_{now.strftime('%Y%m%dT%H%M%SZ')}_{uuid4().hex[:8]}",
            symbol=review.symbol,
            created_at=now,
            expires_at=now + timedelta(minutes=ttl_minutes),
            source_review_id=run_id,
            evidence_snapshot_path=review.artifact_paths.evidence_snapshot,
            portfolio_context_path=review.artifact_paths.portfolio_context,
            proposed_action=proposed_action,  # type: ignore[arg-type]
            proposed_notional=proposed_notional,
            status="draft",
        )
        return self.write(intent)

    def get(self, intent_id: str) -> ExecutionIntent:
        path = self._path(intent_id)
        if not path.exists():
            raise KeyError(f"Execution intent not found: {intent_id}")
        return ExecutionIntent.model_validate(json.loads(path.read_text(encoding="utf-8")))

    def approve(self, intent_id: str, *, operator: str, note: str | None = None) -> ExecutionIntent:
        intent = self.get(intent_id)
        approval = ApprovalRecord(operator=operator, decided_at=datetime.now(UTC), decision="approved", note=note)
        return self.write(intent.model_copy(update={"status": "approved", "approval": approval}))

    def reject(self, intent_id: str, *, operator: str, note: str | None = None) -> ExecutionIntent:
        intent = self.get(intent_id)
        approval = ApprovalRecord(operator=operator, decided_at=datetime.now(UTC), decision="rejected", note=note)
        return self.write(intent.model_copy(update={"status": "rejected", "approval": approval}))

    def write(self, intent: ExecutionIntent) -> ExecutionIntent:
        path = self._path(intent.intent_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        intent = intent.model_copy(update={"artifact_path": str(path)})
        path.write_text(intent.model_dump_json(indent=2), encoding="utf-8")
        return intent

    def _path(self, intent_id: str) -> Path:
        return self.cache_dir / f"{intent_id}.json"
