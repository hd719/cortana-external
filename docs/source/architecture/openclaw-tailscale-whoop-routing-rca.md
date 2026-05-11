# OpenClaw, Tailscale, and WHOOP Routing RCA

This note captures the routing incident where OpenClaw, Mission Control, and the WHOOP webhook were competing for the same Tailscale hostname.

It is model-agnostic: use it as an operator runbook regardless of which assistant, CLI, or shell is doing the debugging.

## Final State

Only the WHOOP webhook is public. Operator dashboards stay private to the tailnet.

| Surface | URL | Exposure | Target |
| --- | --- | --- | --- |
| OpenClaw dashboard | `https://hs-mac-mini.taild96d14.ts.net/chat?session=main` | Tailnet-only HTTPS Serve | `http://127.0.0.1:18789` |
| Mission Control | `https://hs-mac-mini.taild96d14.ts.net:8443` | Tailnet-only HTTPS Serve | `http://127.0.0.1:3000` |
| WHOOP webhook | `https://hs-mac-mini.taild96d14.ts.net:10000/webhooks/whoop` | Public Funnel | `http://127.0.0.1:3033/webhooks/whoop` |
| Mission Control fallback | `http://100.120.198.12:3002` | Tailnet-only raw TCP | `tcp://127.0.0.1:3000` |
| OpenClaw fallback | `http://100.120.198.12:18790` | Tailnet-only raw TCP | `tcp://127.0.0.1:18789` |

Important: the OpenClaw raw TCP fallback is only a reachability test. It is not a full dashboard path because OpenClaw device identity requires HTTPS or localhost secure context.

## Impact

- OpenClaw loaded on desktop but failed or asked for a gateway token on mobile.
- Mission Control worked locally, but mobile access was inconsistent unless the iPhone used the Mac mini as an exit node.
- WHOOP webhook delivery was at risk because Funnel and private dashboards were sharing the default hostname path.
- Operators could not tell whether failures were app bugs, auth bugs, or Tailscale routing bugs without checking each layer.

## Root Causes

### 1. Public Funnel and private Serve shared the same hostname root

The original setup mixed these concerns:

- public WHOOP Funnel on `https://hs-mac-mini.taild96d14.ts.net/webhooks/whoop`
- private OpenClaw Serve on `https://hs-mac-mini.taild96d14.ts.net` or `:18789`
- private Mission Control Serve on `:8443`

That made the default Tailscale hostname ambiguous. Desktop browsers could still work, but iOS was more sensitive to the DNS/TLS path and sometimes treated the hostname as public Funnel rather than private Serve.

### 2. OpenClaw HTTPS was required, but raw TCP only proved reachability

`http://100.120.198.12:18790` reached OpenClaw, but OpenClaw correctly rejected full dashboard use with a secure-context error:

```text
control ui requires device identity (use HTTPS or localhost secure context)
```

That proved Tailscale transport was working, but not that OpenClaw was usable.

### 3. OpenClaw route automation fought manually managed Tailscale routes

OpenClaw had:

```json
"gateway": {
  "tailscale": {
    "mode": "serve",
    "resetOnExit": false
  }
}
```

That setting lets OpenClaw manage Tailscale Serve itself. In this deployment, routes are intentionally managed outside OpenClaw because the same MagicDNS hostname also carries Mission Control and WHOOP.

Leaving OpenClaw in `serve` mode could re-add a root route after restart and collide with the WHOOP Funnel plan.

### 4. Disabling OpenClaw Tailscale automation changed auth behavior

When `gateway.tailscale.mode` was changed to `off`, OpenClaw stopped implicitly allowing Tailscale identity auth. The UI then asked for a gateway token:

```text
unauthorized: gateway token missing
```

Setting `gateway.auth.allowTailscale=true` restored the intended trust model, but token mode still generated or expected a shared token. The final operator decision was to use tailnet-only routing as the boundary and set gateway auth to `none`.

Security note: `gateway.auth.mode=none` is only acceptable while OpenClaw remains loopback-bound and exposed only through tailnet-only Serve. Do not combine it with Funnel or a public bind.

