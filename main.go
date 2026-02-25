package main

import (
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
	}

	router.GET("/auth/url", svc.AuthURLHandler)
	router.GET("/auth/callback", svc.CallbackHandler)
	router.GET("/whoop/data", svc.DataHandler)

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
	router.GET("/alpaca/quote/:symbol", alpacaSvc.QuoteHandler)
	router.GET("/alpaca/snapshot/:symbol", alpacaSvc.SnapshotHandler)
	router.GET("/alpaca/bars/:symbol", alpacaSvc.BarsHandler)
	router.GET("/alpaca/trades", alpacaSvc.TradesHandler)
	router.POST("/alpaca/trades", alpacaSvc.RecordTradeHandler)
	router.PUT("/alpaca/trades/:id", alpacaSvc.UpdateTradeHandler)
	router.GET("/alpaca/stats", alpacaSvc.StatsHandler)

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
