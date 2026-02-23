package tonal

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	tonalAuthURL  = "https://tonal.auth0.com/oauth/token"
	tonalAPIBase  = "https://api.tonal.com"
	tonalClientID = "ERCyexW-xoVG_Yy3RDe-eV4xsOnRHP6L"
)

var errTonalUnauthorized = errors.New("tonal unauthorized")

type authResponse struct {
	IDToken      string `json:"id_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
}

type userInfoResponse struct {
	ID string `json:"id"`
}

// extractJWTExpiry decodes a JWT token and extracts the exp claim
func extractJWTExpiry(idToken string) (time.Time, error) {
	// Split JWT into parts
	parts := strings.Split(idToken, ".")
	if len(parts) != 3 {
		return time.Time{}, errors.New("invalid JWT format")
	}

	// Decode the payload (second part)
	payload := parts[1]
	// Add padding if needed for base64 decoding
	if padding := len(payload) % 4; padding != 0 {
		payload += strings.Repeat("=", 4-padding)
	}

	decoded, err := base64.URLEncoding.DecodeString(payload)
	if err != nil {
		return time.Time{}, fmt.Errorf("failed to decode JWT payload: %w", err)
	}

	// Parse JSON to extract exp claim
	var claims struct {
		Exp int64 `json:"exp"`
	}
	if err := json.Unmarshal(decoded, &claims); err != nil {
		return time.Time{}, fmt.Errorf("failed to parse JWT claims: %w", err)
	}

	if claims.Exp == 0 {
		return time.Time{}, errors.New("exp claim not found or invalid")
	}

	return time.Unix(claims.Exp, 0), nil
}

func (s *Service) authenticate(ctx context.Context) (*TokenData, error) {
	payload := map[string]string{
		"grant_type": "http://auth0.com/oauth/grant-type/password-realm",
		"realm":      "Username-Password-Authentication",
		"client_id":  tonalClientID,
		"username":   s.Email,
		"password":   s.Password,
		"scope":      "openid offline_access",
		"audience":   "https://tonal.auth0.com/userinfo",
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", tonalAuthURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("auth failed: %s - %s", resp.Status, string(respBody))
	}

	var authResp authResponse
	if err := json.NewDecoder(resp.Body).Decode(&authResp); err != nil {
		return nil, err
	}

	// Try to extract expiry from JWT, fallback to expires_in with safety margin
	expiresAt := time.Now().Add(time.Duration(authResp.ExpiresIn) * time.Second)
	if jwtExpiry, err := extractJWTExpiry(authResp.IDToken); err == nil {
		expiresAt = jwtExpiry
	} else {
		// JWT decoding failed, use expires_in with safety margin (half the time)
		expiresAt = time.Now().Add(time.Duration(authResp.ExpiresIn/2) * time.Second)
	}

	return &TokenData{
		IDToken:      authResp.IDToken,
		RefreshToken: authResp.RefreshToken,
		ExpiresAt:    expiresAt,
	}, nil
}

// refreshAuthentication uses a refresh token to get a new id_token without
// requiring the user's password. This is more reliable than password auth
// and avoids rate-limit issues with Auth0.
func (s *Service) refreshAuthentication(ctx context.Context, refreshToken string) (*TokenData, error) {
	payload := map[string]string{
		"grant_type":    "refresh_token",
		"client_id":     tonalClientID,
		"refresh_token": refreshToken,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", tonalAuthURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("refresh auth failed: %s - %s", resp.Status, string(respBody))
	}

	var authResp authResponse
	if err := json.NewDecoder(resp.Body).Decode(&authResp); err != nil {
		return nil, err
	}

	newRefresh := authResp.RefreshToken
	if newRefresh == "" {
		// Some Auth0 configurations don't rotate refresh tokens;
		// keep the existing one in that case.
		newRefresh = refreshToken
	}

	// Try to extract expiry from JWT, fallback to expires_in with safety margin
	expiresAt := time.Now().Add(time.Duration(authResp.ExpiresIn) * time.Second)
	if jwtExpiry, err := extractJWTExpiry(authResp.IDToken); err == nil {
		expiresAt = jwtExpiry
	} else {
		// JWT decoding failed, use expires_in with safety margin (half the time)
		expiresAt = time.Now().Add(time.Duration(authResp.ExpiresIn/2) * time.Second)
	}

	return &TokenData{
		IDToken:      authResp.IDToken,
		RefreshToken: newRefresh,
		ExpiresAt:    expiresAt,
	}, nil
}

func (s *Service) getValidToken(ctx context.Context) (string, error) {
	tokens, err := LoadTokens(s.TokenPath)
	if err == nil && time.Now().Before(tokens.ExpiresAt.Add(-1*time.Minute)) {
		return tokens.IDToken, nil
	}

	// Token expired or missing — try refresh token first (faster, no password needed)
	if err == nil && tokens.RefreshToken != "" {
		s.Logger.Println("refreshing Tonal token...")
		refreshed, refreshErr := s.refreshAuthentication(ctx, tokens.RefreshToken)
		if refreshErr == nil {
			if saveErr := SaveTokens(s.TokenPath, refreshed); saveErr != nil {
				s.Logger.Printf("warning: failed to save refreshed tokens: %v", saveErr)
			}
			return refreshed.IDToken, nil
		}
		s.Logger.Printf("refresh token failed, falling back to password auth: %v", refreshErr)
	}

	// Fall back to full password authentication
	s.Logger.Println("authenticating with Tonal (password)...")
	tokens, err = s.authenticate(ctx)
	if err != nil {
		return "", fmt.Errorf("authentication failed: %w", err)
	}

	if err := SaveTokens(s.TokenPath, tokens); err != nil {
		s.Logger.Printf("warning: failed to save tokens: %v", err)
	}

	return tokens.IDToken, nil
}

func (s *Service) fetchTonal(ctx context.Context, token, method, path string, headers map[string]string) ([]byte, error) {
	endpoint := tonalAPIBase + path

	req, err := http.NewRequestWithContext(ctx, method, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")

	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := s.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return nil, errTonalUnauthorized
	}
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("tonal api error: %s - %s", resp.Status, string(body))
	}

	return io.ReadAll(resp.Body)
}

// apiCallWithSelfHeal wraps API operations with automatic token refresh/retry logic.
// When an auth failure (401/403) is detected, it:
// 1. Attempts refresh-token auth first (no token file deletion)
// 2. Falls back to full password auth only if refresh fails
// 3. Retries the API call once with the new token
// 4. Logs the self-heal action for visibility
func (s *Service) apiCallWithSelfHeal(ctx context.Context, operation func(ctx context.Context, token string) error) error {
	// Get initial token
	token, err := s.getValidToken(ctx)
	if err != nil {
		return err
	}

	// Try the operation with current token
	err = operation(ctx, token)
	if !errors.Is(err, errTonalUnauthorized) {
		return err // Success or non-auth error
	}

	// Auth failure detected - perform self-healing
	s.Logger.Printf("🔧 TONAL SELF-HEAL: Authentication failure detected, attempting automatic recovery...")

	var freshTokens *TokenData

	// First try refresh token flow (preferred)
	if existing, loadErr := LoadTokens(s.TokenPath); loadErr == nil && existing.RefreshToken != "" {
		s.Logger.Printf("🔄 TONAL SELF-HEAL: Trying refresh-token recovery...")
		if refreshed, refreshErr := s.refreshAuthentication(ctx, existing.RefreshToken); refreshErr == nil {
			freshTokens = refreshed
			if saveErr := SaveTokens(s.TokenPath, refreshed); saveErr != nil {
				s.Logger.Printf("⚠️  TONAL SELF-HEAL: Warning - failed to save refreshed tokens: %v", saveErr)
			}
		} else {
			s.Logger.Printf("⚠️  TONAL SELF-HEAL: Refresh-token recovery failed, falling back to password auth: %v", refreshErr)
		}
	}

	// If refresh route failed/unavailable, use full authentication
	if freshTokens == nil {
		s.Logger.Printf("🔐 TONAL SELF-HEAL: Running full authentication fallback...")
		freshTokens, err = s.authenticate(ctx)
		if err != nil {
			s.Logger.Printf("❌ TONAL SELF-HEAL: Failed to re-authenticate: %v", err)
			return fmt.Errorf("self-heal failed - re-authentication error: %w", err)
		}
		if saveErr := SaveTokens(s.TokenPath, freshTokens); saveErr != nil {
			s.Logger.Printf("⚠️  TONAL SELF-HEAL: Warning - failed to save fresh tokens: %v", saveErr)
		}
	}

	// Retry operation with fresh token
	s.Logger.Printf("🔄 TONAL SELF-HEAL: Retrying API call with refreshed authentication...")
	err = operation(ctx, freshTokens.IDToken)
	if err != nil {
		s.Logger.Printf("❌ TONAL SELF-HEAL: Retry failed: %v", err)
		return fmt.Errorf("self-heal failed - retry error: %w", err)
	}

	s.Logger.Printf("✅ TONAL SELF-HEAL: Recovery successful - API call completed with refreshed authentication")
	return nil
}

func (s *Service) getUserInfo(ctx context.Context, token string) (string, error) {
	body, err := s.fetchTonal(ctx, token, "GET", "/v6/users/userinfo", nil)
	if err != nil {
		return "", err
	}

	var info userInfoResponse
	if err := json.Unmarshal(body, &info); err != nil {
		return "", err
	}

	return info.ID, nil
}

func (s *Service) getProfile(ctx context.Context, token, userID string) (map[string]any, error) {
	path := fmt.Sprintf("/v6/users/%s/profile", userID)
	body, err := s.fetchTonal(ctx, token, "GET", path, nil)
	if err != nil {
		return nil, err
	}

	var profile map[string]any
	if err := json.Unmarshal(body, &profile); err != nil {
		return nil, err
	}

	return profile, nil
}

func (s *Service) getWorkoutActivities(ctx context.Context, token, userID string, limit int, totalWorkouts int) ([]map[string]any, error) {
	path := fmt.Sprintf("/v6/users/%s/workout-activities", userID)

	// Tonal API returns workouts in ascending order (oldest first).
	// To get the most recent workouts, calculate offset = total - limit.
	offset := 0
	if totalWorkouts > limit {
		offset = totalWorkouts - limit
	}

	headers := map[string]string{
		"pg-offset": fmt.Sprintf("%d", offset),
		"pg-limit":  fmt.Sprintf("%d", limit),
	}

	body, err := s.fetchTonal(ctx, token, "GET", path, headers)
	if err != nil {
		return nil, err
	}

	var workouts []map[string]any
	if err := json.Unmarshal(body, &workouts); err != nil {
		return nil, err
	}

	return workouts, nil
}

func (s *Service) getStrengthScoresCurrent(ctx context.Context, token, userID string) ([]map[string]any, error) {
	path := fmt.Sprintf("/v6/users/%s/strength-scores/current", userID)
	body, err := s.fetchTonal(ctx, token, "GET", path, nil)
	if err != nil {
		return nil, err
	}

	var scores []map[string]any
	if err := json.Unmarshal(body, &scores); err != nil {
		return nil, err
	}

	return scores, nil
}

func (s *Service) getStrengthScoresHistory(ctx context.Context, token, userID string) ([]map[string]any, error) {
	path := fmt.Sprintf("/v6/users/%s/strength-scores/history", userID)
	body, err := s.fetchTonal(ctx, token, "GET", path, nil)
	if err != nil {
		return nil, err
	}

	var history []map[string]any
	if err := json.Unmarshal(body, &history); err != nil {
		return nil, err
	}

	return history, nil
}

// Self-healing wrapper functions that use apiCallWithSelfHeal

func (s *Service) getUserInfoWithRetry(ctx context.Context) (string, error) {
	var result string
	var resultErr error

	err := s.apiCallWithSelfHeal(ctx, func(ctx context.Context, token string) error {
		userInfo, err := s.getUserInfo(ctx, token)
		result = userInfo
		resultErr = err
		return err
	})

	if err != nil {
		return "", err
	}
	return result, resultErr
}

func (s *Service) getProfileWithRetry(ctx context.Context, userID string) (map[string]any, error) {
	var result map[string]any
	var resultErr error

	err := s.apiCallWithSelfHeal(ctx, func(ctx context.Context, token string) error {
		profile, err := s.getProfile(ctx, token, userID)
		result = profile
		resultErr = err
		return err
	})

	if err != nil {
		return nil, err
	}
	return result, resultErr
}

func (s *Service) getWorkoutActivitiesWithRetry(ctx context.Context, userID string, limit int, totalWorkouts int) ([]map[string]any, error) {
	var result []map[string]any
	var resultErr error

	err := s.apiCallWithSelfHeal(ctx, func(ctx context.Context, token string) error {
		workouts, err := s.getWorkoutActivities(ctx, token, userID, limit, totalWorkouts)
		result = workouts
		resultErr = err
		return err
	})

	if err != nil {
		return nil, err
	}
	return result, resultErr
}

func (s *Service) getStrengthScoresCurrentWithRetry(ctx context.Context, userID string) ([]map[string]any, error) {
	var result []map[string]any
	var resultErr error

	err := s.apiCallWithSelfHeal(ctx, func(ctx context.Context, token string) error {
		scores, err := s.getStrengthScoresCurrent(ctx, token, userID)
		result = scores
		resultErr = err
		return err
	})

	if err != nil {
		return nil, err
	}
	return result, resultErr
}

func (s *Service) getStrengthScoresHistoryWithRetry(ctx context.Context, userID string) ([]map[string]any, error) {
	var result []map[string]any
	var resultErr error

	err := s.apiCallWithSelfHeal(ctx, func(ctx context.Context, token string) error {
		history, err := s.getStrengthScoresHistory(ctx, token, userID)
		result = history
		resultErr = err
		return err
	})

	if err != nil {
		return nil, err
	}
	return result, resultErr
}
