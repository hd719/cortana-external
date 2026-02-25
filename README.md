# cortana-external (`~/Developer/cortana-external`)

External runtime/services layer for Cortana.

If `~/clawd` is the brain/policy workspace, this repo is the **service edge**: HTTP APIs, watchdog reliability monitor, trading/backtesting tools, and Mission Control UI.

---

## 1) What lives here

- Go HTTP service (Whoop + Tonal + Alpaca endpoints) on localhost
- Mission Control web app (Next.js + Prisma)
- Python CANSLIM backtester/advisor
- Watchdog launchd monitor (`com.cortana.watchdog`)
- service docs/runbooks

---

## 2) Top-level layout

```text
~/Developer/cortana-external
├── README.md
├── main.go / run.sh / launchd-run.sh      # Go service entrypoints
├── go.mod / go.sum                         # Go module dependencies
├── .env                                    # runtime secrets (local only)
│
├── whoop/                                  # Whoop OAuth + data handlers
├── tonal/                                  # Tonal auth/data handlers + cache logic
├── alpaca/                                 # Alpaca service handlers
├── fitness-services/                       # Legacy/support service assets
│
├── apps/
│   └── mission-control/                    # Next.js ops dashboard
│
├── backtester/                             # Python CANSLIM engine
├── watchdog/                               # reliability monitor + launchd plist
├── docs/                                   # runbooks/notes
├── TONAL_SERVICE.md / WHOOP_SERVICE.md     # service-specific docs
└── alpaca_keys.json, *_tokens.json, tonal_data.json
```

---

## 3) Go API service (Whoop/Tonal/Alpaca)

### Runtime
- Entrypoint: `main.go`
- Framework: `gin`
- Bind: `127.0.0.1:${PORT}`
- Default port: `3033`
- Start command: `bash run.sh`

### Endpoints

#### Whoop
- `GET /auth/url`
- `GET /auth/callback`
- `GET /whoop/data`

#### Tonal
- `GET /tonal/health`
- `GET /tonal/data`

#### Alpaca
- `GET /alpaca/health`
- `GET /alpaca/account`
- `GET /alpaca/positions`
- `GET /alpaca/portfolio`
- `GET /alpaca/trades`
- `POST /alpaca/trades`
- `PUT /alpaca/trades/:id`
- `GET /alpaca/stats`

### Required env/config
From `.env` / local files:
- `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, `WHOOP_REDIRECT_URL`
- `TONAL_EMAIL`, `TONAL_PASSWORD`
- `PORT` (optional; defaults to `3033`)

Token/data files used at repo root:
- `whoop_tokens.json`
- `tonal_tokens.json`
- `tonal_data.json`
- `alpaca_keys.json`
- `alpaca_trades.json` (created at runtime when tracking trades)

### Current state notes
- Service binds to loopback only (`127.0.0.1`) by design
- Tonal client warns if env credentials are missing
- Tonal request pacing set to `500ms` delay between upstream calls

---

## 4) Mission Control app (`apps/mission-control`)

Next.js operations dashboard for agents/runs/events/task board/decision traces.

### Stack
- Next.js 16 + React 19
- TypeScript
- Prisma + PostgreSQL
- shadcn/ui + Tailwind v4
- package manager: pnpm

### Local run
```bash
cd apps/mission-control
pnpm install
cp .env.example .env.local
pnpm db:migrate
pnpm db:seed
pnpm dev
# http://localhost:3000
```

### Key pages/features
- `/` dashboard
- `/task-board` (reads `cortana_tasks` + `cortana_epics`)
- `/jobs`, `/agents`
- `/decisions` (decision traces)
- `/api/live` SSE refresh
- OpenClaw subagent lifecycle ingestion endpoint

### Mission Control updates (2026-02-25)
- **PR #32:** Agent labels now render on the Mission Control runs/jobs page for clearer operator attribution.
- **PR #33:** Mission Control dashboard responsiveness improved for mobile layouts.
- **PR #34:** Removed the system mood widget from the dashboard to simplify the primary view.

---

## 5) Backtester (`backtester/`)

Python CANSLIM advisor + backtesting engine.

### Typical usage
```bash
cd backtester
source venv/bin/activate
python advisor.py --market
python advisor.py --symbol NVDA
python canslim_alert.py --limit 8 --min-score 6
python main.py --symbol AAPL --years 2 --compare
```

### Dependencies
- Python venv in `backtester/venv`
- packages from `requirements.txt` (`pandas`, `numpy`, `yfinance`, `requests`, etc.)

---

## 6) Watchdog service (`watchdog/`)

Reliability monitor for cron/runtime health.

### launchd config (versioned in repo)
- plist: `watchdog/com.cortana.watchdog.plist`
- label: `com.cortana.watchdog`
- interval: `900s` (15 min)
- script: `/Users/hd/Developer/cortana-external/watchdog/watchdog.sh`
- logs: `watchdog/logs/watchdog.log`
- `RunAtLoad: true`

### What it checks
- OpenClaw cron quarantine markers
- repeated cron failures
- heartbeat process health and drift
- degraded mission-control agents
- gog/Gmail availability
- Tonal and Whoop health
- PostgreSQL availability
- budget threshold warnings

### Manage
```bash
launchctl load ~/Library/LaunchAgents/com.cortana.watchdog.plist
launchctl unload ~/Library/LaunchAgents/com.cortana.watchdog.plist
launchctl list | grep cortana.watchdog
```

---

## 7) launchd vs systemd

### launchd (macOS)
- **Versioned here:** watchdog plist (`watchdog/com.cortana.watchdog.plist`)
- **Referenced by docs, typically installed under `~/Library/LaunchAgents`:** fitness service launcher using `launchd-run.sh`

### systemd
- No systemd unit files currently tracked in this repo.
- If deploying to Linux later, create `docs/runbooks/` + `systemd/` unit templates (not present yet).

---

## 8) Ports and local dependencies

| Component | Default | Notes |
|---|---:|---|
| Go fitness/trading API | `127.0.0.1:3033` | Whoop/Tonal/Alpaca endpoints |
| Mission Control | `127.0.0.1:3000` | Next.js dev/prod app |
| Postgres | local service | used by mission-control and Cortana DB integrations |

External dependencies:
- Whoop OAuth/API
- Tonal API
- Alpaca API
- Yahoo Finance (via backtester)
- local Postgres

---

## 9) Quick health checks

```bash
# core API
curl -s http://127.0.0.1:3033/tonal/health
curl -s http://127.0.0.1:3033/whoop/data | head
curl -s http://127.0.0.1:3033/alpaca/health

# mission control
curl -s http://127.0.0.1:3000/api/dashboard | head

# watchdog
tail -n 50 watchdog/logs/watchdog.log
```

---

## 10) Historical context (still relevant)

- This repo started as a fitness-service host (Whoop + Tonal) and expanded to include Alpaca + mission-control + watchdog.
- It remains intentionally local-first (loopback binding, local token/cache files, launchd automation).

---

## 11) Maintenance rules for this README

Update when any of these change:
- endpoint surface in `main.go`
- service bind/port model
- launchd/service supervision config
- mission-control major pages/data model links
- backtester execution path/dependencies

Last refreshed: **2026-02-25**
