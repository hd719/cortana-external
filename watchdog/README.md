# Cortana Watchdog

Local reliability monitor — pure shell, $0 cost, runs every 15 min via launchd.

## What it checks

| Check | Action on failure |
|-------|-------------------|
| **Cron Health** | Alert if any cron has 3+ consecutive failures |
| **Heartbeat Pileup** | Alert if multiple heartbeat processes running |
| **gog (Gmail)** | Log failure |
| **Tonal API** | Self-heal (delete tokens), then alert if still down |
| **Whoop API** | Log failure |
| **PostgreSQL** | Alert |
| **API Budget** | Alert if <30% remaining before day 20 |

All results logged to `cortana_events` table.

## Install

```bash
chmod +x /Users/hd/Desktop/services/watchdog/watchdog.sh
chmod +x /Users/hd/Desktop/services/watchdog/send_telegram.sh
cp /Users/hd/Desktop/services/watchdog/com.cortana.watchdog.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.cortana.watchdog.plist
```

## Test manually

```bash
/Users/hd/Desktop/services/watchdog/watchdog.sh
```

## Check logs

```bash
tail -f /Users/hd/Desktop/services/watchdog/logs/watchdog.log
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
