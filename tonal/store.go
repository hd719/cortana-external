package tonal

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

var tokenFileMu sync.Mutex

type TokenData struct {
	IDToken      string    `json:"id_token"`
	RefreshToken string    `json:"refresh_token,omitempty"`
	ExpiresAt    time.Time `json:"expires_at"`
}

type StrengthScoreData struct {
	Current []map[string]any `json:"current"`
	History []map[string]any `json:"history"`
}

type TonalCache struct {
	UserID         string             `json:"user_id"`
	Profile        map[string]any     `json:"profile"`
	Workouts       map[string]any     `json:"workouts"`
	StrengthScores *StrengthScoreData `json:"strength_scores"`
	LastUpdated    time.Time          `json:"last_updated"`
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

	tokenFileMu.Lock()
	defer tokenFileMu.Unlock()

	dir := filepath.Dir(path)
	base := filepath.Base(path)
	tmp, err := os.CreateTemp(dir, base+".tmp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)

	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}

	if err := os.Rename(tmpName, path); err != nil {
		return err
	}

	dh, err := os.Open(dir)
	if err != nil {
		return fmt.Errorf("open token dir: %w", err)
	}
	defer dh.Close()
	if err := dh.Sync(); err != nil {
		return fmt.Errorf("sync token dir: %w", err)
	}

	return nil
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

	return os.WriteFile(path, data, 0o644)
}
