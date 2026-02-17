# Hamel's Services

Local HTTP server providing unified access to:
- **Whoop** — sleep, recovery, strain, HRV
- **Tonal** — strength workouts, strength scores
- **Alpaca** — trading portfolio, positions, trade tracking

Server runs on `localhost:8080` and handles all authentication automatically.

---

## Quick Reference for Claude

### To Get Whoop Data (sleep, recovery, strain, HRV)
```bash
curl http://localhost:8080/whoop/data
```

### To Get Tonal Data (workouts, strength scores)
```bash
curl http://localhost:8080/tonal/data
```

**No authentication headers needed.** The service handles everything internally.

---

## When to Fetch Each Service

| Question to Answer | Service | Endpoint |
|--------------------|---------|----------|
| How did Hamel sleep last night? | Whoop | `/whoop/data` |
| What's Hamel's recovery score? | Whoop | `/whoop/data` |
| What's Hamel's HRV? | Whoop | `/whoop/data` |
| How much strain did Hamel accumulate? | Whoop | `/whoop/data` |
| What Tonal workouts has Hamel done? | Tonal | `/tonal/data` |
| What's Hamel's strength score? | Tonal | `/tonal/data` |
| How much volume has Hamel lifted? | Tonal | `/tonal/data` |

**Whoop** = Passive 24/7 health monitoring (sleep, recovery, strain, heart rate)
**Tonal** = Active workout data (strength training sessions, strength scores)

---

## Whoop Data Structure

```json
{
  "profile": {
    "user_id": 123456,
    "first_name": "Hamel",
    "last_name": "Desai",
    "email": "..."
  },
  "body_measurement": {
    "height_meter": 1.83,
    "weight_kilogram": 82.5,
    "max_heart_rate": 190
  },
  "cycles": [
    {
      "id": 123,
      "start": "2024-01-15T00:00:00Z",
      "end": "2024-01-16T00:00:00Z",
      "score": {
        "strain": 12.5,
        "kilojoules": 8500
      }
    }
  ],
  "recovery": [
    {
      "cycle_id": 123,
      "score": {
        "recovery_score": 85,
        "hrv_rmssd_milli": 45.2,
        "resting_heart_rate": 52,
        "spo2_percentage": 98.5
      }
    }
  ],
  "sleep": [
    {
      "id": 456,
      "start": "2024-01-15T22:00:00Z",
      "end": "2024-01-16T06:30:00Z",
      "score": {
        "stage_summary": {
          "total_light_sleep_time_milli": 14400000,
          "total_slow_wave_sleep_time_milli": 7200000,
          "total_rem_sleep_time_milli": 5400000,
          "total_awake_time_milli": 1800000
        },
        "sleep_performance_percentage": 88,
        "sleep_efficiency_percentage": 92
      }
    }
  ],
  "workouts": [
    {
      "id": 789,
      "sport_id": 1,
      "start": "2024-01-15T07:00:00Z",
      "end": "2024-01-15T08:00:00Z",
      "score": {
        "strain": 15.2,
        "average_heart_rate": 145,
        "max_heart_rate": 175,
        "kilojoule": 2500
      }
    }
  ]
}
```

### Key Whoop Metrics

| Metric | Location | Interpretation |
|--------|----------|----------------|
| Recovery Score | `recovery[0].score.recovery_score` | 0-33 red (poor), 34-66 yellow (moderate), 67-100 green (good) |
| HRV | `recovery[0].score.hrv_rmssd_milli` | Higher = better recovery, varies by individual |
| Resting HR | `recovery[0].score.resting_heart_rate` | Lower generally = better fitness |
| Strain | `cycles[0].score.strain` | 0-21 scale. Light: 0-9, Moderate: 10-13, Hard: 14-17, All Out: 18-21 |
| Sleep Performance | `sleep[0].score.sleep_performance_percentage` | % of sleep need achieved |

### Whoop Data Notes
- Data is sorted most recent first
- `cycles` = 24-hour periods (day strain)
- `recovery` = morning recovery assessment
- `sleep` = individual sleep sessions
- `workouts` = detected or logged activities (not Tonal-specific)

