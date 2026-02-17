"""
Simple RSI Strategy

THE SIMPLEST STRATEGY TO UNDERSTAND.

=============================================================================
WHAT ARE THE RULES?
=============================================================================

  BUY when:  RSI drops below 30
  SELL when: RSI rises above 70

That's it. Two numbers. Nothing else.

=============================================================================
WHAT IS RSI?
=============================================================================

RSI (Relative Strength Index) is a number from 0 to 100 that measures
if a stock has been going up or down recently.

  - RSI below 30 = Stock has been falling a lot lately ("oversold")
                   It might be a good time to buy because it could bounce back
                   
  - RSI above 70 = Stock has been rising a lot lately ("overbought")
                   It might be a good time to sell because it could fall back

Think of it like a rubber band:
  - Stretched too far down (RSI < 30) → might snap back up → BUY
  - Stretched too far up (RSI > 70) → might snap back down → SELL

=============================================================================
"""

import pandas as pd
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from strategies.base import Strategy
from indicators import rsi


class SimpleRSIStrategy(Strategy):
    """
    The simplest possible strategy: Buy low RSI, sell high RSI.
    
    Rules:
      BUY when:  RSI < 30 (oversold)
      SELL when: RSI > 70 (overbought)
    
    Parameters:
      - buy_threshold: RSI level to buy at (default 30)
      - sell_threshold: RSI level to sell at (default 70)
      - rsi_period: Days to calculate RSI (default 14)
    """
    
    def __init__(
        self,
        buy_threshold: int = 30,
        sell_threshold: int = 70,
        rsi_period: int = 14
    ):
        """
        Set up the strategy.
        
        Args:
            buy_threshold: Buy when RSI drops below this (default 30)
            sell_threshold: Sell when RSI rises above this (default 70)
            rsi_period: Number of days for RSI calculation (default 14)
        """
        super().__init__(name="Simple RSI")
        
        # Store the settings
        self.buy_threshold = buy_threshold
        self.sell_threshold = sell_threshold
        self.rsi_period = rsi_period
        
        # Record parameters for display
        self.parameters = {
            "buy_below": buy_threshold,
            "sell_above": sell_threshold,
            "rsi_period": rsi_period
        }
    
    def generate_signals(self, data: pd.DataFrame) -> pd.Series:
        """
        Generate buy/sell signals.
        
        This is where the magic happens:
          1. Calculate RSI for each day
          2. If RSI < 30 → return BUY signal (1)
          3. If RSI > 70 → return SELL signal (-1)
          4. Otherwise → return HOLD signal (0)
        
        Args:
            data: DataFrame with price data (needs 'close' column)
        
        Returns:
            Series of signals: 1 (buy), -1 (sell), 0 (hold)
        """
        # Step 1: Calculate RSI
        # RSI looks at recent price changes and gives us a number 0-100
        rsi_values = rsi(data['close'], self.rsi_period)
        
        # Step 2: Start with all HOLD signals (0)
        signals = pd.Series(0, index=data.index)
        
        # Step 3: Where RSI < 30, signal BUY (1)
        # Stock is oversold, might bounce back up
        signals[rsi_values < self.buy_threshold] = 1
        
        # Step 4: Where RSI > 70, signal SELL (-1)
        # Stock is overbought, might fall back down
        signals[rsi_values > self.sell_threshold] = -1
        
        return signals


if __name__ == "__main__":
    # Test the strategy
    print("=== Testing Simple RSI Strategy ===\n")
    
    import numpy as np
    
    # Create fake price data that goes up and down
    np.random.seed(42)
    dates = pd.date_range('2024-01-01', periods=100, freq='D')
    
    # Simulate a stock that swings up and down
    prices = 100 + 20 * np.sin(np.linspace(0, 4 * np.pi, 100)) + np.random.randn(100) * 2
    
    data = pd.DataFrame({
        'open': prices,
        'high': prices * 1.01,
        'low': prices * 0.99,
        'close': prices,
        'volume': np.random.randint(1000000, 5000000, 100)
    }, index=dates)
    
    # Create and test the strategy
    strategy = SimpleRSIStrategy(buy_threshold=30, sell_threshold=70)
    print(f"Strategy: {strategy}")
    print(f"Rules: BUY when RSI < {strategy.buy_threshold}, SELL when RSI > {strategy.sell_threshold}")
    
    # Generate signals
    signals = strategy.generate_signals(data)
    
    # Count signals
    buy_count = (signals == 1).sum()
    sell_count = (signals == -1).sum()
    hold_count = (signals == 0).sum()
    
    print(f"\nResults over {len(data)} days:")
    print(f"  BUY signals:  {buy_count}")
    print(f"  SELL signals: {sell_count}")
    print(f"  HOLD days:    {hold_count}")
    
    print("\n✅ Simple RSI strategy working!")
