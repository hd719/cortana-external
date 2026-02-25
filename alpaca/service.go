package alpaca

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"
)

// Keys holds the Alpaca API credentials
// base_url should point at paper-api.alpaca.markets for paper trading.
type Keys struct {
	KeyID     string `json:"key_id"`
	SecretKey string `json:"secret_key"`
	BaseURL   string `json:"base_url"`
	DataURL   string `json:"data_url"`
}

// Account represents Alpaca account info
type Account struct {
	ID               string `json:"id"`
	AccountNumber    string `json:"account_number"`
	Status           string `json:"status"`
	Currency         string `json:"currency"`
	Cash             string `json:"cash"`
	PortfolioValue   string `json:"portfolio_value"`
	BuyingPower      string `json:"buying_power"`
	Equity           string `json:"equity"`
	LastEquity       string `json:"last_equity"`
	DaytradeCount    int    `json:"daytrade_count"`
	PatternDayTrader bool   `json:"pattern_day_trader"`
}

// Position represents a single position in the portfolio
type Position struct {
	Symbol         string `json:"symbol"`
	Qty            string `json:"qty"`
	Side           string `json:"side"`
	MarketValue    string `json:"market_value"`
	CostBasis      string `json:"cost_basis"`
	UnrealizedPL   string `json:"unrealized_pl"`
	UnrealizedPLPC string `json:"unrealized_plpc"`
	CurrentPrice   string `json:"current_price"`
	AvgEntryPrice  string `json:"avg_entry_price"`
	ChangeToday    string `json:"change_today"`
}

// LatestTrade represents Alpaca latest trade payload
type LatestTrade struct {
	P float64 `json:"p"`
	T string  `json:"t"`
}

// LatestQuote represents Alpaca latest quote payload
type LatestQuote struct {
	BP float64 `json:"bp"`
	AP float64 `json:"ap"`
	T  string  `json:"t"`
}

// TradeRecord is DB-backed Cortana trade history.
type TradeRecord struct {
	ID          int64           `json:"id"`
	Timestamp   time.Time       `json:"timestamp"`
	Symbol      string          `json:"symbol"`
	Side        string          `json:"side"`
	Qty         *float64        `json:"qty,omitempty"`
	Notional    *float64        `json:"notional,omitempty"`
	EntryPrice  *float64        `json:"entry_price,omitempty"`
	TargetPrice *float64        `json:"target_price,omitempty"`
	StopLoss    *float64        `json:"stop_loss,omitempty"`
	Thesis      string          `json:"thesis,omitempty"`
	SignalSrc   string          `json:"signal_source,omitempty"`
	Status      string          `json:"status"`
	ExitPrice   *float64        `json:"exit_price,omitempty"`
	ExitTS      *time.Time      `json:"exit_timestamp,omitempty"`
	PnL         *float64        `json:"pnl,omitempty"`
	PnLPct      *float64        `json:"pnl_pct,omitempty"`
	Outcome     string          `json:"outcome,omitempty"`
	Metadata    json.RawMessage `json:"metadata,omitempty"`
}

type RecordTradeRequest struct {
	Symbol       string   `json:"symbol" binding:"required"`
	Side         string   `json:"side" binding:"required"`
	Qty          *float64 `json:"qty"`
	Notional     *float64 `json:"notional"`
	Thesis       string   `json:"thesis"`
	SignalSource string   `json:"signal_source"`
	TargetPrice  *float64 `json:"target_price"`
	StopLoss     *float64 `json:"stop_loss"`
	OrderType    string   `json:"order_type"`
	TimeInForce  string   `json:"time_in_force"`
}

type UpdateTradeRequest struct {
	Status    *string  `json:"status"`
	ExitPrice *float64 `json:"exit_price"`
	Outcome   *string  `json:"outcome"`
}

// Service handles Alpaca API interactions
type Service struct {
	HTTPClient *http.Client
	Logger     *log.Logger
	KeysPath   string
	TradesPath string // retained for backwards compatibility, no longer primary store

	keys *Keys

	db     *sql.DB
	dbOnce sync.Once
	dbErr  error
}