---

## Tonal Data Structure

```json
{
  "profile": {
    "userId": "abc123",
    "firstName": "Hamel",
    "lastName": "Desai",
    "totalWorkouts": 150,
    "totalVolume": 1250000,
    "memberSince": "2022-01-15T00:00:00Z"
  },
  "workouts": {
    "workout-uuid-1": {
      "id": "workout-uuid-1",
      "workoutType": "CUSTOM",
      "workoutName": "Full Body Strength",
      "beginTime": "2024-01-15T18:00:00Z",
      "endTime": "2024-01-15T18:45:00Z",
      "totalVolume": 8500,
      "totalReps": 120,
      "totalSets": 24,
      "totalTime": 2700
    }
  },
  "workout_count": 150,
  "strength_scores": {
    "current": [
      {"muscleGroup": "FULL_BODY", "score": 450},
      {"muscleGroup": "UPPER", "score": 425},
      {"muscleGroup": "CORE", "score": 380},
      {"muscleGroup": "LOWER", "score": 520}
    ],
    "history": [
      {"date": "2024-01-15", "muscleGroup": "FULL_BODY", "score": 450},
      {"date": "2024-01-08", "muscleGroup": "FULL_BODY", "score": 445}
    ]
  },
  "last_updated": "2024-01-15T19:00:00Z"
}
```

### Key Tonal Metrics

| Metric | Location | Interpretation |
|--------|----------|----------------|
| Overall Strength | `strength_scores.current` (FULL_BODY) | Tonal's strength measure, higher = stronger |
| Total Volume | `profile.totalVolume` or sum workout volumes | Total lbs lifted (lifetime or per workout) |
| Workout Count | `workout_count` | Total cached workouts |
| Last Workout | Find max `beginTime` in `workouts` | Most recent training session |

### Tonal Data Notes
- **Workouts are cached incrementally** - each API call fetches recent workouts and merges them into the cache
- `workouts` is a map keyed by workout ID (not an array)
- `workout_count` reflects total cached workouts, grows over time
- Strength scores update after workouts that test relevant muscle groups
- `totalVolume` in workouts = total weight lifted in that session (reps × weight)

### Workout Types
| Type | Description |
|------|-------------|
| PROGRAM | Guided Tonal program |
| CUSTOM | User-created workout |
| QUICK_FIT | Quick session |
| FREE_LIFT | Free lifting mode |
| MOVEMENT | Mobility focused |

---

## Error Handling

| Status | Meaning | Action |
|--------|---------|--------|
| 200 | Success | Parse and use the data |
| 401 | Auth failed | Whoop: need to re-auth via browser. Tonal: check credentials in .env |
| 502 | API error | Upstream service issue, try again later |

If you get a 401 from Whoop, tell the user to run the OAuth flow:
1. Visit `http://localhost:8080/auth/url`
2. Open the returned URL in browser
3. Authorize with Whoop

Tonal 401 means credentials in `.env` are wrong.

---

## Rate Limiting

**Whoop**: 100 requests/minute, 10,000/day. Each `/whoop/data` call uses ~6 internal requests.

**Tonal**: Unknown limits. Service adds 500ms delay between calls. Each `/tonal/data` call makes ~5-6 internal requests.

**Recommendation**: Don't call either endpoint more than a few times per minute. For typical usage (checking once or twice a day), you'll never hit limits.

---

## Example Python Code

```python
import requests

# Get Whoop data
whoop = requests.get("http://localhost:8080/whoop/data").json()
recovery = whoop["recovery"][0]["score"]["recovery_score"]
hrv = whoop["recovery"][0]["score"]["hrv_rmssd_milli"]
strain = whoop["cycles"][0]["score"]["strain"]
sleep_perf = whoop["sleep"][0]["score"]["sleep_performance_percentage"]

print(f"Recovery: {recovery}%, HRV: {hrv}ms, Strain: {strain}, Sleep: {sleep_perf}%")

# Get Tonal data
tonal = requests.get("http://localhost:8080/tonal/data").json()
strength = next(s["score"] for s in tonal["strength_scores"]["current"] if s["muscleGroup"] == "FULL_BODY")
total_workouts = tonal["workout_count"]
last_workout = max(tonal["workouts"].values(), key=lambda w: w["beginTime"])

print(f"Strength: {strength}, Workouts: {total_workouts}, Last: {last_workout['workoutName']}")
```

