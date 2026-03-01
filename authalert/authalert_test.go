package authalert

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestAlertEmittedAfterThreeFailures(t *testing.T) {
	ResetForTests()
	home := t.TempDir()
	oldHome := os.Getenv("HOME")
	_ = os.Setenv("HOME", home)
	defer os.Setenv("HOME", oldHome)

	if err := MarkFailure("whoop", errors.New("one")); err != nil {
		t.Fatalf("mark failure 1: %v", err)
	}
	if err := MarkFailure("whoop", errors.New("two")); err != nil {
		t.Fatalf("mark failure 2: %v", err)
	}
	alertPath := filepath.Join(home, ".cortana", "auth-alerts", "whoop.json")
	if _, err := os.Stat(alertPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("alert should not exist before threshold")
	}

	if err := MarkFailure("whoop", errors.New("three")); err != nil {
		t.Fatalf("mark failure 3: %v", err)
	}

	content, err := os.ReadFile(alertPath)
	if err != nil {
		t.Fatalf("read alert: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(content, &payload); err != nil {
		t.Fatalf("decode alert: %v", err)
	}
	if payload["provider"] != "whoop" {
		t.Fatalf("unexpected provider: %v", payload["provider"])
	}
	if payload["consecutive_failures"].(float64) < 3 {
		t.Fatalf("expected consecutive_failures >= 3")
	}

	MarkSuccess("whoop")
	if err := MarkFailure("whoop", errors.New("reset")); err != nil {
		t.Fatalf("mark failure after reset: %v", err)
	}
}
