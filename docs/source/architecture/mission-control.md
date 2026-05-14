# Mission Control — Architecture Overview

Mission Control is the operational UI in `cortana-external`.

Durable work tracking belongs in GitHub Issues. Mission Control does not own local task-board, approval-inbox, feedback-inbox, decision-trace, or autonomy read-model workflows.

## Current App Surfaces

- Dashboard for agents, jobs, events, and high-level system state
- Trading Ops for latest-run truth, live tape, watchlists, system health, deep dive, and Polymarket
- Council and human-required actions for control-plane operations
- Mjolnir for the fitness/recovery surface

## Trading Ops Architecture

Trading Ops combines two different kinds of truth:

1. completed-run truth
   - latest run, decision, counts, delivery state
   - preferred source is Mission Control DB state (`mc_trading_runs`)
   - fallback source is artifact/file truth when DB-backed truth is unavailable

2. live runtime truth
   - tape, watchlist prices, streamer health, runtime warnings
   - read through Mission Control live routes:
     - `/api/trading-ops/live`
     - `/api/trading-ops/live/stream`

Those live routes read through the external-service boundary instead of calling providers from the browser.

## Live Data And Source-Of-Truth Rules

- external-service owns Schwab market-data, streamer state, and Polymarket service routes
- Mission Control owns browser-facing aggregation and operator wording
- `DB-backed` means the latest run card came from Mission Control stored run state
- `fallback` means Mission Control had to fall back to artifact truth
- streamer disconnected + REST still working should surface as degraded, not healthy

## Runtime Dependencies

- Next.js + React for the app shell
- Prisma + PostgreSQL for stored run, agent, and runtime state
- external-service for market-data and Polymarket live inputs
- local launchd for the production-style app process

## Launchd / Restart Model

- local production-style restarts should use `apps/mission-control/scripts/restart-mission-control.sh`
- that script rewrites the LaunchAgent to a direct `next start` entrypoint before relaunch
- it clears stale Mission Control `next-server` processes to avoid leaked Prisma pools
- it waits for `/api/heartbeat-status`
- it can also run the Trading Ops smoke guard after restart
