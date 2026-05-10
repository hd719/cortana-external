from __future__ import annotations

import argparse
import json
from typing import Any

from .runner import ReviewRunner
from .settlement import SettlementService
from .storage import MarketLabStore


def emit(payload: Any, *, as_json: bool = False) -> None:
    if as_json:
        print(json.dumps(payload, indent=2, default=str))
        return
    if isinstance(payload, dict):
        for key, value in payload.items():
            print(f"{key}: {value}")
    else:
        print(payload)


def run_command(args: argparse.Namespace) -> None:
    artifact = ReviewRunner().run(args.symbol)
    payload = {
        "run_id": artifact.run_id,
        "symbol": artifact.symbol,
        "status": artifact.status,
        "trust_verdict": artifact.trust_verdict,
        "verdict_reasons": artifact.verdict_reasons,
        "review_path": artifact.artifact_paths.review,
    }
    emit(payload, as_json=args.json)


def show_command(args: argparse.Namespace) -> None:
    store = MarketLabStore()
    run = store.get_run(args.run_id)
    review = store.read_review(args.run_id)
    payload = {
        "run": run.model_dump(mode="json"),
        "review": review,
        "settlements": store.list_settlements(args.run_id),
    }
    emit(payload, as_json=args.json)


def events_command(args: argparse.Namespace) -> None:
    events = MarketLabStore().read_events(args.run_id)
    emit(events, as_json=args.json)


def settle_command(args: argparse.Namespace) -> None:
    artifact = SettlementService().settle_run(args.run_id)
    payload = {
        "run_id": artifact.run_id,
        "symbol": artifact.symbol,
        "settlements": [item.model_dump(mode="json") for item in artifact.settlements],
    }
    emit(payload, as_json=args.json)


def settle_due_command(args: argparse.Namespace) -> None:
    run_ids = SettlementService().settle_due()
    emit({"settled_run_ids": run_ids}, as_json=args.json)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="market-lab", description="Run Market Lab trust reviews.")
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="Run a one-symbol review.")
    run.add_argument("symbol")
    run.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    run.set_defaults(func=run_command)

    show = sub.add_parser("show", help="Show a run and review artifact.")
    show.add_argument("run_id")
    show.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    show.set_defaults(func=show_command)

    events = sub.add_parser("events", help="Show a run event stream.")
    events.add_argument("run_id")
    events.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    events.set_defaults(func=events_command)

    settle = sub.add_parser("settle", help="Settle due windows for a run.")
    settle.add_argument("run_id")
    settle.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    settle.set_defaults(func=settle_command)

    settle_due = sub.add_parser("settle-due", help="Settle all due windows.")
    settle_due.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    settle_due.set_defaults(func=settle_due_command)
    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
