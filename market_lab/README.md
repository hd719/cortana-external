# Market Lab Python Engine

Market Lab runs one-symbol, forward-looking trust reviews. It is intentionally separate from the old backtester.

Planning docs live in `market_lab/docs/planning`.

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
uv run --project market_lab python -m market_lab.cli codex-packet <run_id> --json
uv run --project market_lab python -m market_lab.cli attach-codex-review <run_id> <review_path> --json
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
    codex-review-packet.md
    codex-review.md
    logs.txt
```

## Environment

- `MARKET_LAB_CACHE_DIR`: override `.cache/market_lab`
- `MARKET_DATA_SERVICE_BASE_URL`: defaults to `http://127.0.0.1:3033`

## Codex-Assisted Reviews

Every run writes `codex-review-packet.md`. Mission Control's `Ask Codex` button sends that packet through the existing Codex sessions route for the `cortana-external` workspace.

```bash
uv run --project market_lab python -m market_lab.cli codex-packet <run_id> --json
uv run --project market_lab python -m market_lab.cli attach-codex-review <run_id> <review_path> --json
```

Codex writes `codex-review.md`, then runs the attach command so Mission Control can render the review summary without requiring OpenAI API keys.

## Module Map

- `models.py`: Pydantic contracts
- `storage.py`: SQLite index and artifact files
- `market_data.py`: local market-data service client
- `checks.py`: deterministic freshness and evidence checks
- `codex_review.py`: Codex review packet and prompt builder
- `verdict.py`: trusted / uncertain / blocked decision
- `runner.py`: one-symbol review orchestration
- `settlement.py`: 1D / 5D / 20D outcome scoring
- `cli.py`: terminal interface used by Mission Control too
