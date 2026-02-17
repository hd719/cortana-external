package alpaca

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// Keys holds the Alpaca API credentials
type Keys struct {
	KeyID     string `json:"key_id"`
	SecretKey string `json:"secret_key"`
	BaseURL   string `json:"base_url"`
	DataURL   string `json:"data_url"`
}

// Account represents Alpaca account info
type Account struct {
	ID               string  `json:"id"`
	AccountNumber    string  `json:"account_number"`
	Status           string  `json:"status"`
	Currency         string  `json:"currency"`
	Cash             string  `json:"cash"`
	PortfolioValue   string  `json:"portfolio_value"`
	BuyingPower      string  `json:"buying_power"`
	Equity           string  `json:"equity"`
	LastEquity       string  `json:"last_equity"`
	DaytradeCount    int     `json:"daytrade_count"`
	PatternDayTrader bool    `json:"pattern_day_trader"`
}

// Position represents a single position in the portfolio
type Position struct {
	Symbol           string `json:"symbol"`
	Qty              string `json:"qty"`
	Side             string `json:"side"`
	MarketValue      string `json:"market_value"`
	CostBasis        string `json:"cost_basis"`
	UnrealizedPL     string `json:"unrealized_pl"`
	UnrealizedPLPC   string `json:"unrealized_plpc"`
	CurrentPrice     string `json:"current_price"`
	AvgEntryPrice    string `json:"avg_entry_price"`
	ChangeToday      string `json:"change_today"`
}

// Trade represents a tracked trade recommendation
type Trade struct {
	ID           string    `json:"id"`
	Symbol       string    `json:"symbol"`
	Action       string    `json:"action"`        // BUY, SELL
	Status       string    `json:"status"`        // recommended, executed, declined, closed
	Score        int       `json:"score"`         // CANSLIM score
	EntryPrice   float64   `json:"entry_price"`
	StopLoss     float64   `json:"stop_loss"`
	Shares       int       `json:"shares"`
	Reasoning    string    `json:"reasoning"`
	RecommendedAt time.Time `json:"recommended_at"`
	ExecutedAt   *time.Time `json:"executed_at,omitempty"`
	ExecutedPrice *float64  `json:"executed_price,omitempty"`
	ClosedAt     *time.Time `json:"closed_at,omitempty"`
	ClosedPrice  *float64   `json:"closed_price,omitempty"`
	PnL          *float64   `json:"pnl,omitempty"`
	PnLPct       *float64   `json:"pnl_pct,omitempty"`
}

// TradeLog stores all tracked trades
type TradeLog struct {
	Trades []Trade `json:"trades"`
}

// Service handles Alpaca API interactions
type Service struct {
	HTTPClient *http.Client
	Logger     *log.Logger
	KeysPath   string
	TradesPath string

	keys     *Keys
	trades   *TradeLog
	mu       sync.RWMutex
}

// LoadKeys loads API keys from file
func (s *Service) LoadKeys() error {
	data, err := os.ReadFile(s.KeysPath)
	if err != nil {
		return fmt.Errorf("failed to read keys: %w", err)
	}

	var keys Keys
	if err := json.Unmarshal(data, &keys); err != nil {
		return fmt.Errorf("failed to parse keys: %w", err)
	}

	if keys.BaseURL == "" {
		keys.BaseURL = "https://paper-api.alpaca.markets"
	}
	// Ensure base URL has /v2 suffix
	if keys.BaseURL[len(keys.BaseURL)-3:] != "/v2" {
		keys.BaseURL = keys.BaseURL + "/v2"
	}
	if keys.DataURL == "" {
		keys.DataURL = "https://data.alpaca.markets"
	}

	s.keys = &keys
	return nil
}

// LoadTrades loads trade history from file
func (s *Service) LoadTrades() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, err := os.Stat(s.TradesPath); os.IsNotExist(err) {
		s.trades = &TradeLog{Trades: []Trade{}}
		return nil
	}

	data, err := os.ReadFile(s.TradesPath)
	if err != nil {
		return fmt.Errorf("failed to read trades: %w", err)
	}

	var trades TradeLog
	if err := json.Unmarshal(data, &trades); err != nil {
		return fmt.Errorf("failed to parse trades: %w", err)
	}

	s.trades = &trades
	return nil
}

// SaveTrades saves trade history to file
func (s *Service) SaveTrades() error {
	s.mu.RLock()
	defer s.mu.RUnlock()

	data, err := json.MarshalIndent(s.trades, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal trades: %w", err)
	}

	return os.WriteFile(s.TradesPath, data, 0644)
}

// makeRequest makes an authenticated request to Alpaca API
func (s *Service) makeRequest(method, url string) ([]byte, error) {
	if s.keys == nil {
		if err := s.LoadKeys(); err != nil {
			return nil, err
		}
	}

	req, err := http.NewRequest(method, url, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("APCA-API-KEY-ID", s.keys.KeyID)
	req.Header.Set("APCA-API-SECRET-KEY", s.keys.SecretKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error %d: %s", resp.StatusCode, string(body))
	}

	return body, nil
}

// HealthHandler checks if Alpaca API is accessible
func (s *Service) HealthHandler(c *gin.Context) {
	if err := s.LoadKeys(); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status": "unhealthy",
			"error":  err.Error(),
		})
		return
	}

	url := s.keys.BaseURL + "/account"
	_, err := s.makeRequest("GET", url)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status": "unhealthy",
			"error":  err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "healthy",
		"environment": func() string {
			if filepath.Base(s.keys.BaseURL) == "paper-api.alpaca.markets" {
				return "paper"
			}
			return "live"
		}(),
	})
}

