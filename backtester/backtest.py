"""
Backtesting Engine

This is the core engine that runs a strategy against historical data
to see how it would have performed.

=============================================================================
HOW BACKTESTING WORKS
=============================================================================

Imagine you have a time machine. You go back to January 1, 2020, and
you start trading with your strategy. Each day:

  1. Look at today's data (open, high, low, close, volume)
  2. Ask the strategy: "Should I buy, sell, or hold?"
  3. Execute the trade (if any)
  4. Record the result
  5. Move to the next day

At the end, we have a record of every trade and the total profit/loss.

This engine does exactly that — it simulates trading day by day.

=============================================================================
KEY CONCEPTS
=============================================================================

EQUITY CURVE:
  Your portfolio value over time. Starts at initial cash, changes as
  you make and lose money on trades.

POSITION:
  Whether you own the stock or not, and how many shares.
  - position = 0: You're out of the market (all cash)
  - position = 100: You own 100 shares

SIGNALS:
  What the strategy tells us to do each day:
  - 1 = BUY (enter a position)
  - -1 = SELL (exit the position)
  - 0 = HOLD (do nothing)

=============================================================================
"""

import pandas as pd
import numpy as np
from typing import Optional, List, Dict, Tuple
from dataclasses import dataclass
from datetime import datetime

from strategies.base import Strategy
from metrics import calculate_metrics, BacktestMetrics, quick_summary


@dataclass
class Trade:
    """
    Record of a single completed trade.
    
    A trade is a round-trip: buy (entry) → sell (exit).
    """
    entry_date: datetime
    exit_date: datetime
    entry_price: float
    exit_price: float
    shares: int
    pnl: float              # Dollar profit/loss
    pnl_pct: float          # Percentage profit/loss
    exit_reason: str        # 'signal', 'stop_loss', 'end_of_data'


