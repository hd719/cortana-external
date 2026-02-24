# Mission Control (v1) — Architecture Overview

## Goals
- Provide a single pane to monitor Cortana agents, their runs/jobs, and health events.
- Keep v1 lightweight: local PostgreSQL, Prisma ORM, and a Next.js/shadcn UI with server components.
- Make data portable: API routes mirror server actions so other services can consume the same tables.

## Stack & Components
- **Next.js (App Router, TypeScript)** — UI + API routes.
- **shadcn/ui + Tailwind v4** — UI primitives and theming.
- **PostgreSQL** — source of truth for agents, runs/jobs, and alerts/events.
- **Prisma** — schema, migrations, and database client.
- **Seed data** — known agents (Huragok, Oracle, Researcher, Librarian, Monitor) plus sample runs/events.

## Data Model (Prisma/Postgres)
- **Agent**: id, name, role, description, capabilities, status (active/idle/degraded/offline), healthScore, lastSeen, timestamps.
- **Run**: id, agentId (nullable FK), jobType, status (queued/running/completed/failed/cancelled), summary, payload/result JSON, startedAt/completedAt, timestamps.
- **Event**: id, agentId (nullable FK), runId (nullable FK), type, severity (info/warning/critical), message, metadata JSON, createdAt, acknowledged.

## App Surfaces
- **Dashboard (/)**: stats tiles, agent health widgets, recent runs table, alerts feed, quick API references.
- **Agents (/agents)**: roster with roles, capabilities, health scores, and last-seen times.
- **Jobs (/jobs)**: recent runs with status, timing, and ownership.
- **API routes**: `/api/dashboard`, `/api/agents`, `/api/runs`, `/api/events` (JSON from Postgres via Prisma).

## Phased Rollout
1) **v1 (this PR)**: local Postgres schema + migrations, seed data, dashboard/agents/jobs pages, basic API routes, setup docs.
2) **v1.1**: add auth (if required), filters/search, pagination, and uptime/latency charts; wire to real agent emitters.
3) **v1.2**: notifications/escalations, acknowledgements on events, SLA tracking, and simple write APIs for agents to log runs/events.
4) **v2**: multi-environment support (staging/prod), richer analytics (MTTA/MTTR), role-based access, and plug-in transport for remote deployments.