---

## Architecture

```
/Users/hameldesai/Desktop/services/
├── .env                     # Credentials (WHOOP_*, TONAL_*)
├── main.go                  # Server entry point, runs on :8080
├── whoop_tokens.json        # Whoop OAuth tokens (auto-managed)
├── tonal_tokens.json        # Tonal auth tokens (auto-managed)
├── tonal_data.json          # Tonal workout cache (grows over time)
├── whoop/
│   ├── api.go               # Whoop API client
│   ├── handler.go           # /whoop/data, /auth/url, /auth/callback
│   └── token_store.go       # Token persistence
└── tonal/
    ├── api.go               # Tonal API client + auth
    ├── handler.go           # /tonal/data handler
    └── store.go             # Token + cache persistence
```

## Running the Server

```bash
cd /Users/hameldesai/Desktop/services
source .env && go run main.go
```

Server listens on `http://localhost:8080`.

---

---

## Alpaca Trading Data

### Endpoints

| Endpoint | Description |
|----------|-------------|
| `/alpaca/health` | Check API connection status |
| `/alpaca/account` | Account balances, buying power |
| `/alpaca/positions` | Current holdings with P&L |
| `/alpaca/portfolio` | Combined account + positions |
| `/alpaca/trades` | Trade recommendations tracked |
| `/alpaca/stats` | Win rate, total P&L |

### Quick Commands
```bash
# Portfolio summary
curl http://localhost:8080/alpaca/portfolio

# Trading statistics
curl http://localhost:8080/alpaca/stats

# Log a trade recommendation
curl -X POST http://localhost:8080/alpaca/trades \
  -H "Content-Type: application/json" \
  -d '{"symbol":"CRWD","action":"BUY","score":10,"entry_price":382.50,"stop_loss":352.00,"shares":10,"reasoning":"CANSLIM breakout"}'

# Update trade status (executed, declined, closed)
curl -X PUT http://localhost:8080/alpaca/trades/T123 \
  -H "Content-Type: application/json" \
  -d '{"status":"executed","executed_price":382.50}'
```

### Portfolio Response
```json
{
  "account": {
    "cash": "100000",
    "equity": "100000",
    "buying_power": "200000",
    "status": "ACTIVE"
  },
  "positions": [
    {
      "symbol": "AAPL",
      "qty": "10",
      "market_value": "2500",
      "unrealized_pl": "125",
      "unrealized_plpc": "5.2"
    }
  ],
  "timestamp": "2026-02-15T20:00:00-05:00"
}
```

### Trade Tracking Stats
```json
{
  "total_recommendations": 12,
  "executed": 8,
  "declined": 4,
  "closed": 5,
  "wins": 3,
  "losses": 2,
  "win_rate": 60,
  "total_pnl": 1250.50
}
```

### Configuration
API keys stored in `alpaca_keys.json`:
```json
{
  "key_id": "YOUR_KEY",
  "secret_key": "YOUR_SECRET",
  "base_url": "https://paper-api.alpaca.markets",
  "data_url": "https://data.alpaca.markets"
}
```

---

## Summary for Claude

1. **Need sleep/recovery/strain/HRV?** → `curl http://localhost:8080/whoop/data`
2. **Need workouts/strength scores?** → `curl http://localhost:8080/tonal/data`
3. **Need portfolio/positions/trades?** → `curl http://localhost:8080/alpaca/portfolio`
4. **No auth headers needed** - service handles tokens internally
5. **Don't over-fetch** - once or twice per conversation is plenty
6. **Parse the JSON** - key metrics listed in tables above
7. **Errors?** - 401 = auth issue, 502 = upstream problem
