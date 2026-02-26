package alpaca

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

	"github.com/gin-gonic/gin"
)

func writeTestKeys(t *testing.T, baseURL, dataURL string) string {
	t.Helper()
	dir := t.TempDir()
	keysPath := filepath.Join(dir, "alpaca_keys.json")
	payload := `{"key_id":"k","secret_key":"s","base_url":"` + baseURL + `","data_url":"` + dataURL + `"}`
	if err := os.WriteFile(keysPath, []byte(payload), 0o600); err != nil {
		t.Fatalf("write keys: %v", err)
	}
	return keysPath
}

func newTestService(t *testing.T, keysPath string, client *http.Client) *Service {
	t.Helper()
	if client == nil {
		client = &http.Client{}
	}
	return &Service{
		HTTPClient: client,
		Logger:     log.New(io.Discard, "", 0),
		KeysPath:   keysPath,
	}
}

type rewriteTransport struct {
	targetHost string
	base       http.RoundTripper
}

func (rt *rewriteTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL.Host == "query1.finance.yahoo.com" {
		clone := req.Clone(req.Context())
		clone.URL.Scheme = "http"
		clone.URL.Host = rt.targetHost
		clone.Host = rt.targetHost
		return rt.base.RoundTrip(clone)
	}
	return rt.base.RoundTrip(req)
}

func performJSONRequest(t *testing.T, h gin.HandlerFunc, method, path string) map[string]any {
	t.Helper()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(method, path, nil)
	c.Request = req
	h(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%s", w.Code, w.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return out
}

func TestNormalizeEarningsSymbol(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"BRK-B", "BRK.B"},
		{" brk-b ", "BRK.B"},
		{"msft", "MSFT"},
		{"RDS-A", "RDS.A"},
	}

	for _, tc := range tests {
		t.Run(tc.in, func(t *testing.T) {
			if got := normalizeEarningsSymbol(tc.in); got != tc.want {
				t.Fatalf("normalizeEarningsSymbol(%q)=%q want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestHelperFunctions(t *testing.T) {
	t.Run("normalizeSide", func(t *testing.T) {
		cases := []struct {
			in   string
			want string
		}{
			{"buy", "buy"},
			{" SELL ", "sell"},
			{"hold", ""},
			{"", ""},
		}
		for _, tc := range cases {
			if got := normalizeSide(tc.in); got != tc.want {
				t.Fatalf("normalizeSide(%q)=%q want %q", tc.in, got, tc.want)
			}
		}
	})

	t.Run("parseNullableFloat", func(t *testing.T) {
		if got := parseNullableFloat(""); got != nil {
			t.Fatalf("expected nil for empty")
		}
		if got := parseNullableFloat("abc"); got != nil {
			t.Fatalf("expected nil for invalid")
		}
		got := parseNullableFloat("123.45")
		if got == nil || *got != 123.45 {
			t.Fatalf("expected 123.45 got %#v", got)
		}
	})

	t.Run("float64Ptr", func(t *testing.T) {
		p := float64Ptr(9.9)
		if p == nil || *p != 9.9 {
			t.Fatalf("float64Ptr failed: %#v", p)
		}
	})
}

func TestFetchLatestTradePrice(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/v2/stocks/AAPL/trades/latest", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"trade":{"p":189.12,"t":"2026-02-26T12:00:00Z"}}`))
	})
	mux.HandleFunc("/v2/stocks/TSLA/trades/latest", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"trade":{"p":0}}`))
	})

	ts := httptest.NewServer(mux)
	defer ts.Close()

	keysPath := writeTestKeys(t, ts.URL, ts.URL)
	svc := newTestService(t, keysPath, ts.Client())
	if err := svc.LoadKeys(); err != nil {
		t.Fatalf("LoadKeys: %v", err)
	}

	if p := svc.fetchLatestTradePrice("AAPL"); p == nil || *p != 189.12 {
		t.Fatalf("expected 189.12 got %#v", p)
	}
	if p := svc.fetchLatestTradePrice("TSLA"); p != nil {
		t.Fatalf("expected nil for non-positive price got %#v", p)
	}
}

func TestHealthHandler(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/v2/account", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"id":"acct"}`))
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()

	keysPath := writeTestKeys(t, ts.URL, ts.URL)
	svc := newTestService(t, keysPath, ts.Client())

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/alpaca/health", nil)

	svc.HealthHandler(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"status":"healthy"`) {
		t.Fatalf("unexpected body: %s", w.Body.String())
	}
}

func TestPortfolioHandler(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/v2/account", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"id":"acct1","cash":"1000","portfolio_value":"1500"}`))
	})
	mux.HandleFunc("/v2/positions", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`[
			{"symbol":"AAPL","qty":"2","side":"long","market_value":"360","cost_basis":"300","unrealized_pl":"60"},
			{"symbol":"MSFT","qty":"1","side":"long","market_value":"410","cost_basis":"400","unrealized_pl":"10"}
		]`))
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()

	keysPath := writeTestKeys(t, ts.URL, ts.URL)
	svc := newTestService(t, keysPath, ts.Client())

	out := performJSONRequest(t, svc.PortfolioHandler, http.MethodGet, "/alpaca/portfolio")
	account, ok := out["account"].(map[string]any)
	if !ok {
		t.Fatalf("missing account object: %#v", out)
	}
	if account["id"] != "acct1" {
		t.Fatalf("unexpected account id: %#v", account["id"])
	}
	positions, ok := out["positions"].([]any)
	if !ok || len(positions) != 2 {
		t.Fatalf("expected 2 positions got %#v", out["positions"])
	}
}

