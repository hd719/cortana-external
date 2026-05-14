from __future__ import annotations

import argparse
import json
import os
from typing import Any

from .broker_adapter import BrokerAdapter
from .codex_review import build_codex_packet, codex_prompt_for_packet
from .environment import artifact_environment, current_environment, reset_environment_cache
from .execution_intents import ExecutionIntentService
from .models import ReviewArtifact
from .opportunities import OpportunityBoardService
from .portfolio_context import PortfolioContextService
from .runner import ReviewRunner
from .settlement import SettlementService
from .storage import MarketLabStore
from .token_budget import build_token_budget


def emit(payload: Any, *, as_json: bool = False) -> None:
    if isinstance(payload, dict) and "environment" not in payload:
        meta = artifact_environment()
        payload = {
            "environment": meta.environment,
            "source_mode": meta.source_mode,
            "is_test_data": meta.is_test_data,
            **payload,
        }
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


def list_command(args: argparse.Namespace) -> None:
    runs = MarketLabStore().list_runs(limit=args.limit)
    emit({"runs": [run.model_dump(mode="json") for run in runs]}, as_json=args.json)


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


def reset_env_command(args: argparse.Namespace) -> None:
    store = MarketLabStore()
    reset_environment_cache(store.cache_dir, environment=store.environment, confirm=args.confirm)
    emit({"reset": True, "cache_dir": str(store.cache_dir)}, as_json=args.json)


def codex_packet_command(args: argparse.Namespace) -> None:
    store = MarketLabStore()
    review = store.read_review(args.run_id)
    if review is None:
        raise SystemExit(f"Review not found: {args.run_id}")
    artifact = ReviewArtifact.model_validate(review)
    prior_runs = [item for item in store.list_runs(limit=25) if item.symbol == artifact.symbol and item.run_id != artifact.run_id]
    packet_text = build_codex_packet(
        artifact,
        prior_runs=prior_runs,
        prior_settlements={item.run_id: store.list_settlements(item.run_id) for item in prior_runs[:5]},
        mode=args.mode,
    )
    token_budget = build_token_budget(args.mode, packet_text, artifact)
    artifact = artifact.model_copy(update={"token_budget": token_budget})
    store.write_review(artifact)
    packet_text = build_codex_packet(
        artifact,
        prior_runs=prior_runs,
        prior_settlements={item.run_id: store.list_settlements(item.run_id) for item in prior_runs[:5]},
        mode=args.mode,
    )
    store.write_codex_packet(args.run_id, packet_text)

    packet_path = review.get("artifact_paths", {}).get("codex_packet")
    if not packet_path:
        raise SystemExit(f"Codex packet path missing for {args.run_id}")

    prompt = codex_prompt_for_packet(packet_path)
    payload = {"run_id": args.run_id, "packet_path": packet_path, "prompt": prompt}
    emit(payload, as_json=args.json)


def attach_codex_review_command(args: argparse.Namespace) -> None:
    artifact = MarketLabStore().attach_codex_review(args.run_id, args.review_path, session_id=args.session_id)
    payload = {
        "run_id": artifact.run_id,
        "symbol": artifact.symbol,
        "codex_review": artifact.codex_review.model_dump(mode="json") if artifact.codex_review else None,
        "review_path": artifact.artifact_paths.review,
    }
    emit(payload, as_json=args.json)


def opportunities_command(args: argparse.Namespace) -> None:
    board = OpportunityBoardService().generate(watchlist=args.watchlist, symbols=args.symbols)
    emit(board.model_dump(mode="json"), as_json=args.json)


def opportunity_show_command(args: argparse.Namespace) -> None:
    board = OpportunityBoardService().load(args.board_id)
    emit(board.model_dump(mode="json"), as_json=args.json)


def portfolio_command(args: argparse.Namespace) -> None:
    service = PortfolioContextService()
    context = service.refresh() if args.refresh else service.latest()
    emit(context.model_dump(mode="json"), as_json=args.json)


def intent_create_command(args: argparse.Namespace) -> None:
    intent = ExecutionIntentService().create_draft(
        run_id=args.run_id,
        proposed_action=args.action,
        proposed_notional=args.notional,
    )
    emit(intent.model_dump(mode="json"), as_json=args.json)


def intent_approve_command(args: argparse.Namespace) -> None:
    intent = ExecutionIntentService().approve(args.intent_id, operator=args.operator, note=args.note)
    emit(intent.model_dump(mode="json"), as_json=args.json)


def intent_reject_command(args: argparse.Namespace) -> None:
    intent = ExecutionIntentService().reject(args.intent_id, operator=args.operator, note=args.note)
    emit(intent.model_dump(mode="json"), as_json=args.json)


def intent_validate_command(args: argparse.Namespace) -> None:
    intent = ExecutionIntentService().get(args.intent_id)
    result = BrokerAdapter().validate_intent(intent)
    emit(result.model_dump(mode="json"), as_json=args.json)