const createTradesTableSQL = `
CREATE TABLE IF NOT EXISTS cortana_trades (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  qty NUMERIC,
  notional NUMERIC,
  entry_price NUMERIC,
  target_price NUMERIC,
  stop_loss NUMERIC,
  thesis TEXT,
  signal_source TEXT,
  status TEXT DEFAULT 'open',
  exit_price NUMERIC,
  exit_timestamp TIMESTAMPTZ,
  pnl NUMERIC,
  pnl_pct NUMERIC,
  outcome TEXT,
  metadata JSONB DEFAULT '{}'
);`

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
	keys.BaseURL = strings.TrimRight(keys.BaseURL, "/")
	if !strings.HasSuffix(keys.BaseURL, "/v2") {
		keys.BaseURL = keys.BaseURL + "/v2"
	}
	if keys.DataURL == "" {
		keys.DataURL = "https://data.alpaca.markets"
	}
	keys.DataURL = strings.TrimRight(keys.DataURL, "/")

	s.keys = &keys
	return nil
}

func (s *Service) ensureKeysLoaded() error {
	if s.keys != nil {
		return nil
	}
	return s.LoadKeys()
}

func (s *Service) ensureDB() error {
	s.dbOnce.Do(func() {
		dsn := os.Getenv("CORTANA_DATABASE_URL")
		if dsn == "" {
			dsn = "postgres://localhost:5432/cortana?sslmode=disable"
		}
		db, err := sql.Open("postgres", dsn)
		if err != nil {
			s.dbErr = fmt.Errorf("open db: %w", err)
			return
		}
		db.SetMaxOpenConns(5)
		db.SetMaxIdleConns(5)
		db.SetConnMaxLifetime(30 * time.Minute)

		if err := db.Ping(); err != nil {
			s.dbErr = fmt.Errorf("ping db: %w", err)
			_ = db.Close()
			return
		}

		if _, err := db.Exec(createTradesTableSQL); err != nil {
			s.dbErr = fmt.Errorf("create cortana_trades: %w", err)
			_ = db.Close()
			return
		}

		s.db = db
	})
	return s.dbErr
}

func (s *Service) makeJSONRequest(method, url string, payload any, okCodes ...int) ([]byte, error) {
	if err := s.ensureKeysLoaded(); err != nil {
		return nil, err
	}

	var body io.Reader
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			return nil, fmt.Errorf("marshal request: %w", err)
		}
		body = bytes.NewBuffer(b)
	}

	req, err := http.NewRequest(method, url, body)
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

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if len(okCodes) == 0 {
		okCodes = []int{http.StatusOK}
	}
	for _, code := range okCodes {
		if resp.StatusCode == code {
			return respBody, nil
		}
	}
	return nil, fmt.Errorf("alpaca API error %d: %s", resp.StatusCode, string(respBody))
}

func normalizeSide(side string) string {
	s := strings.ToLower(strings.TrimSpace(side))
	if s == "buy" || s == "sell" {
		return s
	}
	return ""
}

func parseNullableFloat(str string) *float64 {
	if strings.TrimSpace(str) == "" {
		return nil
	}
	f, err := strconv.ParseFloat(str, 64)
	if err != nil {
		return nil
	}
	return &f
}

func float64Ptr(v float64) *float64 { return &v }

func (s *Service) fetchLatestTradePrice(symbol string) *float64 {
	url := fmt.Sprintf("%s/v2/stocks/%s/trades/latest", s.keys.DataURL, symbol)
	data, err := s.makeJSONRequest("GET", url, nil, http.StatusOK)
	if err != nil {
		return nil
	}
	var tradeResp struct {
		Trade LatestTrade `json:"trade"`
	}
	if err := json.Unmarshal(data, &tradeResp); err != nil {
		return nil
	}
	if tradeResp.Trade.P <= 0 {
		return nil
	}
	return float64Ptr(tradeResp.Trade.P)
}

func (s *Service) insertTrade(rec *TradeRecord) error {
	if err := s.ensureDB(); err != nil {
		return err
	}

	if rec.Metadata == nil {
		rec.Metadata = json.RawMessage(`{}`)
	}

	row := s.db.QueryRow(`
		INSERT INTO cortana_trades (
			symbol, side, qty, notional, entry_price, target_price, stop_loss,
			thesis, signal_source, status, metadata
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING id, timestamp
	`,
		rec.Symbol,
		rec.Side,
		rec.Qty,
		rec.Notional,
		rec.EntryPrice,
		rec.TargetPrice,
		rec.StopLoss,
		rec.Thesis,
		rec.SignalSrc,
		rec.Status,
		rec.Metadata,
	)

	if err := row.Scan(&rec.ID, &rec.Timestamp); err != nil {
		return fmt.Errorf("insert trade: %w", err)
	}
	return nil
}

