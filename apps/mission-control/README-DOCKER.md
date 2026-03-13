# Mission Control Docker + Tailscale

## Prerequisites
- Docker Desktop (or Docker Engine + Compose)
- Tailscale auth key

## Tailscale auth key
1. Open Tailscale Admin Console.
2. Go to Settings -> Keys -> Generate auth key.
3. Enable reusable + ephemeral.
4. Copy the key for `TS_AUTHKEY`.

## Setup
1. Copy the environment file:
   ```bash
   cp .env.example .env.docker
   ```
2. Edit `.env.docker`:
   - Set `DATABASE_URL` to use `host.docker.internal` (example: `postgresql://hd@host.docker.internal:5432/mission_control`).
   - Set `CORTANA_DATABASE_URL` to use `host.docker.internal` (example: `postgresql://hd@host.docker.internal:5432/cortana`).
   - Add `TS_AUTHKEY` from Tailscale.
   - Optional: set `CORTANA_SOURCE_REPO_HOST` if the Cortana source repo is not at `/Users/hd/Developer/cortana`.
   - Optional: set `HEARTBEAT_MEMORY_DIR` if runtime heartbeat state is not at `/Users/hd/.openclaw/memory`.
3. Update `tailscale/serve.json` with your actual tailnet domain.
4. Start the stack:
   ```bash
   docker compose --env-file .env.docker up -d
   ```

## Access
- https://mission-control.<your-tailnet>.ts.net

## Notes
- `tailscale/serve.json` includes a placeholder tailnet domain. Replace it with your own.
- PostgreSQL must allow connections from Docker. If needed, update `pg_hba.conf` to permit `host.docker.internal`.
- The compose file mounts the Cortana source repo read-only at `/app/cortana-source` so Mission Control can read docs, agent models, and the telegram-usage handler without depending on the legacy `/Users/hd/openclaw` shim.
