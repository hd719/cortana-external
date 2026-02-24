# Gateway Uptime & Recovery Playbook (v1)

**Scope:** Restore Cortana reliability when heartbeats are missed or observability signals degrade.

**Primary incidents covered:**
1. Heartbeat misses / heartbeat pileup
2. Cron failures / cron quarantine
3. Budget telemetry mismatch or stale usage data
4. Stale upstream data (Whoop/Tonal/API surfaces)

**Target operator window:** 60–90 minutes

---

## 1) Detection thresholds (trigger this playbook)

Trigger if **any** of these are true:

- **Heartbeat missed:** No heartbeat check-in for **>30 min** during active hours, or `pgrep -f "openclaw.*heartbeat"` shows **0** process.
- **Heartbeat pileup:** `pgrep -f "openclaw.*heartbeat" | wc -l` returns **>1**.
- **Cron failure:** any cron state file has `consecutiveFailures >= 3`.
- **Cron quarantine present:** any `~/.openclaw/cron/quarantine/*.quarantined` exists.
- **Budget telemetry mismatch:** usage source reports invalid/empty quota, or watchdog logs repeated budget parse failures for **>30 min**.
- **Stale data:** key endpoints return non-200 or data timestamps older than:
  - Whoop/Tonal health endpoints stale or failing for **>15 min**
  - watchdog status/log not updated for **>20 min**

---

## 2) 10-minute triage checklist

Run in order. Stop when root cause is confirmed.

1. **Confirm gateway health**
   ```bash
   openclaw gateway status
   ```
2. **Check heartbeat process count**
   ```bash
   pgrep -fl "openclaw.*heartbeat" || true
   pgrep -f "openclaw.*heartbeat" | wc -l
   ```
3. **Check cron + quarantine state**
   ```bash
   ls -1 ~/.openclaw/cron/quarantine/*.quarantined 2>/dev/null || echo "no quarantine markers"
   jq -r '.consecutiveFailures // 0' ~/.openclaw/cron/*.state.json 2>/dev/null | nl
   ```
4. **Check watchdog is running and fresh**
   ```bash
   launchctl list | grep cortana.watchdog || true
   tail -n 80 ~/Developer/cortana-external/watchdog/logs/watchdog.log
   ```
5. **Check service dependencies**
   ```bash
   psql cortana -c "SELECT NOW();"
   curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 http://localhost:3033/tonal/health
   curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 http://localhost:3033/whoop/data
   ```
6. **Check budget telemetry source**
   ```bash
   node /Users/hd/clawd/skills/telegram-usage/handler.js json | jq '{quotaRemaining, periodStart, periodEnd}'
   ```

---

## 3) Recovery commands (exact actions)

> Use the **least invasive** fix first. Verify after each action.

### A. Gateway down / degraded

```bash
openclaw gateway restart
sleep 5
openclaw gateway status
```

If still unhealthy:
```bash
openclaw gateway stop
sleep 2
openclaw gateway start
openclaw gateway status
```

### B. Heartbeat pileup (>1 process)

```bash
pgrep -fl "openclaw.*heartbeat"
pkill -f "openclaw.*heartbeat"
sleep 2
openclaw gateway restart
```

### C. Cron failures / quarantine

1) Identify failing cron(s):
```bash
for f in ~/.openclaw/cron/*.state.json; do echo "--- $f"; jq '.consecutiveFailures, .lastError, .lastRunAt' "$f"; done
```

2) If quarantine marker exists and cause is fixed, clear marker:
```bash
ls -1 ~/.openclaw/cron/quarantine/*.quarantined
# remove only the specific recovered marker(s)
rm ~/.openclaw/cron/quarantine/<cron-name>.quarantined
```

3) Restart gateway to re-register scheduler cleanly:
```bash
openclaw gateway restart
```

### D. Watchdog not running / stale

