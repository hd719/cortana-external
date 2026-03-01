package whoop

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
	AccessToken   string    `json:"access_token"`
	RefreshToken  string    `json:"refresh_token"`
	ExpiresAt     time.Time `json:"expires_at"`
	LastRefreshAt time.Time `json:"last_refresh_at,omitempty"`
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