class Backtester:
    """
    The main backtesting engine.
    
    Takes a strategy and price data, simulates trading day-by-day,
    and calculates performance metrics.
    
    Example usage:
        strategy = MomentumStrategy()
        backtester = Backtester(initial_cash=10000)
        results = backtester.run(strategy, price_data)
        print(results.metrics)
    """
    
    def __init__(
        self,
        initial_cash: float = 10000,
        commission: float = 0.0,        # Per-trade commission ($0 for Alpaca)
        slippage: float = 0.001,        # 0.1% slippage (realistic)
    ):
        """
        Initialize the backtester.
        
        Args:
            initial_cash: Starting portfolio value
            commission: Commission per trade in dollars
            slippage: Price slippage as decimal (0.001 = 0.1%)
        """
        self.initial_cash = initial_cash
        self.commission = commission
        self.slippage = slippage
        
        # These get set during run()
        self.cash = initial_cash
        self.position = 0           # Number of shares held
        self.entry_price = 0.0      # Price we bought at
        self.entry_date = None      # When we bought
        self.highest_price = 0.0    # For trailing stop-loss
        
        self.trades: List[Trade] = []
        self.equity_curve: List[Tuple[datetime, float]] = []
    
    def run(
        self,
        strategy: Strategy,
        data: pd.DataFrame,
        benchmark: Optional[pd.DataFrame] = None,
    ) -> 'BacktestResult':
        """
        Run the backtest.
        
        This is the main method. It:
        1. Generates signals from the strategy
        2. Simulates trading day by day
        3. Calculates performance metrics
        
        Args:
            strategy: The trading strategy to test
            data: Price data with columns: open, high, low, close, volume
            benchmark: Optional benchmark data for comparison (e.g., SPY)
        
        Returns:
            BacktestResult with equity curve, trades, and metrics
        """
        # Reset state for fresh run
        self._reset()
        
        # =================================================================
        # STEP 1: Generate signals
        # =================================================================
        # Ask the strategy what to do on each day
        signals = strategy.generate_signals(data)
        
        # =================================================================
        # STEP 2: Simulate trading day by day
        # =================================================================
        for i, (date, row) in enumerate(data.iterrows()):
            signal = signals.iloc[i]
            current_price = row['close']
            
            # Track highest price for trailing stop-loss
            if self.position > 0:
                self.highest_price = max(self.highest_price, current_price)
            
            # ----- CHECK STOP LOSS -----
            if self.position > 0 and strategy.should_use_stop_loss():
                stop_price = self.highest_price * (1 - strategy.stop_loss_pct())
                
                if current_price <= stop_price:
                    # Stop-loss triggered! Exit position
                    self._sell(date, current_price, reason='stop_loss')
                    # Don't process other signals this day
                    self._record_equity(date, current_price)
                    continue
            
            # ----- PROCESS SIGNALS -----
            if signal == 1 and self.position == 0:
                # BUY signal and we're not already in a position
                self._buy(date, current_price)
            
            elif signal == -1 and self.position > 0:
                # SELL signal and we have a position
                self._sell(date, current_price, reason='signal')
            
            # Record portfolio value for this day
            self._record_equity(date, current_price)
        
        # =================================================================
        # STEP 3: Close any open position at end of data
        # =================================================================
        if self.position > 0:
            final_price = data['close'].iloc[-1]
            final_date = data.index[-1]
            self._sell(final_date, final_price, reason='end_of_data')
        
        # =================================================================
        # STEP 4: Calculate metrics
        # =================================================================
        # Convert equity curve to Series
        equity_df = pd.DataFrame(self.equity_curve, columns=['date', 'equity'])
        equity_df.set_index('date', inplace=True)
        equity_series = equity_df['equity']
        
        # Convert trades to DataFrame
        if self.trades:
            trades_df = pd.DataFrame([
                {
                    'entry_date': t.entry_date,
                    'exit_date': t.exit_date,
                    'entry_price': t.entry_price,
                    'exit_price': t.exit_price,
                    'shares': t.shares,
                    'pnl': t.pnl,
                    'pnl_pct': t.pnl_pct,
                    'exit_reason': t.exit_reason,
                }
                for t in self.trades
            ])
        else:
            trades_df = pd.DataFrame()
        
        # Calculate benchmark curve if provided
        benchmark_curve = None
        if benchmark is not None:
            # Scale benchmark to same starting value
            benchmark_curve = benchmark['close'] / benchmark['close'].iloc[0] * self.initial_cash
            benchmark_curve = benchmark_curve.loc[equity_series.index[0]:equity_series.index[-1]]
        
        # Calculate all metrics
        metrics = calculate_metrics(equity_series, trades_df, benchmark_curve)
        
        return BacktestResult(
            strategy=strategy,
            equity_curve=equity_series,
            trades=self.trades,
            metrics=metrics,
            signals=signals,
        )
    
    def _reset(self):
        """Reset all state for a fresh backtest run."""
        self.cash = self.initial_cash
        self.position = 0
        self.entry_price = 0.0
        self.entry_date = None
        self.highest_price = 0.0
        self.trades = []
        self.equity_curve = []
    
    def _buy(self, date: datetime, price: float):
        """
        Execute a buy order.
        
        Uses all available cash to buy as many shares as possible.
        Includes slippage (slightly worse fill price).
        """
        # Apply slippage (we pay slightly more than the "price")
        fill_price = price * (1 + self.slippage)
        
        # Calculate how many shares we can buy
        available = self.cash - self.commission
        shares = int(available / fill_price)
        
        if shares <= 0:
            return  # Can't afford any shares
        
        # Execute the buy
        cost = shares * fill_price + self.commission
        self.cash -= cost
        self.position = shares
        self.entry_price = fill_price
        self.entry_date = date
        self.highest_price = price  # Start tracking for trailing stop
    
    def _sell(self, date: datetime, price: float, reason: str):
        """
        Execute a sell order and record the trade.
        
        Includes slippage (slightly worse fill price).
        """
        if self.position <= 0:
            return
        
        # Apply slippage (we receive slightly less than the "price")
        fill_price = price * (1 - self.slippage)
        
        # Execute the sell
        proceeds = self.position * fill_price - self.commission
        self.cash += proceeds
        
        # Calculate profit/loss
        pnl = (fill_price - self.entry_price) * self.position
        pnl_pct = ((fill_price / self.entry_price) - 1) * 100
        
        # Record the completed trade
        trade = Trade(
            entry_date=self.entry_date,
            exit_date=date,
            entry_price=self.entry_price,
            exit_price=fill_price,
            shares=self.position,
            pnl=pnl,
            pnl_pct=pnl_pct,
            exit_reason=reason,
        )
        self.trades.append(trade)
        
        # Clear position
        self.position = 0
        self.entry_price = 0.0
        self.entry_date = None
        self.highest_price = 0.0
    
    def _record_equity(self, date: datetime, current_price: float):
        """
        Record the portfolio value for this day.
        
        Equity = cash + (shares × current price)
        """
        equity = self.cash + (self.position * current_price)
        self.equity_curve.append((date, equity))


