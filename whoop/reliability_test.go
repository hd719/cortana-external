package whoop

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestWhoopEnsureValidTokenUsesSingleflight(t *testing.T) {
	mux := http.NewServeMux()
	var refreshCalls int32
	mux.HandleFunc("/oauth/oauth2/token", func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&refreshCalls, 1)
		time.Sleep(50 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"new-access","refresh_token":"new-refresh","expires_in":3600}`))
	})

	ts := httptest.NewServer(mux)
	defer ts.Close()

	transport := &rewriteTransport{
		targetHost: strings.TrimPrefix(ts.URL, "http://"),
		base:       http.DefaultTransport,
		hosts:      map[string]struct{}{"api.prod.whoop.com": {}},
	}

	tmp := t.TempDir()
	tokensPath := filepath.Join(tmp, "tokens.json")
	if err := SaveTokens(tokensPath, &TokenData{
		AccessToken:  "old",
		RefreshToken: "refresh",
		ExpiresAt:    time.Now().Add(-time.Hour),
	}); err != nil {
		t.Fatalf("save tokens: %v", err)
	}

	svc := newTestService(t, tokensPath, filepath.Join(tmp, "data.json"), &http.Client{Transport: transport})
	tokens, err := LoadTokens(tokensPath)
	if err != nil {
		t.Fatalf("load tokens: %v", err)
	}

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := svc.ensureValidToken(context.Background(), tokens); err != nil {
				t.Errorf("ensure token: %v", err)
			}
		}()
	}
	wg.Wait()

	if got := atomic.LoadInt32(&refreshCalls); got != 1 {
		t.Fatalf("expected 1 refresh call, got %d", got)
	}
}

func TestWhoopRefreshNonRetriableClassification(t *testing.T) {
	if !isNonRetriableWhoopRefreshError(errors.New("invalid_grant")) {
		t.Fatalf("expected invalid_grant to be non-retriable")
	}
	if !isNonRetriableWhoopRefreshError(errors.New("invalid_client")) {
		t.Fatalf("expected invalid_client to be non-retriable")
	}
	if !isNonRetriableWhoopRefreshError(errors.New("unauthorized_client")) {
		t.Fatalf("expected unauthorized_client to be non-retriable")
	}
	if isNonRetriableWhoopRefreshError(errors.New("temporary error")) {
		t.Fatalf("expected temporary error to be retriable")
	}
}

func TestWhoopSaveTokensAtomicConcurrent(t *testing.T) {
	tmp := t.TempDir()
	tokensPath := filepath.Join(tmp, "tokens.json")

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_ = SaveTokens(tokensPath, &TokenData{
				AccessToken:  "access-" + time.Now().Format(time.RFC3339Nano),
				RefreshToken: "refresh",
				ExpiresAt:    time.Now().Add(time.Hour),
			})
		}(i)
	}
	wg.Wait()

	if _, err := LoadTokens(tokensPath); err != nil {
		t.Fatalf("tokens should be readable after concurrent saves: %v", err)
	}

	matches, err := filepath.Glob(filepath.Join(tmp, "tokens.json.tmp-*"))
	if err != nil {
		t.Fatalf("glob: %v", err)
	}
	if len(matches) != 0 {
		t.Fatalf("expected no temp files left behind, found %v", matches)
	}
}
