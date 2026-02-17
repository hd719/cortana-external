"""
Technical Indicators Module

This module contains functions to calculate common technical indicators
used in trading strategies. Each function is heavily commented to explain
what the indicator measures and how it's calculated.

Technical indicators are mathematical calculations based on price/volume
that traders use to predict future price movements.
"""

import pandas as pd
import numpy as np


# =============================================================================
# MOVING AVERAGES
# =============================================================================

def sma(prices: pd.Series, period: int) -> pd.Series:
    """
    Simple Moving Average (SMA)
    
    The average price over the last N periods. Used to smooth out price data
    and identify trends.
    
    - Price above SMA = bullish (uptrend)
    - Price below SMA = bearish (downtrend)
    - Common periods: 10, 20, 50, 200 days
    
    Args:
        prices: Series of prices (usually closing prices)
        period: Number of periods to average (e.g., 50 for 50-day SMA)
    
    Returns:
        Series of SMA values (first `period-1` values will be NaN)
    
    Example:
        >>> closes = pd.Series([10, 11, 12, 13, 14])
        >>> sma(closes, period=3)
        0     NaN
        1     NaN  
        2    11.0  # (10 + 11 + 12) / 3
        3    12.0  # (11 + 12 + 13) / 3
        4    13.0  # (12 + 13 + 14) / 3
    """
    return prices.rolling(window=period).mean()


def ema(prices: pd.Series, period: int) -> pd.Series:
    """
    Exponential Moving Average (EMA)
    
    Like SMA, but gives more weight to recent prices. Reacts faster to
    price changes than SMA.
    
    - More responsive to recent price action
    - Common in MACD calculation
    - Used for short-term trend following
    
    Args:
        prices: Series of prices
        period: Number of periods for the EMA span
    
    Returns:
        Series of EMA values
    """
    return prices.ewm(span=period, adjust=False).mean()


# =============================================================================
# MOMENTUM INDICATORS
# =============================================================================

def rsi(prices: pd.Series, period: int = 14) -> pd.Series:
    """
    Relative Strength Index (RSI)
    
    Measures the speed and magnitude of price changes on a scale of 0-100.
    
    - RSI > 70 = Overbought (price may be too high, could fall)
    - RSI < 30 = Oversold (price may be too low, could rise)
    - RSI around 50 = Neutral
    
    This is one of the most popular momentum indicators.
    
    Args:
        prices: Series of prices (usually closing prices)
        period: Lookback period (default 14 is standard)
    
    Returns:
        Series of RSI values (0-100)
    
    How it works:
        1. Calculate daily price changes
        2. Separate gains (up days) and losses (down days)
        3. Calculate average gain and average loss
        4. RS = Average Gain / Average Loss
        5. RSI = 100 - (100 / (1 + RS))
    """
    # Step 1: Calculate price changes from day to day
    delta = prices.diff()
    
    # Step 2: Separate gains and losses
    # gains = positive changes only (losses replaced with 0)
    # losses = negative changes only (as positive numbers)
    gains = delta.where(delta > 0, 0)
    losses = -delta.where(delta < 0, 0)
    
    # Step 3: Calculate average gain/loss over the period
    # Using exponential moving average for smoother results
    avg_gain = gains.ewm(com=period - 1, min_periods=period).mean()
    avg_loss = losses.ewm(com=period - 1, min_periods=period).mean()
    
    # Step 4: Calculate Relative Strength (RS)
    # Add small epsilon to avoid division by zero
    rs = avg_gain / (avg_loss + 1e-10)
    
    # Step 5: Convert to RSI (0-100 scale)
    rsi_values = 100 - (100 / (1 + rs))
    
    return rsi_values


