from __future__ import annotations

import json
import os
import re
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any

from .models import CodexReview, ReviewArtifact, RunRecord, RunStatus, TimelineEvent, TrustVerdict, model_to_json

_CODEX_VERDICT_RE = re.compile(r"^\s*Verdict\s*:\s*(trusted|blocked|uncertain)\b", re.IGNORECASE | re.MULTILINE)


def utc_now() -> datetime:
    return datetime.now(UTC)


def iso(value: datetime | None = None) -> str:
    return (value or utc_now()).isoformat()


def parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def default_cache_dir() -> Path:
    configured = os.getenv("MARKET_LAB_CACHE_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return repo_root() / ".cache" / "market_lab"


def make_run_id(symbol: str, now: datetime | None = None) -> str:
    stamp = (now or utc_now()).strftime("%Y%m%dT%H%M%SZ")
    return f"mlab_{stamp}_{symbol.strip().upper()}"


def parse_codex_verdict(text: str) -> TrustVerdict | None:
    match = _CODEX_VERDICT_RE.search(text)
    if not match:
        return None
    return TrustVerdict(match.group(1).lower())


class MarketLabStore:
    def __init__(self, cache_dir: Path | str | None = None):
        self.cache_dir = Path(cache_dir).expanduser().resolve() if cache_dir else default_cache_dir()
        self.runs_dir = self.cache_dir / "runs"
        self.db_path = self.cache_dir / "market_lab.sqlite"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.runs_dir.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self.connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS market_lab_runs (
                  run_id TEXT PRIMARY KEY,
                  symbol TEXT NOT NULL,
                  requested_at TEXT NOT NULL,
                  status TEXT NOT NULL,
                  trust_verdict TEXT,
                  verdict_reasons_json TEXT,
                  run_dir TEXT NOT NULL,
                  review_path TEXT,
                  events_path TEXT NOT NULL,
                  logs_path TEXT NOT NULL,
                  tradingagents_path TEXT,
                  error_message TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_market_lab_runs_symbol_requested_at
                  ON market_lab_runs(symbol, requested_at DESC);
                CREATE INDEX IF NOT EXISTS idx_market_lab_runs_status_updated_at
                  ON market_lab_runs(status, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_market_lab_runs_verdict_requested_at
                  ON market_lab_runs(trust_verdict, requested_at DESC);

                CREATE TABLE IF NOT EXISTS market_lab_settlements (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  run_id TEXT NOT NULL,
                  window TEXT NOT NULL,
                  status TEXT NOT NULL,
                  due_at TEXT NOT NULL,
                  symbol_entry_price REAL,
                  spy_entry_price REAL,
                  symbol_settlement_price REAL,
                  spy_settlement_price REAL,
                  raw_return_pct REAL,
                  spy_return_pct REAL,
                  alpha_vs_spy_pct REAL,
                  score TEXT,
                  settled_at TEXT,
                  error_message TEXT,
                  UNIQUE(run_id, window)
                );
                CREATE INDEX IF NOT EXISTS idx_market_lab_settlements_due
                  ON market_lab_settlements(status, due_at);
                CREATE INDEX IF NOT EXISTS idx_market_lab_settlements_run
                  ON market_lab_settlements(run_id, window);
                """
            )

    def create_run(self, symbol: str, *, run_id: str | None = None, requested_at: datetime | None = None) -> RunRecord:
        requested = requested_at or utc_now()
        normalized = symbol.strip().upper()
        run_id = run_id or make_run_id(normalized, requested)
        run_dir = self.runs_dir / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        events_path = run_dir / "events.jsonl"
        logs_path = run_dir / "logs.txt"
        events_path.touch(exist_ok=True)
        logs_path.touch(exist_ok=True)
        now = iso()

        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO market_lab_runs (
                  run_id, symbol, requested_at, status, verdict_reasons_json,
                  run_dir, events_path, logs_path, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    normalized,
                    requested.isoformat(),
                    RunStatus.QUEUED.value,
                    "[]",
                    str(run_dir),
                    str(events_path),
                    str(logs_path),
                    now,
                    now,
                ),
            )
        return self.get_run(run_id)

    def get_run(self, run_id: str) -> RunRecord:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM market_lab_runs WHERE run_id = ?", (run_id,)).fetchone()
        if row is None:
            raise KeyError(f"Run not found: {run_id}")
        return self._row_to_run(row)

    def list_runs(self, *, limit: int = 50) -> list[RunRecord]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM market_lab_runs ORDER BY requested_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [self._row_to_run(row) for row in rows]

    def update_run(
        self,
        run_id: str,
        *,
        status: RunStatus | str | None = None,
        trust_verdict: TrustVerdict | str | None = None,
        verdict_reasons: list[str] | None = None,
        review_path: Path | str | None = None,
        tradingagents_path: Path | str | None = None,
        error_message: str | None = None,
    ) -> RunRecord:
        fields: list[str] = ["updated_at = ?"]
        values: list[Any] = [iso()]
        if status is not None:
            fields.append("status = ?")
            values.append(str(status))
        if trust_verdict is not None:
            fields.append("trust_verdict = ?")
            values.append(str(trust_verdict))
        if verdict_reasons is not None:
            fields.append("verdict_reasons_json = ?")
            values.append(json.dumps(verdict_reasons))
        if review_path is not None:
            fields.append("review_path = ?")
            values.append(str(review_path))
        if tradingagents_path is not None:
            fields.append("tradingagents_path = ?")
            values.append(str(tradingagents_path))
        if error_message is not None:
            fields.append("error_message = ?")
            values.append(error_message)
        values.append(run_id)
        with self.connect() as conn:
            conn.execute(f"UPDATE market_lab_runs SET {', '.join(fields)} WHERE run_id = ?", values)
        return self.get_run(run_id)

    def append_event(self, run_id: str, event: str, message: str, *, details: dict[str, Any] | None = None) -> TimelineEvent:
        run = self.get_run(run_id)
        item = TimelineEvent(
            run_id=run_id,
            timestamp=utc_now(),
            event=event,
            message=message,
            details=details or {},
        )
        with Path(run.events_path).open("a", encoding="utf-8") as handle:
            handle.write(item.model_dump_json() + "\n")
        return item

    def read_events(self, run_id: str) -> list[dict[str, Any]]:
        run = self.get_run(run_id)
        path = Path(run.events_path)
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]

    def append_log(self, run_id: str, message: str) -> None:
        run = self.get_run(run_id)
        with Path(run.logs_path).open("a", encoding="utf-8") as handle:
            handle.write(f"{iso()} {message.rstrip()}\n")

    def read_logs(self, run_id: str, *, tail: int | None = None) -> str:
        run = self.get_run(run_id)
        path = Path(run.logs_path)
        if not path.exists():
            return ""
        lines = path.read_text(encoding="utf-8").splitlines()
        if tail is not None:
            lines = lines[-tail:]
        return "\n".join(lines)

    def write_json_atomic(self, path: Path, payload: dict[str, Any] | ReviewArtifact) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        text = model_to_json(payload) if isinstance(payload, ReviewArtifact) else json.dumps(payload, indent=2, default=str)
        with NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as tmp:
            tmp.write(text)
            tmp.write("\n")
            tmp_path = Path(tmp.name)
        tmp_path.replace(path)
        return path

    def write_review(self, artifact: ReviewArtifact) -> Path:
        run = self.get_run(artifact.run_id)
        review_path = Path(run.run_dir) / "review.json"
        self.write_json_atomic(review_path, artifact)
        self.update_run(
            artifact.run_id,
            status=artifact.status,
            trust_verdict=artifact.trust_verdict,
            verdict_reasons=artifact.verdict_reasons,
            review_path=review_path,
            tradingagents_path=artifact.artifact_paths.tradingagents,
        )
        return review_path

    def write_codex_packet(self, run_id: str, text: str) -> Path:
        run = self.get_run(run_id)
        packet_path = Path(run.run_dir) / "codex-review-packet.md"
        packet_path.write_text(text.rstrip() + "\n", encoding="utf-8")
        return packet_path

    def read_review(self, run_id: str) -> dict[str, Any] | None:
        run = self.get_run(run_id)
        if not run.review_path:
            return None
        path = Path(run.review_path)
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def attach_codex_review(self, run_id: str, review_path: Path | str, *, session_id: str | None = None) -> ReviewArtifact:
        raw = self.read_review(run_id)
        if raw is None:
            raise KeyError(f"Review not found: {run_id}")

        path = Path(review_path).expanduser().resolve()
        if not path.exists():
            raise FileNotFoundError(f"Codex review not found: {path}")

        text = path.read_text(encoding="utf-8").strip()
        first_line = next((line.strip() for line in text.splitlines() if line.strip()), "Codex review attached.")
        artifact = ReviewArtifact.model_validate(raw)
        artifact = artifact.model_copy(
            update={
                "codex_review": CodexReview(
                    status="attached",
                    summary=first_line[:240],
                    verdict=parse_codex_verdict(text),
                    output_path=str(path),
                    session_id=session_id,
                ),
                "artifact_paths": artifact.artifact_paths.model_copy(update={"codex_review": str(path)}),
            },
        )
        self.write_review(artifact)
        self.append_event(run_id, "codex_review_attached", f"Codex review attached from {path}.")
        return artifact

    def upsert_settlement(self, run_id: str, window: str, values: dict[str, Any]) -> None:
        payload = {"run_id": run_id, "window": window, **values}
        columns = list(payload.keys())
        placeholders = ", ".join("?" for _ in columns)
        updates = ", ".join(f"{col}=excluded.{col}" for col in columns if col not in {"run_id", "window"})
        with self.connect() as conn:
            conn.execute(
                f"""
                INSERT INTO market_lab_settlements ({', '.join(columns)})
                VALUES ({placeholders})
                ON CONFLICT(run_id, window) DO UPDATE SET {updates}
                """,
                [payload[col] for col in columns],
            )

    def list_settlements(self, run_id: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM market_lab_settlements WHERE run_id = ? ORDER BY due_at ASC",
                (run_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def due_settlements(self, now: datetime | None = None) -> list[dict[str, Any]]:
        cutoff = (now or utc_now()).isoformat()
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM market_lab_settlements WHERE status IN ('pending', 'not_due') AND due_at <= ? ORDER BY due_at ASC",
                (cutoff,),
            ).fetchall()
        return [dict(row) for row in rows]

    def _row_to_run(self, row: sqlite3.Row) -> RunRecord:
        return RunRecord(
            run_id=row["run_id"],
            symbol=row["symbol"],
            requested_at=parse_dt(row["requested_at"]),
            status=row["status"],
            trust_verdict=row["trust_verdict"],
            verdict_reasons=json.loads(row["verdict_reasons_json"] or "[]"),
            run_dir=row["run_dir"],
            review_path=row["review_path"],
            events_path=row["events_path"],
            logs_path=row["logs_path"],
            tradingagents_path=row["tradingagents_path"],
            error_message=row["error_message"],
            created_at=parse_dt(row["created_at"]),
            updated_at=parse_dt(row["updated_at"]),
        )
