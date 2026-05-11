from __future__ import annotations

import subprocess

from market_lab.tradingagents_adapter import TradingAgentsAdapter


def test_tradingagents_adapter_uses_shlex_for_configured_command(monkeypatch, tmp_path):
    repo = tmp_path / "TradingAgents"
    repo.mkdir()
    calls = []

    def fake_run(args, **kwargs):
        calls.append(args)
        return subprocess.CompletedProcess(args=args, returncode=0, stdout="review ok\n", stderr="")

    monkeypatch.setenv("MARKET_LAB_TRADINGAGENTS_COMMAND", "uv run tradingagents-cli --mode quick")
    monkeypatch.setattr(subprocess, "run", fake_run)

    review = TradingAgentsAdapter(repo_path=repo).review("AAPL", run_dir=tmp_path)

    assert review.status == "ok"
    assert calls == [["uv", "run", "tradingagents-cli", "--mode", "quick", "AAPL"]]
