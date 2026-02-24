# Mission Control

Next.js + PostgreSQL dashboard for Cortana agents. Provides a unified view of agents, runs/jobs, and alerts/events with shadcn/ui components.

## Stack
- Next.js (App Router, TypeScript)
- shadcn/ui + Tailwind v4
- PostgreSQL + Prisma

## Setup
1) Install deps
```bash
cd apps/mission-control
pnpm install
```
2) Configure the database
```bash
cp .env.example .env.local
# Update DATABASE_URL for your Postgres instance
# e.g., createdb mission_control
```
3) Apply schema + seed data (creates agents Huragok, Oracle, Researcher, Librarian, Monitor)
```bash
pnpm db:migrate
pnpm db:seed
```
4) Run the app
```bash
pnpm dev
# open http://localhost:3000
```

## Scripts
- `pnpm dev` — start Next.js dev server
- `pnpm build` / `pnpm start` — production build & start
- `pnpm lint` — lint
- `pnpm db:migrate` — apply Prisma migrations
- `pnpm db:deploy` — deploy migrations in production
- `pnpm db:seed` — load starter agents/runs/events
- `pnpm db:generate` — regenerate Prisma client
- `pnpm task-autoclose:post-merge` — close mapped `cortana_tasks` for a merged PR and enforce verification gate
- `pnpm test:task-autoclose` — regression test for PR→task mapping

## Data model (Prisma)
- `Agent`: id, name, role, description, capabilities, status (active/idle/degraded/offline), healthScore, lastSeen, timestamps.
- `Run`: id, agentId (nullable FK), jobType, status (queued/running/completed/failed/cancelled), summary, payload/result JSON, startedAt/completedAt, timestamps.
- `Event`: id, agentId (nullable FK), runId (nullable FK), type, severity (info/warning/critical), message, metadata JSON, createdAt, acknowledged.

## API routes
- `GET /api/dashboard` — aggregated metrics + recent rows
- `GET /api/agents` — agent roster
- `GET /api/runs` — recent runs/jobs
- `GET /api/events` — latest alerts/events
- `GET /api/task-board` — task board slices (ready, blocked, due, pillar rollups, recent outcomes)
- `GET /api/live` — SSE stream for near-live UI refresh ticks
- `POST /api/openclaw/subagent-events` — OpenClaw sub-agent lifecycle ingestion (queued/running/done/failed/timeout/killed)
- `POST /api/github/post-merge-task-autoclose` — webhook endpoint for merged PR task auto-closure + verification gate

## Pages
- `/` — Dashboard with stats, agent health widgets, runs table, and alerts feed
- `/task-board` — Task board cards (Ready now, Blocked, Due soon/Overdue, By pillar, and Recent execution log)
- `/agents` — Agent overview
- `/jobs` — Runs/jobs list

## Task board data model
- Mission Control reads from the Cortana task queue tables when available: `cortana_tasks` and `cortana_epics` (see `prisma/schema.prisma`).
- Task board reads can use a dedicated Cortana DB URL (`CORTANA_DATABASE_URL`). If unset and `DATABASE_URL` points to `mission_control`, Mission Control automatically tries the same Postgres instance with database `cortana` for task reads to avoid stale adapter copies.
- If your Postgres doesn't already expose these tables, running `pnpm db:migrate` will create adapter/read-model tables with the same names/columns:
  - `cortana_epics`: id (serial), title, source, status, deadline, created_at, completed_at, metadata JSONB
  - `cortana_tasks`: id (serial), title, description, priority (1-5), status (text), due_at, remind_at, execute_at, auto_executable, execution_plan, depends_on int[], completed_at, outcome, metadata JSONB, epic_id FK, parent_id FK, assigned_to, source, created_at, updated_at
- Pillar grouping uses `metadata -> 'pillar'` (expected values: Time, Health, Wealth, Career; falls back to Unspecified).
- Ready Now = `status = 'pending'` + `auto_executable = true` + dependencies either empty or all `done`.
- Blocked = `status = 'pending'` with dependencies not marked `done`.
- Due soon = pending + due within 48h; Overdue = pending + due_at in the past.
- Recent outcomes list tasks with `completed_at` or `outcome` populated.

## Realtime + OpenClaw lifecycle bridge
- UI live updates are implemented in `components/auto-refresh.tsx`.
  - Uses `EventSource` against `/api/live` (2s server tick) and falls back to visibility-aware polling.
  - Applied on Dashboard, Jobs, Agents, Agent detail, and Task Board pages.
- OpenClaw lifecycle bridge supports two ingestion paths:
  1) Push webhook adapter in `lib/openclaw-bridge.ts` + `/api/openclaw/subagent-events`
  2) Pull sync adapter in `lib/openclaw-sync.ts` that reads `~/.openclaw/subagents/runs.json` (or `OPENCLAW_SUBAGENT_RUNS_PATH`) and upserts real sub-agent runs into Mission Control on data fetch.
- Reliability/autonomy controls now implemented:
  - **Two-phase launch confirmation**: queued (phase 1) and running (phase 2). Running without prior queue evidence is marked `phase2_running_unconfirmed` and emits warning events.
  - **Stale UI guard + auto-reconcile**: long-running states not present in live run store are auto-marked `stale` and emit `subagent.reconciled_stale` events.
  - **Source-of-truth reconciliation job**: Task Board periodically compares dedicated Cortana DB vs app DB and surfaces drift warnings in the UI.
  - **Fallback transparency layer**: Jobs/Agent detail display provider/model/auth path and explicit fallback-path badges when detected in run payload metadata.
  - **Evidence-graded status messaging**: each run gets confidence grade (`high|medium|low`) based on observed lifecycle evidence.
- Upserts runs by `Run.openclaw_run_id`, stores raw lifecycle in `Run.external_status`, and writes `Event` rows (`subagent.<status>`).
- Optional webhook auth: set `OPENCLAW_EVENT_TOKEN` and send `Authorization: Bearer <token>`.

Example local ingestion:
```bash
curl -X POST http://localhost:3000/api/openclaw/subagent-events \
  -H "content-type: application/json" \
  -d '{"runId":"sub-123","status":"queued","agentName":"Huragok","jobType":"mission-control-sync"}'
```

## Notes
- Migrations are stored in `prisma/migrations`. Update schema in `prisma/schema.prisma`, then run `pnpm db:migrate`.
- Seed data lives in `prisma/seed.ts`; safe to re-run.
