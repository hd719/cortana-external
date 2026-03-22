from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pandas as pd

from evaluation.prediction_accuracy import (
    build_prediction_accuracy_summary,
    persist_prediction_snapshot,
    settle_prediction_snapshots,
)


class _StubProvider:
    def get_history(self, symbol: str, period: str = "6mo"):
        frame = pd.DataFrame(
            {
                "Open": [10.0, 11.0, 12.0],
                "High": [10.0, 11.0, 12.0],
                "Low": [10.0, 11.0, 12.0],
                "Close": [10.0, 11.0, 12.0],
                "Volume": [100, 100, 100],
            },
            index=pd.to_datetime(
                [
                    datetime(2026, 3, 1, tzinfo=timezone.utc),
                    datetime(2026, 3, 3, tzinfo=timezone.utc),
                    datetime(2026, 3, 25, tzinfo=timezone.utc),
                ]
            ),
        )
        return type("History", (), {"frame": frame})()


def test_prediction_accuracy_round_trip(tmp_path):
    generated_at = datetime(2026, 3, 1, tzinfo=timezone.utc)
    persist_prediction_snapshot(
        strategy="dip_buyer",
        market_regime="correction",
        records=[{"symbol": "AAPL", "action": "WATCH", "score": 8, "reason": "test"}],
        root=tmp_path,
        generated_at=generated_at,
    )

    settle_prediction_snapshots(root=tmp_path, provider=_StubProvider(), now=generated_at + timedelta(days=30))
    summary = build_prediction_accuracy_summary(root=tmp_path)

    assert summary["snapshot_count"] == 1
    bucket = summary["summary"][0]
    assert bucket["strategy"] == "dip_buyer"
    assert bucket["action"] == "WATCH"
    assert bucket["20d"]["samples"] == 1
