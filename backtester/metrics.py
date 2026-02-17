"""
Performance Metrics Module

This module calculates all the metrics we use to evaluate trading strategies.
Each metric tells us something different about how well a strategy performs.

=============================================================================
WHY DO WE NEED METRICS?
=============================================================================

"This strategy made 50% profit" sounds great, but:
  - What if it lost 40% at one point? (drawdown)
  - What if it only won 30% of trades? (win rate)
  - What if the S&P 500 made 60%? (vs benchmark)
  - What if it was insanely volatile? (risk-adjusted returns)

Metrics help us understand:
  1. How much money did we make? (returns)
  2. How much risk did we take? (volatility, drawdown)
  3. Was the return worth the risk? (Sharpe, Sortino)
  4. How consistent were we? (win rate, profit factor)

=============================================================================
"""

import pandas as pd
import numpy as np
from typing import Dict, Optional, Tuple
from dataclasses import dataclass


@dataclass
class BacktestMetrics:
    """
    Container for all backtest performance metrics.
    
    Using a dataclass makes it easy to access metrics by name
    and print them nicely.
    """
    # Return metrics
    total_return: float          # Total percentage return
    annual_return: float         # Annualized return (CAGR)
    benchmark_return: float      # Benchmark total return (for comparison)
    excess_return: float         # Return above benchmark (alpha)
    
    # Risk metrics
    volatility: float            # Annualized standard deviation of returns
    max_drawdown: float          # Worst peak-to-trough decline
    max_drawdown_duration: int   # Days in longest drawdown
    
    # Risk-adjusted metrics
    sharpe_ratio: float          # Return per unit of total risk
    sortino_ratio: float         # Return per unit of downside risk
    calmar_ratio: float          # Return per unit of max drawdown
    
    # Trade metrics
    total_trades: int            # Number of completed trades
    win_rate: float              # Percentage of winning trades
    avg_win: float               # Average profit on winning trades
    avg_loss: float              # Average loss on losing trades
    profit_factor: float         # Gross profit / gross loss
    avg_trade: float             # Average profit per trade
    
    # Time metrics
    start_date: str
    end_date: str
    trading_days: int
    
    def __str__(self) -> str:
        """Pretty print the metrics."""
        return f"""
╔══════════════════════════════════════════════════════════════╗
║                    BACKTEST RESULTS                          ║
╠══════════════════════════════════════════════════════════════╣
║ Period: {self.start_date} to {self.end_date} ({self.trading_days} days)
║
║ RETURNS
║   Total Return:      {self.total_return:>8.2f}%
║   Annual Return:     {self.annual_return:>8.2f}%
║   Benchmark Return:  {self.benchmark_return:>8.2f}%
║   Excess Return:     {self.excess_return:>8.2f}%
║
║ RISK
║   Volatility:        {self.volatility:>8.2f}%
║   Max Drawdown:      {self.max_drawdown:>8.2f}%
║   Drawdown Duration: {self.max_drawdown_duration:>8d} days
║
║ RISK-ADJUSTED
║   Sharpe Ratio:      {self.sharpe_ratio:>8.2f}
║   Sortino Ratio:     {self.sortino_ratio:>8.2f}
║   Calmar Ratio:      {self.calmar_ratio:>8.2f}
║
║ TRADES
║   Total Trades:      {self.total_trades:>8d}
║   Win Rate:          {self.win_rate:>8.2f}%
║   Avg Win:           {self.avg_win:>8.2f}%
║   Avg Loss:          {self.avg_loss:>8.2f}%
║   Profit Factor:     {self.profit_factor:>8.2f}
║   Avg Trade:         {self.avg_trade:>8.2f}%
╚══════════════════════════════════════════════════════════════╝
"""


# =============================================================================
# RETURN CALCULATIONS
# =============================================================================

