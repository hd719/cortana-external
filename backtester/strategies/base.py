"""
Base Strategy Class

All trading strategies inherit from this base class.
It defines the interface that the backtester expects.

=============================================================================
WHAT IS A STRATEGY?
=============================================================================

A "strategy" is a set of rules that answers two questions:
  1. When do I BUY? (enter a trade)
  2. When do I SELL? (exit a trade)

That's it. A strategy is just rules written in code.

Example rules (Momentum Strategy):
  BUY when:  10-day average crosses ABOVE 50-day average
  SELL when: 10-day average crosses BELOW 50-day average

The strategy is the "brain" that makes decisions.
The backtester is the "body" that executes those decisions.
You swap in different strategies to test different ideas — same backtester, 
different rules.

=============================================================================

Think of this file as a template — every strategy must implement
certain methods so the backtester knows how to use it.
"""

from abc import ABC, abstractmethod
import pandas as pd
from typing import Optional


class Strategy(ABC):
    """
    Abstract base class for trading strategies.
    
    A strategy is a set of rules that generate trading signals:
    - When to BUY (enter a position)
    - When to SELL (exit a position)
    - How much to buy (position sizing)
    
    To create a new strategy:
    1. Create a class that inherits from Strategy
    2. Implement the generate_signals() method
    3. Optionally override other methods
    
    Example:
        class MyStrategy(Strategy):
            def generate_signals(self, data):
                # Your trading logic here
                signals = pd.Series(0, index=data.index)
                # 1 = buy, -1 = sell, 0 = hold
                return signals
    """
    
    def __init__(self, name: str = "Unnamed Strategy"):
        """
        Initialize the strategy.
        
        Args:
            name: Human-readable name for the strategy
        """
        self.name = name
        self.parameters = {}  # Store strategy parameters
    
    @abstractmethod
    def generate_signals(self, data: pd.DataFrame) -> pd.Series:
        """
        Generate trading signals based on price data.
        
        THIS IS THE MAIN METHOD YOU MUST IMPLEMENT.
        
        Args:
            data: DataFrame with columns: open, high, low, close, volume
                  Index is datetime
        
        Returns:
            Series of signals aligned with the data index:
            - 1 = BUY signal (enter long position)
            - -1 = SELL signal (exit position)
            - 0 = HOLD (no action)
        
        Example implementation:
            def generate_signals(self, data):
                signals = pd.Series(0, index=data.index)
                
                # Buy when price > 50-day moving average
                sma_50 = data['close'].rolling(50).mean()
                signals[data['close'] > sma_50] = 1
                
                # Sell when price < 50-day moving average  
                signals[data['close'] < sma_50] = -1
                
                return signals
        """
        pass
    
    def position_size(self, cash: float, price: float) -> int:
        """
        Calculate how many shares to buy.
        
        Default implementation: use all available cash.
        Override this for more sophisticated position sizing.
        
        Args:
            cash: Available cash
            price: Current stock price
        
        Returns:
            Number of shares to buy
        """
        # Simple: buy as many whole shares as we can afford
        return int(cash / price)
    
    def should_use_stop_loss(self) -> bool:
        """
        Whether this strategy uses stop-loss orders.
        
        Override to enable stop-loss functionality.
        """
        return False
    
    def stop_loss_pct(self) -> float:
        """
        Stop-loss percentage (if enabled).
        
        Returns:
            Percentage as decimal (e.g., 0.08 for 8% stop-loss)
        """
        return 0.08  # Default 8%
    
    def __repr__(self) -> str:
        """String representation of the strategy."""
        params_str = ", ".join(f"{k}={v}" for k, v in self.parameters.items())
        return f"{self.name}({params_str})"
