package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	"services/alpaca"
	"services/tonal"
	"services/whoop"

	"github.com/gin-gonic/gin"
)

func main() {
	router := gin.Default()

	// Whoop service
	svc := &whoop.Service{
		HTTPClient:   &http.Client{Timeout: 30 * time.Second},
		Logger:       log.New(os.Stdout, "[whoop]", log.LstdFlags),
		ClientID:     os.Getenv("WHOOP_CLIENT_ID"),
		ClientSecret: os.Getenv("WHOOP_CLIENT_SECRET"),
		RedirectURL:  os.Getenv("WHOOP_REDIRECT_URL"),
		TokenPath:    "whoop_tokens.json",
		DataPath:     "whoop_data.json",
	}

	router.GET("/auth/url", svc.AuthURLHandler)
	router.GET("/auth/callback", svc.CallbackHandler)
	router.GET("/auth/status", svc.AuthStatusHandler)
	router.GET("/whoop/health", svc.HealthHandler)
	router.GET("/whoop/data", svc.DataHandler)
	router.GET("/whoop/recovery", svc.RecoveryHandler)
	router.GET("/whoop/recovery/latest", svc.RecoveryLatestHandler)

	// Tonal service
	tonalEmail := os.Getenv("TONAL_EMAIL")
	tonalPassword := os.Getenv("TONAL_PASSWORD")
	if tonalEmail == "" || tonalPassword == "" {
		log.Println("[tonal] NOTICE: TONAL_EMAIL or TONAL_PASSWORD not set; existing token file will still work. Fresh auth/refresh fallback may fail without env credentials")
	}

	tonalSvc := &tonal.Service{
		HTTPClient:   &http.Client{Timeout: 30 * time.Second},
		Logger:       log.New(os.Stdout, "[tonal] ", log.LstdFlags),
		Email:        tonalEmail,
		Password:     tonalPassword,
		TokenPath:    "tonal_tokens.json",
		DataPath:     "tonal_data.json",
		RequestDelay: 500 * time.Millisecond,
	}

	router.GET("/tonal/health", tonalSvc.HealthHandler)
	router.GET("/tonal/data", tonalSvc.DataHandler)

	// Alpaca trading service
	alpacaSvc := &alpaca.Service{
		HTTPClient: &http.Client{Timeout: 30 * time.Second},
		Logger:     log.New(os.Stdout, "[alpaca] ", log.LstdFlags),
		KeysPath:   "alpaca_keys.json",
		TradesPath: "alpaca_trades.json",
	}

	router.GET("/alpaca/health", alpacaSvc.HealthHandler)
	router.GET("/alpaca/account", alpacaSvc.AccountHandler)
	router.GET("/alpaca/positions", alpacaSvc.PositionsHandler)
	router.GET("/alpaca/portfolio", alpacaSvc.PortfolioHandler)
	router.GET("/alpaca/earnings", alpacaSvc.EarningsHandler)
	router.GET("/alpaca/quote/:symbol", alpacaSvc.QuoteHandler)
	router.GET("/alpaca/snapshot/:symbol", alpacaSvc.SnapshotHandler)
	router.GET("/alpaca/bars/:symbol", alpacaSvc.BarsHandler)
	router.GET("/alpaca/trades", alpacaSvc.TradesHandler)
	router.POST("/alpaca/trades", alpacaSvc.RecordTradeHandler)
	router.PUT("/alpaca/trades/:id", alpacaSvc.UpdateTradeHandler)
	router.GET("/alpaca/stats", alpacaSvc.StatsHandler)
	router.GET("/alpaca/performance", alpacaSvc.PerformanceHandler)

	// Startup warmup (non-blocking for server availability).
	warmupCtx, cancelWarmup := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancelWarmup()

	if err := svc.Warmup(warmupCtx); err != nil {
		log.Printf("[startup] whoop warmup failed: %v", err)
	} else {
		log.Printf("[startup] whoop warmup ok")
	}

	if err := tonalSvc.Warmup(warmupCtx); err != nil {
		log.Printf("[startup] tonal warmup failed: %v", err)
	} else {
		log.Printf("[startup] tonal warmup ok")
	}

	// Proactive token maintenance while idle.
	go startTokenMaintenance(svc, tonalSvc)

	router.GET("/health", func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
		defer cancel()

		whoopHealth := serviceHealthWhoop(ctx, svc)
		tonalHealth := serviceHealthTonal(ctx, tonalSvc)
		alpacaHealth := serviceHealthAlpaca(alpacaSvc)

		healthyCount := 0
		if whoopHealth["status"] == "healthy" {
			healthyCount++
		}
		if tonalHealth["status"] == "healthy" {
			healthyCount++
		}
		if alpacaHealth["status"] == "healthy" {
			healthyCount++
		}

		overall := "ok"
		switch {
		case healthyCount == 3:
			overall = "ok"
		case healthyCount == 0:
			overall = "unhealthy"
		default:
			overall = "degraded"
		}

		statusCode := http.StatusOK
		if overall == "unhealthy" {
			statusCode = http.StatusServiceUnavailable
		}

		c.JSON(statusCode, gin.H{
			"status": overall,
			"whoop":  whoopHealth,
			"tonal":  tonalHealth,
			"alpaca": alpacaHealth,
		})
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "3033"
	}
	bindAddr := "127.0.0.1:" + port
	log.Printf("Starting server on %s", bindAddr)
	if err := router.Run(bindAddr); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

func startTokenMaintenance(whoopSvc *whoop.Service, tonalSvc *tonal.Service) {
	ticker := time.NewTicker(30 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)

		if err := whoopSvc.ProactiveRefreshIfExpiring(ctx, 60*time.Minute); err != nil {
			log.Printf("[refresh] whoop proactive refresh failed: %v", err)
		} else {
			log.Printf("[refresh] whoop proactive refresh check completed")
		}

		if err := tonalSvc.ProactiveRefreshIfExpiring(ctx, 60*time.Minute); err != nil {
			log.Printf("[refresh] tonal proactive refresh failed: %v", err)
		} else {
			log.Printf("[refresh] tonal proactive refresh check completed")
		}

		cancel()
	}
}