def total_return(equity_curve: pd.Series) -> float:
    """
    Calculate total percentage return.
    
    Simple: (ending value - starting value) / starting value * 100
    
    Args:
        equity_curve: Series of portfolio values over time
    
    Returns:
        Total return as percentage (e.g., 25.5 for 25.5% return)
    """
    return ((equity_curve.iloc[-1] / equity_curve.iloc[0]) - 1) * 100


def cagr(equity_curve: pd.Series) -> float:
    """
    Compound Annual Growth Rate (CAGR)
    
    The smoothed annual rate of return. If you made 50% over 2 years,
    CAGR tells you the equivalent annual rate.
    
    Formula: (ending / starting) ^ (1 / years) - 1
    
    Args:
        equity_curve: Series of portfolio values with datetime index
    
    Returns:
        CAGR as percentage
    """
    # Calculate number of years
    days = (equity_curve.index[-1] - equity_curve.index[0]).days
    years = days / 365.25
    
    if years <= 0:
        return 0.0
    
    # Calculate CAGR
    total = equity_curve.iloc[-1] / equity_curve.iloc[0]
    annual = (total ** (1 / years)) - 1
    
    return annual * 100


# =============================================================================
# RISK CALCULATIONS
# =============================================================================

def volatility(returns: pd.Series, annualize: bool = True) -> float:
    """
    Calculate volatility (standard deviation of returns).
    
    Higher volatility = more risk = bigger swings up AND down.
    
    Args:
        returns: Series of daily returns
        annualize: If True, multiply by sqrt(252) for annual vol
    
    Returns:
        Volatility as percentage
    """
    vol = returns.std()
    
    if annualize:
        # 252 trading days per year
        vol = vol * np.sqrt(252)
    
    return vol * 100


def max_drawdown(equity_curve: pd.Series) -> Tuple[float, int]:
    """
    Calculate maximum drawdown and its duration.
    
    Drawdown = how much you lost from a peak before recovering.
    This is the WORST case scenario — how bad could it have gotten?
    
    Example:
        Portfolio goes: $100 → $120 → $90 → $110
        Max drawdown = (120 - 90) / 120 = 25%
    
    Args:
        equity_curve: Series of portfolio values
    
    Returns:
        Tuple of (max_drawdown_pct, duration_in_days)
    """
    # Calculate running maximum (the peak at each point)
    rolling_max = equity_curve.expanding().max()
    
    # Drawdown = how far below the peak we are
    drawdowns = (equity_curve - rolling_max) / rolling_max
    
    # Maximum drawdown (most negative value)
    max_dd = drawdowns.min() * 100  # Convert to percentage
    
    # Calculate drawdown duration (longest time underwater)
    # "Underwater" = below a previous peak
    underwater = drawdowns < 0
    
    # Find the longest streak of being underwater
    if underwater.any():
        # Create groups of consecutive underwater periods
        underwater_groups = (underwater != underwater.shift()).cumsum()
        underwater_groups = underwater_groups[underwater]
        
        if len(underwater_groups) > 0:
            duration = underwater_groups.value_counts().max()
        else:
            duration = 0
    else:
        duration = 0
    
    return max_dd, duration


# =============================================================================
# RISK-ADJUSTED RETURN CALCULATIONS
# =============================================================================

def sharpe_ratio(returns: pd.Series, risk_free_rate: float = 0.02) -> float:
    """
    Sharpe Ratio: Return per unit of TOTAL risk.
    
    Higher Sharpe = better risk-adjusted returns.
    
    Interpretation:
        < 0    = Losing money (bad)
        0-1    = Below average
        1-2    = Good
        2-3    = Very good
        > 3    = Excellent (rare)
    
    Formula: (Return - Risk-Free Rate) / Volatility
    
    Args:
        returns: Series of daily returns
        risk_free_rate: Annual risk-free rate (default 2%)
    
    Returns:
        Annualized Sharpe ratio
    """
    # Annualized return
    annual_return = returns.mean() * 252
    
    # Annualized volatility
    annual_vol = returns.std() * np.sqrt(252)
    
    if annual_vol == 0:
        return 0.0
    
    return (annual_return - risk_free_rate) / annual_vol