// HealthHandler checks if Alpaca API is accessible
func (s *Service) HealthHandler(c *gin.Context) {
	if err := s.LoadKeys(); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "unhealthy", "error": err.Error()})
		return
	}

	url := s.keys.BaseURL + "/account"
	_, err := s.makeJSONRequest("GET", url, nil, http.StatusOK)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "unhealthy", "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "healthy",
		"environment": func() string {
			if strings.Contains(s.keys.BaseURL, "paper-api.alpaca.markets") {
				return "paper"
			}
			return "live"
		}(),
	})
}

// AccountHandler returns account summary
func (s *Service) AccountHandler(c *gin.Context) {
	if err := s.ensureKeysLoaded(); err != nil {
		s.Logger.Printf("failed to load Alpaca keys in /alpaca/account: %v", err)
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}

	data, err := s.makeJSONRequest("GET", s.keys.BaseURL+"/account", nil, http.StatusOK)
	if err != nil {
		s.Logger.Printf("alpaca account request failed: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
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
	if err := s.ensureKeysLoaded(); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}

	data, err := s.makeJSONRequest("GET", s.keys.BaseURL+"/positions", nil, http.StatusOK)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
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
	if err := s.ensureKeysLoaded(); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}

	accountData, err := s.makeJSONRequest("GET", s.keys.BaseURL+"/account", nil, http.StatusOK)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	positionsData, err := s.makeJSONRequest("GET", s.keys.BaseURL+"/positions", nil, http.StatusOK)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	var account Account
	if err := json.Unmarshal(accountData, &account); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var positions []Position
	if err := json.Unmarshal(positionsData, &positions); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"account": account, "positions": positions, "timestamp": time.Now().Format(time.RFC3339)})
}

// QuoteHandler returns latest quote + latest trade for symbol.
func (s *Service) QuoteHandler(c *gin.Context) {
	if err := s.ensureKeysLoaded(); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}

	symbol := strings.ToUpper(strings.TrimSpace(c.Param("symbol")))
	if symbol == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "symbol is required"})
		return
	}

	quoteURL := fmt.Sprintf("%s/v2/stocks/%s/quotes/latest", s.keys.DataURL, symbol)
	quoteData, err := s.makeJSONRequest("GET", quoteURL, nil, http.StatusOK)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	var quoteResp struct {
		Quote LatestQuote `json:"quote"`
	}
	if err := json.Unmarshal(quoteData, &quoteResp); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	tradeURL := fmt.Sprintf("%s/v2/stocks/%s/trades/latest", s.keys.DataURL, symbol)
	tradeData, err := s.makeJSONRequest("GET", tradeURL, nil, http.StatusOK)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	var tradeResp struct {
		Trade LatestTrade `json:"trade"`
	}
	if err := json.Unmarshal(tradeData, &tradeResp); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	timestamp := quoteResp.Quote.T
	if timestamp == "" {
		timestamp = tradeResp.Trade.T
	}

	c.JSON(http.StatusOK, gin.H{"symbol": symbol, "bid": quoteResp.Quote.BP, "ask": quoteResp.Quote.AP, "last_price": tradeResp.Trade.P, "timestamp": timestamp})
}

// SnapshotHandler returns market snapshot for symbol.
func (s *Service) SnapshotHandler(c *gin.Context) {
	if err := s.ensureKeysLoaded(); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}

	symbol := strings.ToUpper(strings.TrimSpace(c.Param("symbol")))
	if symbol == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "symbol is required"})
		return
	}

	url := fmt.Sprintf("%s/v2/stocks/%s/snapshot", s.keys.DataURL, symbol)
	data, err := s.makeJSONRequest("GET", url, nil, http.StatusOK)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"symbol":         symbol,
		"latest_trade":   payload["latestTrade"],
		"latest_quote":   payload["latestQuote"],
		"minute_bar":     payload["minuteBar"],
		"daily_bar":      payload["dailyBar"],
		"prev_daily_bar": payload["prevDailyBar"],
	})
}

// BarsHandler returns latest daily bars (OHLCV) for symbol.
func (s *Service) BarsHandler(c *gin.Context) {
	if err := s.ensureKeysLoaded(); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}

	symbol := strings.ToUpper(strings.TrimSpace(c.Param("symbol")))
	if symbol == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "symbol is required"})
		return
	}

	url := fmt.Sprintf("%s/v2/stocks/%s/bars?timeframe=1Day&limit=5", s.keys.DataURL, symbol)
	data, err := s.makeJSONRequest("GET", url, nil, http.StatusOK)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	var barsResp struct {
		Bars []map[string]any `json:"bars"`
	}
	if err := json.Unmarshal(data, &barsResp); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"symbol": symbol, "bars": barsResp.Bars, "count": len(barsResp.Bars)})
}

