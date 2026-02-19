#!/bin/bash

# Source environment variables from .env file
if [ -f "/Users/hd/cortana-external/.env" ]; then
    export $(grep -v '^#' /Users/hd/cortana-external/.env | xargs)
fi

# Change to the correct directory
cd /Users/hd/cortana-external

# Run the Go application
exec go run main.go