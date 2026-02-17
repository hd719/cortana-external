"""
Momentum Strategy Implementation

This is a concrete trading strategy that inherits from the base Strategy class.
It implements a simple but effective momentum-based approach.

=============================================================================
WHAT IS MOMENTUM TRADING?
=============================================================================

Momentum = the idea that stocks that have been going UP tend to keep going up,
and stocks that have been going DOWN tend to keep going down.

It's like Newton's first law for stocks:
"A stock in motion tends to stay in motion."

This strategy buys when a stock shows strong upward momentum (it's been rising)
and sells when that momentum fades or reverses.

=============================================================================
OUR MOMENTUM STRATEGY
=============================================================================

BUY when ALL of these are true:
  1. Fast moving average crosses ABOVE slow moving average (trend turning up)
  2. RSI is between 40-70 (not overbought, but has momentum)
  3. Price is above the 50-day moving average (overall uptrend)

SELL when ANY of these are true:
  1. Fast moving average crosses BELOW slow moving average (trend turning down)
  2. RSI > 80 (overbought — take profits)
  3. Stop-loss hit (8% trailing stop)

Why these rules?
  - MA crossover confirms trend change (not just noise)
  - RSI filter avoids buying tops or chasing overbought stocks
  - 50-day SMA ensures we're trading with the larger trend
  - Trailing stop limits losses on bad trades

=============================================================================
"""

import pandas as pd
import numpy as np
from typing import Optional

# Import from parent directory
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from strategies.base import Strategy
from indicators import sma, ema, rsi, crossover, crossunder


class MomentumStrategy(Strategy):
    """
    A momentum-based trading strategy using moving average crossovers and RSI.
    
    Parameters:
        fast_period: Period for the fast moving average (default: 10)
        slow_period: Period for the slow moving average (default: 30)
        trend_period: Period for trend filter SMA (default: 50)
        rsi_period: Period for RSI calculation (default: 14)
        rsi_oversold: RSI level considered oversold (default: 40)
        rsi_overbought: RSI level considered overbought (default: 70)
        rsi_exit: RSI level to trigger exit (default: 80)
        use_ema: Use EMA instead of SMA for signals (default: True)
    
    The strategy generates:
        1 = BUY signal
       -1 = SELL signal  
        0 = HOLD (no action)
    """
    
    def __init__(
        self,
        fast_period: int = 10,
        slow_period: int = 30,
        trend_period: int = 50,
        rsi_period: int = 14,
        rsi_oversold: float = 40,
        rsi_overbought: float = 70,
        rsi_exit: float = 80,
        use_ema: bool = True,
        stop_loss_pct: float = 0.08,  # 8% trailing stop
    ):
        """
        Initialize the momentum strategy with customizable parameters.
        
        These parameters can be optimized later using the genetic optimizer.
        """
        super().__init__(name="Momentum Strategy")
        
        # Store all parameters (useful for logging and optimization)
        self.parameters = {
            'fast_period': fast_period,
            'slow_period': slow_period,
            'trend_period': trend_period,
            'rsi_period': rsi_period,
            'rsi_oversold': rsi_oversold,
            'rsi_overbought': rsi_overbought,
            'rsi_exit': rsi_exit,
            'use_ema': use_ema,
            'stop_loss_pct': stop_loss_pct,
        }
        
        # Make parameters accessible as instance attributes
        self.fast_period = fast_period
        self.slow_period = slow_period
        self.trend_period = trend_period
        self.rsi_period = rsi_period
        self.rsi_oversold = rsi_oversold
        self.rsi_overbought = rsi_overbought
        self.rsi_exit = rsi_exit
        self.use_ema = use_ema
        self._stop_loss_pct = stop_loss_pct
    
    def generate_signals(self, data: pd.DataFrame) -> pd.Series:
        """
        Generate buy/sell signals based on momentum rules.
        
        This is where the magic happens — we apply our trading rules
        to the price data and output signals.
        
        Args:
            data: DataFrame with columns: open, high, low, close, volume
                  Index should be datetime
        
        Returns:
            Series of signals: 1 (buy), -1 (sell), 0 (hold)
        """
        # Get the closing prices (most common price used for signals)
        close = data['close']
        
        # =====================================================================
        # STEP 1: Calculate the indicators we need
        # =====================================================================
        
        # Fast and slow moving averages (for crossover signals)
        if self.use_ema:
            # EMA reacts faster to price changes
            fast_ma = ema(close, self.fast_period)
            slow_ma = ema(close, self.slow_period)
        else:
            # SMA is smoother, less reactive
            fast_ma = sma(close, self.fast_period)
            slow_ma = sma(close, self.slow_period)
        
        # Trend filter: only trade in direction of larger trend
        trend_ma = sma(close, self.trend_period)
        
        # RSI: momentum oscillator
        rsi_values = rsi(close, self.rsi_period)
        
        # =====================================================================
        # STEP 2: Define entry conditions (when to BUY)
        # =====================================================================
        
        # Condition 1: Fast MA crosses above slow MA (bullish crossover)
        # This indicates the short-term trend is turning up
        ma_crossover = crossover(fast_ma, slow_ma)
        
        # Condition 2: RSI is in the "goldilocks zone" — not overbought, not oversold
        # We want momentum, but not chasing a stock that's already run too far
        rsi_ok = (rsi_values >= self.rsi_oversold) & (rsi_values <= self.rsi_overbought)
        
        # Condition 3: Price is above the trend MA (we're in an uptrend)
        # This keeps us trading with the larger trend, not against it
        above_trend = close > trend_ma
        
        # BUY signal: ALL conditions must be true
        buy_signal = ma_crossover & rsi_ok & above_trend
        
        # =====================================================================
        # STEP 3: Define exit conditions (when to SELL)
        # =====================================================================
        
        # Condition 1: Fast MA crosses below slow MA (bearish crossover)
        # The short-term trend is turning down — time to exit
        ma_crossunder = crossunder(fast_ma, slow_ma)
        
        # Condition 2: RSI is extremely overbought
        # Take profits — the stock has run too far too fast
        rsi_overbought_exit = rsi_values > self.rsi_exit
        
        # SELL signal: ANY exit condition triggers a sell
        sell_signal = ma_crossunder | rsi_overbought_exit
        
        # =====================================================================
        # STEP 4: Combine into signal series
        # =====================================================================
        
        # Start with zeros (hold)
        signals = pd.Series(0, index=data.index)
        
        # Set buy signals
        signals[buy_signal] = 1
        
        # Set sell signals (these override buy if both happen on same day)
        signals[sell_signal] = -1
        
        return signals
    
    def should_use_stop_loss(self) -> bool:
        """Enable stop-loss for this strategy."""
        return True
    
    def stop_loss_pct(self) -> float:
        """Return the stop-loss percentage."""
        return self._stop_loss_pct
    
    def describe(self) -> str:
        """
        Return a human-readable description of the strategy.
        
        Useful for logging and understanding what the strategy does.
        """
        ma_type = "EMA" if self.use_ema else "SMA"
        return f"""
╔══════════════════════════════════════════════════════════════╗
║                    MOMENTUM STRATEGY                         ║
╠══════════════════════════════════════════════════════════════╣
║ BUY when:                                                    ║
║   • {self.fast_period}-day {ma_type} crosses ABOVE {self.slow_period}-day {ma_type}              ║
║   • RSI({self.rsi_period}) is between {self.rsi_oversold} and {self.rsi_overbought}                       ║
║   • Price is above {self.trend_period}-day SMA (uptrend)                      ║
║                                                              ║
║ SELL when:                                                   ║
║   • {self.fast_period}-day {ma_type} crosses BELOW {self.slow_period}-day {ma_type}              ║
║   • RSI({self.rsi_period}) > {self.rsi_exit} (overbought exit)                       ║
║   • Stop-loss: {self._stop_loss_pct * 100:.0f}% trailing stop                          ║
╚══════════════════════════════════════════════════════════════╝
"""


