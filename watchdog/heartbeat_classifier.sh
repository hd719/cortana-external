#!/bin/bash

# classify_heartbeat_health <count> <age_seconds> <restarts_6h> <variance_seconds>
# Prints: <severity>|<reason>
# severity in: ok|warning|critical
classify_heartbeat_health() {
  local count="$1"
  local age_seconds="$2"
  local restarts_6h="$3"
  local variance_seconds="$4"

  if [[ "$count" -eq 0 ]]; then
    echo "critical|no heartbeat process running"
    return
  fi

  if [[ "$count" -gt 1 ]]; then
    echo "critical|heartbeat pileup (${count} processes)"
    return
  fi

  if [[ "$age_seconds" -ge 3600 ]]; then
    echo "critical|heartbeat process stale for ${age_seconds}s"
    return
  fi

  if [[ "$restarts_6h" -ge 4 ]]; then
    echo "critical|heartbeat restarted ${restarts_6h}x in 6h"
    return
  fi

  if [[ "$age_seconds" -ge 2400 ]]; then
    echo "warning|heartbeat process age high (${age_seconds}s)"
    return
  fi

  if [[ "$restarts_6h" -ge 2 ]]; then
    echo "warning|heartbeat restarted ${restarts_6h}x in 6h"
    return
  fi

  if [[ "$variance_seconds" -ge 300 ]]; then
    echo "warning|heartbeat timing variance elevated (${variance_seconds}s drift)"
    return
  fi

  echo "ok|heartbeat stable"
}