func TestEarningsHandler_MultipleSymbolsAndFallback(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mux := http.NewServeMux()

	mux.HandleFunc("/v1beta1/news", func(w http.ResponseWriter, r *http.Request) {
		symbol := r.URL.Query().Get("symbols")
		w.Header().Set("Content-Type", "application/json")
		switch symbol {
		case "AAPL":
			_, _ = w.Write([]byte(`{"news":[{"headline":"AAPL quarterly results beat"}]}`))
		case "MSFT":
			_, _ = w.Write([]byte(`{"news":[{"headline":"Product launch update"}]}`))
		case "TSLA":
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"error":"news down"}`))
		default:
			_, _ = w.Write([]byte(`{"news":[]}`))
		}
	})

	mux.HandleFunc("/v10/finance/quoteSummary/AAPL", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"quoteSummary":{"result":[{"calendarEvents":{"earnings":{"earningsDate":[{"fmt":"2026-03-10"}]}}}]}}`))
	})
	mux.HandleFunc("/v10/finance/quoteSummary/MSFT", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"quoteSummary":{"result":[{"calendarEvents":{"earnings":{"earningsDate":[{"fmt":"2026-03-20"}]}}}]}}`))
	})
	mux.HandleFunc("/v10/finance/quoteSummary/BRK.B", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"quoteSummary":{"result":[{"calendarEvents":{"earnings":{"earningsDate":[{"fmt":"2026-04-01"}]}}}]}}`))
	})
	mux.HandleFunc("/v10/finance/quoteSummary/TSLA", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"error":"upstream fail"}`))
	})

	ts := httptest.NewServer(mux)
	defer ts.Close()

	keysPath := writeTestKeys(t, ts.URL, ts.URL)
	transport := &rewriteTransport{
		targetHost: strings.TrimPrefix(ts.URL, "http://"),
		base:       http.DefaultTransport,
	}
	client := &http.Client{Transport: transport}
	svc := newTestService(t, keysPath, client)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/alpaca/earnings?symbols=AAPL,MSFT,BRK-B,TSLA", nil)

	svc.EarningsHandler(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%s", w.Code, w.Body.String())
	}

	var resp struct {
		Results []EarningsResult `json:"results"`
		Strategy string          `json:"strategy"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.Strategy != "alpaca-news + yahoo-calendar-fallback" {
		t.Fatalf("unexpected strategy: %s", resp.Strategy)
	}
	if len(resp.Results) != 4 {
		t.Fatalf("expected 4 results got %d", len(resp.Results))
	}

	bySymbol := map[string]EarningsResult{}
	for _, r := range resp.Results {
		bySymbol[r.Symbol] = r
	}

	if got := bySymbol["BRK-B"].EarningsDate; got != "2026-04-01" {
		t.Fatalf("expected BRK-B normalized Yahoo lookup date, got %q", got)
	}
	if got := bySymbol["AAPL"]; got.Note != "alpaca_news_contains_earnings" || got.Source != "yahoo" {
		t.Fatalf("unexpected AAPL result: %+v", got)
	}
	if got := bySymbol["TSLA"]; got.Source != "alpaca_news_only" || got.EarningsDate != "" {
		t.Fatalf("expected TSLA fallback result, got %+v", got)
	}
}
