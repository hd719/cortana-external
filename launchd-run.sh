#!/bin/bash

# Source environment variables from .env file
if [ -f "/Users/hd/Developer/cortana-external/.env" ]; then
    export $(grep -v '^#' /Users/hd/Developer/cortana-external/.env | xargs)
fi

# Ensure fitness service binds to the canonical port expected by watchdog
export PORT="${PORT:-3033}"

# Change to the correct directory
cd /Users/hd/Developer/cortana-external

# Run the Go application
exec go run main.go