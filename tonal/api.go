package tonal

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

const (
	tonalAuthURL  = "https://tonal.auth0.com/oauth/token"
	tonalAPIBase  = "https://api.tonal.com"
	tonalClientID = "ERCyexW-xoVG_Yy3RDe-eV4xsOnRHP6L"
)

type authResponse struct {
	IDToken   string `json:"id_token"`
	ExpiresIn int64  `json:"expires_in"`
}

type userInfoResponse struct {
	ID string `json:"id"`
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

	return &TokenData{
		IDToken:   authResp.IDToken,
		ExpiresAt: time.Now().Add(time.Duration(authResp.ExpiresIn) * time.Second),
	}, nil
}

func (s *Service) getValidToken(ctx context.Context) (string, error) {
	tokens, err := LoadTokens(s.TokenPath)
	if err == nil && time.Now().Before(tokens.ExpiresAt.Add(-1*time.Minute)) {
		return tokens.IDToken, nil
	}

	s.Logger.Println("authenticating with Tonal...")
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

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, errors.New("tonal unauthorized")
	}
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("tonal api error: %s - %s", resp.Status, string(body))
	}

	return io.ReadAll(resp.Body)
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
