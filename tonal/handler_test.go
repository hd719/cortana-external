package tonal

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

type rewriteTransport struct {
	targetHost string
	base       http.RoundTripper
	hosts      map[string]struct{}
}

func (rt *rewriteTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if _, ok := rt.hosts[req.URL.Host]; ok {
		clone := req.Clone(req.Context())
		clone.URL.Scheme = "http"
		clone.URL.Host = rt.targetHost
		clone.Host = rt.targetHost
		return rt.base.RoundTrip(clone)
	}
	return rt.base.RoundTrip(req)
}

func newTestService(t *testing.T, tokenPath, dataPath string, client *http.Client) *Service {
	t.Helper()
	if client == nil {
		client = &http.Client{}
	}
	return &Service{
		HTTPClient:   client,
		Logger:       log.New(io.Discard, "", 0),
		Email:        "user@example.com",
		Password:     "pass",
		TokenPath:    tokenPath,
		DataPath:     dataPath,
		RequestDelay: 0,
	}
}

func performRequest(t *testing.T, handler gin.HandlerFunc, method, path string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(method, path, nil)
	handler(c)
	return w
}

func writeTokens(t *testing.T, path, idToken, refreshToken string, expiresAt time.Time) {
	t.Helper()
	tokens := &TokenData{IDToken: idToken, RefreshToken: refreshToken, ExpiresAt: expiresAt}
	if err := SaveTokens(path, tokens); err != nil {
		t.Fatalf("save tokens: %v", err)
	}
}

func TestTonalHealthHandler_AuthFailure(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mux := http.NewServeMux()
	mux.HandleFunc("/oauth/token", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
	})

	ts := httptest.NewServer(mux)
	defer ts.Close()

	transport := &rewriteTransport{
		targetHost: strings.TrimPrefix(ts.URL, "http://"),
		base:       http.DefaultTransport,
		hosts: map[string]struct{}{
			"tonal.auth0.com": {},
		},
	}

	service := newTestService(t, filepath.Join(t.TempDir(), "tokens.json"), filepath.Join(t.TempDir(), "cache.json"), &http.Client{Transport: transport})

	w := performRequest(t, service.HealthHandler, http.MethodGet, "/tonal/health")
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 got %d body=%s", w.Code, w.Body.String())
	}
}

func TestTonalHealthHandler_RefreshToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mux := http.NewServeMux()
	mux.HandleFunc("/oauth/token", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id_token":"new-token","refresh_token":"new-refresh","expires_in":3600}`))
	})
	mux.HandleFunc("/v6/users/userinfo", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"user-1"}`))
	})

	ts := httptest.NewServer(mux)
	defer ts.Close()

	transport := &rewriteTransport{
		targetHost: strings.TrimPrefix(ts.URL, "http://"),
		base:       http.DefaultTransport,
		hosts: map[string]struct{}{
			"tonal.auth0.com": {},
			"api.tonal.com":   {},
		},
	}

	tokensPath := filepath.Join(t.TempDir(), "tokens.json")
	writeTokens(t, tokensPath, "old-token", "refresh", time.Now().Add(-1*time.Hour))

	service := newTestService(t, tokensPath, filepath.Join(t.TempDir(), "cache.json"), &http.Client{Transport: transport})

	w := performRequest(t, service.HealthHandler, http.MethodGet, "/tonal/health")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%s", w.Code, w.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["user_id"] != "user-1" {
		t.Fatalf("unexpected user_id: %#v", payload["user_id"])
	}

	updated, err := LoadTokens(tokensPath)
	if err != nil {
		t.Fatalf("load tokens: %v", err)
	}
	if updated.IDToken != "new-token" {
		t.Fatalf("expected refreshed token got %#v", updated)
	}
}

func TestTonalDataHandler_SuccessMergesCache(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mux := http.NewServeMux()
	mux.HandleFunc("/v6/users/userinfo", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"user-1"}`))
	})
	mux.HandleFunc("/v6/users/user-1/profile", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"totalWorkouts":2,"name":"tester"}`))
	})
	mux.HandleFunc("/v6/users/user-1/workout-activities", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"id":"1","name":"a"},{"id":"2","name":"b"}]`))
	})
	mux.HandleFunc("/v6/users/user-1/strength-scores/current", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[]`))
	})
	mux.HandleFunc("/v6/users/user-1/strength-scores/history", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[]`))
	})

	ts := httptest.NewServer(mux)
	defer ts.Close()

	transport := &rewriteTransport{
		targetHost: strings.TrimPrefix(ts.URL, "http://"),
		base:       http.DefaultTransport,
		hosts: map[string]struct{}{
			"api.tonal.com": {},
		},
	}

	tmp := t.TempDir()
	tokensPath := filepath.Join(tmp, "tokens.json")
	cachePath := filepath.Join(tmp, "cache.json")
	writeTokens(t, tokensPath, "token", "", time.Now().Add(2*time.Hour))

	cache := &TonalCache{Workouts: map[string]any{"1": map[string]any{"id": "1", "name": "old"}}}
	if err := SaveCache(cachePath, cache); err != nil {
		t.Fatalf("save cache: %v", err)
	}

	service := newTestService(t, tokensPath, cachePath, &http.Client{Transport: transport})
	w := performRequest(t, service.DataHandler, http.MethodGet, "/tonal/data")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%s", w.Code, w.Body.String())
	}

	var payload DataResponse
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.WorkoutCount != 2 {
		t.Fatalf("expected 2 workouts got %d", payload.WorkoutCount)
	}
	if _, ok := payload.Workouts["1"]; !ok {
		t.Fatalf("expected workout 1 in response")
	}
	if _, ok := payload.Workouts["2"]; !ok {
		t.Fatalf("expected workout 2 in response")
	}
}

