# Cortana External Services & Mission Control

This repo has two pieces:
- **Fitness/Trading API (Go)** — serves Whoop, Tonal, and Alpaca data on `http://localhost:8080`.
- **Mission Control (Next.js dashboard)** — lives in `apps/mission-control`, uses PostgreSQL + Prisma, and surfaces agents/runs/events plus the task board.

---

## Mission Control (apps/mission-control)
- Path: `apps/mission-control`
- Stack: Next.js (App Router, TypeScript), shadcn/ui (Tailwind v4), PostgreSQL + Prisma
- Package manager: **pnpm-first**
- Docs: `docs/mission-control.md`

### Setup
```bash
cd apps/mission-control
pnpm install
cp .env.example .env.local
# set DATABASE_URL to your Postgres instance
```

### Database
```bash
pnpm db:migrate   # apply migrations locally
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

### Mission Control Operator Quick Actions
```bash
# open app
open http://localhost:3000

# verify DB connectivity
cd apps/mission-control && pnpm db:generate

# run dev with fresh build cache
cd apps/mission-control && rm -rf .next && pnpm dev
```

### Task Board integration
- Page: `/task-board` (Ready now, Blocked, Due soon/Overdue, By pillar, Recent outcomes)
- Reads `cortana_tasks` + `cortana_epics`
- `Ready now` = `status='pending'` + `auto_executable=true` + dependencies done
- Pillars read from `metadata -> 'pillar'` (Time, Health, Wealth, Career; defaults to Unspecified)

### Troubleshooting — Radix import mismatch
If Next.js/Turbopack errors like `Cannot find module "radix-ui"`:
1) Ensure imports use scoped packages (`@radix-ui/react-progress`, etc.)
2) Remove lingering `radix-ui` imports; re-run `pnpm install`
3) Clear stale builds: `rm -rf .next` then `pnpm dev`

---

## Fitness/Trading API (Go)
- Entry: `main.go`; run with `bash run.sh` (listens on `:8080`)
- Key endpoints:
  - `/whoop/data` — sleep, recovery, strain, HRV
  - `/tonal/data` — workouts + strength scores
  - `/alpaca/portfolio`, `/alpaca/stats`, `/alpaca/positions`, `/alpaca/trades`

### Quick Reference

### To Get Whoop Data (sleep, recovery, strain, HRV)
```bash
curl http://localhost:8080/whoop/data
```

### To Get Tonal Data (workouts, strength scores)
```bash
curl http://localhost:8080/tonal/data
```

**No auth headers needed** — service handles auth internally.

### Key Whoop Metrics

| Metric | Location | Interpretation |
|--------|----------|----------------|
| Recovery Score | `recovery[0].score.recovery_score` | 0-33 red, 34-66 yellow, 67-100 green |
| HRV | `recovery[0].score.hrv_rmssd_milli` | Higher is generally better (individual baseline matters) |
| Resting HR | `recovery[0].score.resting_heart_rate` | Lower is generally better fitness/recovery |
| Strain | `cycles[0].score.strain` | 0-21 scale: light → all out |
| Sleep Performance | `sleep[0].score.sleep_performance_percentage` | % of sleep need achieved |

### Key Tonal Metrics

| Metric | Location | Interpretation |
|--------|----------|----------------|
| Overall Strength | `strength_scores.current` (FULL_BODY) | Tonal strength measure, higher = stronger |
| Total Volume | `profile.totalVolume` / workout totals | Total lbs lifted |
| Workout Count | `workout_count` | Total cached workouts |
| Last Workout | max `beginTime` in `workouts` | Most recent training session |

### Tonal Data Notes
- `workouts` is a map keyed by workout ID (not array)
- `workout_count` grows as cache fills
- Strength scores update after relevant workouts

### Error Handling

| Status | Meaning | Action |
|--------|---------|--------|
| 200 | Success | Parse and use data |
| 401 | Auth failed | Whoop: re-auth via `/auth/url`; Tonal: verify `.env` creds |
| 502 | Upstream error | Retry later |

### Example Python Code

```python
import requests

whoop = requests.get("http://localhost:8080/whoop/data").json()
recovery = whoop["recovery"][0]["score"]["recovery_score"]

tonal = requests.get("http://localhost:8080/tonal/data").json()
print("Recovery:", recovery)
print("Workouts cached:", tonal.get("workout_count"))
```

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
