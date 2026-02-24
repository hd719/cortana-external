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
- **Jobs (/jobs)**: recent runs with status, timing, ownership, launch-phase confidence, and fallback transparency badges.
- **API routes**: `/api/dashboard`, `/api/agents`, `/api/runs`, `/api/events` (JSON from Postgres via Prisma).

## Reliability/Autonomy Foundations (Tasks #46-#50)
1. **Two-phase launch confirmation protocol**
   - Lifecycle ingestion tracks phase-1 (`queued`) and phase-2 (`running`) confirmations.
   - If a run reports `running` without queued evidence, Mission Control emits a warning and labels launch as unconfirmed.
2. **Stale UI state guard + auto-reconcile**
   - OpenClaw run-store sync applies TTL reconciliation and marks stale in-flight runs as `external_status=stale`.
   - Reconciliation emits explicit events for operator auditability.
3. **Task Board source-of-truth reconciliation**
   - Periodic comparison between dedicated Cortana DB and app DB task tables.
   - Drift is surfaced in Task Board warning banners with sample mismatches.
4. **Fallback transparency layer**
   - Provider/model/auth routing path is extracted from run metadata and rendered in Jobs + Agent Detail.
   - Fallback execution paths are explicitly badged.
5. **Evidence-graded status messaging**
   - Run status confidence is classified (`high|medium|low`) and shown in operational views.

## Phased Rollout
1) **v1 (this PR)**: local Postgres schema + migrations, seed data, dashboard/agents/jobs pages, basic API routes, setup docs.
2) **v1.1**: add auth (if required), filters/search, pagination, and uptime/latency charts; wire to real agent emitters.
3) **v1.2**: notifications/escalations, acknowledgements on events, SLA tracking, and simple write APIs for agents to log runs/events.
4) **v2**: multi-environment support (staging/prod), richer analytics (MTTA/MTTR), role-based access, and plug-in transport for remote deployments.