def sortino_ratio(returns: pd.Series, risk_free_rate: float = 0.02) -> float:
    """
    Sortino Ratio: Return per unit of DOWNSIDE risk.
    
    Like Sharpe, but only penalizes negative volatility.
    This is fairer because upside volatility is good!
    
    Higher Sortino = better at making money without big losses.
    
    Formula: (Return - Risk-Free Rate) / Downside Volatility
    
    Args:
        returns: Series of daily returns
        risk_free_rate: Annual risk-free rate (default 2%)
    
    Returns:
        Annualized Sortino ratio
    """
    # Annualized return
    annual_return = returns.mean() * 252
    
    # Downside volatility (only negative returns)
    negative_returns = returns[returns < 0]
    
    if len(negative_returns) == 0:
        return np.inf  # No negative returns = infinite Sortino
    
    downside_vol = negative_returns.std() * np.sqrt(252)
    
    if downside_vol == 0:
        return 0.0
    
    return (annual_return - risk_free_rate) / downside_vol


def calmar_ratio(equity_curve: pd.Series) -> float:
    """
    Calmar Ratio: Annual return divided by max drawdown.
    
    How much return did you get per unit of maximum pain?
    
    Higher Calmar = better return relative to worst-case loss.
    
    Args:
        equity_curve: Series of portfolio values
    
    Returns:
        Calmar ratio
    """
    annual = cagr(equity_curve) / 100  # Convert back to decimal
    max_dd, _ = max_drawdown(equity_curve)
    max_dd = abs(max_dd) / 100  # Convert to positive decimal
    
    if max_dd == 0:
        return 0.0
    
    return annual / max_dd


# =============================================================================
# TRADE ANALYSIS
# =============================================================================

def analyze_trades(trades: pd.DataFrame) -> Dict:
    """
    Analyze completed trades to calculate trade-level metrics.
    
    Args:
        trades: DataFrame with columns:
            - entry_date: When position was opened
            - exit_date: When position was closed
            - entry_price: Price at entry
            - exit_price: Price at exit
            - pnl_pct: Percentage profit/loss
    
    Returns:
        Dictionary of trade metrics
    """
    if len(trades) == 0:
        return {
            'total_trades': 0,
            'win_rate': 0.0,
            'avg_win': 0.0,
            'avg_loss': 0.0,
            'profit_factor': 0.0,
            'avg_trade': 0.0,
        }
    
    # Separate winners and losers
    winners = trades[trades['pnl_pct'] > 0]
    losers = trades[trades['pnl_pct'] <= 0]
    
    # Win rate
    win_rate = (len(winners) / len(trades)) * 100
    
    # Average win/loss
    avg_win = winners['pnl_pct'].mean() if len(winners) > 0 else 0.0
    avg_loss = losers['pnl_pct'].mean() if len(losers) > 0 else 0.0
    
    # Profit factor = gross profit / gross loss
    gross_profit = winners['pnl_pct'].sum() if len(winners) > 0 else 0
    gross_loss = abs(losers['pnl_pct'].sum()) if len(losers) > 0 else 0.001
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else 0.0
    
    # Average trade
    avg_trade = trades['pnl_pct'].mean()
    
    return {
        'total_trades': len(trades),
        'win_rate': win_rate,
        'avg_win': avg_win,
        'avg_loss': avg_loss,
        'profit_factor': profit_factor,
        'avg_trade': avg_trade,
    }


# =============================================================================
# MAIN METRICS CALCULATION
# =============================================================================

