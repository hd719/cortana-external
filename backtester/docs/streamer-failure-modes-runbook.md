# Schwab Streamer Failure Modes Runbook

Operator runbook for the Schwab streamer inside the TS market-data service.

Use this when quote freshness drops, reconnects spike, or `/market-data/ops` shows streamer trouble.

## Fast checks

1. Check `GET /market-data/ops` first.
2. Check `GET /market-data/ready` if scans are blocked.
3. Confirm the intended role:
   - `auto` should have one leader
   - `leader` forces this instance to own the stream
   - `follower` should not open a local socket
4. Look for stale symbols, reconnect streaks, and last-success timestamps.

## Common failure modes

- `LOGIN_DENIED`
  - credentials, session state, or Schwab auth setup is wrong
  - fix auth, then restart the service
- `STREAM_CONN_NOT_FOUND`
  - the websocket session disappeared
  - expect reconnect logic to retry, but confirm the ops payload recovers
- `STOP_STREAMING` or `CLOSE_CONNECTION`
  - Schwab closed the stream
  - wait for reconnect backoff, then verify subscriptions return
- `REACHED_SYMBOL_LIMIT`
  - the active symbol budget is too high
  - reduce subscription pressure or lower the configured soft cap
- repeated `FAILED_COMMAND_SUBS` / `ADD` / `UNSUBS` / `VIEW`
  - commands are not being acknowledged cleanly
  - check for lock contention, reconnect churn, or a bad field set

## What to do

- If the service is still healthy, let supervised reconnect/backoff finish.
- If health does not recover, restart the TS service.
- If one instance should own streaming, verify only the leader is active.
- If follower state looks stale, confirm shared-state backend and file/DB propagation.
- If symbol pressure is the issue, trim the active basket before retrying.

## When to escalate

Escalate if:

- `ready` stays false after reconnect attempts
- `ops` shows a growing reconnect failure streak
- quote or chart data stays stale across multiple refresh cycles
- the service is stuck on auth or connection denial

Treat this as a service recovery problem first, not a Python scoring problem.