@dataclass
class BacktestResult:
    """
    Container for backtest results.
    
    Includes the equity curve, list of trades, and all metrics.
    """
    strategy: Strategy
    equity_curve: pd.Series
    trades: List[Trade]
    metrics: BacktestMetrics
    signals: pd.Series
    
    def print_trades(self, limit: int = 10):
        """Print a summary of trades."""
        print(f"\n{'='*60}")
        print(f"TRADES ({len(self.trades)} total, showing first {min(limit, len(self.trades))})")
        print(f"{'='*60}")
        
        for i, trade in enumerate(self.trades[:limit]):
            emoji = "✅" if trade.pnl >= 0 else "❌"
            print(f"{emoji} {trade.entry_date.strftime('%Y-%m-%d')} → {trade.exit_date.strftime('%Y-%m-%d')}")
            print(f"   Entry: ${trade.entry_price:.2f} | Exit: ${trade.exit_price:.2f}")
            print(f"   P&L: ${trade.pnl:+.2f} ({trade.pnl_pct:+.2f}%) | Reason: {trade.exit_reason}")
            print()
    
    def summary(self) -> str:
        """One-line summary."""
        return quick_summary(self.equity_curve)


# =============================================================================
# HELPER: Run multiple strategies for comparison
# =============================================================================

def compare_strategies(
    strategies: List[Strategy],
    data: pd.DataFrame,
    initial_cash: float = 10000,
) -> pd.DataFrame:
    """
    Run multiple strategies on the same data and compare results.
    
    Args:
        strategies: List of strategies to test
        data: Price data
        initial_cash: Starting capital
    
    Returns:
        DataFrame comparing key metrics for each strategy
    """
    results = []
    
    for strategy in strategies:
        backtester = Backtester(initial_cash=initial_cash)
        result = backtester.run(strategy, data)
        
        results.append({
            'Strategy': strategy.name,
            'Return (%)': result.metrics.total_return,
            'Sharpe': result.metrics.sharpe_ratio,
            'Sortino': result.metrics.sortino_ratio,
            'Max DD (%)': result.metrics.max_drawdown,
            'Win Rate (%)': result.metrics.win_rate,
            'Trades': result.metrics.total_trades,
        })
    
    return pd.DataFrame(results)


# =============================================================================
# TEST THE BACKTESTER
# =============================================================================

if __name__ == "__main__":
    from strategies.momentum import MomentumStrategy, AggressiveMomentum, ConservativeMomentum
    
    print("=== Testing Backtester ===\n")
    
    # Generate sample data (2 years of daily prices)
    np.random.seed(42)
    dates = pd.date_range('2022-01-01', periods=504, freq='D')  # ~2 years
    
    # Create realistic price data with some trends
    trend = np.cumsum(np.random.randn(504) * 0.02)  # Random walk
    seasonality = np.sin(np.arange(504) * 2 * np.pi / 252) * 0.1  # Yearly cycle
    prices = 100 * np.exp(trend + seasonality)  # Log-normal prices
    
    data = pd.DataFrame({
        'open': prices * (1 + np.random.randn(504) * 0.005),
        'high': prices * (1 + np.abs(np.random.randn(504)) * 0.015),
        'low': prices * (1 - np.abs(np.random.randn(504)) * 0.015),
        'close': prices,
        'volume': np.random.randint(1000000, 5000000, 504),
    }, index=dates)
    
    # Run backtest with momentum strategy
    strategy = MomentumStrategy()
    print(strategy.describe())
    
    backtester = Backtester(initial_cash=10000)
    result = backtester.run(strategy, data)
    
    # Print results
    print(result.metrics)
    result.print_trades(limit=5)
    
    # Compare all momentum variants
    print("\n" + "="*60)
    print("STRATEGY COMPARISON")
    print("="*60)
    
    strategies = [
        MomentumStrategy(),
        AggressiveMomentum(),
        ConservativeMomentum(),
    ]
    
    comparison = compare_strategies(strategies, data)
    print(comparison.to_string(index=False))
    
    print("\n✅ Backtester ready!")
