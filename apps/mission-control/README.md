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
npm install
```
2) Configure the database
```bash
cp .env.example .env.local
# Update DATABASE_URL for your Postgres instance
# e.g., createdb mission_control
```
3) Apply schema + seed data (creates agents Huragok, Oracle, Researcher, Librarian, Monitor)
```bash
npm run db:migrate
npm run db:seed
```
4) Run the app
```bash
npm run dev
# open http://localhost:3000
```

## Scripts
- `npm run dev` — start Next.js dev server
- `npm run build` / `npm run start` — production build & start
- `npm run lint` — lint
- `npm run db:migrate` — apply Prisma migrations
- `npm run db:deploy` — deploy migrations in production
- `npm run db:seed` — load starter agents/runs/events
- `npm run db:generate` — regenerate Prisma client

## Data model (Prisma)
- `Agent`: id, name, role, description, capabilities, status (active/idle/degraded/offline), healthScore, lastSeen, timestamps.
- `Run`: id, agentId (nullable FK), jobType, status (queued/running/completed/failed/cancelled), summary, payload/result JSON, startedAt/completedAt, timestamps.
- `Event`: id, agentId (nullable FK), runId (nullable FK), type, severity (info/warning/critical), message, metadata JSON, createdAt, acknowledged.

## API routes
- `GET /api/dashboard` — aggregated metrics + recent rows
- `GET /api/agents` — agent roster
- `GET /api/runs` — recent runs/jobs
- `GET /api/events` — latest alerts/events

## Pages
- `/` — Dashboard with stats, agent health widgets, runs table, and alerts feed
- `/agents` — Agent overview
- `/jobs` — Runs/jobs list

## Notes
- Migrations are stored in `prisma/migrations`. Update schema in `prisma/schema.prisma`, then run `npm run db:migrate`.
- Seed data lives in `prisma/seed.ts`; safe to re-run.
