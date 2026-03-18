# Whoop Service

Whoop integration now runs inside the TypeScript external service package:
`apps/external-service` (`@cortana/external-service`).

## Runtime

- Framework: Hono on Node.js
- Bind: `127.0.0.1:${PORT}` (default `3033`)
- Startup command:
  ```bash
  cd ~/Developer/cortana-external
  pnpm --filter @cortana/external-service start
  ```
- Launchd command path:
  - `launchd-run.sh` -> `pnpm --filter @cortana/external-service start`

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/auth/url` | Returns Whoop authorization URL |
| GET | `/auth/callback` | OAuth callback (token exchange) |
| GET | `/auth/status` | Auth/token readiness status |
| GET | `/whoop/health` | Service/auth health snapshot |
| GET | `/whoop/data` | Full Whoop payload |
| GET | `/whoop/recovery` | Recovery array only |
| GET | `/whoop/recovery/latest` | Latest recovery object |

All routes are unauthenticated on localhost and keep the same contract expected by OpenClaw and downstream digest jobs.

## Auth + Token Storage

- Required env vars:
  - `WHOOP_CLIENT_ID`
  - `WHOOP_CLIENT_SECRET`
  - `WHOOP_REDIRECT_URL` (default `http://localhost:3033/auth/callback`)
- Token file defaults:
  - `whoop_tokens.json`
  - `whoop_data.json`

Token/data paths can be overridden with:
- `WHOOP_TOKEN_PATH`
- `WHOOP_DATA_PATH`

## Behavior Notes

- Automatic token refresh is built in.
- Refresh calls are deduplicated to avoid parallel refresh storms.
- If refresh fails but stale cache exists, the service can return stale data with:
  - `Warning: 110 - "Serving stale Whoop cache after token refresh failure"`

## Token Refresh

You do not need to handle token refresh in the client. The Whoop routes automatically:

1. Check whether the access token is expired or about to expire.
2. Use the refresh token to obtain a new access token from Whoop.
3. Persist the refreshed tokens back to `whoop_tokens.json`.
4. Continue serving the request with the fresh token when refresh succeeds.

As long as the integration is exercised periodically, the stored refresh token should keep the local auth state alive without repeated manual OAuth.

## Rate Limits

The upstream Whoop API limits are still relevant operationally:

| Limit | Value |
|-------|-------|
| Per Minute | 100 requests |
| Per Day | 10,000 requests |

Each call to `/whoop/data` fans out into multiple upstream requests, so repeated polling can consume the quota faster than the single local route suggests.

## Verification

```bash
curl -s http://127.0.0.1:3033/auth/url | jq .
curl -s http://127.0.0.1:3033/auth/status | jq .
curl -s http://127.0.0.1:3033/whoop/health | jq .
curl -s http://127.0.0.1:3033/whoop/recovery/latest | jq .
```
