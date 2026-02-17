#!/bin/bash
BOT_TOKEN="$1"
CHAT_ID="$2"
MESSAGE="$3"
curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -d chat_id="${CHAT_ID}" \
  -d text="${MESSAGE}" \
  -d parse_mode="Markdown" > /dev/null