### 5. iPhone DNS/TLS behavior depended on exit-node routing

The iPhone had Tailscale DNS enabled and could reach the Mac mini tailnet IP. However, hostname HTTPS access only stabilized when the iPhone used the Mac mini as an exit node.

That points to mobile DNS/TLS path selection, not a Mission Control or OpenClaw backend outage.

## Fixes Applied

### Separate public and private surfaces

WHOOP moved to a public Funnel on a dedicated port:

```bash
tailscale funnel --bg --https=10000 --set-path=/webhooks/whoop \
  http://127.0.0.1:3033/webhooks/whoop
```

The root public Funnel path was removed, then reused as private OpenClaw HTTPS Serve:

```bash
tailscale funnel --https=443 --set-path=/webhooks/whoop off
tailscale serve --bg --https=443 http://127.0.0.1:18789
```

Mission Control stayed private on `:8443`:

```bash
tailscale serve --bg --https=8443 http://127.0.0.1:3000
```

Raw TCP fallbacks remained tailnet-only:

```bash
tailscale serve --bg --tcp=3002 tcp://127.0.0.1:3000
tailscale serve --bg --tcp=18790 tcp://127.0.0.1:18789
```

### Disable OpenClaw route ownership

OpenClaw routing automation was disabled so the operator-owned Tailscale route table remains stable across restarts:

```json
"gateway": {
  "tailscale": {
    "mode": "off",
    "resetOnExit": false
  }
}
```

### Use tailnet routing as the OpenClaw access boundary

OpenClaw gateway auth was simplified for the private Serve deployment:

```json
"gateway": {
  "auth": {
    "mode": "none",
    "allowTailscale": true
  }
}
```

The gateway remains loopback-bound:

```text
Gateway: bind=loopback (127.0.0.1), port=18789
Listening: 127.0.0.1:18789
```

## Verification Commands

Run these from the Mac mini unless noted.

### Tailscale route table

```bash
tailscale serve status
```

Expected shape:

```text
# Funnel on:
#     - https://hs-mac-mini.taild96d14.ts.net:10000

https://hs-mac-mini.taild96d14.ts.net:10000 (Funnel on)
|-- /webhooks/whoop proxy http://127.0.0.1:3033/webhooks/whoop

https://hs-mac-mini.taild96d14.ts.net (tailnet only)
|-- / proxy http://127.0.0.1:18789

https://hs-mac-mini.taild96d14.ts.net:8443 (tailnet only)
|-- / proxy http://127.0.0.1:3000
```

It is okay for additional tailnet-only raw TCP fallbacks to exist on `3002` and `18790`.

### OpenClaw gateway health

```bash
openclaw gateway status --deep
```

Expected signals:

- service is loaded and running
- connectivity probe is `ok`
- gateway bind is loopback
- listening address is `127.0.0.1:18789`

### Dashboard HTTP checks

```bash
curl -skI https://hs-mac-mini.taild96d14.ts.net/ | sed -n "1,12p"
curl -skI https://hs-mac-mini.taild96d14.ts.net:8443/ | sed -n "1,12p"
```

Both should return `200`.

### WHOOP webhook ingress check

Unsigned test traffic should reach the handler and be rejected only for missing WHOOP signature headers:

```bash
curl -sk -X POST \
  -H "content-type: application/json" \
  -d "{}" \
  https://hs-mac-mini.taild96d14.ts.net:10000/webhooks/whoop -i
```

Expected result:

```text
HTTP/2 401
{"ok":false,"error":"missing_header"}
```

That means Funnel, local proxying, and the webhook handler are connected.

### WHOOP database verification

Use the Homebrew Postgres client on the Mac mini:

```bash
PSQL=/opt/homebrew/opt/postgresql@17/bin/psql

"$PSQL" "postgresql://hd@localhost:5432/cortana" -c \
  "select event_type, resource_id, whoop_user_id, status, received_at, processed_at, last_error
   from whoop_webhook_events
   order by received_at desc
   limit 8;"

"$PSQL" "postgresql://hd@localhost:5432/cortana" -c \
  "select source, activity_type, resource_id, status, summary, created_at, updated_at
   from whoop_activity_log
   order by created_at desc
   limit 8;"
```

