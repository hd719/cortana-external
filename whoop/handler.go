package whoop

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

const whoopAuthURL = "https://api.prod.whoop.com/oauth/oauth2/auth"
const whoopTokenURL = "https://api.prod.whoop.com/oauth/oauth2/token"

// Cache configuration
const (
	defaultCacheTTL  = 5 * time.Minute
	tokenRefreshSkew = 10 * time.Minute
)

type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token,omitempty"`
	ExpiresIn    int64  `json:"expires_in"`
	Scope        string `json:"scope"`
	TokenType    string `json:"token_type"`
}

// whoopDataCache represents an in-memory cache for Whoop data
type whoopDataCache struct {
	data      *WhoopData
	lastFetch time.Time
	mu        sync.RWMutex
	ttl       time.Duration
}

type Service struct {
	HTTPClient   *http.Client
	Logger       *log.Logger
	ClientID     string
	ClientSecret string
	RedirectURL  string
	TokenPath    string
	DataPath     string
	cache        *whoopDataCache
}

func (s *Service) AuthURLHandler(c *gin.Context) {
	params := url.Values{}
	params.Set("client_id", s.ClientID)
	params.Set("redirect_uri", s.RedirectURL)
	params.Set("response_type", "code")
	params.Set("scope", "read:profile read:body_measurement read:cycles read:recovery read:sleep read:workout offline")
	params.Set("state", "whoopauth") // Simple static state for single-user personal use

	authURL := whoopAuthURL + "?" + params.Encode()
	c.JSON(http.StatusOK, gin.H{"url": authURL})
}

func (s *Service) CallbackHandler(c *gin.Context) {
	if errParam := c.Query("error"); errParam != "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":       errParam,
			"description": c.Query("error_description"),
		})
		return
	}

	code := c.Query("code")
	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing code parameter"})
		return
	}

	token, err := s.exchangeToken(c.Request.Context(), code)
	if err != nil {
		if s.Logger != nil {
			s.Logger.Printf("token exchange failed: %v", err)
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": "token exchange failed"})
		return
	}

	now := time.Now()
	tokens := &TokenData{
		AccessToken:   token.AccessToken,
		RefreshToken:  token.RefreshToken,
		ExpiresAt:     now.Add(time.Duration(token.ExpiresIn) * time.Second),
		LastRefreshAt: now,
	}

	if err := SaveTokens(s.TokenPath, tokens); err != nil {
		if s.Logger != nil {
			s.Logger.Printf("failed to save tokens: %v", err)
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save tokens"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok", "message": "tokens saved successfully"})
}

func (s *Service) AuthStatusHandler(c *gin.Context) {
	tokens, err := LoadTokens(s.TokenPath)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"has_token":             false,
			"token_path":            s.TokenPath,
			"error":                 err.Error(),
			"refresh_token_present": false,
		})
		return
	}

	now := time.Now()
	expiresIn := int64(tokens.ExpiresAt.Sub(now).Seconds())
	if tokens.ExpiresAt.IsZero() {
		expiresIn = 0
	}

	c.JSON(http.StatusOK, gin.H{
		"has_token":             true,
		"token_path":            s.TokenPath,
		"expires_at":            tokens.ExpiresAt,
		"expires_in_seconds":    expiresIn,
		"is_expired":            !tokens.ExpiresAt.IsZero() && now.After(tokens.ExpiresAt),
		"needs_refresh":         s.tokenNeedsRefresh(tokens),
		"last_refresh_at":       tokens.LastRefreshAt,
		"refresh_token_present": tokens.RefreshToken != "",
	})
}

func (s *Service) DataHandler(c *gin.Context) {
	forceFresh := c.Query("fresh") == "true"
	data, statusCode, errPayload, servedStale := s.getWhoopData(c.Request.Context(), forceFresh)
	if errPayload != nil {
		c.JSON(statusCode, errPayload)
		return
	}
	if servedStale {
		c.Header("Warning", `110 - "Serving stale Whoop cache after token refresh failure"`)
	}

	c.JSON(http.StatusOK, data)
}

func (s *Service) RecoveryHandler(c *gin.Context) {
	forceFresh := c.Query("fresh") == "true"
	data, statusCode, errPayload, servedStale := s.getWhoopData(c.Request.Context(), forceFresh)
	if errPayload != nil {
		c.JSON(statusCode, errPayload)
		return
	}
	if servedStale {
		c.Header("Warning", `110 - "Serving stale Whoop cache after token refresh failure"`)
	}

	c.JSON(http.StatusOK, gin.H{"recovery": data.Recovery})
}

