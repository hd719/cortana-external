"""
CANSLIM Strategy Implementation

The full CANSLIM strategy using both fundamental and technical factors.

=============================================================================
WHAT IS CANSLIM?
=============================================================================

CANSLIM is a growth stock investing strategy developed by William O'Neil,
founder of Investor's Business Daily. It's a systematic, rules-based approach
that combines fundamental analysis with technical analysis.

The name is an acronym for 7 factors:

  C - Current Earnings      (quarterly EPS growth > 25%)
  A - Annual Earnings       (5-year EPS growth > 25%)
  N - New Highs             (stock at or near 52-week high)
  S - Supply & Demand       (smaller float, volume on up days)
  L - Leader                (relative strength vs market > 80)
  I - Institutional         (increasing institutional ownership)
  M - Market Direction      (only buy in confirmed uptrends)

=============================================================================
SCORING
=============================================================================

Each factor gets 0-2 points:
  - C: 0-2 based on quarterly EPS growth
  - A: 0-2 based on annual EPS growth
  - N: 0-2 based on proximity to 52-week high
  - S: 0-2 based on float size
  - L: 0-2 based on relative strength rating
  - I: 0-2 based on institutional ownership

Total: 0-12 points

The M factor (Market) acts as a GATE — if the market is in correction,
we don't buy anything regardless of individual stock scores.

=============================================================================
"""

import pandas as pd
import numpy as np
from typing import Optional, Dict
from datetime import datetime, timedelta

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from strategies.base import Strategy
from indicators import sma, rsi, relative_strength, rate_of_change
from data.fundamentals import FundamentalsFetcher


