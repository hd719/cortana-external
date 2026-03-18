#!/bin/bash

# Source environment variables from .env file
if [ -f "/Users/hd/Developer/cortana-external/.env" ]; then
    export $(grep -v '^#' /Users/hd/Developer/cortana-external/.env | xargs)
fi

# Ensure fitness service binds to the canonical port expected by watchdog
export PORT="${PORT:-3033}"
export ALPACA_KEYS_PATH="${ALPACA_KEYS_PATH:-$HOME/Developer/cortana-external/alpaca_keys.json}"
export ALPACA_TARGET_ENVIRONMENT="${ALPACA_TARGET_ENVIRONMENT:-live}"


# Change to the correct directory
cd /Users/hd/Developer/cortana-external

# Run the TypeScript external service
exec pnpm --filter @cortana/external-service start