func (s *Service) RecoveryLatestHandler(c *gin.Context) {
	forceFresh := c.Query("fresh") == "true"
	data, statusCode, errPayload, servedStale := s.getWhoopData(c.Request.Context(), forceFresh)
	if errPayload != nil {
		c.JSON(statusCode, errPayload)
		return
	}
	if servedStale {
		c.Header("Warning", `110 - "Serving stale Whoop cache after token refresh failure"`)
	}

	if len(data.Recovery) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "no recovery data available"})
		return
	}

	c.JSON(http.StatusOK, data.Recovery[0])
}

func (s *Service) HealthHandler(c *gin.Context) {
	tokens, err := LoadTokens(s.TokenPath)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"status":                "ok",
			"authenticated":         false,
			"token_path":            s.TokenPath,
			"refresh_token_present": false,
			"error":                 err.Error(),
		})
		return
	}

	now := time.Now()
	c.JSON(http.StatusOK, gin.H{
		"status":                "ok",
		"authenticated":         true,
		"token_path":            s.TokenPath,
		"expires_at":            tokens.ExpiresAt,
		"expires_in_seconds":    int64(tokens.ExpiresAt.Sub(now).Seconds()),
		"is_expired":            !tokens.ExpiresAt.IsZero() && now.After(tokens.ExpiresAt),
		"needs_refresh":         s.tokenNeedsRefresh(tokens),
		"refresh_token_present": tokens.RefreshToken != "",
	})
}

func (s *Service) getWhoopData(ctx context.Context, forceFresh bool) (*WhoopData, int, gin.H, bool) {
	// Initialize cache if not already done (lazy initialization for backward compatibility)
	if s.cache == nil {
		s.cache = &whoopDataCache{ttl: defaultCacheTTL}
	}

	// Check cache first - serve immediately if data is fresh unless cache-busted.
	if !forceFresh {
		if cachedData, isFresh := s.cache.get(); isFresh {
			return cachedData, 0, nil, false
		}
	}

	tokens, err := LoadTokens(s.TokenPath)
	if err != nil {
		return nil, http.StatusUnauthorized, gin.H{"error": "not authenticated - visit /auth/url to authenticate"}, false
	}

	if err := s.ensureValidToken(ctx, tokens); err != nil {
		if s.Logger != nil {
			s.Logger.Printf("token validation/refresh failed: %v", err)
		}

		// Best-effort fallback: serve stale disk cache when token refresh fails.
		if cachedData, cacheErr := s.loadDataFromDisk(); cacheErr == nil && cachedData != nil {
			s.cache.set(cachedData)
			if s.Logger != nil {
				s.Logger.Printf("serving stale Whoop cache from disk due to token refresh failure")
			}
			return cachedData, 0, nil, true
		}

		return nil, http.StatusBadGateway, gin.H{"error": "token refresh failed"}, false
	}

	data, err := s.fetchAllWhoopData(ctx, tokens.AccessToken)
	if err != nil {
		if s.Logger != nil {
			s.Logger.Printf("failed to fetch whoop data: %v", err)
		}
		return nil, http.StatusBadGateway, gin.H{"error": "failed to fetch whoop data"}, false
	}

	// Update cache with fresh data
	s.cache.set(data)
	if err := s.saveDataToDisk(data); err != nil && s.Logger != nil {
		s.Logger.Printf("warning: failed to persist Whoop cache: %v", err)
	}

	return data, 0, nil, false
}

func (s *Service) tokenNeedsRefresh(tokens *TokenData) bool {
	if tokens == nil {
		return true
	}
	if tokens.ExpiresAt.IsZero() {
		return true
	}
	return time.Now().After(tokens.ExpiresAt.Add(-1 * tokenRefreshSkew))
}

func (s *Service) ensureValidToken(ctx context.Context, tokens *TokenData) error {
	if !s.tokenNeedsRefresh(tokens) {
		return nil
	}

	if tokens.RefreshToken == "" {
		return fmt.Errorf("token expired and no refresh token available")
	}

	if s.Logger != nil {
		s.Logger.Printf("attempting token refresh (expires_at=%s)", tokens.ExpiresAt.Format(time.RFC3339))
	}

	refreshed, err := s.refreshTokenWithRetry(ctx, tokens.RefreshToken)
	if err != nil {
		return fmt.Errorf("refresh request failed: %w", err)
	}

	now := time.Now()
	tokens.AccessToken = refreshed.AccessToken
	if refreshed.RefreshToken != "" {
		tokens.RefreshToken = refreshed.RefreshToken
	}
	if refreshed.ExpiresIn > 0 {
		tokens.ExpiresAt = now.Add(time.Duration(refreshed.ExpiresIn) * time.Second)
	}
	tokens.LastRefreshAt = now

	if err := SaveTokens(s.TokenPath, tokens); err != nil {
		if s.Logger != nil {
			s.Logger.Printf("warning: refreshed token obtained but failed to persist to disk: %v", err)
		}
		return nil
	}

	if s.Logger != nil {
		s.Logger.Printf("token refresh succeeded (new_expiry=%s, refresh_token_rotated=%t)", tokens.ExpiresAt.Format(time.RFC3339), refreshed.RefreshToken != "")
	}

	return nil
}