// TradesHandler returns recent trade history from PostgreSQL.
func (s *Service) TradesHandler(c *gin.Context) {
	if err := s.ensureDB(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	rows, err := s.db.Query(`
		SELECT id, timestamp, symbol, side, qty::float8, notional::float8, entry_price::float8,
		       target_price::float8, stop_loss::float8, thesis, signal_source, status,
		       exit_price::float8, exit_timestamp, pnl::float8, pnl_pct::float8, outcome, metadata
		FROM cortana_trades
		ORDER BY timestamp DESC
		LIMIT 200
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	trades := make([]TradeRecord, 0)
	for rows.Next() {
		var rec TradeRecord
		var thesis, signalSource, status, outcome sql.NullString
		var qty, notional, entry, target, stop, exit, pnl, pnlPct sql.NullFloat64
		var exitTS sql.NullTime
		var metadata []byte

		err := rows.Scan(
			&rec.ID,
			&rec.Timestamp,
			&rec.Symbol,
			&rec.Side,
			&qty,
			&notional,
			&entry,
			&target,
			&stop,
			&thesis,
			&signalSource,
			&status,
			&exit,
			&exitTS,
			&pnl,
			&pnlPct,
			&outcome,
			&metadata,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		if qty.Valid {
			rec.Qty = &qty.Float64
		}
		if notional.Valid {
			rec.Notional = &notional.Float64
		}
		if entry.Valid {
			rec.EntryPrice = &entry.Float64
		}
		if target.Valid {
			rec.TargetPrice = &target.Float64
		}
		if stop.Valid {
			rec.StopLoss = &stop.Float64
		}
		if exit.Valid {
			rec.ExitPrice = &exit.Float64
		}
		if pnl.Valid {
			rec.PnL = &pnl.Float64
		}
		if pnlPct.Valid {
			rec.PnLPct = &pnlPct.Float64
		}
		if thesis.Valid {
			rec.Thesis = thesis.String
		}
		if signalSource.Valid {
			rec.SignalSrc = signalSource.String
		}
		if status.Valid {
			rec.Status = status.String
		}
		if outcome.Valid {
			rec.Outcome = outcome.String
		}
		if exitTS.Valid {
			t := exitTS.Time
			rec.ExitTS = &t
		}
		rec.Metadata = metadata

		trades = append(trades, rec)
	}

	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"trades": trades})
}

// RecordTradeHandler places an Alpaca order and logs trade thesis to PostgreSQL.
func (s *Service) RecordTradeHandler(c *gin.Context) {
	var req RecordTradeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := s.ensureKeysLoaded(); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	if err := s.ensureDB(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	symbol := strings.ToUpper(strings.TrimSpace(req.Symbol))
	side := normalizeSide(req.Side)
	if symbol == "" || side == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "symbol and side (buy/sell) are required"})
		return
	}
	if req.Qty == nil && req.Notional == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "qty or notional is required"})
		return
	}
	if req.Qty != nil && req.Notional != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provide qty or notional, not both"})
		return
	}
	if req.Qty != nil && *req.Qty <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "qty must be > 0"})
		return
	}
	if req.Notional != nil && *req.Notional <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "notional must be > 0"})
		return
	}

	orderType := strings.ToLower(strings.TrimSpace(req.OrderType))
	if orderType == "" {
		orderType = "market"
	}
	tif := strings.ToLower(strings.TrimSpace(req.TimeInForce))
	if tif == "" {
		tif = "day"
	}

	orderPayload := map[string]any{
		"symbol":        symbol,
		"side":          side,
		"type":          orderType,
		"time_in_force": tif,
	}
	if req.Qty != nil {
		orderPayload["qty"] = *req.Qty
	}
	if req.Notional != nil {
		orderPayload["notional"] = *req.Notional
	}

	alpacaRespRaw, err := s.makeJSONRequest("POST", s.keys.BaseURL+"/orders", orderPayload, http.StatusOK, http.StatusCreated)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	var alpacaOrder map[string]any
	if err := json.Unmarshal(alpacaRespRaw, &alpacaOrder); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("unable to parse Alpaca order response: %v", err)})
		return
	}

	var entryPrice *float64
	if v, ok := alpacaOrder["filled_avg_price"]; ok && v != nil {
		switch t := v.(type) {
		case string:
			entryPrice = parseNullableFloat(t)
		case float64:
			entryPrice = &t
		}
	}
	if entryPrice == nil {
		entryPrice = s.fetchLatestTradePrice(symbol)
	}

	meta := map[string]any{"alpaca_order": alpacaOrder}
	metaRaw, _ := json.Marshal(meta)

	rec := TradeRecord{
		Symbol:      symbol,
		Side:        side,
		Qty:         req.Qty,
		Notional:    req.Notional,
		EntryPrice:  entryPrice,
		TargetPrice: req.TargetPrice,
		StopLoss:    req.StopLoss,
		Thesis:      strings.TrimSpace(req.Thesis),
		SignalSrc:   strings.TrimSpace(req.SignalSource),
		Status:      "open",
		Metadata:    metaRaw,
	}

	if err := s.insertTrade(&rec); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"trade":        rec,
		"alpaca_order": alpacaOrder,
	})
}

// UpdateTradeHandler updates trade state in PostgreSQL.
func (s *Service) UpdateTradeHandler(c *gin.Context) {
	if err := s.ensureDB(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	tradeID := strings.TrimSpace(c.Param("id"))
	if tradeID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "trade id is required"})
		return
	}

	id, err := strconv.ParseInt(tradeID, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "trade id must be an integer"})
		return
	}

	var req UpdateTradeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var currentEntry sql.NullFloat64
	var currentQty sql.NullFloat64
	err = s.db.QueryRow("SELECT entry_price::float8, qty::float8 FROM cortana_trades WHERE id = $1", id).Scan(&currentEntry, &currentQty)
	if errors.Is(err, sql.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"error": "trade not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	setParts := make([]string, 0, 6)
	args := make([]any, 0, 8)
	argIdx := 1

	if req.Status != nil {
		setParts = append(setParts, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, strings.TrimSpace(*req.Status))
		argIdx++
	}
	if req.Outcome != nil {
		setParts = append(setParts, fmt.Sprintf("outcome = $%d", argIdx))
		args = append(args, strings.TrimSpace(*req.Outcome))
		argIdx++
	}
	if req.ExitPrice != nil {
		setParts = append(setParts, fmt.Sprintf("exit_price = $%d", argIdx))
		args = append(args, *req.ExitPrice)
		argIdx++
		setParts = append(setParts, "exit_timestamp = NOW()")

		if currentEntry.Valid {
			pnl := (*req.ExitPrice - currentEntry.Float64)
			if currentQty.Valid {
				pnl *= currentQty.Float64
			}
			setParts = append(setParts, fmt.Sprintf("pnl = $%d", argIdx))
			args = append(args, pnl)
			argIdx++

			if currentEntry.Float64 != 0 {
				pct := ((*req.ExitPrice / currentEntry.Float64) - 1) * 100
				if !math.IsNaN(pct) && !math.IsInf(pct, 0) {
					setParts = append(setParts, fmt.Sprintf("pnl_pct = $%d", argIdx))
					args = append(args, pct)
					argIdx++
				}
			}
		}
	}

	if len(setParts) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no update fields provided"})
		return
	}

	args = append(args, id)
	query := fmt.Sprintf("UPDATE cortana_trades SET %s WHERE id = $%d", strings.Join(setParts, ", "), argIdx)
	res, err := s.db.Exec(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	rowsAffected, _ := res.RowsAffected()
	if rowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "trade not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "updated", "trade_id": id})
}

// StatsHandler keeps backwards compatibility for existing consumers.
func (s *Service) StatsHandler(c *gin.Context) {
	if err := s.ensureDB(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var total, open, closed int
	var wins int
	var totalPnL sql.NullFloat64
	if err := s.db.QueryRow(`
		SELECT
			COUNT(*)::int,
			COUNT(*) FILTER (WHERE status = 'open')::int,
			COUNT(*) FILTER (WHERE status = 'closed')::int,
			COUNT(*) FILTER (WHERE status = 'closed' AND COALESCE(pnl,0) > 0)::int,
			SUM(pnl)::float8
		FROM cortana_trades
	`).Scan(&total, &open, &closed, &wins, &totalPnL); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	winRate := 0.0
	if closed > 0 {
		winRate = (float64(wins) / float64(closed)) * 100
	}

	c.JSON(http.StatusOK, gin.H{
		"total_trades": total,
		"open":         open,
		"closed":       closed,
		"wins":         wins,
		"win_rate":     winRate,
		"total_pnl": func() float64 {
			if totalPnL.Valid {
				return totalPnL.Float64
			}
			return 0
		}(),
	})
}

// PerformanceHandler returns portfolio and strategy performance metrics.
func (s *Service) PerformanceHandler(c *gin.Context) {
	if err := s.ensureDB(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := s.ensureKeysLoaded(); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}

	summary := gin.H{}
	var totalTrades int
	var avgReturn sql.NullFloat64
	var wins int
	if err := s.db.QueryRow(`
		SELECT
			COUNT(*)::int,
			AVG(pnl_pct)::float8,
			COUNT(*) FILTER (WHERE status = 'closed' AND COALESCE(pnl,0) > 0)::int
		FROM cortana_trades
	`).Scan(&totalTrades, &avgReturn, &wins); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var closedCount int
	if err := s.db.QueryRow(`SELECT COUNT(*)::int FROM cortana_trades WHERE status = 'closed'`).Scan(&closedCount); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	winRate := 0.0
	if closedCount > 0 {
		winRate = float64(wins) / float64(closedCount) * 100
	}

	var bestSymbol, worstSymbol sql.NullString
	var bestRet, worstRet sql.NullFloat64
	_ = s.db.QueryRow(`SELECT symbol, pnl_pct::float8 FROM cortana_trades WHERE pnl_pct IS NOT NULL ORDER BY pnl_pct DESC LIMIT 1`).Scan(&bestSymbol, &bestRet)
	_ = s.db.QueryRow(`SELECT symbol, pnl_pct::float8 FROM cortana_trades WHERE pnl_pct IS NOT NULL ORDER BY pnl_pct ASC LIMIT 1`).Scan(&worstSymbol, &worstRet)

	summary["total_trades"] = totalTrades
	summary["closed_trades"] = closedCount
	summary["win_rate"] = winRate
	summary["avg_return_pct"] = func() float64 {
		if avgReturn.Valid {
			return avgReturn.Float64
		}
		return 0
	}()
	summary["best_trade"] = gin.H{"symbol": bestSymbol.String, "return_pct": bestRet.Float64}
	summary["worst_trade"] = gin.H{"symbol": worstSymbol.String, "return_pct": worstRet.Float64}

	signalBreakdown := make([]gin.H, 0)
	rows, err := s.db.Query(`
		SELECT COALESCE(NULLIF(signal_source, ''), 'unknown') as signal_source,
		       COUNT(*)::int,
		       AVG(pnl_pct)::float8,
		       COUNT(*) FILTER (WHERE status='closed' AND COALESCE(pnl,0) > 0)::int,
		       COUNT(*) FILTER (WHERE status='closed')::int
		FROM cortana_trades
		GROUP BY 1
		ORDER BY 2 DESC
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	for rows.Next() {
		var source string
		var count, sourceWins, sourceClosed int
		var sourceAvg sql.NullFloat64
		if err := rows.Scan(&source, &count, &sourceAvg, &sourceWins, &sourceClosed); err != nil {
			rows.Close()
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		swr := 0.0
		if sourceClosed > 0 {
			swr = float64(sourceWins) / float64(sourceClosed) * 100
		}
		signalBreakdown = append(signalBreakdown, gin.H{
			"signal_source": source,
			"trade_count":   count,
			"avg_return_pct": func() float64 {
				if sourceAvg.Valid {
					return sourceAvg.Float64
				}
				return 0
			}(),
			"win_rate": swr,
		})
	}
	rows.Close()

	positionsData, err := s.makeJSONRequest("GET", s.keys.BaseURL+"/positions", nil, http.StatusOK)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	var positions []Position
	if err := json.Unmarshal(positionsData, &positions); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	openPositions := make([]gin.H, 0, len(positions))
	for _, p := range positions {
		openPositions = append(openPositions, gin.H{
			"symbol":             p.Symbol,
			"qty":                p.Qty,
			"avg_entry_price":    p.AvgEntryPrice,
			"current_price":      p.CurrentPrice,
			"market_value":       p.MarketValue,
			"unrealized_pnl":     p.UnrealizedPL,
			"unrealized_pnl_pct": p.UnrealizedPLPC,
			"change_today":       p.ChangeToday,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"summary":              summary,
		"by_signal_source":     signalBreakdown,
		"open_positions":       openPositions,
		"open_positions_count": len(openPositions),
		"timestamp":            time.Now().Format(time.RFC3339),
	})
}