func serviceHealthWhoop(ctx context.Context, svc *whoop.Service) map[string]any {
	tokens, err := whoop.LoadTokens(svc.TokenPath)
	if err != nil {
		return map[string]any{"status": "unhealthy", "authenticated": false, "error": err.Error()}
	}

	if err := svc.ProactiveRefreshIfExpiring(ctx, 0); err != nil {
		return map[string]any{
			"status":                "unhealthy",
			"authenticated":         true,
			"error":                 err.Error(),
			"expires_at":            tokens.ExpiresAt,
			"refresh_token_present": tokens.RefreshToken != "",
		}
	}

	return map[string]any{
		"status":                "healthy",
		"authenticated":         true,
		"expires_at":            tokens.ExpiresAt,
		"expires_in_seconds":    int64(time.Until(tokens.ExpiresAt).Seconds()),
		"refresh_token_present": tokens.RefreshToken != "",
	}
}

func serviceHealthTonal(ctx context.Context, svc *tonal.Service) map[string]any {
	tokens, loadErr := tonal.LoadTokens(svc.TokenPath)
	if err := svc.Warmup(ctx); err != nil {
		result := map[string]any{"status": "unhealthy", "error": err.Error()}
		if loadErr == nil {
			result["expires_at"] = tokens.ExpiresAt
		}
		return result
	}

	result := map[string]any{"status": "healthy"}
	if loadErr == nil {
		result["expires_at"] = tokens.ExpiresAt
		result["expires_in_seconds"] = int64(time.Until(tokens.ExpiresAt).Seconds())
	}
	return result
}

func serviceHealthAlpaca(svc *alpaca.Service) map[string]any {
	health, _ := svc.CheckHealth()
	return health
}