func (s *Service) exchangeToken(ctx context.Context, code string) (*TokenResponse, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("client_id", s.ClientID)
	form.Set("client_secret", s.ClientSecret)
	form.Set("redirect_uri", s.RedirectURL)

	req, err := http.NewRequestWithContext(ctx, "POST", whoopTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := s.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return nil, fmt.Errorf("token endpoint returned status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var token TokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&token); err != nil {
		return nil, err
	}
	return &token, nil
}

// NewService creates a new Service with initialized cache
func NewService(httpClient *http.Client, logger *log.Logger, clientID, clientSecret, redirectURL, tokenPath string) *Service {
	return &Service{
		HTTPClient:   httpClient,
		Logger:       logger,
		ClientID:     clientID,
		ClientSecret: clientSecret,
		RedirectURL:  redirectURL,
		TokenPath:    tokenPath,
		DataPath:     "whoop_data.json",
		cache: &whoopDataCache{
			ttl: defaultCacheTTL,
		},
	}
}

// isStale checks if the cached data is stale
func (c *whoopDataCache) isStale() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.data == nil || time.Since(c.lastFetch) > c.ttl
}

// get returns cached data if available and fresh
func (c *whoopDataCache) get() (*WhoopData, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.data == nil || time.Since(c.lastFetch) > c.ttl {
		return nil, false
	}
	return c.data, true
}

// set updates the cache with new data
func (c *whoopDataCache) set(data *WhoopData) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.data = data
	c.lastFetch = time.Now()
}

func (s *Service) refreshToken(ctx context.Context, refreshToken string) (*TokenResponse, error) {
	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", refreshToken)
	form.Set("client_id", s.ClientID)
	form.Set("client_secret", s.ClientSecret)

	req, err := http.NewRequestWithContext(ctx, "POST", whoopTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := s.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return nil, fmt.Errorf("refresh token endpoint returned status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var token TokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&token); err != nil {
		return nil, err
	}
	return &token, nil
}

func (s *Service) refreshTokenWithRetry(ctx context.Context, refreshToken string) (*TokenResponse, error) {
	backoffs := []time.Duration{0, 2 * time.Second, 5 * time.Second}
	var lastErr error

	for attempt, backoff := range backoffs {
		if backoff > 0 {
			if s.Logger != nil {
				s.Logger.Printf("retrying Whoop token refresh in %s (attempt %d/%d)", backoff, attempt+1, len(backoffs))
			}
			select {
			case <-time.After(backoff):
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}

		refreshed, err := s.refreshToken(ctx, refreshToken)
		if err == nil {
			return refreshed, nil
		}
		lastErr = err
		if s.Logger != nil {
			s.Logger.Printf("Whoop token refresh attempt %d/%d failed: %v", attempt+1, len(backoffs), err)
		}
	}

	return nil, lastErr
}

func (s *Service) loadDataFromDisk() (*WhoopData, error) {
	if s.DataPath == "" {
		return nil, fmt.Errorf("data path not configured")
	}
	data, err := os.ReadFile(s.DataPath)
	if err != nil {
		return nil, err
	}
	var payload WhoopData
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, err
	}
	return &payload, nil
}

func (s *Service) saveDataToDisk(data *WhoopData) error {
	if s.DataPath == "" {
		return fmt.Errorf("data path not configured")
	}
	payload, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.DataPath, payload, 0600)
}

// Warmup validates Whoop auth state at startup so auth issues are visible early.
func (s *Service) Warmup(ctx context.Context) error {
	tokens, err := LoadTokens(s.TokenPath)
	if err != nil {
		return err
	}
	return s.ensureValidToken(ctx, tokens)
}

// ProactiveRefreshIfExpiring refreshes token ahead of expiry to avoid first-request failures.
func (s *Service) ProactiveRefreshIfExpiring(ctx context.Context, within time.Duration) error {
	tokens, err := LoadTokens(s.TokenPath)
	if err != nil {
		return err
	}
	if !tokens.ExpiresAt.IsZero() && time.Until(tokens.ExpiresAt) > within {
		return nil
	}
	return s.ensureValidToken(ctx, tokens)
}