def calculate_metrics(
    equity_curve: pd.Series,
    trades: pd.DataFrame,
    benchmark_curve: Optional[pd.Series] = None,
) -> BacktestMetrics:
    """
    Calculate all performance metrics for a backtest.
    
    This is the main function that combines all metrics into
    a single BacktestMetrics object.
    
    Args:
        equity_curve: Series of portfolio values over time
        trades: DataFrame of completed trades
        benchmark_curve: Optional benchmark equity curve (e.g., SPY)
    
    Returns:
        BacktestMetrics object with all calculated metrics
    """
    # Calculate daily returns from equity curve
    returns = equity_curve.pct_change().dropna()
    
    # Return metrics
    total_ret = total_return(equity_curve)
    annual_ret = cagr(equity_curve)
    
    # Benchmark comparison
    if benchmark_curve is not None:
        bench_ret = total_return(benchmark_curve)
        excess_ret = total_ret - bench_ret
    else:
        bench_ret = 0.0
        excess_ret = 0.0
    
    # Risk metrics
    vol = volatility(returns)
    max_dd, dd_duration = max_drawdown(equity_curve)
    
    # Risk-adjusted metrics
    sharpe = sharpe_ratio(returns)
    sortino = sortino_ratio(returns)
    calmar = calmar_ratio(equity_curve)
    
    # Trade metrics
    trade_stats = analyze_trades(trades)
    
    return BacktestMetrics(
        # Returns
        total_return=total_ret,
        annual_return=annual_ret,
        benchmark_return=bench_ret,
        excess_return=excess_ret,
        
        # Risk
        volatility=vol,
        max_drawdown=max_dd,
        max_drawdown_duration=dd_duration,
        
        # Risk-adjusted
        sharpe_ratio=sharpe,
        sortino_ratio=sortino,
        calmar_ratio=calmar,
        
        # Trades
        total_trades=trade_stats['total_trades'],
        win_rate=trade_stats['win_rate'],
        avg_win=trade_stats['avg_win'],
        avg_loss=trade_stats['avg_loss'],
        profit_factor=trade_stats['profit_factor'],
        avg_trade=trade_stats['avg_trade'],
        
        # Time
        start_date=equity_curve.index[0].strftime('%Y-%m-%d'),
        end_date=equity_curve.index[-1].strftime('%Y-%m-%d'),
        trading_days=len(equity_curve),
    )


# =============================================================================
# QUICK METRICS (for comparing strategies)
# =============================================================================

def quick_summary(equity_curve: pd.Series) -> str:
    """
    Generate a one-line summary of key metrics.
    
    Useful for comparing multiple strategies quickly.
    """
    returns = equity_curve.pct_change().dropna()
    
    total_ret = total_return(equity_curve)
    max_dd, _ = max_drawdown(equity_curve)
    sharpe = sharpe_ratio(returns)
    
    return f"Return: {total_ret:+.1f}% | MaxDD: {max_dd:.1f}% | Sharpe: {sharpe:.2f}"


if __name__ == "__main__":
    print("=== Testing Metrics Module ===\n")
    
    # Create sample equity curve
    np.random.seed(42)
    dates = pd.date_range('2023-01-01', periods=252, freq='D')  # 1 year
    
    # Simulate portfolio that generally goes up with some drawdowns
    daily_returns = np.random.randn(252) * 0.015 + 0.0005  # ~1.5% daily vol, slight drift
    equity = 10000 * np.cumprod(1 + daily_returns)
    equity_curve = pd.Series(equity, index=dates)
    
    # Create sample trades
    trades = pd.DataFrame({
        'entry_date': pd.date_range('2023-01-15', periods=20, freq='15D'),
        'exit_date': pd.date_range('2023-01-20', periods=20, freq='15D'),
        'entry_price': np.random.uniform(95, 105, 20),
        'exit_price': np.random.uniform(90, 115, 20),
    })
    trades['pnl_pct'] = ((trades['exit_price'] - trades['entry_price']) / trades['entry_price']) * 100
    
    # Calculate metrics
    metrics = calculate_metrics(equity_curve, trades)
    print(metrics)
    
    # Quick summary
    print(f"\nQuick Summary: {quick_summary(equity_curve)}")
    
    print("\n✅ Metrics module ready!")