// AccountHandler returns account summary
func (s *Service) AccountHandler(c *gin.Context) {
	url := s.keys.BaseURL + "/account"
	data, err := s.makeRequest("GET", url)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var account Account
	if err := json.Unmarshal(data, &account); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, account)
}

// PositionsHandler returns all positions
func (s *Service) PositionsHandler(c *gin.Context) {
	url := s.keys.BaseURL + "/positions"
	data, err := s.makeRequest("GET", url)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var positions []Position
	if err := json.Unmarshal(data, &positions); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, positions)
}

// PortfolioHandler returns combined account + positions summary
func (s *Service) PortfolioHandler(c *gin.Context) {
	// Get account
	accountURL := s.keys.BaseURL + "/account"
	accountData, err := s.makeRequest("GET", accountURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var account Account
	if err := json.Unmarshal(accountData, &account); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Get positions
	positionsURL := s.keys.BaseURL + "/positions"
	positionsData, err := s.makeRequest("GET", positionsURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var positions []Position
	if err := json.Unmarshal(positionsData, &positions); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"account":   account,
		"positions": positions,
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

// TradesHandler returns trade history
func (s *Service) TradesHandler(c *gin.Context) {
	if err := s.LoadTrades(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	c.JSON(http.StatusOK, s.trades)
}

// RecordTradeHandler records a new trade recommendation or execution
func (s *Service) RecordTradeHandler(c *gin.Context) {
	var trade Trade
	if err := c.BindJSON(&trade); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := s.LoadTrades(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	s.mu.Lock()
	trade.ID = fmt.Sprintf("T%d", time.Now().UnixNano())
	if trade.RecommendedAt.IsZero() {
		trade.RecommendedAt = time.Now()
	}
	s.trades.Trades = append(s.trades.Trades, trade)
	s.mu.Unlock()

	if err := s.SaveTrades(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, trade)
}

// UpdateTradeHandler updates a trade (executed, closed, etc.)
func (s *Service) UpdateTradeHandler(c *gin.Context) {
	tradeID := c.Param("id")

	var update struct {
		Status        string   `json:"status"`
		ExecutedPrice *float64 `json:"executed_price,omitempty"`
		ClosedPrice   *float64 `json:"closed_price,omitempty"`
	}

	if err := c.BindJSON(&update); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := s.LoadTrades(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	s.mu.Lock()
	found := false
	for i := range s.trades.Trades {
		if s.trades.Trades[i].ID == tradeID {
			now := time.Now()
			s.trades.Trades[i].Status = update.Status

			if update.Status == "executed" && update.ExecutedPrice != nil {
				s.trades.Trades[i].ExecutedAt = &now
				s.trades.Trades[i].ExecutedPrice = update.ExecutedPrice
			}

			if update.Status == "closed" && update.ClosedPrice != nil {
				s.trades.Trades[i].ClosedAt = &now
				s.trades.Trades[i].ClosedPrice = update.ClosedPrice

				// Calculate P&L
				if s.trades.Trades[i].ExecutedPrice != nil {
					pnl := (*update.ClosedPrice - *s.trades.Trades[i].ExecutedPrice) * float64(s.trades.Trades[i].Shares)
					pnlPct := ((*update.ClosedPrice / *s.trades.Trades[i].ExecutedPrice) - 1) * 100
					s.trades.Trades[i].PnL = &pnl
					s.trades.Trades[i].PnLPct = &pnlPct
				}
			}

			found = true
			break
		}
	}
	s.mu.Unlock()

	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "trade not found"})
		return
	}

	if err := s.SaveTrades(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "updated"})
}

// StatsHandler returns trading statistics
func (s *Service) StatsHandler(c *gin.Context) {
	if err := s.LoadTrades(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	var (
		total      int
		executed   int
		declined   int
		closed     int
		wins       int
		losses     int
		totalPnL   float64
	)

	for _, t := range s.trades.Trades {
		total++
		switch t.Status {
		case "executed":
			executed++
		case "declined":
			declined++
		case "closed":
			closed++
			if t.PnL != nil {
				totalPnL += *t.PnL
				if *t.PnL > 0 {
					wins++
				} else {
					losses++
				}
			}
		}
	}

	winRate := float64(0)
	if closed > 0 {
		winRate = float64(wins) / float64(closed) * 100
	}

	c.JSON(http.StatusOK, gin.H{
		"total_recommendations": total,
		"executed":              executed,
		"declined":              declined,
		"closed":                closed,
		"wins":                  wins,
		"losses":                losses,
		"win_rate":              winRate,
		"total_pnl":             totalPnL,
	})
}