class CANSLIMStrategy(Strategy):
    """
    Full CANSLIM implementation combining fundamentals + technicals.
    
    Parameters:
        min_score: Minimum total score to generate buy signal (default: 8)
        rs_period: Period for relative strength calculation (default: 252)
        stop_loss_pct: Trailing stop loss percentage (default: 0.08)
    
    Note: This strategy requires both price data AND fundamental data.
    The fundamentals are fetched separately using the FundamentalsFetcher.
    """
    
    def __init__(
        self,
        min_score: int = 8,
        rs_period: int = 252,
        stop_loss_pct: float = 0.08,
    ):
        super().__init__(name="CANSLIM Strategy")
        
        self.parameters = {
            'min_score': min_score,
            'rs_period': rs_period,
            'stop_loss_pct': stop_loss_pct,
        }
        
        self.min_score = min_score
        self.rs_period = rs_period
        self._stop_loss_pct = stop_loss_pct
        
        # Fundamentals fetcher (for C, A, I, S factors)
        self.fundamentals_fetcher = FundamentalsFetcher()
        
        # Store the symbol and fundamentals (set before running)
        self.symbol = None
        self.fundamentals = None
        self.fundamental_scores = None
    
    def set_symbol(self, symbol: str):
        """
        Set the symbol and fetch its fundamentals.
        
        Call this before running the backtest.
        """
        self.symbol = symbol
        self.fundamentals = self.fundamentals_fetcher.get_fundamentals(symbol)
        self.fundamental_scores = self.fundamentals_fetcher.score_canslim_fundamentals(
            self.fundamentals
        )
    
    def generate_signals(
        self,
        data: pd.DataFrame,
        benchmark: pd.DataFrame = None,
    ) -> pd.Series:
        """
        Generate CANSLIM buy/sell signals.
        
        Args:
            data: Price data for the stock (OHLCV)
            benchmark: Price data for benchmark (e.g., SPY) for RS calculation
        
        Returns:
            Series of signals: 1 (buy), -1 (sell), 0 (hold)
        """
        close = data['close']
        volume = data['volume']
        
        # Initialize signals
        signals = pd.Series(0, index=data.index)
        
        # =====================================================================
        # TECHNICAL FACTORS (calculated daily)
        # =====================================================================
        
        # N — New High (proximity to 52-week high)
        rolling_high = close.rolling(252).max()
        pct_from_high = (close / rolling_high)
        n_score = pd.Series(0, index=data.index)
        n_score[pct_from_high >= 0.95] = 2  # Within 5% of high
        n_score[(pct_from_high >= 0.90) & (pct_from_high < 0.95)] = 1
        
        # L — Leader (Relative Strength)
        if benchmark is not None:
            rs = relative_strength(close, benchmark['close'], self.rs_period)
            l_score = pd.Series(0, index=data.index)
            l_score[rs >= 1.2] = 2   # Outperforming by 20%+
            l_score[(rs >= 1.1) & (rs < 1.2)] = 1  # Outperforming by 10-20%
        else:
            # Without benchmark, use price momentum as proxy
            momentum = rate_of_change(close, 252)
            l_score = pd.Series(0, index=data.index)
            l_score[momentum >= 30] = 2  # Up 30%+ in a year
            l_score[(momentum >= 15) & (momentum < 30)] = 1
        
        # S — Supply/Demand (volume patterns)
        # Up days should have higher volume than down days
        daily_return = close.pct_change()
        up_volume = volume.where(daily_return > 0, 0)
        down_volume = volume.where(daily_return < 0, 0)
        
        # 20-day average up volume vs down volume
        avg_up_vol = up_volume.rolling(20).mean()
        avg_down_vol = down_volume.rolling(20).mean()
        vol_ratio = avg_up_vol / (avg_down_vol + 1)  # +1 to avoid division by zero
        
        s_volume_score = pd.Series(0, index=data.index)
        s_volume_score[vol_ratio >= 1.5] = 1  # Strong accumulation
        s_volume_score[vol_ratio >= 2.0] = 2  # Very strong accumulation
        
        # M — Market Direction (simple trend filter)
        # Market is "healthy" if above 50-day and 200-day SMA
        sma_50 = sma(close, 50)
        sma_200 = sma(close, 200)
        market_healthy = (close > sma_50) & (close > sma_200)
        
        # =====================================================================
        # COMBINE SCORES
        # =====================================================================
        
        # Fundamental scores (constant for all dates in this simple version)
        # In a more sophisticated version, we'd use point-in-time fundamentals
        c_score = self.fundamental_scores.get('C', 0) if self.fundamental_scores else 0
        a_score = self.fundamental_scores.get('A', 0) if self.fundamental_scores else 0
        i_score = self.fundamental_scores.get('I', 0) if self.fundamental_scores else 0
        s_fund_score = self.fundamental_scores.get('S', 0) if self.fundamental_scores else 0
        
        # Total S score = fundamental (float size) + technical (volume)
        # Cap at 2 points max
        s_total = np.minimum(s_fund_score + s_volume_score, 2)
        
        # Total score for each day
        total_score = c_score + a_score + n_score + s_total + l_score + i_score
        
        # =====================================================================
        # ENTRY CONDITIONS
        # =====================================================================
        
        # Breakout detection: price crossing above recent resistance
        resistance = close.rolling(20).max().shift(1)
        breakout = close > resistance
        
        # Volume confirmation: volume should be higher than average
        avg_volume = volume.rolling(50).mean()
        volume_surge = volume > (avg_volume * 1.5)
        
        # BUY when:
        # 1. Total score >= minimum
        # 2. Market is healthy (M factor)
        # 3. Breaking out on high volume
        buy_condition = (
            (total_score >= self.min_score) &
            market_healthy &
            breakout &
            volume_surge
        )
        
        # =====================================================================
        # EXIT CONDITIONS
        # =====================================================================
        
        # Sell when:
        # 1. Market turns unhealthy
        # 2. Relative strength collapses
        # 3. Or stop-loss (handled by backtester)
        
        market_unhealthy = close < sma_50
        rs_collapse = l_score < 1
        
        sell_condition = market_unhealthy | rs_collapse
        
        # =====================================================================
        # GENERATE SIGNALS
        # =====================================================================
        
        signals[buy_condition] = 1
        signals[sell_condition] = -1
        
        # Store scores for analysis
        self._scores = pd.DataFrame({
            'C': c_score,
            'A': a_score,
            'N': n_score,
            'S': s_total,
            'L': l_score,
            'I': i_score,
            'Total': total_score,
            'Market_Healthy': market_healthy,
        }, index=data.index)
        
        return signals
    
    def should_use_stop_loss(self) -> bool:
        return True
    
    def stop_loss_pct(self) -> float:
        return self._stop_loss_pct
    
    def get_current_scores(self) -> pd.DataFrame:
        """Get the detailed scores DataFrame (after running generate_signals)."""
        return self._scores if hasattr(self, '_scores') else None
    
    def describe(self) -> str:
        """Return a human-readable description."""
        fund_str = ""
        if self.fundamental_scores:
            fund_str = f"""
   Fundamental Scores (from yfinance):
     C (Current EPS):    {self.fundamental_scores.get('C', '?')}/2
     A (Annual EPS):     {self.fundamental_scores.get('A', '?')}/2
     I (Institutional):  {self.fundamental_scores.get('I', '?')}/2
     S (Float):          {self.fundamental_scores.get('S', '?')}/2"""
        
        return f"""
╔══════════════════════════════════════════════════════════════╗
║                    CANSLIM STRATEGY                          ║
╠══════════════════════════════════════════════════════════════╣
║ Symbol: {self.symbol or 'Not set'}
║ Minimum Score: {self.min_score}/12
║{fund_str}
║
║ BUY when:
║   • Total CANSLIM score >= {self.min_score}
║   • Market in uptrend (above 50 & 200 SMA)
║   • Breaking out of resistance on high volume
║
║ SELL when:
║   • Market turns down (below 50 SMA)
║   • Relative strength collapses
║   • Stop-loss: {self._stop_loss_pct * 100:.0f}% trailing stop
╚══════════════════════════════════════════════════════════════╝
"""


# =============================================================================
# CANSLIM LITE (Technical factors only — no fundamental data needed)
# =============================================================================

