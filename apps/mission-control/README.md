# Mission Control

Next.js + PostgreSQL dashboard for Cortana agents and Trading Ops truth surfaces. Provides a unified view of agents, runs/jobs, alerts/events, services, sessions, Mjolnir, and live market ops with shadcn/ui components.

Durable operational follow-up lives in GitHub Issues. Mission Control no longer exposes Task Board, approvals inbox, feedback inbox, decision trace, or autonomy read-model pages.

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
cat > .env.local <<'EOF'
DATABASE_URL=postgresql://hd@localhost:5432/mission_control
EOF
# Update DATABASE_URL for your Postgres instance
# e.g., createdb mission_control
# Required for task reads: CORTANA_DATABASE_URL
# Required for notification flows: TELEGRAM_BOT_TOKEN
# Optional machine-ingress auth token for local producers/webhooks only:
#   MISSION_CONTROL_API_TOKEN=replace-with-long-random-token
# Optional source/runtime overrides:
#   CORTANA_SOURCE_REPO=/Users/hd/Developer/cortana
#   DOCS_PATH=/Users/hd/Developer/cortana/docs
#   AGENT_MODELS_PATH=/Users/hd/Developer/cortana/config/agent-models.json
#   HEARTBEAT_STATE_PATH=/Users/hd/.openclaw/memory/heartbeat-state.json
#   TELEGRAM_USAGE_HANDLER_PATH=/Users/hd/Developer/cortana/skills/telegram-usage/handler.ts
```
3) Apply schema + seed data (creates active agents Librarian and Monitor)
```bash
pnpm db:migrate
pnpm db:seed
```
4) Run the app
```bash
pnpm dev
# open http://localhost:3000
```

Preferred launchd-managed operator flow:
```bash
./scripts/restart-mission-control.sh --env prod
./scripts/restart-mission-control.sh --env dev
```
This runs Mission Control through the launchd-managed local app path instead of a transient dev server.

## Runtime environments

Mission Control has two local launchd profiles:

| Profile | URL | LaunchAgent | Env |
|---|---|---|---|
| `prod` | `http://127.0.0.1:3000` / `http://100.120.198.12:3000` | `com.cortana.mission-control` | `PORT=3000`, `MISSION_CONTROL_RUNTIME_ENV=prod`, `MARKET_LAB_ENV=prod` |
| `dev` | `http://127.0.0.1:3001` / `http://100.120.198.12:3001` | `com.cortana.mission-control-dev` | `PORT=3001`, `MISSION_CONTROL_RUNTIME_ENV=dev`, `MARKET_LAB_ENV=dev` |

`3002` is not a valid Mission Control environment. If `100.120.198.12:3002` serves prod, remove the stale Tailscale Serve TCP forward:

```bash
tailscale serve --yes --bg --tcp=3002 off
```

## Scripts
- `pnpm dev` — start Next.js dev server
- `pnpm build` / `pnpm start` — production build & manual foreground start
- `pnpm lint` — lint
- `pnpm db:migrate` — apply Prisma migrations
- `pnpm db:deploy` — deploy migrations in production
- `pnpm db:seed` — load starter agents/runs/events
- `pnpm db:generate` — regenerate Prisma client

Use `scripts/restart-mission-control.sh` for the launchd-managed local app.
That path rewrites the LaunchAgent to a direct `next start` entrypoint, clears stale Mission Control `next-server` processes, waits for `/api/heartbeat-status`, and can run the Trading Ops smoke guard.

## Codex Sessions workspace
- Mission Control includes a Codex-only Sessions workspace at `/sessions`.
- The Sessions surface is designed to mirror the local Codex desktop client’s project-oriented sidebar rather than acting as a generic transcript dump.
- Session discovery is backed by the local Codex store under `~/.codex`, with Mission Control reading:
  - `session_index.jsonl` for fast recent-session discovery
  - transcript files under `~/.codex/sessions/...` and `~/.codex/archived_sessions/...` for detail hydration
  - `state_5.sqlite` and `.codex-global-state.json` for local sidebar/workspace context
