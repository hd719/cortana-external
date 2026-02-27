# cortana-external (`~/Developer/cortana-external`)

This repo is the **operational backend + dashboard** for Cortana.

- Go services for **fitness, trading, and reliability** (loopback on `127.0.0.1`)
- **Mission Control** (Next.js) dashboard for agents, tasks, cron, decisions, council, and feedback
- Backtester, watchdog, and helper tools that plug into the `~/clawd` command brain

If `~/clawd` is strategy/memory/policy, **cortana-external is execution runtime + Mission Control UI**.

---

## 1. What this repo contains (high level)

- **Go fitness + trading API service** (Whoop, Tonal, Alpaca) on `http://127.0.0.1:3033`
- **Mission Control dashboard** (`apps/mission-control`, Next.js 15+)
- **CANSLIM backtester/advisor** (`backtester/`)
- **Watchdog reliability service** (`watchdog/`, launchd)
- Supporting docs and stock-discovery/ops tools

---

## 2. Directory structure

```text
~/Developer/cortana-external
├── README.md
├── main.go                 # Go service entrypoint
├── run.sh                  # Local dev runner for Go service
├── launchd-run.sh          # LaunchAgent-safe runner wrapper
├── go.mod / go.sum
│
├── apps/
│   └── mission-control/    # Next.js Mission Control dashboard
│
├── whoop/                  # Whoop API/auth handlers
├── tonal/                  # Tonal auth/data/health handlers
├── alpaca/                 # Alpaca service handlers
├── backtester/             # CANSLIM engine + alerts
├── watchdog/               # Launchd reliability monitor
├── tools/
│   └── stock-discovery/    # Stock discovery helper scripts
├── docs/                   # Runbooks + architecture notes
│
├── alpaca_keys.json        # Local Alpaca creds (git-ignored)
├── whoop_tokens.json       # Whoop OAuth tokens (git-ignored)
├── whoop_tokens.backup.json
├── tonal_tokens.json       # Tonal auth tokens (git-ignored)
├── tonal_data.json         # Cached Tonal data snapshot
└── .env                    # Root service config (git-ignored)
```

There is currently **no top-level `services/` or `scripts/` directory** – service entrypoints live at repo root and in feature folders above.

---

## 3. Apps & services

### 3.A Go fitness + trading API service

**Purpose:** single HTTP service that exposes local APIs for **Whoop**, **Tonal**, and **Alpaca**, so Cortana can talk to fitness + brokerage systems via loopback.

#### Entry points

- `main.go`
- `run.sh` – loads `.env`, then `go run main.go`
- `launchd-run.sh` – launchd-safe wrapper, enforces `PORT=3033` default

#### Bind/port

- Host: `127.0.0.1`
- Port: `${PORT:-3033}` (defaults to `3033`)

#### API routes (high level)

Exact handlers live under `whoop/`, `tonal/`, and `alpaca/`, but the main surface is:

- **Whoop**
  - `GET /auth/url` – Whoop OAuth URL
  - `GET /auth/callback` – OAuth callback handler
  - `GET /whoop/data` – Whoop sleep/strain/recovery data

- **Tonal**
  - `GET /tonal/health` – health check
  - `GET /tonal/data` – workout history + metrics

- **Alpaca**
  - `GET /alpaca/health` – health check
  - `GET /alpaca/account` – account info
  - `GET /alpaca/positions` – open positions
  - `GET /alpaca/portfolio` – portfolio snapshot (used by market-intel tools)
  - `GET /alpaca/stats` – aggregate account stats
  - `GET /alpaca/performance` – strategy performance summary
  - `GET /alpaca/earnings?symbol=NVDA` – upcoming/recent earnings
  - `GET /alpaca/trades` – trade log
  - `POST /alpaca/trades` – place trade + log thesis/metadata
  - `PUT /alpaca/trades/:id` – update trade metadata/outcomes

**Earnings endpoint:**

- `GET /alpaca/earnings?symbol=NVDA`
  - Primary: Alpaca news/events data
  - Fallback: Yahoo Finance earnings if Alpaca lacks coverage

**Trade execution + analytics:**

- `POST /alpaca/trades` places a **real Alpaca order** (`/v2/orders`) and then logs:
  - symbol, side, qty, notional, entry/target/stop
  - thesis, signal source, outcome, P&L, metadata
- `GET /alpaca/performance` returns win rate, avg return, best/worst trades, signal source breakdown, and open positions

`cortana_trades` table (auto-created if missing):

- `id`, `timestamp`, `symbol`, `side`, `qty`, `notional`
- `entry_price`, `target_price`, `stop_loss`
- `thesis`, `signal_source`, `status`
- `exit_price`, `exit_timestamp`, `pnl`, `pnl_pct`, `outcome`
- `metadata` (JSONB)

**Tonal auth self-heal:**

- Automatically recovers from `401/403` by resetting stale tokens + re-authing
- No manual token surgery needed for routine expiry/failure cycles

#### Run locally

```bash
cd ~/Developer/cortana-external
bash run.sh
```

Dependencies:

