from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Protocol

from .models import ReviewArtifact, SettlementWindow

DEFAULT_OPENCLAW_CONFIG = Path.home() / ".openclaw" / "openclaw.json"
DEFAULT_MONITOR_CHAT_ID = "8171372724"


class SettlementAlertNotifier(Protocol):
    def send_settlement_alert(self, artifact: ReviewArtifact, settlement: SettlementWindow) -> None: ...


def _read_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _fmt_pct(value: float | None) -> str:
    return "n/a" if value is None else f"{value:+.2f}%"


def build_settlement_alert_text(artifact: ReviewArtifact, settlement: SettlementWindow) -> str:
    alpha = settlement.alpha_vs_spy_pct
    if alpha is None:
        result = "alpha unavailable"
    elif alpha > 0:
        result = f"beat SPY by {_fmt_pct(alpha)}"
    elif alpha < 0:
        result = f"trailed SPY by {_fmt_pct(abs(alpha))}"
    else:
        result = "matched SPY"

    return "\n".join(
        [
            "Market Lab Settlement",
            f"{artifact.symbol} {settlement.window.upper()} | {str(settlement.score or 'unscored').replace('_', ' ')}",
            f"Verdict: {artifact.trust_verdict} | {result}",
            f"{artifact.symbol}: {_fmt_pct(settlement.raw_return_pct)} | SPY: {_fmt_pct(settlement.spy_return_pct)} | Alpha: {_fmt_pct(alpha)}",
            f"Entry: ${settlement.symbol_entry_price:.2f} -> ${settlement.symbol_settlement_price:.2f}"
            if settlement.symbol_entry_price is not None and settlement.symbol_settlement_price is not None
            else "Entry/exit: n/a",
            f"Run: {artifact.run_id}",
        ]
    )


class OpenClawMonitorTelegramNotifier:
    def __init__(
        self,
        *,
        enabled: bool | None = None,
        config_path: Path | None = None,
        fetch_timeout_seconds: float = 10,
    ):
        self.enabled = enabled if enabled is not None else os.getenv("MARKET_LAB_SETTLEMENT_ALERTS_ENABLED", "1") != "0"
        self.config_path = config_path or Path(os.getenv("OPENCLAW_CONFIG_PATH", str(DEFAULT_OPENCLAW_CONFIG)))
        self.fetch_timeout_seconds = fetch_timeout_seconds

    def _routing(self) -> tuple[str | None, str | None]:
        token = os.getenv("MARKET_LAB_MONITOR_BOT_TOKEN") or os.getenv("TELEGRAM_BOT_TOKEN")
        chat_id = os.getenv("MARKET_LAB_MONITOR_CHAT_ID") or os.getenv("TELEGRAM_CHAT_ID")
        cfg = _read_json(self.config_path)
        telegram = cfg.get("channels", {}).get("telegram", {})
        accounts = telegram.get("accounts", {})
        token = token or accounts.get("monitor", {}).get("botToken") or accounts.get("default", {}).get("botToken")
        if not chat_id:
            chat_id = accounts.get("monitor", {}).get("chatId")
        if not chat_id and isinstance(telegram.get("allowFrom"), list) and telegram["allowFrom"]:
            chat_id = str(telegram["allowFrom"][0])
        return (str(token) if token else None, str(chat_id or DEFAULT_MONITOR_CHAT_ID))

    def send_settlement_alert(self, artifact: ReviewArtifact, settlement: SettlementWindow) -> None:
        if not self.enabled:
            return
        token, chat_id = self._routing()
        if not token or not chat_id:
            return
        body = urllib.parse.urlencode(
            {
                "chat_id": chat_id,
                "text": build_settlement_alert_text(artifact, settlement),
                "disable_web_page_preview": "true",
            }
        ).encode("utf-8")
        request = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendMessage",
            data=body,
            headers={"content-type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        try:
            urllib.request.urlopen(request, timeout=self.fetch_timeout_seconds).read()
        except Exception:
            # Settlement must stay durable even if notification delivery is down.
            return