- Mission Control filters out threads that do not resolve to a visible workspace context, along with spawned worker/subagent threads and utility CLI noise, so the visible project rail stays closer to Codex desktop parity.
- New turns sent from Mission Control continue the same local Codex session id and write back through the Codex app/CLI boundary rather than a separate chat backend.
- Transcript rendering is bounded inside the page shell with an internal scroll viewport so long conversations do not expand the entire page.

### Codex mirror model
- Mission Control maintains a lightweight DB-backed mirror for Codex thread metadata so the UI does not rely only on raw filesystem reads.
- Mirror reconciliation is lifecycle-aware:
  - active threads stay visible and can be resumed/replied to
  - archived or deleted threads are removed from the Mission Control selection set on refresh
- The mirror is still downstream of the local Codex store. Codex remains the source of truth for session existence and transcript history.

## Browser access model
- Mission Control browser access is private-network based: `localhost` and Tailscale operator sessions are first-class supported paths.
- Prod is served on `3000`; dev is served on `3001`.
- Browser pages and their same-origin API reads do **not** require `MISSION_CONTROL_API_TOKEN`.
- Browser mutations are protected by same-origin checks instead of token-cookie bootstrap.
- `MISSION_CONTROL_API_TOKEN` is only for machine ingress such as local producers, webhooks, and automation jobs.
- Remote iPhone/Tailscale access to `Configuration` and `Vacation Ops` is a supported browser path.

## Data model (Prisma)
- `Agent`: id, name, role, description, capabilities, status (active/idle/degraded/offline), healthScore, lastSeen, timestamps.
- `Run`: id, agentId (nullable FK), jobType, status (queued/running/completed/failed/cancelled), summary, payload/result JSON, startedAt/completedAt, timestamps.
- `Event`: id, agentId (nullable FK), runId (nullable FK), type, severity (info/warning/critical), message, metadata JSON, createdAt, acknowledged.

## API routes
- `GET /api/dashboard` — aggregated metrics + recent rows
- `GET /api/agents` — agent roster
- `GET /api/runs` — recent runs/jobs
- `GET /api/events` — latest alerts/events
- `GET /api/council` / `POST /api/council` — list and create council sessions
- `POST /api/council/jobs/deliberate` — council deliberation fanout job
- `GET /api/human-required-actions` — open Cortana human-required queue items for read-only display
- `GET /api/live` — SSE stream for near-live UI refresh ticks
- `GET /api/codex/sessions` — list visible Codex sessions grouped by local workspace/project
- `POST /api/codex/sessions` — create a new Codex thread and stream the first turn back into Mission Control
- `GET /api/codex/sessions/:sessionId` — fetch a visible Codex thread transcript plus session metadata
- `POST /api/codex/sessions/:sessionId/messages` — continue an existing Codex thread from Mission Control
- `GET /api/trading-ops/live` — Trading Ops live summary payload
- `GET /api/trading-ops/live/stream` — Trading Ops SSE stream
- `GET /api/trading-ops/polymarket` — Polymarket Trading Ops summary payload
- `GET /api/trading-ops/polymarket/live` — Polymarket live snapshot
- `GET /api/trading-ops/polymarket/live/stream` — Polymarket SSE stream
- `POST /api/trading-ops/polymarket/pins` / `DELETE /api/trading-ops/polymarket/pins/:marketSlug` — pinned-market mutations
- `POST /api/openclaw/subagent-events` — OpenClaw sub-agent lifecycle ingestion (queued/running/done/failed/timeout/killed)

## Pages
- `/` — Dashboard with stats, agent health widgets, runs table, and alerts feed
- `/trading-ops` — latest-run truth, live tape, streamer health, watchlists, system health, deep dive, and Polymarket boards
- `/agents` — Agent overview
- `/sessions` — Codex session workspace with project-grouped thread rail, transcript view, inspector, and reply/start controls
- `/council` — Council deliberation sessions, member votes, and synthesis rationale
- `/jobs` — Runs/jobs list

## Realtime + OpenClaw lifecycle bridge
- UI live updates are implemented in `components/auto-refresh.tsx`.
  - Uses `EventSource` against `/api/live` (2s server tick) and falls back to visibility-aware polling.
  - Applied on Dashboard, Jobs, Agents, and Agent detail pages.