- Go toolchain
- `.env` with Whoop/Tonal credentials
- Local token/key files: `whoop_tokens.json`, `tonal_tokens.json`, `alpaca_keys.json`

---

### 3.B Mission Control (`apps/mission-control`)

**Purpose:** Next.js dashboard for **health, tasks, agents, council, decisions, approvals, and feedback** – the UI front-end to the `cortana` + `mission_control` Postgres databases.

#### Stack

- **Next.js 15+** (app router, `app/` directory)
- React + TypeScript
- Tailwind CSS + shadcn/ui
- Prisma (with separate schemas for `mission_control` and `cortana` DBs)

#### Run

```bash
cd ~/Developer/cortana-external/apps/mission-control
pnpm install
cp .env.example .env.local
pnpm db:migrate
pnpm db:seed
pnpm dev
```

- Local dev: `http://127.0.0.1:3000`
- Tailscale: same host via tailnet IP (e.g., `100.x.x.x:3000`)

#### Key pages

Routes are implemented under `app/`:

- `/` or `/dashboard` – **Dashboard**
  - High-level system health, today stats, heartbeat status, autonomy score, activity feed
- `/task-board` – **Task Board**
  - Active + completed tasks, pagination, task state, epic linkage
- `/agents` – **Agents**
  - Covenant/main-agent roster, status, recent runs, capabilities
- `/jobs` – **Jobs & Runs**
  - Cron jobs, autonomous jobs, recent runs, status and durations
- `/runs` – **Runs**
  - Detailed run history and lifecycle state
- `/decisions` – **Decision Traces**
  - Decision timelines, trace spans, autonomy incidents
- `/approvals` – **Approvals**
  - Pending/complete approvals, history of gated actions
- `/feedback` – **Feedback**
  - Feedback items, lessons, application status
- `/council` – **Council** (new)
  - Council deliberation traces, arguments, verdicts, and follow-up tasks
- `/events`, `/activity-feed`, `/heartbeat-status`, `/cron-health`, `/db-status`, `/openclaw`, `/memory-constellation`, `/today-stats`, `/thinking-status` – supporting views for system introspection

#### Mission Control API routes

API endpoints live under `app/api/` and are all **internal** (no public surface). Highlights:

- `/api/dashboard` – dashboard aggregates
- `/api/agents` – agent roster + status
- `/api/jobs` – jobs listing
- `/api/runs` – runs data
- `/api/cron-health` – schedule-aware cron health status
- `/api/live` – **SSE live updates** stream for dashboard widgets
- `/api/activity-feed` – recent notable events
- `/api/autonomy-score` – autonomy scorecard
- `/api/heartbeat-status` – heartbeat status summary
- `/api/db-status` – DB health and connectivity
- `/api/memory-constellation` – memory graph/constellation data
- `/api/openclaw/*` – OpenClaw subagent lifecycle ingestion (`subagent-events`, etc.)
- `/api/github/*` – GitHub integration endpoints
- `/api/today-stats` – today’s activity stats
- `/api/feedback` / `/api/decisions` / `/api/council` – feedback/decision/council-related data

#### Cron Health dashboard behavior

The cron health UI and API (`/api/cron-health`) are **schedule-aware**:

- Reads OpenClaw jobs from `~/.openclaw/cron/jobs.json`
- Computes expected intervals from cron expressions / `everyMs`
- Classifies jobs as `healthy`, `late`, or `failed` based on last-fire time
- Prefers real-time OpenClaw state over stale DB snapshots
- UI defaults:
  - Failed jobs expanded
  - Healthy jobs collapsed
  - Rows sorted by most recent fire time for triage

#### Databases used

Mission Control talks to **two Postgres databases**:

- `mission_control` – app’s own state (agents, jobs, runs, council records, feedback, decisions, UI config)
- `cortana` – core Cortana brain DB (tasks, epics, patterns, events, autonomy, etc.)

Connection strings are configured via `.env.local`:

- `DATABASE_URL` – pointing at `mission_control`
- `CORTANA_DATABASE_URL` – pointing at `cortana`

---

### 3.C Backtester (`backtester/`)

**Purpose:** Python CANSLIM advisor/backtesting engine with Telegram-ready alert output.

#### Core files

- `advisor.py` – market/symbol analysis
- `canslim_alert.py` – signal summary
- `main.py`, `backtest.py`
- `strategies/canslim.py`
- `data/fetcher.py`, `data/fundamentals.py`, `data/market_regime.py`

#### Run

```bash
cd ~/Developer/cortana-external/backtester
source venv/bin/activate
python advisor.py --market
python advisor.py --symbol NVDA
python canslim_alert.py --limit 8 --min-score 6
python main.py --symbol AAPL --years 2 --compare
```

Dependencies:

- Python venv (`backtester/venv`)
- `requirements.txt` (pandas, numpy, yfinance, requests, etc.)
- Alpaca credentials via `alpaca_keys.json`

---

### 3.D Watchdog (`watchdog/`)

**Purpose:** local reliability monitor (every 15 minutes) for service/cron/agent health.

#### LaunchAgent

- Label: `com.cortana.watchdog`
- Versioned plist: `watchdog/com.cortana.watchdog.plist`
- Installed plist: `~/Library/LaunchAgents/com.cortana.watchdog.plist`
- Script: `watchdog/watchdog.sh`

