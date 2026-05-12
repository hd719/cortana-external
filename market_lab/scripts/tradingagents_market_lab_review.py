from __future__ import annotations

import json
import os
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


PROVIDER_KEY_ENV = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "google": "GOOGLE_API_KEY",
    "xai": "XAI_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
    "qwen": "DASHSCOPE_API_KEY",
    "qwen-cn": "DASHSCOPE_CN_API_KEY",
    "glm": "ZHIPU_API_KEY",
    "glm-cn": "ZHIPU_CN_API_KEY",
    "minimax": "MINIMAX_API_KEY",
    "minimax-cn": "MINIMAX_CN_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
}


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def selected_analysts() -> list[str]:
    raw = os.getenv("MARKET_LAB_TRADINGAGENTS_ANALYSTS", "market,news,fundamentals,social")
    return [part.strip() for part in raw.split(",") if part.strip()]


def analysis_date() -> str:
    override = os.getenv("MARKET_LAB_TRADINGAGENTS_DATE")
    if override:
        return override
    return datetime.now(ZoneInfo("America/New_York")).date().isoformat()


def provider_key_status(provider: str) -> tuple[str | None, bool]:
    key_name = PROVIDER_KEY_ENV.get(provider.lower())
    if key_name is None:
        return None, True
    return key_name, bool(os.getenv(key_name))


def markdown_section(title: str, value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        body = value.strip()
    else:
        body = json.dumps(value, indent=2, sort_keys=True, default=str)
    if not body:
        return ""
    return f"\n## {title}\n\n{body}\n"


def main(argv: list[str]) -> int:
    if len(argv) != 2 or not argv[1].strip():
        print("Usage: tradingagents_market_lab_review.py SYMBOL", file=sys.stderr)
        return 2

    symbol = argv[1].strip().upper()
    repo_root = Path.cwd()
    load_env_file(repo_root / ".env")
    extra_env = os.getenv("MARKET_LAB_TRADINGAGENTS_ENV_FILE")
    if extra_env:
        load_env_file(Path(extra_env).expanduser())

    from tradingagents.default_config import DEFAULT_CONFIG
    from tradingagents.graph.trading_graph import TradingAgentsGraph

    config = DEFAULT_CONFIG.copy()
    provider = str(config.get("llm_provider", "openai")).lower()
    key_name, has_key = provider_key_status(provider)
    if not has_key:
        print(
            f"TradingAgents provider '{provider}' requires {key_name}; add it to {repo_root / '.env'} "
            "or the launch environment.",
            file=sys.stderr,
        )
        return 2

    analysts = selected_analysts()
    trade_date = analysis_date()
    graph = TradingAgentsGraph(selected_analysts=analysts, debug=False, config=config)
    final_state, decision = graph.propagate(symbol, trade_date)

    parts = [
        f"# TradingAgents Review: {symbol}",
        "",
        f"- Analysis date: {trade_date}",
        f"- Provider: {config.get('llm_provider')}",
        f"- Deep model: {config.get('deep_think_llm')}",
        f"- Quick model: {config.get('quick_think_llm')}",
        f"- Analysts: {', '.join(analysts)}",
        f"- Processed signal: {decision}",
    ]
    for key, title in [
        ("market_report", "Market Analyst"),
        ("sentiment_report", "Sentiment Analyst"),
        ("news_report", "News Analyst"),
        ("fundamentals_report", "Fundamentals Analyst"),
        ("investment_plan", "Research Team"),
        ("trader_investment_plan", "Trader"),
        ("final_trade_decision", "Portfolio Manager Final Decision"),
    ]:
        section = markdown_section(title, final_state.get(key))
        if section:
            parts.append(section)

    print("\n".join(parts).strip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
