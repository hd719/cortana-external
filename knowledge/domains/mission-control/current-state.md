# Mission Control Current State

Mission Control is the local operator UI for agents, runs, sessions, docs, services, Mjolnir, Council, human-required actions, and Trading Ops truth.

## Current Operator Surfaces

- `/` for dashboard, jobs, and agent health
- `/trading-ops` for latest-run truth, live tape, watchlists, system health, and Polymarket
- `/council` and human-required action surfaces for control-plane operations
- `/mjolnir` for the fitness/recovery surface

Retired surfaces:
- `/task-board`
- `/approvals`
- `/feedback`
- `/decisions`
- `/autonomy`

Durable operational follow-up now belongs in GitHub Issues, not local Mission Control task or governance rows.

## Trading Ops Truth Model

- preferred latest-run truth is DB-backed from `mc_trading_runs`
- if DB-backed truth is unavailable, the UI can fall back to file/artifact truth
- that fallback is meant to be explicit, not silent
- live quote and streamer state are separate from completed-run truth

## Live Data Dependencies

- Mission Control reads live market data through the external service boundary
- core live routes are:
  - `/api/trading-ops/live`
  - `/api/trading-ops/live/stream`
- those routes depend on external-service market-data endpoints such as:
  - `/market-data/quote/batch`
  - `/market-data/ops`
- Polymarket boards use separate live endpoints and should not be confused with Schwab tape status

## Restart Model

- local production-style restarts should use `apps/mission-control/scripts/restart-mission-control.sh`
- that script rewrites the LaunchAgent to a direct `next start` entrypoint
- it also clears stale Mission Control `next-server` processes before relaunch
- health is verified through `/api/heartbeat-status`

## Linked Runbooks

- [Architecture source](../../../docs/source/architecture/mission-control.md)
- [Mission Control app README](../../../apps/mission-control/README.md)
- [Trading Ops QA runbook](../../../backtester/docs/source/runbook/trading-ops-qa-runbook.md)
- [Streamer failure modes runbook](../../../backtester/docs/source/runbook/streamer-failure-modes-runbook.md)
- [Polymarket US source](../../../docs/source/architecture/polymarket-us-trading-ops.md)
- [Polymarket board flow](./polymarket-board-flow.md)
