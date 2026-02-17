package tonal

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// Service holds the Tonal API client configuration and state.
type Service struct {
	HTTPClient   *http.Client
	Logger       *log.Logger
	Email        string
	Password     string
	TokenPath    string
	DataPath     string
	RequestDelay time.Duration

	// mu is a Mutex (mutual exclusion lock) that prevents race conditions.
	//
	// WHAT IS A RACE CONDITION?
	// When two goroutines (concurrent operations) access shared data simultaneously,
	// and at least one is writing, you get unpredictable behavior. For example:
	//   - Request A reads cache file
	//   - Request B reads cache file (same old data)
	//   - Request A adds workout X, writes file
	//   - Request B adds workout Y, writes file (overwrites A's changes!)
	//   - Result: workout X is lost
	//
	// HOW MUTEX SOLVES THIS:
	// A mutex is like a bathroom lock - only one person can hold it at a time.
	//   - mu.Lock()   = lock the door, others must wait
	//   - mu.Unlock() = unlock the door, next person can enter
	//
	// With mutex:
	//   - Request A locks, reads, modifies, writes, unlocks
	//   - Request B waits... then locks, reads (sees A's changes), modifies, writes, unlocks
	//   - Result: both workouts preserved
	//
	// IMPORTANT: Always use defer mu.Unlock() right after Lock() to ensure
	// the lock is released even if the function returns early or panics.
	mu sync.Mutex
}

const (
	// workoutFetchLimit is the number of recent workouts to fetch per request.
	// Tonal's API is paginated, so we fetch the most recent N and merge into cache.
	workoutFetchLimit = 50
)

type DataResponse struct {
	Profile        map[string]any     `json:"profile"`
	Workouts       map[string]any     `json:"workouts"`
	WorkoutCount   int                `json:"workout_count"`
	StrengthScores *StrengthScoreData `json:"strength_scores"`
	LastUpdated    time.Time          `json:"last_updated"`
}

// HealthHandler checks if Tonal authentication is working.
// Returns 200 if healthy, 503 if auth fails.
func (s *Service) HealthHandler(c *gin.Context) {
	ctx := c.Request.Context()

	token, err := s.getValidToken(ctx)
	if err != nil {
		s.Logger.Printf("health check failed - auth error: %v", err)
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status":  "unhealthy",
			"error":   "authentication failed",
			"details": err.Error(),
		})
		return
	}

	// Quick user info check to verify token actually works
	userID, err := s.getUserInfo(ctx, token)
	if err != nil {
		s.Logger.Printf("health check failed - user info error: %v", err)
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status":  "unhealthy",
			"error":   "failed to get user info",
			"details": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":  "healthy",
		"user_id": userID,
	})
}

func (s *Service) DataHandler(c *gin.Context) {
	// ctx (context) carries request-scoped data and cancellation signals.
	// When a client disconnects, ctx.Done() becomes readable, signaling cancellation.
	ctx := c.Request.Context()

	token, err := s.getValidToken(ctx)
	if err != nil {
		s.Logger.Printf("authentication failed: %v", err)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication failed", "details": err.Error()})
		return
	}

	// Lock the mutex before accessing shared resources (cache files).
	// This ensures only one request can read/modify the cache at a time.
	s.mu.Lock()
	// defer ensures Unlock() runs when this function exits, even if we return early.
	// Without defer, we'd need to call Unlock() before every return statement.
	defer s.mu.Unlock()

	cache, err := LoadCache(s.DataPath)
	if err != nil {
		cache = &TonalCache{
			Workouts: make(map[string]any),
		}
	}

	userID, err := s.getUserInfo(ctx, token)
	if err != nil {
		s.Logger.Printf("failed to get user info: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to get user info"})
		return
	}
	cache.UserID = userID

	if err := s.rateLimitDelay(ctx); err != nil {
		return // Client disconnected, exit gracefully
	}

	profile, err := s.getProfile(ctx, token, userID)
	if err != nil {
		s.Logger.Printf("failed to get profile: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to get profile"})
		return
	}
	cache.Profile = profile

	if err := s.rateLimitDelay(ctx); err != nil {
		return
	}

	// Extract totalWorkouts from profile to calculate proper offset for recent workouts
	totalWorkouts := 0
	if tw, ok := profile["totalWorkouts"].(float64); ok {
		totalWorkouts = int(tw)
	}

	workouts, err := s.getWorkoutActivities(ctx, token, userID, workoutFetchLimit, totalWorkouts)
	if err != nil {
		s.Logger.Printf("failed to get workouts: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to get workouts"})
		return
	}

	// Merge fetched workouts into cache, keyed by ID to prevent duplicates.
	// Handle both string IDs and numeric IDs (JSON numbers decode as float64).
	for _, w := range workouts {
		var id string
		switch v := w["id"].(type) {
		case string:
			id = v
		case float64:
			id = fmt.Sprintf("%.0f", v)
		default:
			continue // Skip workouts without a valid ID
		}
		cache.Workouts[id] = w
	}

	if err := s.rateLimitDelay(ctx); err != nil {
		return
	}

	currentScores, err := s.getStrengthScoresCurrent(ctx, token, userID)
	if err != nil {
		s.Logger.Printf("failed to get current strength scores: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to get current strength scores"})
		return
	}

	if err := s.rateLimitDelay(ctx); err != nil {
		return
	}

	historyScores, err := s.getStrengthScoresHistory(ctx, token, userID)
	if err != nil {
		s.Logger.Printf("failed to get strength score history: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to get strength score history"})
		return
	}

	cache.StrengthScores = &StrengthScoreData{
		Current: currentScores,
		History: historyScores,
	}

	cache.LastUpdated = time.Now()

	if err := SaveCache(s.DataPath, cache); err != nil {
		s.Logger.Printf("warning: failed to save cache: %v", err)
	}

	response := DataResponse{
		Profile:        cache.Profile,
		Workouts:       cache.Workouts,
		WorkoutCount:   len(cache.Workouts),
		StrengthScores: cache.StrengthScores,
		LastUpdated:    cache.LastUpdated,
	}

	c.JSON(http.StatusOK, response)
}

// rateLimitDelay waits for the configured delay between API calls.
// Unlike time.Sleep(), this respects context cancellation.
//
// WHY NOT JUST USE time.Sleep()?
// time.Sleep() blocks unconditionally - if a client disconnects mid-request,
// we'd still wait and then make unnecessary API calls to Tonal.
//
// HOW SELECT WORKS:
// select waits on multiple channel operations and proceeds with whichever is ready first:
//   - time.After(duration) returns a channel that receives a value after the duration
//   - ctx.Done() returns a channel that receives a value when the context is cancelled
//
// So this select says: "wait for EITHER the delay to pass OR the client to disconnect,
// whichever happens first."
func (s *Service) rateLimitDelay(ctx context.Context) error {
	select {
	case <-time.After(s.RequestDelay):
		// Delay completed normally
		return nil
	case <-ctx.Done():
		// Context was cancelled (client disconnected or timeout)
		return ctx.Err()
	}
}
