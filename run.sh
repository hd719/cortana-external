#!/usr/bin/env bash
set -euo pipefail

# Load env vars from .env if present, then run the Go service.
if [ -f ".env" ]; then
  set -a
  # shellcheck source=/dev/null
  source ".env"
  set +a
else
  echo "Missing .env in $(pwd). Create one or export env vars first."
  exit 1
fi

go run main.go
