package tonal

import (
	"encoding/json"
	"os"
	"time"
)

type TokenData struct {
	IDToken   string    `json:"id_token"`
	ExpiresAt time.Time `json:"expires_at"`
}

type StrengthScoreData struct {
	Current []map[string]any `json:"current"`
	History []map[string]any `json:"history"`
}

type TonalCache struct {
	UserID         string            `json:"user_id"`
	Profile        map[string]any    `json:"profile"`
	Workouts       map[string]any    `json:"workouts"`
	StrengthScores *StrengthScoreData `json:"strength_scores"`
	LastUpdated    time.Time         `json:"last_updated"`
}

func LoadTokens(path string) (*TokenData, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var tokens TokenData
	if err := json.Unmarshal(data, &tokens); err != nil {
		return nil, err
	}

	return &tokens, nil
}

func SaveTokens(path string, tokens *TokenData) error {
	data, err := json.MarshalIndent(tokens, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0600)
}

func LoadCache(path string) (*TonalCache, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var cache TonalCache
	if err := json.Unmarshal(data, &cache); err != nil {
		return nil, err
	}

	return &cache, nil
}

func SaveCache(path string, cache *TonalCache) error {
	data, err := json.MarshalIndent(cache, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0644)
}