Expected for a successful real WHOOP event:

- `whoop_webhook_events.status = processed`
- `whoop_activity_log.status = sent`
- `last_error` is empty

## Mobile Troubleshooting

### If desktop works but iPhone does not

Check whether the iPhone can use the Mac mini as an exit node.

Working mobile shape:

1. Connect iPhone to Tailscale.
2. Enable the Mac mini as the iPhone exit node.
3. Open `https://hs-mac-mini.taild96d14.ts.net/chat?session=main`.
4. Open `https://hs-mac-mini.taild96d14.ts.net:8443`.

If both work only with the exit node, the app and route table are healthy; the issue is mobile DNS/TLS path selection outside the exit-node path.

### If `http://100.120.198.12:18790` loads but OpenClaw refuses to connect

That is expected. Raw HTTP is not a secure browser context. Use HTTPS Serve for OpenClaw.

### If Mission Control works by raw IP but not hostname

Use this as a temporary fallback:

```text
http://100.120.198.12:3002
```

Then debug Tailscale DNS or mobile browser routing separately.

## Common Failure Modes

### Public root Funnel accidentally returns

Symptom:

```text
# Funnel on:
#     - https://hs-mac-mini.taild96d14.ts.net
```

Risk:

- OpenClaw or Mission Control may be publicly reachable if the wrong route is attached.
- iPhone may prefer the public Funnel DNS/TLS path instead of private Serve.

Fix:

```bash
tailscale funnel --https=443 --set-path=/webhooks/whoop off
tailscale serve --bg --https=443 http://127.0.0.1:18789
```

Keep WHOOP public only on `:10000`.

### OpenClaw asks for a gateway token again

Check config:

```bash
python3 - <<PY
import json
cfg=json.load(open(/Users/hd/.openclaw/openclaw.json))[gateway]
print(cfg.get(auth))
print(cfg.get(tailscale))
PY
```

Expected:

```json
{"mode":"none","allowTailscale":true}
{"mode":"off","resetOnExit":false}
```

Then restart OpenClaw:

```bash
launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway
```

If the browser still shows the old token error, hard refresh or open a private tab.

### WHOOP events stop arriving

Check the route first:

```bash
tailscale serve status
curl -sk -X POST -H "content-type: application/json" -d "{}" \
  https://hs-mac-mini.taild96d14.ts.net:10000/webhooks/whoop -i
```

If the curl does not return `401 missing_header`, the public ingress path is broken.

If it does return `401 missing_header`, check WHOOP developer portal configuration and database ingress audit rows.

### WHOOP public URL still points to the old root path

The running service can expose stale environment like:

```text
WHOOP_WEBHOOK_PUBLIC_URL=https://hs-mac-mini.taild96d14.ts.net/webhooks/whoop
```

The correct value is:

```text
WHOOP_WEBHOOK_PUBLIC_URL=https://hs-mac-mini.taild96d14.ts.net:10000/webhooks/whoop
```

This does not necessarily block inbound delivery, but it can confuse status pages, generated instructions, and future operators.

## Do Not Do This

- Do not expose OpenClaw through Funnel while `gateway.auth.mode=none`.
- Do not put WHOOP and OpenClaw on the same public root hostname path.
- Do not treat raw TCP success as proof OpenClaw is usable; it only proves reachability.
- Do not let OpenClaw own Tailscale routes while Mission Control and WHOOP routes are manually managed on the same host.
- Do not update WHOOP developer portal to a tailnet-only URL; WHOOP cloud needs a public HTTPS Funnel URL.

## Current Operator URLs

Use these unless the route contract changes:

- OpenClaw desktop and mobile with Mac mini exit node: `https://hs-mac-mini.taild96d14.ts.net/chat?session=main`
- Mission Control desktop and mobile with Mac mini exit node: `https://hs-mac-mini.taild96d14.ts.net:8443`
- WHOOP developer portal webhook: `https://hs-mac-mini.taild96d14.ts.net:10000/webhooks/whoop`
- Mission Control raw fallback: `http://100.120.198.12:3002`
