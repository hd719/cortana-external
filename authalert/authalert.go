package authalert

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const threshold = 3

var (
	mu       sync.Mutex
	failures = map[string]int{}
)

type alertPayload struct {
	Provider            string    `json:"provider"`
	ConsecutiveFailures int       `json:"consecutive_failures"`
	LastError           string    `json:"last_error"`
	UpdatedAt           time.Time `json:"updated_at"`
}

func MarkFailure(provider string, err error) error {
	mu.Lock()
	defer mu.Unlock()

	failures[provider]++
	if failures[provider] < threshold {
		return nil
	}

	msg := ""
	if err != nil {
		msg = err.Error()
	}

	payload := alertPayload{
		Provider:            provider,
		ConsecutiveFailures: failures[provider],
		LastError:           msg,
		UpdatedAt:           time.Now().UTC(),
	}

	data, mErr := json.MarshalIndent(payload, "", "  ")
	if mErr != nil {
		return mErr
	}

	dir := filepath.Join(os.Getenv("HOME"), ".cortana", "auth-alerts")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	return os.WriteFile(filepath.Join(dir, provider+".json"), data, 0o600)
}

func MarkSuccess(provider string) {
	mu.Lock()
	defer mu.Unlock()
	failures[provider] = 0
}

func ResetForTests() {
	mu.Lock()
	defer mu.Unlock()
	failures = map[string]int{}
}
