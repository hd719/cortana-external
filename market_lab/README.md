# Market Lab Python Engine

Market Lab runs one-symbol, forward-looking trust reviews. It is intentionally separate from the old backtester.

Planning docs live in `market_lab/docs/planning`.

## CLI

Canonical commands:

```bash
uv run --project market_lab python -m market_lab.cli run AAPL --env prod
uv run --project market_lab python -m market_lab.cli run AAPL --env dev --json
uv run --project market_lab python -m market_lab.cli list --env prod --json
uv run --project market_lab python -m market_lab.cli show <run_id> --env prod
uv run --project market_lab python -m market_lab.cli events <run_id> --env prod
uv run --project market_lab python -m market_lab.cli settle <run_id> --env prod
uv run --project market_lab python -m market_lab.cli settle-due --env prod
uv run --project market_lab python -m market_lab.cli reset-env --env dev --confirm dev --json
uv run --project market_lab python -m market_lab.cli codex-packet <run_id> --env prod --json
uv run --project market_lab python -m market_lab.cli attach-codex-review <run_id> <review_path> --env prod --json
```

Repo-level convenience command:

```bash
pnpm market-lab -- run AAPL --env dev --json
pnpm market-lab -- show <run_id> --env dev --json
pnpm market-lab -- events <run_id> --env dev --json
```

Optional local aliases:

```bash
export MARKET_LAB_ENV=dev
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
  prod/
    market_lab.sqlite
    runs/<run_id>/
      review.json
      events.jsonl
      codex-review-packet.md
      codex-review.md
      logs.txt
  dev/
  test/
  ci/
```

## Environment

- `MARKET_LAB_ENV`: required for CLI, one of `prod`, `dev`, `test`, or `ci`
- `MARKET_LAB_DATA_ROOT`: override the root before the env suffix is added
- `MARKET_LAB_CACHE_DIR`: legacy alias for `MARKET_LAB_DATA_ROOT`
- `MARKET_DATA_SERVICE_BASE_URL`: defaults to `http://127.0.0.1:3033`
- `MARKET_LAB_SETTLEMENT_ALERTS_ENABLED=0`: disable OpenClaw monitor settlement alerts
- `MARKET_LAB_ALLOW_ALERTS_IN_TEST=1`: allow non-prod settlement alerts during explicit QA
- `MARKET_LAB_MONITOR_BOT_TOKEN`: override monitor Telegram bot token
- `MARKET_LAB_MONITOR_CHAT_ID`: override monitor Telegram chat id
- `OPENCLAW_CONFIG_PATH`: override `~/.openclaw/openclaw.json`

Mission Control sets `MARKET_LAB_ENV` from its launchd profile:

| Mission Control profile | URL | Market Lab env |
|---|---|---|
| prod | `http://127.0.0.1:3000` / `http://100.120.198.12:3000` | `prod` |
| dev | `http://127.0.0.1:3001` / `http://100.120.198.12:3001` | `dev` |

Use explicit `--env prod` for real tracked runs. Use `--env dev`, `test`, or `ci` for throwaway QA.

## Codex-Assisted Reviews

Every run writes `codex-review-packet.md`. Mission Control's `Ask Codex` button sends that packet through the existing Codex sessions route for the `cortana-external` workspace.

```bash
uv run --project market_lab python -m market_lab.cli codex-packet <run_id> --env prod --json
uv run --project market_lab python -m market_lab.cli attach-codex-review <run_id> <review_path> --env prod --json
```

Codex writes `codex-review.md`, then runs the attach command so Mission Control can render the review summary without requiring OpenAI API keys.

V1 expects `codex-review.md` to include a fenced `json market-lab-codex-review/v1` block. That block records the analyst roles (`price_action`, `fundamentals`, `news_sentiment`, `risk`, `final_judge`), confidence, missing context, and what would change the verdict. Markdown-only reviews still attach as a fallback, but the structured block is the durable contract.

## Settlement Operations

Each run creates pending `1d`, `5d`, and `20d` settlement windows. The per-run `Settle` button checks only the selected run. The global `Settle due` action checks every due window.

Only windows whose `due_at` has passed are settled. Already-settled windows are skipped, so each window is scored once. When a pending window becomes settled, Market Lab sends an OpenClaw monitor Telegram alert with the symbol, window, original verdict, settlement score, stock return, SPY return, alpha versus SPY, and run id.

Mac mini scheduled settlement uses:

```bash
market_lab/scripts/settle-due.sh
```

Install or refresh the launchd schedule:

```bash
mkdir -p ~/Library/LaunchAgents
cp market_lab/launchd/com.cortana.market-lab-settle-due.plist ~/Library/LaunchAgents/
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.cortana.market-lab-settle-due.plist 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.cortana.market-lab-settle-due.plist
```

The job runs daily at 5:05 PM local time and the script skips weekends by default.

## Module Map

- `models.py`: Pydantic contracts
- `storage.py`: SQLite index and artifact files
- `market_data.py`: local market-data service client
- `checks.py`: deterministic freshness and evidence checks
- `codex_review.py`: Codex review packet and prompt builder
- `monitor_alerts.py`: OpenClaw monitor alerts for newly settled outcome windows
- `verdict.py`: trusted / uncertain / blocked decision
- `runner.py`: one-symbol review orchestration
- `settlement.py`: 1D / 5D / 20D outcome scoring
- `cli.py`: terminal interface used by Mission Control too
