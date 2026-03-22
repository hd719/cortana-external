#!/usr/bin/env python3
"""Settle logged alert predictions and write a compact accuracy artifact."""

from __future__ import annotations

import argparse
import json

from evaluation.prediction_accuracy import build_prediction_accuracy_summary, settle_prediction_snapshots


def main() -> None:
    parser = argparse.ArgumentParser(description="Settle prediction snapshots and build an accuracy artifact")
    parser.add_argument("--json", action="store_true", help="Emit summary as JSON")
    args = parser.parse_args()

    settle_prediction_snapshots()
    summary = build_prediction_accuracy_summary()

    if args.json:
        print(json.dumps(summary, indent=2))
        return

    print("Prediction accuracy")
    print(f"Snapshots settled: {int(summary.get('snapshot_count', 0) or 0)}")
    rows = summary.get("summary") or []
    if not rows:
        print("No settled prediction samples yet.")
        return
    for row in rows:
        parts = [f"{row.get('strategy')} {row.get('action')}"]
        for horizon_key, metrics in row.items():
            if horizon_key in {"strategy", "action"} or not isinstance(metrics, dict):
                continue
            parts.append(
                f"{horizon_key}: n={int(metrics.get('samples', 0) or 0)} "
                f"avg={float(metrics.get('avg_return_pct', 0.0) or 0.0):+.2f}% "
                f"hit={float(metrics.get('hit_rate', 0.0) or 0.0):.0%}"
            )
        print(" | ".join(parts))


if __name__ == "__main__":
    main()
