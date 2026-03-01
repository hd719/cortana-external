package whoop

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
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
		ClientID:     "client",
		ClientSecret: "secret",
		RedirectURL:  "https://example.com/callback",
		TokenPath:    tokenPath,
		DataPath:     dataPath,
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

func TestWhoopAuthURLHandler(t *testing.T) {
	gin.SetMode(gin.TestMode)
	service := newTestService(t, "", "", nil)
	service.ClientID = "abc"
	service.RedirectURL = "https://example.com/return"

	w := performRequest(t, service.AuthURLHandler, http.MethodGet, "/whoop/auth/url")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d", w.Code)
	}

	var payload map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	parsed, err := url.Parse(payload["url"])
	if err != nil {
		t.Fatalf("parse url: %v", err)
	}
	q := parsed.Query()
	if q.Get("client_id") != "abc" {
		t.Fatalf("expected client_id=abc got %q", q.Get("client_id"))
	}
	if q.Get("redirect_uri") != service.RedirectURL {
		t.Fatalf("expected redirect_uri %q got %q", service.RedirectURL, q.Get("redirect_uri"))
	}
	if q.Get("response_type") != "code" {
		t.Fatalf("expected response_type=code got %q", q.Get("response_type"))
	}
	if !strings.Contains(q.Get("scope"), "read:profile") {
		t.Fatalf("expected scope to include read:profile got %q", q.Get("scope"))
	}
}

func TestWhoopCallbackHandlerErrors(t *testing.T) {
	gin.SetMode(gin.TestMode)
	service := newTestService(t, filepath.Join(t.TempDir(), "tokens.json"), "", nil)

	w := performRequest(t, service.CallbackHandler, http.MethodGet, "/callback?error=access_denied&error_description=nope")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", w.Code)
	}

	w = performRequest(t, service.CallbackHandler, http.MethodGet, "/callback")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", w.Code)
	}
}

func TestWhoopCallbackHandlerSuccess(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mux := http.NewServeMux()
	mux.HandleFunc("/oauth/oauth2/token", func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if r.PostForm.Get("grant_type") != "authorization_code" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"access","refresh_token":"refresh","expires_in":3600,"scope":"read"}`))
	})

	ts := httptest.NewServer(mux)
	defer ts.Close()

	transport := &rewriteTransport{
		targetHost: strings.TrimPrefix(ts.URL, "http://"),
		base:       http.DefaultTransport,
		hosts:      map[string]struct{}{"api.prod.whoop.com": {}},
	}

	tokensPath := filepath.Join(t.TempDir(), "tokens.json")
	service := newTestService(t, tokensPath, "", &http.Client{Transport: transport})

	w := performRequest(t, service.CallbackHandler, http.MethodGet, "/callback?code=abc")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%s", w.Code, w.Body.String())
	}

	tokens, err := LoadTokens(tokensPath)
	if err != nil {
		t.Fatalf("load tokens: %v", err)
	}
	if tokens.AccessToken != "access" || tokens.RefreshToken != "refresh" {
		t.Fatalf("unexpected tokens: %#v", tokens)
	}
	if time.Until(tokens.ExpiresAt) <= 0 {
		t.Fatalf("expected expires_at in future got %s", tokens.ExpiresAt)
	}
}

func TestWhoopAuthStatusHandler_NoToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	service := newTestService(t, filepath.Join(t.TempDir(), "missing.json"), "", nil)

	w := performRequest(t, service.AuthStatusHandler, http.MethodGet, "/whoop/auth/status")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d", w.Code)
	}

	var payload map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["has_token"].(bool) {
		t.Fatalf("expected has_token=false")
	}
}

func TestWhoopDataHandler_UsesCache(t *testing.T) {
	gin.SetMode(gin.TestMode)
	data := &WhoopData{
		Profile:         map[string]any{"name": "whoop"},
		BodyMeasurement: map[string]any{"weight": 1},
		Recovery:        []map[string]any{{"score": 90}},
	}

	service := newTestService(t, filepath.Join(t.TempDir(), "missing.json"), filepath.Join(t.TempDir(), "data.json"), nil)
	service.cache = &whoopDataCache{
		data:      data,
		lastFetch: time.Now(),
		ttl:       time.Minute,
	}

	w := performRequest(t, service.DataHandler, http.MethodGet, "/whoop/data")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%s", w.Code, w.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	profile := payload["profile"].(map[string]any)
	if profile["name"] != "whoop" {
		t.Fatalf("unexpected profile: %#v", profile)
	}
}

func TestWhoopDataHandler_ExpiredTokenNoRefresh(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tmp := t.TempDir()
	tokensPath := filepath.Join(tmp, "tokens.json")
	dataPath := filepath.Join(tmp, "whoop.json")

	tokens := &TokenData{
		AccessToken:  "token",
		RefreshToken: "",
		ExpiresAt:    time.Now().Add(-1 * time.Hour),
	}
	if err := SaveTokens(tokensPath, tokens); err != nil {
		t.Fatalf("save tokens: %v", err)
	}

	service := newTestService(t, tokensPath, dataPath, nil)
	w := performRequest(t, service.DataHandler, http.MethodGet, "/whoop/data")
	if w.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 got %d body=%s", w.Code, w.Body.String())
	}
}

func TestWhoopRecoveryLatestHandler_NoRecovery(t *testing.T) {
	gin.SetMode(gin.TestMode)
	service := newTestService(t, filepath.Join(t.TempDir(), "tokens.json"), filepath.Join(t.TempDir(), "data.json"), nil)
	service.cache = &whoopDataCache{
		data:      &WhoopData{Recovery: []map[string]any{}},
		lastFetch: time.Now(),
		ttl:       time.Minute,
	}

	w := performRequest(t, service.RecoveryLatestHandler, http.MethodGet, "/whoop/recovery/latest")
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 got %d body=%s", w.Code, w.Body.String())
	}
}

func TestWhoopDataHandler_DiskCacheWhenStale(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tmp := t.TempDir()
	tokensPath := filepath.Join(tmp, "tokens.json")
	dataPath := filepath.Join(tmp, "whoop.json")

	data := &WhoopData{Profile: map[string]any{"name": "cached"}}
	payload, err := json.Marshal(data)
	if err != nil {
		t.Fatalf("marshal cache: %v", err)
	}
	if err := os.WriteFile(dataPath, payload, 0o600); err != nil {
		t.Fatalf("write cache: %v", err)
	}

	service := newTestService(t, tokensPath, dataPath, nil)
	service.cache = &whoopDataCache{data: nil, lastFetch: time.Now().Add(-10 * time.Minute), ttl: time.Minute}

	w := performRequest(t, service.DataHandler, http.MethodGet, "/whoop/data")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 got %d body=%s", w.Code, w.Body.String())
	}
}