def intent_preview_command(args: argparse.Namespace) -> None:
    intent = ExecutionIntentService().get(args.intent_id)
    result = BrokerAdapter().preview_order(intent)
    emit(result.model_dump(mode="json"), as_json=args.json)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="market-lab", description="Run Market Lab trust reviews.")
    sub = parser.add_subparsers(dest="command", required=True)
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--env", choices=["prod", "dev", "test", "ci"], default=None, help="Market Lab data environment.")

    run = sub.add_parser("run", parents=[common], help="Run a one-symbol review.")
    run.add_argument("symbol")
    run.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    run.set_defaults(func=run_command)

    list_runs = sub.add_parser("list", parents=[common], help="List recent runs.")
    list_runs.add_argument("--limit", type=int, default=50)
    list_runs.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    list_runs.set_defaults(func=list_command)

    show = sub.add_parser("show", parents=[common], help="Show a run and review artifact.")
    show.add_argument("run_id")
    show.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    show.set_defaults(func=show_command)

    events = sub.add_parser("events", parents=[common], help="Show a run event stream.")
    events.add_argument("run_id")
    events.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    events.set_defaults(func=events_command)

    settle = sub.add_parser("settle", parents=[common], help="Settle due windows for a run.")
    settle.add_argument("run_id")
    settle.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    settle.set_defaults(func=settle_command)

    settle_due = sub.add_parser("settle-due", parents=[common], help="Settle all due windows.")
    settle_due.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    settle_due.set_defaults(func=settle_due_command)

    codex_packet = sub.add_parser("codex-packet", parents=[common], help="Show the Codex review prompt for a run.")
    codex_packet.add_argument("run_id")
    codex_packet.add_argument("--mode", choices=["quick", "deep"], default="quick")
    codex_packet.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    codex_packet.set_defaults(func=codex_packet_command)

    attach_codex = sub.add_parser("attach-codex-review", parents=[common], help="Attach a Codex markdown review to a run.")
    attach_codex.add_argument("run_id")
    attach_codex.add_argument("review_path")
    attach_codex.add_argument("--session-id")
    attach_codex.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    attach_codex.set_defaults(func=attach_codex_review_command)

    opportunities = sub.add_parser("opportunities", parents=[common], help="Generate a deterministic opportunity board.")
    opportunities.add_argument("--watchlist", default=None)
    opportunities.add_argument("--symbols", default=None, help="Comma-separated ad hoc symbols.")
    opportunities.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    opportunities.set_defaults(func=opportunities_command)

    opportunity_show = sub.add_parser("opportunity-show", parents=[common], help="Show a generated opportunity board.")
    opportunity_show.add_argument("board_id")
    opportunity_show.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    opportunity_show.set_defaults(func=opportunity_show_command)

    portfolio = sub.add_parser("portfolio", parents=[common], help="Show or refresh the read-only portfolio context.")
    portfolio.add_argument("--refresh", action="store_true")
    portfolio.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    portfolio.set_defaults(func=portfolio_command)

    intent_create = sub.add_parser("intent-create", parents=[common], help="Create a draft execution intent from a review.")
    intent_create.add_argument("run_id")
    intent_create.add_argument("--action", choices=["buy", "sell", "hold"], default="hold")
    intent_create.add_argument("--notional", type=float)
    intent_create.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    intent_create.set_defaults(func=intent_create_command)

    intent_approve = sub.add_parser("intent-approve", parents=[common], help="Approve a draft execution intent.")
    intent_approve.add_argument("intent_id")
    intent_approve.add_argument("--operator", default="operator")
    intent_approve.add_argument("--note")
    intent_approve.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    intent_approve.set_defaults(func=intent_approve_command)

    intent_reject = sub.add_parser("intent-reject", parents=[common], help="Reject an execution intent.")
    intent_reject.add_argument("intent_id")
    intent_reject.add_argument("--operator", default="operator")
    intent_reject.add_argument("--note")
    intent_reject.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    intent_reject.set_defaults(func=intent_reject_command)

    intent_validate = sub.add_parser("intent-validate", parents=[common], help="Validate an approved intent without placing orders.")
    intent_validate.add_argument("intent_id")
    intent_validate.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    intent_validate.set_defaults(func=intent_validate_command)

    intent_preview = sub.add_parser("intent-preview", parents=[common], help="Preview an approved intent without placing orders.")
    intent_preview.add_argument("intent_id")
    intent_preview.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    intent_preview.set_defaults(func=intent_preview_command)
    reset_env = sub.add_parser("reset-env", parents=[common], help="Reset one Market Lab environment cache.")
    reset_env.add_argument("--confirm", required=True)
    reset_env.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    reset_env.set_defaults(func=reset_env_command)
    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.env:
        os.environ["MARKET_LAB_ENV"] = args.env
    elif not os.getenv("MARKET_LAB_ENV"):
        raise SystemExit("Set MARKET_LAB_ENV or pass --env prod|dev|test|ci.")
    current_environment(default=None)
    args.func(args)


if __name__ == "__main__":
    main()