- OpenClaw lifecycle bridge supports two ingestion paths:
  1) Push webhook adapter in `lib/openclaw-bridge.ts` + `/api/openclaw/subagent-events`
  2) Pull sync adapter in `lib/openclaw-sync.ts` that reads `~/.openclaw/subagents/runs.json` (or `OPENCLAW_SUBAGENT_RUNS_PATH`) and upserts real sub-agent runs into Mission Control on data fetch.
- Reliability controls now implemented:
  - **Two-phase launch confirmation**: queued (phase 1) and running (phase 2). Running without prior queue evidence is marked `phase2_running_unconfirmed` and emits warning events.
  - **Stale UI guard + auto-reconcile**: long-running states not present in live run store are auto-marked `stale` and emit `subagent.reconciled_stale` events.
- **Source-of-truth reconciliation job**: fallback guardrail runs every 15 minutes to catch missed updates and surfaces drift warnings when listener is disconnected.
  - **Fallback transparency layer**: Jobs/Agent detail display provider/model/auth path and explicit fallback-path badges when detected in run payload metadata.
  - **Evidence-graded status messaging**: each run gets confidence grade (`high|medium|low`) based on observed lifecycle evidence.
- Upserts runs by `Run.openclaw_run_id`, stores raw lifecycle in `Run.external_status`, and writes `Event` rows (`subagent.<status>`).
- Optional webhook auth: set `OPENCLAW_EVENT_TOKEN` and send `Authorization: Bearer <token>`.

Example local ingestion:
```bash
curl -X POST http://localhost:3000/api/openclaw/subagent-events \
  -H "content-type: application/json" \
  -d '{"runId":"sub-123","status":"queued","agentName":"Monitor","jobType":"mission-control-sync"}'
```

## Trading Ops

Trading Ops is the main market operator surface.

It combines:
- latest-run truth from `mc_trading_runs`
- explicit file fallback when DB-backed truth is unavailable
- live tape and watchlist prices from `/api/trading-ops/live`
- live SSE updates from `/api/trading-ops/live/stream`
- streamer/runtime health from the external service
- a dedicated Polymarket tab for account, pinned markets, top events, top sports, linked watchlists, and results

Primary operator tabs:
- `Overview`
- `Live`
- `Watchlists`
- `System Health`
- `Deep Dive`
- `Polymarket`

Operational notes:
- `DB-backed` means the latest run card came from Mission Control's stored run state
- `fallback` means the card had to fall back to file/artifact truth instead of the preferred DB path
- live quote rows can be `live`, `rest`, `cache`, or degraded depending on provider state
- restart the app with `apps/mission-control/scripts/restart-mission-control.sh`; it uses the launchd direct-start pattern by rewriting the LaunchAgent to a direct `next start` entrypoint, then `kickstart`s the updated agent so stale wrapper processes do not leak Prisma pools

## Live data sources and fallback rules

- Mission Control does not call Schwab or Polymarket directly from the browser.
- The browser-facing boundary is Mission Control itself.
- Mission Control reads live trading data from the external service:
  - `/market-data/quote/batch`
  - `/market-data/ops`
  - Polymarket live endpoints
- If the streamer is down but REST still works, the UI should show that as degraded, not healthy.
- If latest-run DB truth is unavailable, the UI can fall back to artifact truth, but it should say so explicitly.

## Launchd / restart

Preferred local production-style restart:

```bash
./apps/mission-control/scripts/restart-mission-control.sh
```

Manual install/update of the LaunchAgent plist:

```bash
cd apps/mission-control
pnpm exec tsx scripts/install-launch-agent.ts
```

Verification:
- `curl http://127.0.0.1:3000/api/heartbeat-status`
- `curl http://127.0.0.1:3001/api/heartbeat-status`


## Council integration notes
- Council deliberation policy is enforced as **OpenAI `gpt-4o` only** for both member voting and synthesis.
- Council voting calls are made directly from Mission Control to OpenAI (not routed through the OpenClaw gateway).

## Notes
- Migrations are stored in `prisma/migrations`. Update schema in `prisma/schema.prisma`, then run `pnpm db:migrate`.
- Seed data lives in `prisma/seed.ts`; safe to re-run.