#### What it monitors

- OpenClaw cron quarantine markers
- Cron consecutive failures
- Heartbeat process health/drift/restarts
- Degraded Mission Control agents
- gog/Gmail availability
- Tonal/Whoop health
- PostgreSQL health
- API budget thresholds

#### Manage

```bash
launchctl load ~/Library/LaunchAgents/com.cortana.watchdog.plist
launchctl unload ~/Library/LaunchAgents/com.cortana.watchdog.plist
launchctl list | grep cortana.watchdog
```

---

## 4. LaunchAgents in use

Observed on host (`~/Library/LaunchAgents`):

- `com.cortana.watchdog.plist`
- `com.cortana.fitness-service.plist`

### Fitness LaunchAgent

- Label: `com.cortana.fitness-service`
- Program: `/bin/bash /Users/hd/fitness-service-launch.sh`
- Wrapper script delegates to repo `launchd-run.sh`
- Working directory: `/Users/hd/Developer/cortana-external`
- `KeepAlive` + `RunAtLoad` enabled

Restart:

```bash
launchctl kickstart -k gui/$(id -u)/com.cortana.fitness-service
```

---

## 5. Deployment / restart operations

### Fitness API service

```bash
# Preferred (launchd-managed)
launchctl kickstart -k gui/$(id -u)/com.cortana.fitness-service

# Quick health check
curl -s http://127.0.0.1:3033/tonal/health
```

### Mission Control

```bash
cd apps/mission-control
pnpm build
pnpm start
# or pnpm dev for development
```

### Watchdog

```bash
launchctl kickstart -k gui/$(id -u)/com.cortana.watchdog
tail -n 50 watchdog/logs/watchdog.log
```

### Backtester (on-demand)

```bash
cd backtester && source venv/bin/activate
python canslim_alert.py --limit 8 --min-score 6
```

---

## 6. Environment variables and local secrets

### Root `.env` (Go service)

- `WHOOP_CLIENT_ID`
- `WHOOP_CLIENT_SECRET`
- `WHOOP_REDIRECT_URL`
- `TONAL_EMAIL`
- `TONAL_PASSWORD`
- `PORT` (optional; defaults to `3033`)

### Mission Control `.env.local`

- `DATABASE_URL` – Postgres DSN for `mission_control`
- `CORTANA_DATABASE_URL` – Postgres DSN for `cortana`

### Local creds/tokens (git-ignored)

- `whoop_tokens.json`
- `tonal_tokens.json`
- `tonal_data.json`
- `alpaca_keys.json`
- `alpaca_trades.json` (runtime-generated)

---

## 7. Quick health checks

```bash
# Go service
curl -s http://127.0.0.1:3033/tonal/health
curl -s http://127.0.0.1:3033/alpaca/health

# Mission Control
curl -s http://127.0.0.1:3000/api/dashboard | head

# Watchdog
tail -n 30 ~/Developer/cortana-external/watchdog/logs/watchdog.log

# LaunchAgents
launchctl list | grep -E "cortana.watchdog|cortana.fitness-service"
```

---

## 8. Recent additions (Feb 2026 and nearby)

New or recently upgraded components that matter for operations:

- **Council deliberation system**
  - `/council` UI and supporting APIs for council-style multi-agent deliberations
  - Stores arguments, verdicts, and follow-up tasks in `mission_control` + `cortana`

- **Schedule-aware cron health**
  - `/api/cron-health` now computes expected intervals from cron expressions / `everyMs`
  - Classifies jobs as `healthy` / `late` / `failed` using interval-aware thresholds
  - UI makes late vs failed vs healthy visually obvious

- **Quiet-hours-aware heartbeat visibility**
  - Cron health and heartbeat-status views factor in quiet hours from `~/clawd`
  - Reduces false alarms during planned downtimes

- **SSE live updates**
  - `/api/live` provides an event stream powering live tiles on the dashboard
  - Agents, runs, and cron state update in near real-time without manual refresh

- **Cron delivery monitoring**
  - Better reconciliation between OpenClaw cron definitions and observed fires
  - Tracks missed/late fires and surfaces them in cron health + events feed

- **Vitest unit tests** for Mission Control lib functions and API helpers
- **Go unit tests** for Alpaca service logic/endpoints
- **Task board pagination and UI polish** for completed tasks
- **Run reconciliation upgrades** (normalized lifecycle statuses, stale-run auto-close)
- **UI cleanup** – better mobile layouts, decision timeline fixes, clearer agent directory
- **Stock discovery tooling** (`tools/stock-discovery/trend_sweep.sh`) wired into backtester/alerts

---

## 9. README maintenance rules

Update this README whenever any of the following change:

- Mission Control **pages** (new top-level routes or major behavior changes)
- Mission Control **API routes**
- Go service **endpoint surface**, ports, or auth model
- LaunchAgent scripts/plists or labels
- Backtester entrypoints/dependencies
- New top-level services/apps/tools in this repo

Last refreshed: **2026-02-27** (README + structure/APIs cross-check).
