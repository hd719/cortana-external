# Tonal Service

Tonal integration runs inside the TypeScript external service package:
`apps/external-service` (`@cortana/external-service`).

## Runtime

- Framework: Hono on Node.js
- Bind: `127.0.0.1:${PORT}` (default `3033`)
- Startup command:
  ```bash
  cd ~/Developer/cortana-external
  pnpm --filter @cortana/external-service start
  ```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/tonal/health` | Tonal auth health check |
| GET | `/tonal/data` | Profile, workouts, and strength scores |

`/tonal/data` supports `?fresh=true` to bypass short-lived in-memory cache.

## Auth + Storage

- Required env vars:
  - `TONAL_EMAIL`
  - `TONAL_PASSWORD`
- File defaults:
  - `tonal_tokens.json`
  - `tonal_data.json`

Paths can be overridden with:
- `TONAL_TOKEN_PATH`
- `TONAL_DATA_PATH`

## Behavior Notes

- The service uses incremental cache merge to retain workout history over time.
- Workout IDs are normalized to string keys in the returned `workouts` map.
- Requests are paced with a built-in delay to avoid aggressive upstream burst traffic.
- Built-in auth self-heal:
  - on `401/403`, token state is reset and re-auth is attempted once
  - the failed request is retried once after recovery
- `/tonal/health` returns `200` when healthy and `503` on auth failure.

## Verification

```bash
curl -s http://127.0.0.1:3033/tonal/health | jq .
curl -s http://127.0.0.1:3033/tonal/data | jq '.workout_count'
curl -s "http://127.0.0.1:3033/tonal/data?fresh=true" | jq '.last_updated'
```
