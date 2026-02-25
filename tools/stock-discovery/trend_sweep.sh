#!/usr/bin/env bash
set -euo pipefail

WATCHLIST_FILE="/Users/hd/Developer/cortana-external/backtester/data/dynamic_watchlist.json"
TMP_DIR="$(mktemp -d)"
RAW_FILE="$TMP_DIR/raw_results.txt"
TICKERS_FILE="$TMP_DIR/tickers.txt"
COUNTS_FILE="$TMP_DIR/counts.txt"
TODAY="$(date +%F)"
NOW_ISO="$(python3 - <<'PY'
from datetime import datetime
print(datetime.now().astimezone().isoformat(timespec='seconds'))
PY
)"

mkdir -p "$(dirname "$WATCHLIST_FILE")"

QUERIES=(
  'AI stocks|-n 15'
  'trending stocks|-n 15'
  'best stock to buy|-n 10'
  '$NVDA OR $TSLA OR $AMD OR $PLTR OR $SMCI OR $ARM|-n 10'
  'stock breakout|-n 10'
)

# Common false-positive cashtags and noise tokens.
NOISE_REGEX='^(A|ALL|AM|ARE|AS|AT|BE|BEST|BUY|CEO|CFO|CIO|CTO|DD|DO|ET|FOR|GO|GOOD|HAS|HIGH|HOT|HOW|I|IN|IS|IT|ITS|JUST|LOW|LONG|ME|MOON|MY|NEW|NO|NOW|OF|ON|OR|OUR|OUT|PE|PM|PT|QQQ|RSI|SO|SPX|TO|TOP|USA|USD|US|VS|WE|YOU)$'

run_query() {
  local query="$1"
  local limit_flag="$2"

  if command -v bird >/dev/null 2>&1; then
    if bird search "$query" $limit_flag >>"$RAW_FILE" 2>/dev/null; then
      return 0
    fi
  fi

  return 1
}

: >"$RAW_FILE"
for item in "${QUERIES[@]}"; do
  IFS='|' read -r q limit_flag <<<"$item"
  run_query "$q" "$limit_flag" || true
done

if [[ ! -s "$RAW_FILE" ]]; then
  echo "No trend data collected from bird; writing/maintaining existing watchlist metadata."
fi

# Extract cashtags: $ followed by 1-5 letters. Convert to uppercase ticker symbols.
grep -Eo '\$[A-Za-z]{1,5}' "$RAW_FILE" 2>/dev/null \
  | tr -d '$' \
  | tr '[:lower:]' '[:upper:]' \
  | grep -Ev "$NOISE_REGEX" \
  >"$TICKERS_FILE" || true

if [[ -s "$TICKERS_FILE" ]]; then
  sort "$TICKERS_FILE" | uniq -c | awk '{print $2" "$1}' >"$COUNTS_FILE"
else
  : >"$COUNTS_FILE"
fi

python3 - "$WATCHLIST_FILE" "$COUNTS_FILE" "$TODAY" "$NOW_ISO" <<'PY'
import json
import sys
from pathlib import Path
from datetime import datetime, date, timedelta

watchlist_path = Path(sys.argv[1])
counts_path = Path(sys.argv[2])
today_str = sys.argv[3]
now_iso = sys.argv[4]
today = date.fromisoformat(today_str)

existing = {
    "updated_at": now_iso,
    "source": "x_twitter_sweep",
    "tickers": []
}

if watchlist_path.exists():
    try:
        existing = json.loads(watchlist_path.read_text())
        if not isinstance(existing, dict):
            existing = {"updated_at": now_iso, "source": "x_twitter_sweep", "tickers": []}
    except Exception:
        existing = {"updated_at": now_iso, "source": "x_twitter_sweep", "tickers": []}

# Load previous entries keyed by symbol.
by_symbol = {}
for item in existing.get("tickers", []):
    symbol = str(item.get("symbol", "")).upper().strip()
    if not symbol:
        continue
    mentions = int(item.get("mentions", 0) or 0)
    first_seen = str(item.get("first_seen", today_str))
    last_seen = str(item.get("last_seen", today_str))
    by_symbol[symbol] = {
        "symbol": symbol,
        "mentions": max(0, mentions),
        "first_seen": first_seen,
        "last_seen": last_seen,
    }

# Merge fresh counts.
if counts_path.exists():
    for line in counts_path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) != 2:
            continue
        symbol, count_raw = parts
        try:
            count = int(count_raw)
        except ValueError:
            continue
        symbol = symbol.upper().strip()
        if not symbol:
            continue

        if symbol in by_symbol:
            by_symbol[symbol]["mentions"] += count
            by_symbol[symbol]["last_seen"] = today_str
        else:
            by_symbol[symbol] = {
                "symbol": symbol,
                "mentions": count,
                "first_seen": today_str,
                "last_seen": today_str,
            }

# Prune stale entries not seen in 7+ days.
cutoff = today - timedelta(days=7)
pruned = []
for item in by_symbol.values():
    try:
        last_seen_date = date.fromisoformat(item["last_seen"])
    except Exception:
        last_seen_date = today
    if last_seen_date >= cutoff:
        pruned.append(item)

pruned.sort(key=lambda x: (-int(x.get("mentions", 0)), x.get("symbol", "")))

result = {
    "updated_at": now_iso,
    "source": "x_twitter_sweep",
    "tickers": pruned,
}

watchlist_path.write_text(json.dumps(result, indent=2) + "\n")
print(f"Wrote {watchlist_path} with {len(pruned)} tickers")
PY

rm -rf "$TMP_DIR"