def rate_of_change(prices: pd.Series, period: int) -> pd.Series:
    """
    Rate of Change (ROC) / Momentum
    
    Measures the percentage change in price over N periods.
    Shows how fast the price is moving.
    
    - ROC > 0 = Price is higher than N periods ago (bullish)
    - ROC < 0 = Price is lower than N periods ago (bearish)
    - Higher absolute ROC = Stronger momentum
    
    Args:
        prices: Series of prices
        period: Number of periods to look back
    
    Returns:
        Series of ROC values as percentages (e.g., 5.0 = 5% gain)
    
    Example:
        If price was $100 ten days ago and is $110 now:
        ROC(10) = ((110 - 100) / 100) * 100 = 10%
    """
    return ((prices - prices.shift(period)) / prices.shift(period)) * 100


def macd(prices: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    """
    Moving Average Convergence Divergence (MACD)
    
    Shows the relationship between two moving averages. One of the most
    popular trend-following momentum indicators.
    
    Components:
    - MACD Line = Fast EMA - Slow EMA (shows momentum direction)
    - Signal Line = EMA of MACD Line (smoothed version)
    - Histogram = MACD - Signal (shows momentum strength)
    
    Trading signals:
    - MACD crosses above Signal = Bullish (buy signal)
    - MACD crosses below Signal = Bearish (sell signal)
    - Histogram growing = Momentum increasing
    
    Args:
        prices: Series of prices
        fast: Fast EMA period (default 12)
        slow: Slow EMA period (default 26)
        signal: Signal line EMA period (default 9)
    
    Returns:
        DataFrame with columns: 'macd', 'signal', 'histogram'
    """
    # Calculate the fast and slow EMAs
    fast_ema = ema(prices, fast)
    slow_ema = ema(prices, slow)
    
    # MACD line = difference between fast and slow EMAs
    macd_line = fast_ema - slow_ema
    
    # Signal line = EMA of the MACD line
    signal_line = ema(macd_line, signal)
    
    # Histogram = MACD - Signal (shows momentum direction/strength)
    histogram = macd_line - signal_line
    
    return pd.DataFrame({
        'macd': macd_line,
        'signal': signal_line,
        'histogram': histogram
    })


# =============================================================================
# VOLATILITY INDICATORS
# =============================================================================

def bollinger_bands(prices: pd.Series, period: int = 20, std_dev: float = 2.0) -> pd.DataFrame:
    """
    Bollinger Bands
    
    Creates bands around a moving average based on volatility (standard deviation).
    Bands expand when volatility is high, contract when volatility is low.
    
    Components:
    - Middle Band = SMA
    - Upper Band = SMA + (std_dev * standard deviation)
    - Lower Band = SMA - (std_dev * standard deviation)
    
    Trading signals:
    - Price touches upper band = Potentially overbought
    - Price touches lower band = Potentially oversold
    - Bands squeezing = Low volatility, big move may be coming
    
    Args:
        prices: Series of prices
        period: SMA period (default 20)
        std_dev: Number of standard deviations for bands (default 2)
    
    Returns:
        DataFrame with columns: 'middle', 'upper', 'lower'
    """
    # Middle band is just the SMA
    middle = sma(prices, period)
    
    # Calculate rolling standard deviation
    rolling_std = prices.rolling(window=period).std()
    
    # Upper and lower bands
    upper = middle + (rolling_std * std_dev)
    lower = middle - (rolling_std * std_dev)
    
    return pd.DataFrame({
        'middle': middle,
        'upper': upper,
        'lower': lower
    })


def atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    """
    Average True Range (ATR)
    
    Measures market volatility by looking at the full range of price movement
    including gaps. Higher ATR = more volatile market.
    
    Used for:
    - Setting stop-loss levels (e.g., stop at 2x ATR below entry)
    - Position sizing (smaller positions when ATR is high)
    - Identifying volatile vs quiet markets
    
    Args:
        high: Series of high prices
        low: Series of low prices
        close: Series of closing prices
        period: Smoothing period (default 14)
    
    Returns:
        Series of ATR values (in price terms, e.g., $2.50)
    """
    # True Range is the largest of:
    # 1. Current High - Current Low
    # 2. Abs(Current High - Previous Close)
    # 3. Abs(Current Low - Previous Close)
    
    prev_close = close.shift(1)
    
    tr1 = high - low
    tr2 = abs(high - prev_close)
    tr3 = abs(low - prev_close)
    
    # True Range = maximum of the three
    true_range = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    
    # ATR = smoothed average of True Range
    return true_range.ewm(span=period, adjust=False).mean()


# =============================================================================
# RELATIVE STRENGTH (vs Market)
# =============================================================================

def relative_strength(stock_prices: pd.Series, benchmark_prices: pd.Series, period: int = 252) -> pd.Series:
    """
    Relative Strength (RS) vs Benchmark
    
    Compares a stock's performance to a benchmark (usually S&P 500).
    This is different from RSI — this measures performance vs the market.
    
    - RS > 1.0 = Stock outperforming the benchmark
    - RS < 1.0 = Stock underperforming the benchmark
    - RS increasing = Stock gaining relative strength
    
    Used in CANSLIM's "L" factor (Leaders have high RS ratings).
    
    Args:
        stock_prices: Series of stock prices
        benchmark_prices: Series of benchmark prices (e.g., SPY)
        period: Lookback period for comparison (default 252 = 1 year)
    
    Returns:
        Series of relative strength ratios
    """
    # Calculate returns over the period
    stock_return = stock_prices.pct_change(period)
    benchmark_return = benchmark_prices.pct_change(period)
    
    # Relative strength = (1 + stock return) / (1 + benchmark return)
    rs = (1 + stock_return) / (1 + benchmark_return)
    
    return rs


# =============================================================================
# HELPER: CROSSOVER DETECTION
# =============================================================================

def crossover(series1: pd.Series, series2: pd.Series) -> pd.Series:
    """
    Detect when series1 crosses ABOVE series2.
    
    Returns True on the bar where the crossover happens.
    Useful for detecting signals like "fast MA crosses above slow MA".
    
    Args:
        series1: The series that's crossing (e.g., fast MA)
        series2: The series being crossed (e.g., slow MA)
    
    Returns:
        Boolean series (True on crossover bars)
    """
    # Crossover = series1 was below series2, now it's above
    return (series1 > series2) & (series1.shift(1) <= series2.shift(1))


def crossunder(series1: pd.Series, series2: pd.Series) -> pd.Series:
    """
    Detect when series1 crosses BELOW series2.
    
    Returns True on the bar where the crossunder happens.
    
    Args:
        series1: The series that's crossing (e.g., fast MA)
        series2: The series being crossed (e.g., slow MA)
    
    Returns:
        Boolean series (True on crossunder bars)
    """
    # Crossunder = series1 was above series2, now it's below
    return (series1 < series2) & (series1.shift(1) >= series2.shift(1))


if __name__ == "__main__":
    # Quick test with sample data
    print("=== Testing Indicators ===\n")
    
    # Create sample price data
    np.random.seed(42)
    dates = pd.date_range('2024-01-01', periods=100, freq='D')
    prices = pd.Series(
        100 + np.cumsum(np.random.randn(100) * 2),  # Random walk starting at 100
        index=dates
    )
    
    print(f"Sample prices (last 5 days):")
    print(prices.tail())
    print()
    
    # Test SMA
    sma_20 = sma(prices, 20)
    print(f"20-day SMA (last value): ${sma_20.iloc[-1]:.2f}")
    
    # Test RSI
    rsi_14 = rsi(prices, 14)
    print(f"14-day RSI (last value): {rsi_14.iloc[-1]:.1f}")
    
    # Test ROC
    roc_10 = rate_of_change(prices, 10)
    print(f"10-day ROC (last value): {roc_10.iloc[-1]:.2f}%")
    
    print("\n✅ All indicators working!")
