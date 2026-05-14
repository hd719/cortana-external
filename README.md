# cortana-external (`~/Developer/cortana-external`)

[![CI](https://github.com/hd719/cortana-external/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/hd719/cortana-external/actions/workflows/ci.yml)

Runtime edge for Cortana: the external-service front door, Trading Ops truth surfaces, and reliability infrastructure that support the `~/clawd` command brain.

If `~/clawd` is strategy/memory/policy, **cortana-external is execution runtime**.

It carries Schwab market-data, streamer-backed quotes, and the live Trading Ops surfaces that Mission Control reads from.

Documentation placement and authoring rules live in [`docs/source/architecture/documentation-authoring-guide.md`](docs/source/architecture/documentation-authoring-guide.md).

Documentation follows a Karpathy-style LLM wiki split:
- raw source artifacts stay close to the owning system (`backtester/docs/`, app docs, or the tiny root `docs/` front door)
- exploratory product/runtime research lives in `research/`
- compiled current-truth pages live in `knowledge/`
- archived repo-level leftovers live in `docs/archive/`

OpenClaw Dreaming can also inspect a separate isolated runtime wiki at `~/.openclaw/wiki/cortana`. Repo-native sync is owned by the `cortana` repo, but `cortana-external` exposes a post-merge helper that triggers that refresh when this repo's curated front-door docs changed.

## 0) Read this first if you are trading

If you need the current live shape, read in this order:

- `apps/mission-control/README.md` for live Trading Ops routes, live stream, and restart behavior
- `knowledge/domains/mission-control/current-state.md` for Mission Control runtime truth
- `knowledge/domains/backtester/current-state.md` for backtester runtime truth
- `backtester/README.md` for the backtester operator manual and market-data workflow

---

## 1) What this repo contains

- TypeScript Hono service (`@cortana/external-service`) exposing **Whoop + Tonal + Schwab market-data + streamer-backed quotes + Polymarket + Alpaca** APIs (loopback on port `3033`)
- Mission Control dashboard app (`apps/mission-control`, live Trading Ops truth surfaces plus agent, run, cron, and service telemetry)
- CANSLIM backtester/advisor (`backtester/`)
- Read-only Polymarket market-intel + quick-check overlay path for the backtester
- Watchdog reliability service (`watchdog/`, launchd)
- `packages/` – typed client libraries (`fitness-client`, `fitness-types`)
- Supporting docs and stock-discovery scripts
- canonical docs guidance for humans and LLMs

Post-merge wiki sync helper:

```bash
/Users/hd/Developer/cortana-external/tools/repo/post-merge-sync.sh
```

That wrapper only triggers the shared wiki refresh when these files changed in `cortana-external`:

- `README.md`
- `docs/README.md`
- `knowledge/indexes/systems.md`

Tracked Git hook:

- `.githooks/post-merge` runs the helper automatically after local Git merges when `core.hooksPath` is set to `.githooks`

---

## 2) Verified directory structure

```text
~/Developer/cortana-external
├── README.md
├── .env
├── apps/
│   ├── external-service/        # TypeScript external API service (Hono + Node)
│   └── mission-control/         # Next.js ops dashboard
├── launchd-run.sh
│
├── backtester/                  # CANSLIM engine + alerts
├── Mjolnir/                     # Whoop/Tonal fitness service docs
├── watchdog/                    # launchd reliability monitor
├── packages/
│   ├── fitness-client/           # Typed TS client for external fitness/trading service
│   ├── fitness-types/            # Shared TypeScript types for fitness data
│   └── market-intel/             # Read-only Polymarket market-intelligence package
├── tools/
│   ├── market-intel/             # bridge script that materializes Polymarket artifacts for Python alerts
│   └── stock-discovery/         # stock discovery helper scripts
└── docs/                        # runbooks + architecture notes
```

Note: there is currently **no top-level `services/` or `scripts/` directory** in this repo; service entrypoints live under app folders and feature folders above.
Provider implementations for Whoop, Tonal, and Alpaca now live under `apps/external-service/src/`.

Backtester/Polymarket operator surfaces now include:
- `cd /Users/hd/Developer/cortana-external/backtester && uv run python advisor.py --quick-check NVDA`
- `cd /Users/hd/Developer/cortana-external/backtester && uv run python advisor.py --quick-check BTC`
- `cd /Users/hd/Developer/cortana-external/backtester && uv run python experimental_alpha.py --symbols NVDA,BTC,COIN`
- `cd /Users/hd/Developer/cortana-external/backtester && uv run python experimental_alpha.py --persist`
- `cd /Users/hd/Developer/cortana-external/backtester && uv run python experimental_alpha.py --settle`
- `cd /Users/hd/Developer/cortana-external/backtester && uv run python experimental_alpha.py --calibrate --minimum-samples 20`
- `cd /Users/hd/Developer/cortana-external/backtester && uv run python nightly_discovery.py --limit 20`
- `./tools/market-intel/run_market_intel.sh`

Research-only surface:
- `backtester/experimental_alpha.py` is a paper-only Polymarket alpha report built on top of `quick_check`
- it now supports snapshot persistence, forward-settlement, calibration, and promotion-gate reporting for research validation
- it is not wired into cron, alerts, or execution
- promotion into a permanent production role is only allowed after the calibration gate clears on settled forward samples, and even then it should first land as a bounded annotation or small modifier inside the existing Python regime/technical engine

Backtester universe tiers now separate:
- fast operator review (`quick`)
- standard daytime scanning (`standard`)
- broader overnight discovery (`nightly_discovery`)

Plain-English backtester model:
- Python backtester = main decision engine
- TypeScript Polymarket layer = macro/event context only
- daytime alerts = compact operator view
- nightly discovery = broader overnight scan
- experimental alpha = research only, not live trade authority

---

## 3) Service/app catalog

## A) External fitness + trading API service (`@cortana/external-service`)

### What it does
Single HTTP service for:
- Whoop auth + data
- Tonal health/data
- Schwab auth + market-data + streamer-backed live tape
- Polymarket market-intel and pinned-market surfaces
- Alpaca account/positions/portfolio/trade tracking

### Entry points
- `apps/external-service/src/index.ts`
- `apps/external-service/src/app.ts`
- `launchd-run.sh` (launchd-safe runner, enforces `PORT=3033` default and runs `pnpm --filter @cortana/external-service start`)

### Bind/port
- `127.0.0.1:${PORT}`
- Default: `127.0.0.1:3033`

### API surface
- Aggregate health: `/health`
- Whoop: `/auth/url`, `/auth/callback`, `/auth/status`, `/whoop/health`, `/whoop/data`, `/whoop/recovery`, `/whoop/recovery/latest`
- Schwab + market-data: `/auth/schwab/url`, `/auth/schwab/callback`, `/auth/schwab/status`, `/auth/schwab/streamer/url`, `/auth/schwab/streamer/status`, `/market-data/ready`, `/market-data/ops`, `/market-data/history/:symbol`, `/market-data/history/batch`, `/market-data/quote/:symbol`, `/market-data/quote/batch`, `/market-data/snapshot/:symbol`, `/market-data/fundamentals/:symbol`, `/market-data/metadata/:symbol`, `/market-data/universe/base`, `/market-data/universe/audit`, `/market-data/universe/refresh`, `/market-data/risk/history`, `/market-data/risk/snapshot`
- Polymarket: `/polymarket/health`, `/polymarket/balances`, `/polymarket/positions`, `/polymarket/orders`, `/polymarket/focus`, `/polymarket/live`, `/polymarket/board/live`, `/polymarket/results`, `/polymarket/pins`
- Tonal: `/tonal/health`, `/tonal/data`
- Alpaca: `/alpaca/health`, `/alpaca/account`, `/alpaca/positions`, `/alpaca/portfolio`, `/alpaca/earnings`, `/alpaca/quote/:symbol`, `/alpaca/snapshot/:symbol`, `/alpaca/bars/:symbol`, `/alpaca/trades` (GET/POST), `/alpaca/trades/:id` (PUT), `/alpaca/stats`, `/alpaca/performance`

### Earnings endpoint (new)
- `GET /alpaca/earnings?symbol=NVDA` returns upcoming/recent earnings context.
- Primary source: Alpaca news/events integration.
- Fallback source: Yahoo Finance earnings data when Alpaca coverage is missing.

### Alpaca trade execution + analytics (new)
- `POST /alpaca/trades` now **places a real Alpaca order** (`/v2/orders`) and then logs the trade thesis + metadata to Postgres (`cortana_trades`).
- `GET /alpaca/performance` returns strategy performance summary (win rate, avg return, best/worst trade), signal-source breakdown, and current open positions.

`cortana_trades` table (auto-created if missing):
- `id`, `timestamp`, `symbol`, `side`, `qty`, `notional`, `entry_price`, `target_price`, `stop_loss`
- `thesis`, `signal_source`, `status`, `exit_price`, `exit_timestamp`, `pnl`, `pnl_pct`, `outcome`, `metadata (jsonb)`

### Run locally
```bash
cd ~/Developer/cortana-external
pnpm --filter @cortana/external-service start
```

### Common operator commands
```bash
# launchd-managed runtime
launchctl kickstart -k gui/$(id -u)/com.cortana.fitness-service

# local dev
cd ~/Developer/cortana-external
pnpm --filter @cortana/external-service dev

# tests
cd ~/Developer/cortana-external
pnpm --filter @cortana/external-service test
pnpm --filter @cortana/external-service typecheck
```

### Dependencies
- Node.js + pnpm workspace tooling
- `.env` values (Whoop/Tonal creds)
- Local token/key files (`whoop_tokens.json`, `tonal_tokens.json`, `alpaca_keys.json`)

### Runtime files + logs
- Tokens/data live at repo root by default:
  - `whoop_tokens.json`
  - `whoop_data.json`
  - `tonal_tokens.json`
  - `tonal_data.json`
  - `alpaca_keys.json`
- `launchd-run.sh` loads the repo-root `.env`, defaults `PORT=3033`, and sets `ALPACA_KEYS_PATH` to the repo-local key file for launchd runs.
- Launchd logs:
  - `/tmp/fitness-service.log`
  - `/tmp/fitness-service-error.log`

### Health semantics
- `/health` returns:
  - `ok` when Whoop, Tonal, and Alpaca are all healthy
  - `degraded` when at least one provider is healthy and at least one is unhealthy
  - `unhealthy` with HTTP `503` only when all providers are unhealthy
- `/whoop/health` and `/tonal/health` are strict provider auth/readiness signals.
- stale cached Whoop data may still be served from `/whoop/data`, but that never counts as healthy auth.
- provider auth failures also write `~/.cortana/auth-alerts/<provider>.json`, which is consumed by health responses and operator surfaces.

### Whoop behavior notes
- OAuth redirect defaults to `http://localhost:3033/auth/callback`.
- Token refresh is automatic.
- Concurrent refreshes are deduplicated to avoid parallel refresh storms.
- On refresh failure, stale cached Whoop data may be served with `Warning: 110` if a prior cache is available.

### Tonal auth self-heal (new)
- Tonal auth now auto-recovers from `401/403` by resetting stale tokens and re-authing.
- No manual token surgery needed during routine expiry/failure cycles.

### Architectural direction
- This service is now the single local runtime edge for provider integrations.
- The immediate providers are Whoop, Tonal, and Alpaca, but the shape is intended to make future providers easier to add without changing downstream consumers that rely on `localhost:3033`.

---

## B) Mission Control (`apps/mission-control`)

### What it does
Next.js dashboard for agent/runs/events visibility and lifecycle telemetry.

### Stack
- Next.js 16 + React 19 + TypeScript
- Prisma + PostgreSQL
- Tailwind/shadcn UI

### Run
```bash
cd ~/Developer/cortana-external/apps/mission-control
pnpm install
# create .env.local with at least DATABASE_URL=...
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Use `pnpm dev` or `pnpm start` only for a foreground/manual run.
For the local launchd-managed app that the watchdog and Trading Ops smoke checks expect, use `./apps/mission-control/scripts/restart-mission-control.sh`.

### Port/access
- Local: `http://127.0.0.1:3000`
- Tailscale: access via host tailnet IP (example observed in dev logs: `100.120.198.12:3000`)
- To verify current tailnet IP:
```bash
tailscale ip -4
```

### Deploy / refresh checklist after UI merges (Mission Control)
Use this whenever a PR touching `apps/mission-control` is merged and the UI still looks stale.

Quick path:
```bash
./apps/mission-control/scripts/restart-mission-control.sh
```

That restart script rewrites the LaunchAgent to a direct `next start` entrypoint before every relaunch, then uses `launchctl kickstart -k` on the updated agent. That prevents `pnpm start` wrapper leaks from leaving stale Prisma pools behind.

Skip the rebuild when you only want to bounce the already-built app:
```bash
./apps/mission-control/scripts/restart-mission-control.sh --skip-build
```

1. **Update code to latest main**
```bash
cd ~/Developer/cortana-external
git fetch --all --prune
git checkout main
git pull --ff-only origin main
```

2. **Stop old Mission Control processes (including orphans)**
```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.cortana.mission-control.plist 2>/dev/null || true
launchctl remove com.cortana.mission-control 2>/dev/null || true
/usr/sbin/lsof -tiTCP:3000 -sTCP:LISTEN | xargs -r kill
pkill -f 'cortana-external/apps/mission-control' || true
pkill -f 'next-server' || true
```

3. **Rebuild app**
```bash
cd ~/Developer/cortana-external/apps/mission-control
pnpm build
```

4. **Start service cleanly via launchd**
```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.cortana.mission-control.plist 2>/dev/null || true
launchctl kickstart -k gui/$(id -u)/com.cortana.mission-control
```

5. **Verify health**
```bash
curl -sS http://127.0.0.1:3000/api/heartbeat-status
```
Expected: JSON with `ok: true` and current heartbeat status.

6. **Browser refresh**
- Hard refresh (`Cmd+Shift+R`) after restart.

> Note: Tailscale Serve usually is **not** the root cause for stale UI data. It proxies whatever local app process on `127.0.0.1:3000` is currently serving.

### What it shows
- Dashboard (`/`): system metrics + recent activity
- Trading Ops (`/trading-ops`): latest-run truth, live tape, streamer/runtime health, watchlists, and Polymarket overlay
- Council (`/council`): deliberation sessions, weighted votes, and decision rationale timeline
- Mjolnir (`/mjolnir`): recovery dashboard with Whoop recovery/sleep/strain, workout cards, 14-day trend bars, threshold alerts + alert history

Trading Ops operator facts:
- latest run truth is DB-backed from `mc_trading_runs` when available
- explicit file fallback is surfaced instead of pretending the card is current
- live data comes from `/api/trading-ops/live` and `/api/trading-ops/live/stream`
- live tape and watchlists read through the external service boundary, not directly from the browser

### Council deliberation system (new)
- Mission Control includes a multi-member Council workflow for important decisions.
- Entry point: `apps/mission-control/lib/council-jobs.ts` (`runCouncilDeliberationFanout`).
- Deliberation now uses **direct OpenAI API `gpt-4o` reasoning calls** per pending member (parallel fanout), not synthetic votes or gateway-routed voting.

Council members and weights:
- **Oracle** (strategist) — `1.5`
- **Researcher** (analyst) — `1.2`
- **Huragok** (engineer) — `1.0`
- **Monitor** (operations) — `0.8`

Deliberation flow:
1. For each pending member, Mission Control dispatches a role-specific `gpt-4o` prompt with topic + objective.
2. Each member returns structured output: analysis, vote (`approve|reject|abstain|amend`), confidence (`0.0-1.0`), and detailed reasoning.
3. Votes are persisted via `submitVote()` and written to the council timeline via `appendCouncilMessage()`.
4. After all votes are in, a synthesizer `gpt-4o` call weighs member positions by role weight and generates final rationale.
5. Session is finalized via `finalizeDecision()` with weighted tallies, confidence, and synthesis rationale.

Resilience behavior:
- Fanout runs concurrently with `Promise.all` for speed.
- If one member call fails, that failure is logged to the message trail and other members continue.
- Final synthesis runs only once all members have recorded a vote.

### Governance and durable follow-up
Mission Control keeps only the current control-plane surfaces:

- Council: `mc_council_sessions`, `mc_council_members`, `mc_council_messages`
- Human-required actions: read-only runtime queue display
- Durable operational follow-up: GitHub Issues in either `cortana-external` or `cortana`, depending on ownership

The old Task Board, approvals inbox, feedback inbox, decision trace, and autonomy read-model pages were removed. Persistent runtime problems should become high-signal GitHub Issues instead of local Mission Control rows.

- Agents (`/agents`)
- Jobs/runs (`/jobs`)
- Cron Health dashboard via `/api/cron-health` (live OpenClaw-first state, smart fire status, sorted by last fire time)
- Live infra status badges (Postgres + Vector DB) on dashboard cards
- Live updates via SSE (`/api/live`)
- OpenClaw subagent lifecycle ingestion (`/api/openclaw/subagent-events`)

### Cron Health dashboard behavior (new)
- Prefers real-time OpenClaw state over stale DB snapshots.
- Collapsible sections default to: failed expanded, healthy collapsed.
- Fire status is humanized (`fired 5m ago` vs `next 8:03 AM`).
- Rows are sorted by latest fire time for fastest triage.

---

## C) Backtester (`backtester/`)

### What it does
Python CANSLIM advisor/backtesting engine with Telegram-ready alert output.

### Uncertainty-aware confidence runtime (new)
- The backtester now ranks live candidates by final runtime action first, then by uncertainty-aware confidence quality, instead of letting a high raw score outrank a cleaner buyable setup.
- In plain English: a `BUY` with solid evidence now surfaces ahead of a higher-score `WATCH` that is abstaining because the inputs are stale, degraded, or conflicted.
- Phase 2 adds a bounded downside proxy (63-day drawdown + worst-loss blend) and clearer churn proxies so sketchier left-tail / flip-prone setups get smaller size and worse runtime ranking without weakening any veto gates.
- Doc: [`backtester/knowledge/reference/uncertainty-confidence-runtime-wiring.md`](backtester/knowledge/reference/uncertainty-confidence-runtime-wiring.md)

### Start here
- Operator workflow + output guide: [`backtester/README.md`](backtester/README.md)
- Runtime wiring note: [`backtester/knowledge/reference/uncertainty-confidence-runtime-wiring.md`](backtester/knowledge/reference/uncertainty-confidence-runtime-wiring.md)
- Calibration reference: [`backtester/knowledge/reference/scoring-calibration.md`](backtester/knowledge/reference/scoring-calibration.md)

### Core files
- `advisor.py` (market/symbol analysis)
- `canslim_alert.py` (signal summary)
- `main.py`, `backtest.py`, `strategies/canslim.py`
- `data/fetcher.py`, `data/fundamentals.py`, `data/market_regime.py`

### Run
```bash
cd ~/Developer/cortana-external/backtester
uv sync --group dev
uv run python advisor.py --market
uv run python advisor.py --symbol NVDA
uv run python canslim_alert.py --limit 8 --min-score 6
uv run python main.py --symbol AAPL --years 2 --compare
```

### Dependencies
- `backtester/pyproject.toml` (Python project definition)
- `backtester/uv.lock` (Python lockfile)
- Alpaca credentials via `alpaca_keys.json`

---

## D) Watchdog (`watchdog/`)

### What it does
Local reliability monitor (every 15 min) for service/cron/agent health.

### LaunchAgent
- Label: `com.cortana.watchdog`
- Versioned plist: `watchdog/com.cortana.watchdog.plist`
- Installed runtime plist: `~/Library/LaunchAgents/com.cortana.watchdog.plist`
- Script: `watchdog/watchdog.sh`

### What it monitors
- OpenClaw cron quarantine markers
- Cron consecutive failures
- Heartbeat process health/drift/restarts
- Degraded Mission Control agents
- **Sub-agent watchdog events** from `~/clawd/tools/subagent-watchdog/` (failed/aborted/timed-out sub-agent runs persisted to `cortana_events`)
- gog/Gmail availability
- Schwab market-data lane (`/market-data/ready`, `/market-data/ops`, `SPY,QQQ` quote smoke test, sustained cooldown advisories)
- Pre-open readiness artifact (`backtester/var/readiness/pre-open-canary-latest.json`) for trade-lane-level open readiness
- Tonal/Whoop health
- PostgreSQL health
- API budget thresholds

### Manage
```bash
launchctl load ~/Library/LaunchAgents/com.cortana.watchdog.plist
launchctl unload ~/Library/LaunchAgents/com.cortana.watchdog.plist
launchctl list | grep cortana.watchdog
```

---

## 4) LaunchAgent configs in use

Observed on host (`~/Library/LaunchAgents`):
- `com.cortana.watchdog.plist`
- `com.cortana.fitness-service.plist`

### Fitness LaunchAgent details
- Label: `com.cortana.fitness-service`
- Program: `/bin/bash /Users/hd/fitness-service-launch.sh`
- Wrapper script delegates to repo `launchd-run.sh`
- Working directory: `/Users/hd/Developer/cortana-external`
- KeepAlive + RunAtLoad enabled

Restart command:
```bash
launchctl kickstart -k gui/$(id -u)/com.cortana.fitness-service
```

---

## 5) Deployment / restart operations

## Fitness API service
```bash
# Preferred (launchd-managed)
launchctl kickstart -k gui/$(id -u)/com.cortana.fitness-service

# Quick health check
curl -s http://127.0.0.1:3033/tonal/health
```

## Mission Control
```bash
# preferred local production-style restart
./apps/mission-control/scripts/restart-mission-control.sh

# foreground local dev only
cd apps/mission-control
pnpm dev
```

## Watchdog
```bash
launchctl kickstart -k gui/$(id -u)/com.cortana.watchdog
tail -n 50 watchdog/logs/watchdog.log
```

## Backtester (on-demand)
```bash
cd backtester
uv sync --group dev
uv run python canslim_alert.py --limit 8 --min-score 6
```

---

## 6) Environment variables and local secrets

## Root `.env` (external service)
- `WHOOP_CLIENT_ID`
- `WHOOP_CLIENT_SECRET`
- `WHOOP_REDIRECT_URL`
- `TONAL_EMAIL`
- `TONAL_PASSWORD`
- `SCHWAB_CLIENT_ID`
- `SCHWAB_CLIENT_SECRET`
- `SCHWAB_REDIRECT_URL`
- `SCHWAB_CLIENT_STREAMER_ID`
- `SCHWAB_CLIENT_STREAMER_SECRET`
- `PORT` (optional; defaults to `3033`)

## Mission Control `.env.local`
- `DATABASE_URL` (typically `mission_control` DB)
- `CORTANA_DATABASE_URL` (typically `cortana` DB)
- optional path overrides if local repos live somewhere else:
  - `CORTANA_SOURCE_REPO`
  - `DOCS_PATH`
  - `AGENT_MODELS_PATH`
  - `HEARTBEAT_STATE_PATH`
  - `TELEGRAM_USAGE_HANDLER_PATH`

## Local file-based credentials/tokens
- `whoop_tokens.json`
- `tonal_tokens.json`
- `tonal_data.json`
- `alpaca_keys.json`
- `alpaca_trades.json` (generated at runtime)

---

## 7) Quick health checks

```bash
# External service
curl -s http://127.0.0.1:3033/tonal/health
curl -s http://127.0.0.1:3033/alpaca/health
curl -s http://127.0.0.1:3033/market-data/ready
curl -s http://127.0.0.1:3033/market-data/ops

# Mission Control
curl -s http://127.0.0.1:3000/api/dashboard | head
curl -s http://127.0.0.1:3000/api/heartbeat-status
curl -s http://127.0.0.1:3000/api/trading-ops/live | head

# Watchdog
tail -n 30 ~/Developer/cortana-external/watchdog/logs/watchdog.log

# LaunchAgents
launchctl list | grep -E "cortana.watchdog|cortana.fitness-service"
```

---

## 8) Recent additions (high impact)

- **Mjolnir dashboard** in Mission Control (`/mjolnir`) — full recovery/sleep/strain/workout dashboard with threshold alerting
- **Typed fitness packages** (`packages/fitness-client`, `packages/fitness-types`) for type-safe fitness service consumption
- **TypeScript external runtime** (`apps/external-service`) replacing Go startup on `3033` while preserving API parity
- **Whoop OAuth fix** — redirect_uri consistency (http vs https) resolved for token exchange + refresh
- **Cron Health Dashboard** in Mission Control (`/api/cron-health`) with real-time OpenClaw-first state, smart fire timestamps, and triage-friendly collapse defaults
- **Vitest unit tests** for Mission Control lib functions and API helpers
- **TypeScript unit tests** for external service routes/health logic
- **Earnings endpoint**: `GET /alpaca/earnings` with Alpaca news-only signal path
- **Tonal self-heal**: auth token auto-reset/re-auth on `401/403`
- **Live status badges** for Postgres + Vector DB on dashboard
- **Run reconciliation** upgrades: normalized lifecycle statuses and stale-run handling
- **UI polish**: mobile agents table fixes, decision timeline overflow fix, cleaner agent directory cards, theme-aware cron health styling
- Watchdog heartbeat classifier improvements and richer health checks
- Continued CANSLIM alerting integration with scheduled OpenClaw jobs
- Stock discovery helper tooling (`tools/stock-discovery/trend_sweep.sh`)

---

## 9) Maintenance rules for this README

Update whenever any of these change:
- Endpoint surface in `apps/external-service/src/app.ts` and route modules
- Service ports/bind model
- LaunchAgent scripts/plists
- Mission Control routes/runtime model
- Backtester entrypoints/dependencies
- New top-level services/apps/tools

Last refreshed: **2026-03-18** (runtime docs updated for TypeScript external-service migration)