class CANSLIMLite(Strategy):
    """
    CANSLIM-inspired strategy using only technical factors (L, N, S, M).
    
    Use this when you don't have access to fundamental data, or for
    faster backtesting without API calls.
    
    Factors used:
    - L: Leader (relative strength / momentum)
    - N: New high (proximity to 52-week high)  
    - S: Supply/Demand (volume patterns)
    - M: Market direction (trend filter)
    """
    
    def __init__(
        self,
        min_score: int = 5,  # Lower threshold since max is 6
        stop_loss_pct: float = 0.08,
    ):
        super().__init__(name="CANSLIM Lite (Technical Only)")
        
        self.parameters = {
            'min_score': min_score,
            'stop_loss_pct': stop_loss_pct,
        }
        
        self.min_score = min_score
        self._stop_loss_pct = stop_loss_pct
    
    def generate_signals(self, data: pd.DataFrame) -> pd.Series:
        """Generate signals using only technical factors."""
        close = data['close']
        volume = data['volume']
        
        signals = pd.Series(0, index=data.index)
        
        # N — New High (0-2 points)
        rolling_high = close.rolling(252).max()
        pct_from_high = close / rolling_high
        n_score = pd.Series(0, index=data.index)
        n_score[pct_from_high >= 0.95] = 2
        n_score[(pct_from_high >= 0.90) & (pct_from_high < 0.95)] = 1
        
        # L — Leader / Momentum (0-2 points)
        momentum = rate_of_change(close, 126)  # 6-month momentum
        l_score = pd.Series(0, index=data.index)
        l_score[momentum >= 25] = 2
        l_score[(momentum >= 10) & (momentum < 25)] = 1
        
        # S — Supply/Demand (0-2 points)
        daily_return = close.pct_change()
        up_volume = volume.where(daily_return > 0, 0)
        down_volume = volume.where(daily_return < 0, 0)
        avg_up_vol = up_volume.rolling(20).mean()
        avg_down_vol = down_volume.rolling(20).mean()
        vol_ratio = avg_up_vol / (avg_down_vol + 1)
        
        s_score = pd.Series(0, index=data.index)
        s_score[vol_ratio >= 1.5] = 1
        s_score[vol_ratio >= 2.0] = 2
        
        # M — Market Direction (gate)
        sma_50 = sma(close, 50)
        sma_200 = sma(close, 200)
        market_healthy = (close > sma_50) & (close > sma_200)
        
        # Total score (max 6)
        total_score = n_score + l_score + s_score
        
        # Entry
        breakout = close > close.rolling(20).max().shift(1)
        volume_surge = volume > volume.rolling(50).mean() * 1.5
        
        buy_condition = (
            (total_score >= self.min_score) &
            market_healthy &
            breakout &
            volume_surge
        )
        
        # Exit
        sell_condition = close < sma_50
        
        signals[buy_condition] = 1
        signals[sell_condition] = -1
        
        return signals
    
    def should_use_stop_loss(self) -> bool:
        return True
    
    def stop_loss_pct(self) -> float:
        return self._stop_loss_pct
    
    def describe(self) -> str:
        return f"""
╔══════════════════════════════════════════════════════════════╗
║              CANSLIM LITE (Technical Only)                   ║
╠══════════════════════════════════════════════════════════════╣
║ Uses only technical factors: L, N, S, M
║ No fundamental data required (faster backtesting)
║
║ Factors:
║   • N: New High (proximity to 52-week high)
║   • L: Leader (6-month momentum)
║   • S: Supply/Demand (up volume vs down volume)
║   • M: Market Direction (trend filter)
║
║ Minimum Score: {self.min_score}/6
║ Stop-loss: {self._stop_loss_pct * 100:.0f}%
╚══════════════════════════════════════════════════════════════╝
"""


# =============================================================================
# TEST
# =============================================================================

if __name__ == "__main__":
    print("=== Testing CANSLIM Strategy ===\n")
    
    # Test CANSLIM Lite first (no fundamentals needed)
    strategy = CANSLIMLite()
    print(strategy.describe())
    
    # Create sample data
    np.random.seed(42)
    dates = pd.date_range('2023-01-01', periods=300, freq='D')
    
    # Simulate trending stock
    trend = np.cumsum(np.random.randn(300) * 0.02 + 0.002)
    prices = 100 * np.exp(trend)
    
    data = pd.DataFrame({
        'open': prices * (1 + np.random.randn(300) * 0.005),
        'high': prices * (1 + np.abs(np.random.randn(300)) * 0.01),
        'low': prices * (1 - np.abs(np.random.randn(300)) * 0.01),
        'close': prices,
        'volume': np.random.randint(1000000, 5000000, 300),
    }, index=dates)
    
    signals = strategy.generate_signals(data)
    
    buy_count = (signals == 1).sum()
    sell_count = (signals == -1).sum()
    
    print(f"\nSignal Summary:")
    print(f"  BUY signals:  {buy_count}")
    print(f"  SELL signals: {sell_count}")
    
    # Test full CANSLIM
    print("\n" + "="*50)
    print("Testing Full CANSLIM with fundamentals...")
    print("="*50)
    
    full_strategy = CANSLIMStrategy()
    full_strategy.set_symbol("NVDA")
    print(full_strategy.describe())
    
    print("\n✅ CANSLIM strategies ready!")
