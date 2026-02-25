# cortana-external (`~/Developer/cortana-external`)

Runtime edge for Cortana: services, apps, and reliability infrastructure that support the `~/clawd` command brain.

If `~/clawd` is strategy/memory/policy, **cortana-external is execution runtime**.

---

## 1) What this repo contains

- Go service exposing **Whoop + Tonal + Alpaca** APIs (loopback on port `3033`)
- Mission Control dashboard app (`apps/mission-control`, Next.js)
- CANSLIM backtester/advisor (`backtester/`)
- Watchdog reliability service (`watchdog/`, launchd)
- Supporting docs and stock-discovery scripts

---

## 2) Verified directory structure

```text
~/Developer/cortana-external
├── README.md
├── .env
├── main.go
├── run.sh
├── launchd-run.sh
├── go.mod / go.sum
│
├── whoop/                       # Whoop API/auth handlers
├── tonal/                       # Tonal auth/data/health handlers
├── alpaca/                      # Alpaca service handlers
├── backtester/                  # CANSLIM engine + alerts
├── watchdog/                    # launchd reliability monitor
├── apps/
│   └── mission-control/         # Next.js ops dashboard
├── tools/
│   └── stock-discovery/         # stock discovery helper scripts
└── docs/                        # runbooks + architecture notes
```

Note: there is currently **no top-level `services/` or `scripts/` directory** in this repo; service entrypoints are at repo root and in feature folders above.

---

## 3) Service/app catalog

## A) Go fitness + trading API service

### What it does
Single HTTP service for:
- Whoop auth + data
- Tonal health/data
- Alpaca account/positions/portfolio/trade tracking

### Entry points
- `main.go`
- `run.sh` (loads `.env`, then `go run main.go`)
- `launchd-run.sh` (launchd-safe runner, enforces `PORT=3033` default)

### Bind/port
- `127.0.0.1:${PORT}`
- Default: `127.0.0.1:3033`

### API surface (from `main.go`)
- Whoop: `/auth/url`, `/auth/callback`, `/whoop/data`
- Tonal: `/tonal/health`, `/tonal/data`
- Alpaca: `/alpaca/health`, `/alpaca/account`, `/alpaca/positions`, `/alpaca/portfolio`, `/alpaca/trades` (GET/POST/PUT), `/alpaca/stats`, `/alpaca/performance`

### Alpaca trade execution + analytics (new)
- `POST /alpaca/trades` now **places a real Alpaca order** (`/v2/orders`) and then logs the trade thesis + metadata to Postgres (`cortana_trades`).
- `GET /alpaca/performance` returns strategy performance summary (win rate, avg return, best/worst trade), signal-source breakdown, and current open positions.

`cortana_trades` table (auto-created if missing):
- `id`, `timestamp`, `symbol`, `side`, `qty`, `notional`, `entry_price`, `target_price`, `stop_loss`
- `thesis`, `signal_source`, `status`, `exit_price`, `exit_timestamp`, `pnl`, `pnl_pct`, `outcome`, `metadata (jsonb)`

### Run locally
```bash
cd ~/Developer/cortana-external
bash run.sh
```

### Dependencies
- Go toolchain
- `.env` values (Whoop/Tonal creds)
- Local token/key files (`whoop_tokens.json`, `tonal_tokens.json`, `alpaca_keys.json`)

---

## B) Mission Control (`apps/mission-control`)

### What it does
Next.js dashboard for agent/runs/events/task-board visibility and lifecycle telemetry.

### Stack
- Next.js 16 + React 19 + TypeScript
- Prisma + PostgreSQL
- Tailwind/shadcn UI

### Run
```bash
cd ~/Developer/cortana-external/apps/mission-control
pnpm install
cp .env.example .env.local
pnpm db:migrate
pnpm db:seed
pnpm dev
```

### Port/access
- Local: `http://127.0.0.1:3000`
- Tailscale: access via host tailnet IP (example observed in dev logs: `100.120.198.12:3000`)
- To verify current tailnet IP:
```bash
tailscale ip -4
```

### What it shows
- Dashboard (`/`): system metrics + recent activity
- Agents (`/agents`)
- Jobs/runs (`/jobs`)
- Task board (`/task-board`)
- Live updates via SSE (`/api/live`)
- OpenClaw subagent lifecycle ingestion (`/api/openclaw/subagent-events`)

---

## C) Backtester (`backtester/`)

### What it does
Python CANSLIM advisor/backtesting engine with Telegram-ready alert output.

### Core files
- `advisor.py` (market/symbol analysis)
- `canslim_alert.py` (signal summary)
- `main.py`, `backtest.py`, `strategies/canslim.py`
- `data/fetcher.py`, `data/fundamentals.py`, `data/market_regime.py`

### Run
```bash
cd ~/Developer/cortana-external/backtester
source venv/bin/activate
python advisor.py --market
python advisor.py --symbol NVDA
python canslim_alert.py --limit 8 --min-score 6
python main.py --symbol AAPL --years 2 --compare
```

### Dependencies
- Python venv (`backtester/venv`)
- `requirements.txt` (pandas, numpy, yfinance, requests, etc.)
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
- gog/Gmail availability
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
cd apps/mission-control
pnpm build
pnpm start
# or pnpm dev for local dev
```

## Watchdog
```bash
launchctl kickstart -k gui/$(id -u)/com.cortana.watchdog
tail -n 50 watchdog/logs/watchdog.log
```

## Backtester (on-demand)
```bash
cd backtester && source venv/bin/activate
python canslim_alert.py --limit 8 --min-score 6
```

---

## 6) Environment variables and local secrets

## Root `.env` (Go service)
- `WHOOP_CLIENT_ID`
- `WHOOP_CLIENT_SECRET`
- `WHOOP_REDIRECT_URL`
- `TONAL_EMAIL`
- `TONAL_PASSWORD`
- `PORT` (optional; defaults to `3033`)

## Mission Control `.env.local`
- `DATABASE_URL` (typically `mission_control` DB)
- `CORTANA_DATABASE_URL` (typically `cortana` DB)

## Local file-based credentials/tokens
- `whoop_tokens.json`
- `tonal_tokens.json`
- `tonal_data.json`
- `alpaca_keys.json`
- `alpaca_trades.json` (generated at runtime)

---

## 7) Quick health checks

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

## 8) Recent additions (high impact)

- Mission Control reliability upgrades (SSE live updates, lifecycle ingestion, reconciliation paths)
- Post-merge task auto-close workflow (`.github/workflows/post-merge-task-autoclose.yml`)
- Watchdog heartbeat classifier improvements and richer health checks
- Continued CANSLIM alerting integration with scheduled OpenClaw jobs
- Stock discovery helper tooling (`tools/stock-discovery/trend_sweep.sh`)

---

## 9) Maintenance rules for this README

Update whenever any of these change:
- Endpoint surface in `main.go`
- Service ports/bind model
- LaunchAgent scripts/plists
- Mission Control routes/runtime model
- Backtester entrypoints/dependencies
- New top-level services/apps/tools

Last refreshed: **2026-02-25** (filesystem + launchd + code cross-check)