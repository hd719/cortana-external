import json
from datetime import UTC, datetime

import quick_check_batch


def test_normalize_symbols_dedupes_and_upcases():
    assert quick_check_batch._normalize_symbols([" aapl ", "AAPL", "", "msft"]) == ["AAPL", "MSFT"]


def test_json_safe_converts_non_serializable_values():
    payload = quick_check_batch._json_safe(
        {
            "generated_at": datetime(2026, 3, 19, tzinfo=UTC),
            "values": [1, datetime(2026, 3, 19, 12, 0, tzinfo=UTC), float("nan")],
        }
    )

    assert payload["generated_at"] == "2026-03-19T00:00:00+00:00"
    assert payload["values"][1] == "2026-03-19T12:00:00+00:00"
    assert payload["values"][2] is None


def test_build_entry_extracts_compact_fields(monkeypatch):
    monkeypatch.setattr(quick_check_batch.TradingAdvisor, "format_quick_check", staticmethod(lambda result: "formatted"))

    entry = quick_check_batch._build_entry(
        {
            "input_symbol": "aapl",
            "symbol": "AAPL",
            "provider_symbol": "AAPL",
            "asset_class": "stock",
            "analysis_path": "canslim",
            "verdict": "actionable",
            "reason": "strong setup",
            "analysis": {
                "total_score": 9,
                "effective_confidence": 78,
                "recommendation": {"action": "BUY"},
            },
        }
    )

    assert entry["symbol"] == "AAPL"
    assert entry["verdict"] == "actionable"
    assert entry["base_action"] == "BUY"
    assert entry["formatted"] == "formatted"


def test_main_emits_json_payload(monkeypatch, capsys):
    monkeypatch.setattr(quick_check_batch, "parse_args", lambda: type("Args", (), {"symbols": "AAPL,MSFT"})())

    class _FakeAdvisor:
        def quick_check(self, symbol: str):
            return {
                "input_symbol": symbol,
                "symbol": symbol,
                "provider_symbol": symbol,
                "asset_class": "stock",
                "analysis_path": "canslim",
                "verdict": "needs confirmation",
                "reason": f"{symbol} reason",
                "analysis": {
                    "total_score": 8,
                    "effective_confidence": 67,
                    "recommendation": {"action": "WATCH"},
                },
            }

    monkeypatch.setattr(quick_check_batch, "TradingAdvisor", _FakeAdvisor)
    monkeypatch.setattr(
        quick_check_batch.TradingAdvisor,
        "format_quick_check",
        staticmethod(lambda result: f"formatted {result['symbol']}"),
        raising=False,
    )

    quick_check_batch.main()
    payload = json.loads(capsys.readouterr().out)

    assert payload["count"] == 2
    assert payload["symbols"] == ["AAPL", "MSFT"]
    assert payload["results"][0]["formatted"] == "formatted AAPL"