func TestTonalDataHandler_UserInfoError(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mux := http.NewServeMux()
	mux.HandleFunc("/v6/users/userinfo", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"unauthorized"}`))
	})

	ts := httptest.NewServer(mux)
	defer ts.Close()

	transport := &rewriteTransport{
		targetHost: strings.TrimPrefix(ts.URL, "http://"),
		base:       http.DefaultTransport,
		hosts: map[string]struct{}{
			"api.tonal.com": {},
		},
	}

	service := newTestService(t, filepath.Join(t.TempDir(), "tokens.json"), filepath.Join(t.TempDir(), "cache.json"), &http.Client{Transport: transport})
	service.Email = ""
	service.Password = ""

	writeTokens(t, service.TokenPath, "token", "", time.Now().Add(2*time.Hour))

	w := performRequest(t, service.DataHandler, http.MethodGet, "/tonal/data")
	if w.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 got %d body=%s", w.Code, w.Body.String())
	}
}

func TestTonalDataHandler_LoadsEmptyCacheWhenMissing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mux := http.NewServeMux()
	mux.HandleFunc("/v6/users/userinfo", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"user-1"}`))
	})
	mux.HandleFunc("/v6/users/user-1/profile", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"totalWorkouts":0}`))
	})
	mux.HandleFunc("/v6/users/user-1/workout-activities", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[]`))
	})
	mux.HandleFunc("/v6/users/user-1/strength-scores/current", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[]`))
	})
	mux.HandleFunc("/v6/users/user-1/strength-scores/history", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[]`))
	})

	ts := httptest.NewServer(mux)
	defer ts.Close()

	transport := &rewriteTransport{
		targetHost: strings.TrimPrefix(ts.URL, "http://"),
		base:       http.DefaultTransport,
		hosts: map[string]struct{}{
			"api.tonal.com": {},
		},
	}

	tmp := t.TempDir()
	tokensPath := filepath.Join(tmp, "tokens.json")
	cachePath := filepath.Join(tmp, "missing-cache.json")
	writeTokens(t, tokensPath, "token", "", time.Now().Add(2*time.Hour))

	service := newTestService(t, tokensPath, cachePath, &http.Client{Transport: transport})

	w := performRequest(t, service.DataHandler, http.MethodGet, "/tonal/data")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%s", w.Code, w.Body.String())
	}

	if _, err := os.Stat(cachePath); err != nil {
		t.Fatalf("expected cache to be written: %v", err)
	}
}
