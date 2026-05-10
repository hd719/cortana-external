from __future__ import annotations

import os
import subprocess
from pathlib import Path

from .models import TradingAgentsReview


class TradingAgentsAdapter:
    def __init__(self, *, repo_path: str | Path | None = None, required: bool | None = None):
        self.repo_path = Path(repo_path or os.getenv("TRADINGAGENTS_REPO_PATH", "/Users/hd/Developer/TradingAgents")).expanduser()
        self.required = required if required is not None else os.getenv("MARKET_LAB_REQUIRE_TRADINGAGENTS", "").lower() in {"1", "true", "yes"}

    def review(self, symbol: str, *, run_dir: Path) -> TradingAgentsReview:
        output_path = run_dir / "tradingagents.md"
        if os.getenv("MARKET_LAB_FAKE_TRADINGAGENTS", "").lower() in {"1", "true", "yes"}:
            text = f"# TradingAgents Review: {symbol}\n\nFake adapter review for local smoke testing.\n"
            output_path.write_text(text, encoding="utf-8")
            return TradingAgentsReview(status="ok", summary="Fake TradingAgents review completed.", output_path=str(output_path))

        if not self.repo_path.exists():
            message = f"TradingAgents repo not found at {self.repo_path}."
            output_path.write_text(message + "\n", encoding="utf-8")
            return TradingAgentsReview(
                status="failed" if self.required else "skipped",
                summary=message,
                output_path=str(output_path),
                error_message=message if self.required else None,
            )

        command = os.getenv("MARKET_LAB_TRADINGAGENTS_COMMAND")
        if not command:
            message = "TradingAgents command is not configured; set MARKET_LAB_TRADINGAGENTS_COMMAND or use fake mode."
            output_path.write_text(message + "\n", encoding="utf-8")
            return TradingAgentsReview(
                status="failed" if self.required else "skipped",
                summary=message,
                output_path=str(output_path),
                error_message=message if self.required else None,
            )

        args = [part for part in command.split(" ") if part]
        args.append(symbol)
        try:
            result = subprocess.run(
                args,
                cwd=self.repo_path,
                check=False,
                capture_output=True,
                text=True,
                timeout=float(os.getenv("MARKET_LAB_TRADINGAGENTS_TIMEOUT_SECONDS", "180")),
            )
        except Exception as exc:
            message = f"TradingAgents invocation failed: {exc}"
            output_path.write_text(message + "\n", encoding="utf-8")
            return TradingAgentsReview(status="failed", summary=message, output_path=str(output_path), error_message=message)

        text = "\n".join(part for part in [result.stdout, result.stderr] if part).strip()
        output_path.write_text(text + "\n", encoding="utf-8")
        if result.returncode != 0:
            message = f"TradingAgents exited with code {result.returncode}."
            return TradingAgentsReview(status="failed", summary=message, output_path=str(output_path), error_message=message)
        summary = text.splitlines()[0] if text else "TradingAgents review completed."
        return TradingAgentsReview(status="ok", summary=summary, output_path=str(output_path))
