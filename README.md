# Cortana External Services & Mission Control

This repo has two pieces:
- **Fitness/Trading API (Go)** — serves Whoop, Tonal, and Alpaca data on `http://localhost:8080`.
- **Mission Control (Next.js dashboard)** — lives in `apps/mission-control`, uses PostgreSQL + Prisma, and surfaces agents/runs/events plus the task board.

---

## Mission Control (apps/mission-control)
- Path: `apps/mission-control`
- Stack: Next.js (App Router, TypeScript), shadcn/ui (Tailwind v4), PostgreSQL + Prisma
- Package manager: **pnpm-first** (see scripts below)
- Docs: `docs/mission-control.md`

### Setup
```bash
cd apps/mission-control
pnpm install
cp .env.example .env.local
# set DATABASE_URL to your Postgres instance (e.g., postgres://localhost:5432/mission_control)
```

### Database
```bash
pnpm db:migrate   # apply migrations locally (creates cortana_* tables if missing)
pnpm db:seed      # load starter agents/runs/events/task-board data
pnpm db:deploy    # deploy migrations in prod
pnpm db:generate  # regenerate Prisma client
```

### Run / Build / Lint
```bash
pnpm dev     # http://localhost:3000
pnpm build
pnpm start   # after build
pnpm lint
```

### Task Board integration
- Page: `/task-board` (cards: Ready now, Blocked, Due soon/Overdue, By pillar, Recent outcomes)
- Reads Postgres tables `cortana_tasks` and `cortana_epics` if they exist; otherwise migrations create compatible tables.
- `Ready now` = `status = 'pending'` + `auto_executable = true` + dependencies done. Pillars read from `metadata -> 'pillar'` (Time, Health, Wealth, Career; defaults to Unspecified).

### Troubleshooting — Radix import mismatch
If Next.js/Turbopack errors like `Cannot find module "radix-ui"` or references to `ProgressPrimitive` from `radix-ui`:
1) Ensure imports use scoped packages (e.g., `@radix-ui/react-progress`, `@radix-ui/react-slot`, `@radix-ui/react-label`, `@radix-ui/react-tabs`, `@radix-ui/react-select`).
2) Remove any lingering `radix-ui` imports; re-run `pnpm install`.
3) Clear stale builds: `rm -rf .next` then `pnpm dev`.

---

## Fitness/Trading API (Go)
- Entry: `main.go`; run with `bash run.sh` (listens on `:8080`).
- Key endpoints (no auth headers needed):
  - `/whoop/data` — sleep, recovery, strain, HRV (Whoop OAuth handled locally)
  - `/tonal/data` — workouts + strength scores (Tonal credentials from `.env`)
  - `/alpaca/portfolio`, `/alpaca/stats`, `/alpaca/positions`, `/alpaca/trades` — portfolio + trade tracking
- Launchd: optional plist `~/Library/LaunchAgents/com.cortana.fitness-service.plist` (uses `~/fitness-service-launch.sh`) for auto-restart; logs to `/tmp/fitness-service.log`.

---

## Architecture sketch
```
/Users/hd/Developer/cortana-external
├── main.go, run.sh              # Go service exposing Whoop/Tonal/Alpaca on :8080
├── apps/mission-control         # Next.js dashboard + API routes (Postgres + Prisma)
│   ├── app/                     # Pages: /, /agents, /jobs, /task-board
│   ├── prisma/                  # schema + migrations + seed
│   ├── package.json             # pnpm scripts (dev/build/lint/db:*)
│   └── docs/mission-control.md  # deeper architecture notes
└── watchdog/                    # launchd helper/logs
```
