# Market Lab Python Engine

Market Lab runs one-symbol, forward-looking trust reviews. It is intentionally separate from the old backtester.

## CLI

Canonical commands:

```bash
uv run --project market_lab python -m market_lab.cli run AAPL
uv run --project market_lab python -m market_lab.cli run AAPL --json
uv run --project market_lab python -m market_lab.cli list --json
uv run --project market_lab python -m market_lab.cli show <run_id>
uv run --project market_lab python -m market_lab.cli events <run_id>
uv run --project market_lab python -m market_lab.cli settle <run_id>
uv run --project market_lab python -m market_lab.cli settle-due
```

Repo-level convenience command:

```bash
pnpm market-lab -- run AAPL --json
pnpm market-lab -- show <run_id> --json
pnpm market-lab -- events <run_id> --json
```

Optional local aliases:

```bash
alias mlab-run='uv run --project market_lab python -m market_lab.cli run'
alias mlab-list='uv run --project market_lab python -m market_lab.cli list'
alias mlab-show='uv run --project market_lab python -m market_lab.cli show'
alias mlab-events='uv run --project market_lab python -m market_lab.cli events'
alias mlab-settle='uv run --project market_lab python -m market_lab.cli settle'
alias mlab-settle-due='uv run --project market_lab python -m market_lab.cli settle-due'
```

## Runtime Files

Default cache:

```text
.cache/market_lab/
  market_lab.sqlite
  runs/<run_id>/
    review.json
    events.jsonl
    tradingagents.md
    logs.txt
```

## Environment

- `MARKET_LAB_CACHE_DIR`: override `.cache/market_lab`
- `MARKET_DATA_SERVICE_BASE_URL`: defaults to `http://127.0.0.1:3033`
- `TRADINGAGENTS_REPO_PATH`: defaults to `/Users/hd/Developer/TradingAgents`
- `MARKET_LAB_TRADINGAGENTS_COMMAND`: command Market Lab runs for a real TradingAgents review
- `MARKET_LAB_FAKE_TRADINGAGENTS=1`: use deterministic fake TradingAgents output for smoke tests
- `MARKET_LAB_REQUIRE_TRADINGAGENTS=1`: block when TradingAgents cannot run
- `MARKET_LAB_TRADINGAGENTS_ANALYSTS`: comma-separated analysts, defaults to `market,news,fundamentals,social`
- `MARKET_LAB_TRADINGAGENTS_DATE`: optional analysis date override, defaults to today's New York date

## Real TradingAgents Reviews

TradingAgents is interactive by default. Market Lab uses this wrapper for non-interactive reviews:

```bash
MARKET_LAB_TRADINGAGENTS_COMMAND="uv run python /Users/hd/Developer/cortana-external/market_lab/scripts/tradingagents_market_lab_review.py"
```

Add that variable to the Mission Control runtime environment, then restart Mission Control.

The wrapper runs from `/Users/hd/Developer/TradingAgents`, loads `/Users/hd/Developer/TradingAgents/.env`, calls `TradingAgentsGraph.propagate(symbol, today)`, and writes a markdown report into the Market Lab run artifact.

Required before a real model-backed review can complete:

```bash
cd /Users/hd/Developer/TradingAgents
cp .env.example .env
# Fill in OPENAI_API_KEY or another provider key.
```

Optional lower-cost defaults:

```bash
TRADINGAGENTS_LLM_PROVIDER=openai
TRADINGAGENTS_DEEP_THINK_LLM=gpt-5.5
TRADINGAGENTS_QUICK_THINK_LLM=gpt-5.4-mini
TRADINGAGENTS_MAX_DEBATE_ROUNDS=1
TRADINGAGENTS_MAX_RISK_ROUNDS=1
```

## Module Map

- `models.py`: Pydantic contracts
- `storage.py`: SQLite index and artifact files
- `market_data.py`: local market-data service client
- `checks.py`: deterministic freshness and evidence checks
- `tradingagents_adapter.py`: TradingAgents second-opinion lane
- `../scripts/tradingagents_market_lab_review.py`: non-interactive TradingAgents wrapper
- `verdict.py`: trusted / uncertain / blocked decision
- `runner.py`: one-symbol review orchestration
- `settlement.py`: 1D / 5D / 20D outcome scoring
- `cli.py`: terminal interface used by Mission Control too
