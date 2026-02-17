# Whoop Service

A simplified Whoop API service for personal use with clawd bot.

## What This Service Does

Provides a single HTTP endpoint that returns all your Whoop data (profile, body measurements, cycles, recovery, sleep, workouts). The service handles OAuth token management automatically, including refreshing expired tokens.

## Architecture

```
/services/
├── .env                    # WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, WHOOP_REDIRECT_URL
├── go.mod
├── main.go                 # Starts Gin server on :8080
├── whoop_tokens.json             # OAuth tokens (created after first auth)
└── whoop/
    ├── api.go              # Whoop API client
    ├── handler.go          # HTTP handlers
    └── token_store.go      # JSON token storage
```

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/auth/url` | Returns Whoop authorization URL |
| GET | `/auth/callback` | OAuth callback (handles token exchange) |
| GET | `/whoop/data` | Returns all Whoop data as JSON |

## Setup (One-Time)

1. Start the server:
   ```bash
   cd /Users/hameldesai/Desktop/services
   source .env && go run main.go
   ```

2. Visit `http://localhost:8080/auth/url` and open the returned URL in browser

3. Authorize with Whoop - tokens are saved to `whoop_tokens.json`

4. Server is now ready to serve data

## Running the Service

```bash
cd /Users/hameldesai/Desktop/services
source .env && go run main.go
```

Server runs on `http://localhost:8080`

---

# Instructions for Clawd Bot

## How to Get Whoop Data

Make an HTTP GET request to:
```
http://localhost:8080/whoop/data
```

No authentication headers needed. The service handles everything.

## Response Format

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
      "start": "2024-01-01T00:00:00Z",
      "end": "2024-01-02T00:00:00Z",
      "strain": 12.5,
      "kilojoules": 8500
    }
  ],
  "recovery": [
    {
      "cycle_id": 123,
      "score": 85,
      "hrv": 45.2,
      "resting_heart_rate": 52
    }
  ],
  "sleep": [
    {
      "id": 456,
      "start": "2024-01-01T22:00:00Z",
      "end": "2024-01-02T06:30:00Z",
      "score": 88,
      "quality_duration": 28800
    }
  ],
  "workouts": [
    {
      "id": 789,
      "sport_id": 1,
      "start": "2024-01-01T07:00:00Z",
      "end": "2024-01-01T08:00:00Z",
      "strain": 15.2
    }
  ]
}
```

## Token Refresh

**You do not need to handle token refresh.** The `/whoop/data` endpoint automatically:

1. Checks if the access token is expired (or expires within 1 minute)
2. Uses the refresh token to get a new access token from Whoop
3. Saves the new tokens to `whoop_tokens.json`
4. Returns the data

The refresh token has a long lifespan. As long as the service is called periodically (at least once every few months), tokens will stay valid indefinitely through automatic refresh.

## Error Responses

| Status | Meaning |
|--------|---------|
| 200 | Success - data returned |
| 401 | Not authenticated - need to run OAuth flow again |
| 502 | Whoop API error or token refresh failed |

## Example Usage (curl)

```bash
curl http://localhost:8080/whoop/data
```

## Example Usage (Python)

```python
import requests

response = requests.get("http://localhost:8080/whoop/data")
data = response.json()

# Access specific data
recovery_score = data["recovery"][0]["score"]
last_sleep = data["sleep"][0]
```

## Rate Limits

The Whoop API has the following rate limits:

| Limit | Value |
|-------|-------|
| Per Minute | 100 requests |
| Per Day | 10,000 requests |

**Note**: Each call to `/whoop/data` makes ~6 internal Whoop API requests (profile, body measurement, cycles, recovery, sleep, workouts). So you're effectively using 6 requests per call.

**Recommendation**: Don't call `/whoop/data` more than a few times per minute. For typical bot usage (checking recovery/sleep once or twice a day), you'll never hit these limits.

---

## Data Definitions

### Recovery Score
- 0-33: Red (poor recovery)
- 34-66: Yellow (moderate recovery)
- 67-100: Green (good recovery)

### Strain
- 0-21 scale measuring cardiovascular load
- Light: 0-9
- Moderate: 10-13
- Strenuous: 14-17
- All Out: 18-21

### Sleep Score
- 0-100 percentage of sleep need achieved
- Factors: duration, efficiency, disturbances, REM/SWS time
