package whoop

import (
	"encoding/json"
	"os"
	"time"
)

type TokenData struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	ExpiresAt    time.Time `json:"expires_at"`
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
