# Cortana Watchdog

Local reliability monitor — pure shell, $0 cost, runs every 15 min via launchd.
Current location: `~/Developer/cortana-external/watchdog` · Status: **active** (`com.cortana.watchdog`).

## What it checks

| Check | Action on failure |
|-------|-------------------|
| **Cron Quarantine** | Alert if any preflight quarantine marker exists (`~/.openclaw/cron/quarantine/*.quarantined`) |
| **Cron Health** | Alert if any cron has 3+ consecutive failures |
| **Heartbeat Pileup** | Alert if multiple heartbeat processes running |
| **gog (Gmail)** | Log failure |
| **Tonal API** | Health probe + retry; Tonal service self-heals via refresh-token flow |
| **Whoop API** | Log failure |
| **PostgreSQL** | Alert |
| **API Budget** | Alert if <30% remaining before day 20 |

All results logged to `cortana_events` table.

## Install

```bash
chmod +x ~/Developer/cortana-external/watchdog/watchdog.sh
chmod +x ~/Developer/cortana-external/watchdog/send_telegram.sh
cp ~/Developer/cortana-external/watchdog/com.cortana.watchdog.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.cortana.watchdog.plist
```

## Test manually

```bash
~/Developer/cortana-external/watchdog/watchdog.sh
```

## Check logs

```bash
tail -f ~/Developer/cortana-external/watchdog/logs/watchdog.log
```

## Manage

```bash
launchctl list | grep cortana.watchdog
launchctl unload ~/Library/LaunchAgents/com.cortana.watchdog.plist  # stop
launchctl load ~/Library/LaunchAgents/com.cortana.watchdog.plist    # start
```

## Config

- Bot token: read from `/Users/hd/.openclaw/openclaw.json`
- Chat ID: `8171372724`
- Interval: 900s (15 min)
- Fitness base URL: `FITNESS_BASE_URL` env var (default: `http://localhost:3033`)