```bash
launchctl unload ~/Library/LaunchAgents/com.cortana.watchdog.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.cortana.watchdog.plist
~/Developer/cortana-external/watchdog/watchdog.sh
```

### E. Budget telemetry mismatch

```bash
node /Users/hd/clawd/skills/telegram-usage/handler.js json | jq '.'
~/Developer/cortana-external/watchdog/watchdog.sh
tail -n 120 ~/Developer/cortana-external/watchdog/logs/watchdog.log | grep -i budget
```

If output is malformed/empty twice in a row (10+ minutes apart), escalate (see §5).

### F. Stale Whoop/Tonal data

```bash
curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 http://localhost:3033/tonal/health
curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 http://localhost:3033/whoop/data
~/Developer/cortana-external/watchdog/watchdog.sh
```

If endpoints remain non-200 after one watchdog cycle and gateway restart, escalate.

---

## 4) Verification gates (must pass before close)

Close incident only when **all** pass:

1. `openclaw gateway status` reports healthy/running.
2. Heartbeat process count is exactly **1**.
3. No critical cron has `consecutiveFailures >= 3`.
4. No unresolved quarantine marker for affected cron.
5. watchdog log contains a fresh successful run within **15 min**.
6. Postgres query succeeds (`SELECT NOW();`).
7. Tonal and Whoop probes return **200**.
8. Budget telemetry returns parseable `quotaRemaining`.

Quick verification bundle:
```bash
openclaw gateway status
pgrep -f "openclaw.*heartbeat" | wc -l
for f in ~/.openclaw/cron/*.state.json; do echo "$(basename "$f"): $(jq -r '.consecutiveFailures // 0' "$f")"; done
ls -1 ~/.openclaw/cron/quarantine/*.quarantined 2>/dev/null || echo "no quarantine markers"
psql cortana -c "SELECT NOW();"
curl -s -o /dev/null -w 'tonal:%{http_code}\n' --max-time 10 http://localhost:3033/tonal/health
curl -s -o /dev/null -w 'whoop:%{http_code}\n' --max-time 10 http://localhost:3033/whoop/data
node /Users/hd/clawd/skills/telegram-usage/handler.js json | jq -r '.quotaRemaining'
```

---

## 5) Escalation criteria

Escalate to maintainer/on-call if **any** condition holds:

- Gateway fails to recover after **2 restart attempts**.
- Heartbeat remains missing or pileup recurs within **30 min**.
- Any critical cron remains `consecutiveFailures >= 3` after remediation.
- Budget telemetry malformed/empty for **>30 min** despite watchdog/manual checks.
- Postgres unavailable for **>10 min**.
- Whoop/Tonal endpoints remain non-200 for **>20 min**.
- Same incident class occurs **3+ times in 24h**.

Escalation payload should include: timeline, commands run, outputs, and unresolved checks.

---

## 6) Post-incident logging template

Use this template in incident notes and `cortana_events` (or equivalent tracker):

```md
## Incident: <short title>
- Start (ET):
- Detect source: (watchdog/heartbeat/manual)
- Severity: (warning/critical)
- Impact: (missed heartbeat, stale data, cron halt, etc.)

### Signals observed
- Heartbeat count:
- Gateway status:
- Cron failure count/quarantine:
- Budget telemetry state:
- Whoop/Tonal probe codes:
- DB health:

### Actions taken (in order)
1.
2.
3.

### Verification
- [ ] Gateway healthy
- [ ] Heartbeat count = 1
- [ ] Cron failures < 3
- [ ] Quarantine resolved
- [ ] Watchdog fresh run
- [ ] DB OK
- [ ] Endpoints 200
- [ ] Budget telemetry parseable

### Root cause
-

### Prevention / follow-up tasks
-

- End (ET):
- Time to recover:
- Owner:
```

---

## 7) Notes

- Prefer targeted fixes over full-machine restarts.
- Only remove quarantine markers after confirming root cause was addressed.
- Keep command output snippets for escalation and trend analysis.