# =============================================================================
# VARIANT: Aggressive Momentum (shorter periods, higher risk)
# =============================================================================

class AggressiveMomentum(MomentumStrategy):
    """
    A more aggressive variant of the momentum strategy.
    
    Uses shorter periods = faster signals = more trades = more risk.
    Good for shorter-term trading or volatile stocks.
    """
    
    def __init__(self):
        super().__init__(
            fast_period=5,      # Very fast
            slow_period=15,     # Still responsive
            trend_period=20,    # Shorter trend filter
            rsi_period=10,      # Faster RSI
            rsi_oversold=35,
            rsi_overbought=65,
            rsi_exit=75,
            use_ema=True,
            stop_loss_pct=0.06,  # Tighter stop (6%)
        )
        self.name = "Aggressive Momentum"


# =============================================================================
# VARIANT: Conservative Momentum (longer periods, lower risk)
# =============================================================================

class ConservativeMomentum(MomentumStrategy):
    """
    A more conservative variant of the momentum strategy.
    
    Uses longer periods = slower signals = fewer trades = lower risk.
    Good for swing trading or less volatile stocks.
    """
    
    def __init__(self):
        super().__init__(
            fast_period=20,     # Slower
            slow_period=50,     # Much slower
            trend_period=100,   # Long-term trend
            rsi_period=14,      # Standard RSI
            rsi_oversold=45,    # Narrower range
            rsi_overbought=65,
            rsi_exit=75,
            use_ema=False,      # Use SMA for smoother signals
            stop_loss_pct=0.10,  # Wider stop (10%)
        )
        self.name = "Conservative Momentum"


# =============================================================================
# TEST THE STRATEGY
# =============================================================================

if __name__ == "__main__":
    print("=== Testing Momentum Strategy ===\n")
    
    # Create sample data
    np.random.seed(42)
    dates = pd.date_range('2024-01-01', periods=200, freq='D')
    
    # Generate realistic-ish price data (random walk with drift)
    returns = np.random.randn(200) * 0.02 + 0.0005  # 2% daily vol, slight upward drift
    prices = 100 * np.cumprod(1 + returns)
    
    data = pd.DataFrame({
        'open': prices * (1 + np.random.randn(200) * 0.005),
        'high': prices * (1 + np.abs(np.random.randn(200)) * 0.01),
        'low': prices * (1 - np.abs(np.random.randn(200)) * 0.01),
        'close': prices,
        'volume': np.random.randint(1000000, 5000000, 200),
    }, index=dates)
    
    # Create strategy and generate signals
    strategy = MomentumStrategy()
    signals = strategy.generate_signals(data)
    
    # Print strategy description
    print(strategy.describe())
    
    # Count signals
    buy_signals = (signals == 1).sum()
    sell_signals = (signals == -1).sum()
    
    print(f"\nSignal Summary (200 days of data):")
    print(f"  BUY signals:  {buy_signals}")
    print(f"  SELL signals: {sell_signals}")
    print(f"  HOLD days:    {200 - buy_signals - sell_signals}")
    
    # Show some signal dates
    print(f"\nFirst few BUY signals:")
    buy_dates = signals[signals == 1].head(3)
    for date, _ in buy_dates.items():
        print(f"  {date.strftime('%Y-%m-%d')}: BUY at ${data.loc[date, 'close']:.2f}")
    
    print("\n✅ Momentum Strategy ready for backtesting!")
