package whoop

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
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
	// Initialize cache if not already done (lazy initialization for backward compatibility)
	if s.cache == nil {
		s.cache = &whoopDataCache{
			ttl: defaultCacheTTL,
		}
	}

	// Check cache first - serve immediately if data is fresh
	if cachedData, isFresh := s.cache.get(); isFresh {
		c.JSON(http.StatusOK, cachedData)
		return
	}

	tokens, err := LoadTokens(s.TokenPath)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated - visit /auth/url to authenticate"})
		return
	}

	ctx := c.Request.Context()
	if err := s.ensureValidToken(ctx, tokens); err != nil {
		if s.Logger != nil {
			s.Logger.Printf("token validation/refresh failed: %v", err)
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": "token refresh failed"})
		return
	}

	data, err := s.fetchAllWhoopData(ctx, tokens.AccessToken)
	if err != nil {
		if s.Logger != nil {
			s.Logger.Printf("failed to fetch whoop data: %v", err)
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to fetch whoop data"})
		return
	}

	// Update cache with fresh data
	s.cache.set(data)

	c.JSON(http.StatusOK, data)
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

	refreshed, err := s.refreshToken(ctx, tokens.RefreshToken)
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
