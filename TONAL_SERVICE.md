# Tonal Service

A Tonal fitness API service for personal use with clawd bot.

## What This Service Does

Provides a single HTTP endpoint that returns all your Tonal data (profile, workouts, strength scores). The service handles OAuth token management automatically and implements smart incremental caching to build a complete workout history over time.

## Architecture

```
/services/
├── .env                    # TONAL_EMAIL, TONAL_PASSWORD
├── main.go                 # Starts Gin server on :8080 (shared with Whoop)
├── tonal_tokens.json       # OAuth tokens (created after first auth)
├── tonal_data.json         # Cached workout data (grows over time)
└── tonal/
    ├── api.go              # Tonal API client + authentication
    ├── handler.go          # HTTP handler
    └── store.go            # Token + cache storage
```

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/tonal/data` | Returns profile, workouts, and strength scores |

## Setup (One-Time)

1. Add your Tonal credentials to `.env`:
   ```bash
   TONAL_EMAIL=your-email@example.com
   TONAL_PASSWORD=your-password
   ```

2. Start the server:
   ```bash
   cd /Users/hameldesai/Desktop/services
   source .env && go run main.go
   ```

3. The first request to `/tonal/data` will authenticate automatically

**No browser authorization needed** - Tonal uses password-based authentication.

## Running the Service

```bash
cd /Users/hameldesai/Desktop/services
source .env && go run main.go
```

Server runs on `http://localhost:8080`

---

# Instructions for Clawd Bot

## How to Get Tonal Data

Make an HTTP GET request to:
```
http://localhost:8080/tonal/data
```

No authentication headers needed. The service handles everything.

## Response Format

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
    },
    "workout-uuid-2": {
      "id": "workout-uuid-2",
      "workoutType": "PROGRAM",
      "workoutName": "Upper Body Power",
      "beginTime": "2024-01-14T07:00:00Z",
      "endTime": "2024-01-14T07:30:00Z",
      "totalVolume": 6200,
      "totalReps": 90,
      "totalSets": 18,
      "totalTime": 1800
    }
  },
  "workout_count": 150,
  "strength_scores": {
    "current": [
      {
        "muscleGroup": "FULL_BODY",
        "score": 450
      },
      {
        "muscleGroup": "UPPER",
        "score": 425
      },
      {
        "muscleGroup": "CORE",
        "score": 380
      },
      {
        "muscleGroup": "LOWER",
        "score": 520
      }
    ],
    "history": [
      {
        "date": "2024-01-15",
        "muscleGroup": "FULL_BODY",
        "score": 450
      },
      {
        "date": "2024-01-08",
        "muscleGroup": "FULL_BODY",
        "score": 445
      }
    ]
  },
  "last_updated": "2024-01-15T19:00:00Z"
}
```

## Data Caching (Important)

The Tonal service uses **smart incremental caching**:

1. **First call**: Fetches the last 50 workouts from Tonal API and saves to `tonal_data.json`
2. **Subsequent calls**: Fetches the last 50 workouts and **merges** them into the existing cache
3. **Over time**: Your complete workout history builds up in the cache

**Why this matters**: Tonal's API only returns the most recent workouts per request. By caching and merging, the service accumulates your full history. The `workout_count` field shows total cached workouts.

**Workouts are keyed by ID** - no duplicates will occur even if you call the endpoint multiple times.

## Token Refresh

**You do not need to handle token refresh.** The `/tonal/data` endpoint automatically:

1. Checks if the ID token is expired (or expires within 1 minute)
2. Tries refresh-token auth first (no manual token file deletion needed)
3. Falls back to password auth only if refresh fails
4. Saves the updated token set to `tonal_tokens.json`
5. Returns the data

Tokens are short-lived (~24 hours), and the service handles refresh automatically from stored credentials/refresh token.

## Error Responses

| Status | Meaning |
|--------|---------|
| 200 | Success - data returned |
| 401 | Authentication failed - check credentials in .env |
| 502 | Tonal API error |

## Example Usage (curl)

```bash
curl http://localhost:8080/tonal/data
```

## Example Usage (Python)

```python
import requests

response = requests.get("http://localhost:8080/tonal/data")
data = response.json()

# Access specific data
full_body_score = next(
    s["score"] for s in data["strength_scores"]["current"]
    if s["muscleGroup"] == "FULL_BODY"
)
total_workouts = data["workout_count"]
last_workout = max(data["workouts"].values(), key=lambda w: w["beginTime"])
```

## Rate Limits

Tonal's rate limits are not publicly documented. The service implements:

- **500ms delay** between each API call
- Each `/tonal/data` request makes **5-6 API calls** internally

**Recommendation**: Don't call `/tonal/data` more than a few times per hour. The caching system means you get full history on each call anyway.

## When to Fetch Data

| Use Case | Frequency |
|----------|-----------|
| Daily workout summary | Once per day |
| Strength score tracking | Once per week |
| After completing a workout | Wait 5-10 minutes, then fetch once |
| Building initial history | Call once per day for a week to accumulate data |

**Note**: Tonal data doesn't change as frequently as Whoop (no continuous monitoring). Workout data is only added when you complete a Tonal session.

---

## Data Definitions

### Strength Score
- Tonal's proprietary measure of your strength
- Measured per muscle group: FULL_BODY, UPPER, CORE, LOWER
- Higher is stronger (typical range: 200-1000+)
- Updates after workouts that test the relevant muscle groups

### Workout Types
| Type | Description |
|------|-------------|
| PROGRAM | Guided Tonal program workout |
| CUSTOM | User-created custom workout |
| QUICK_FIT | Quick workout session |
| FREE_LIFT | Free lifting mode |
| MOVEMENT | Movement/mobility focused |

### Volume
- Total weight lifted in pounds (sum of all reps × weight)
- Example: 10 reps × 50 lbs = 500 lbs volume

### Workout Fields
| Field | Description |
|-------|-------------|
| `id` | Unique workout identifier |
| `workoutType` | Type of workout (see above) |
| `workoutName` | Name of the workout/program |
| `beginTime` | ISO timestamp when workout started |
| `endTime` | ISO timestamp when workout ended |
| `totalVolume` | Total weight lifted (lbs) |
| `totalReps` | Total repetitions completed |
| `totalSets` | Total sets completed |
| `totalTime` | Duration in seconds |
