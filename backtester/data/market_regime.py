"""
Market Regime Detection (M Factor)

The M factor in CANSLIM is a GATE — it determines whether we should
be buying at all. If the market is in correction, we sit on our hands
regardless of how good individual stocks look.

=============================================================================
MARKET REGIMES
=============================================================================

1. CONFIRMED UPTREND
   - Market is healthy, full position sizing allowed
   - Few distribution days, positive follow-through
   
2. UPTREND UNDER PRESSURE  
   - Caution, reduce position sizing to 50%
   - Multiple distribution days accumulating
   
3. MARKET IN CORRECTION
   - No new buys, tighten stops on existing positions
   - Failed rally attempts, heavy distribution

=============================================================================
KEY CONCEPTS
=============================================================================

DISTRIBUTION DAY:
- Index (S&P 500) closes DOWN >0.2% on HIGHER volume than previous day
- Shows institutional selling
- 4-5 distribution days in 25 trading days = warning sign

FOLLOW-THROUGH DAY (FTD):
- After a market correction/pullback
- Day 4+ of a rally attempt
- Index UP >1.5% on higher volume
- Signals potential new uptrend

=============================================================================
"""

import pandas as pd
import numpy as np
from typing import Dict, Tuple, List
from datetime import datetime, timedelta
from enum import Enum
from dataclasses import dataclass
import yfinance as yf


class MarketRegime(Enum):
    """Market regime states."""
    CONFIRMED_UPTREND = "confirmed_uptrend"
    UPTREND_UNDER_PRESSURE = "uptrend_under_pressure"
    CORRECTION = "correction"
    RALLY_ATTEMPT = "rally_attempt"


@dataclass
class MarketStatus:
    """Current market status with supporting data."""
    regime: MarketRegime
    distribution_days: int
    last_ftd: str  # Date of last follow-through day
    trend_direction: str  # "up", "down", "sideways"
    position_sizing: float  # Recommended position size (0.0 to 1.0)
    notes: str
    
    def __str__(self) -> str:
        emoji = {
            MarketRegime.CONFIRMED_UPTREND: "🟢",
            MarketRegime.UPTREND_UNDER_PRESSURE: "🟡",
            MarketRegime.RALLY_ATTEMPT: "🟡",
            MarketRegime.CORRECTION: "🔴",
        }
        
        return f"""
╔══════════════════════════════════════════════════════════════╗
║                    MARKET STATUS (M Factor)                  ║
╠══════════════════════════════════════════════════════════════╣
║ Regime: {emoji.get(self.regime, '')} {self.regime.value.upper()}
║ Distribution Days (25d): {self.distribution_days}
║ Last Follow-Through: {self.last_ftd or 'None recent'}
║ Trend: {self.trend_direction}
║ Position Sizing: {self.position_sizing * 100:.0f}%
║
║ Notes: {self.notes}
╚══════════════════════════════════════════════════════════════╝
"""


class MarketRegimeDetector:
    """
    Detects the current market regime using O'Neil's methodology.
    
    Uses S&P 500 (SPY) as the market proxy.
    
    Usage:
        detector = MarketRegimeDetector()
        status = detector.get_status()
        
        if status.regime == MarketRegime.CORRECTION:
            print("No new buys!")
    """
    
    def __init__(self, symbol: str = "SPY"):
        """
        Initialize the detector.
        
        Args:
            symbol: Index/ETF to use for market analysis (default: SPY)
        """
        self.symbol = symbol
        self._data = None
        self._distribution_days = []
        self._ftd_dates = []
    
    def fetch_data(self, days: int = 90) -> pd.DataFrame:
        """Fetch recent price/volume data for the index."""
        ticker = yf.Ticker(self.symbol)
        self._data = ticker.history(period=f"{days}d")
        return self._data
    
    def count_distribution_days(self, lookback: int = 25) -> List[datetime]:
        """
        Count distribution days in the last N trading days.
        
        Distribution day criteria:
        - Index closes DOWN more than 0.2%
        - Volume is HIGHER than previous day
        
        Args:
            lookback: Number of trading days to look back
        
        Returns:
            List of distribution day dates
        """
        if self._data is None:
            self.fetch_data()
        
        data = self._data.tail(lookback + 1)  # +1 for volume comparison
        
        distribution_days = []
        
        for i in range(1, len(data)):
            today = data.iloc[i]
            yesterday = data.iloc[i - 1]
            
            # Calculate daily return
            daily_return = (today['Close'] - yesterday['Close']) / yesterday['Close']
            
            # Check if distribution day
            if daily_return < -0.002:  # Down more than 0.2%
                if today['Volume'] > yesterday['Volume']:  # Higher volume
                    distribution_days.append(data.index[i])
        
        self._distribution_days = distribution_days
        return distribution_days
    
    def find_follow_through_days(self, lookback: int = 60) -> List[datetime]:
        """
        Find follow-through days in recent history.
        
        FTD criteria:
        - Day 4 or later of a rally attempt (after correction)
        - Index UP more than 1.5%
        - Volume higher than previous day
        
        This is simplified — real FTD detection requires tracking
        rally attempt start dates.
        """
        if self._data is None:
            self.fetch_data()
        
        data = self._data.tail(lookback)
        
        ftd_dates = []
        
        for i in range(4, len(data)):  # Start at day 4
            today = data.iloc[i]
            yesterday = data.iloc[i - 1]
            
            # Calculate daily return
            daily_return = (today['Close'] - yesterday['Close']) / yesterday['Close']
            
            # Check if FTD candidate
            if daily_return > 0.015:  # Up more than 1.5%
                if today['Volume'] > yesterday['Volume']:  # Higher volume
                    ftd_dates.append(data.index[i])
        
        self._ftd_dates = ftd_dates
        return ftd_dates
    
    def get_trend_direction(self) -> str:
        """
        Determine overall trend direction using moving averages.
        
        Returns: "up", "down", or "sideways"
        """
        if self._data is None:
            self.fetch_data()
        
        close = self._data['Close']
        
        sma_20 = close.rolling(20).mean()
        sma_50 = close.rolling(50).mean()
        
        current = close.iloc[-1]
        sma_20_current = sma_20.iloc[-1]
        sma_50_current = sma_50.iloc[-1]
        
        # Uptrend: price above both SMAs, 20 above 50
        if current > sma_20_current > sma_50_current:
            return "up"
        
        # Downtrend: price below both SMAs, 20 below 50
        if current < sma_20_current < sma_50_current:
            return "down"
        
        return "sideways"
    
    def get_status(self) -> MarketStatus:
        """
        Get current market status with regime classification.
        
        Returns:
            MarketStatus with all relevant data
        """
        # Fetch fresh data
        self.fetch_data()
        
        # Count distribution days
        dist_days = self.count_distribution_days(25)
        dist_count = len(dist_days)
        
        # Find follow-through days
        ftd_dates = self.find_follow_through_days(60)
        last_ftd = ftd_dates[-1].strftime('%Y-%m-%d') if ftd_dates else None
        
        # Get trend
        trend = self.get_trend_direction()
        
        # Determine regime
        if dist_count >= 5:
            # Heavy distribution = correction or under pressure
            if trend == "down":
                regime = MarketRegime.CORRECTION
                sizing = 0.0
                notes = f"{dist_count} distribution days + downtrend. Stay out."
            else:
                regime = MarketRegime.UPTREND_UNDER_PRESSURE
                sizing = 0.5
                notes = f"{dist_count} distribution days. Reduce exposure."
        
        elif dist_count >= 3:
            # Moderate distribution
            regime = MarketRegime.UPTREND_UNDER_PRESSURE
            sizing = 0.75
            notes = f"{dist_count} distribution days. Be cautious."
        
        else:
            # Healthy market
            if trend == "up":
                regime = MarketRegime.CONFIRMED_UPTREND
                sizing = 1.0
                notes = "Market healthy. Full position sizing."
            elif trend == "sideways":
                regime = MarketRegime.RALLY_ATTEMPT
                sizing = 0.5
                notes = "Market sideways. Wait for confirmation."
            else:
                regime = MarketRegime.CORRECTION
                sizing = 0.0
                notes = "Downtrend. No new buys."
        
        return MarketStatus(
            regime=regime,
            distribution_days=dist_count,
            last_ftd=last_ftd,
            trend_direction=trend,
            position_sizing=sizing,
            notes=notes,
        )
    
    def should_buy(self) -> Tuple[bool, float]:
        """
        Quick check: should we be buying?
        
        Returns:
            Tuple of (can_buy: bool, position_size_pct: float)
        """
        status = self.get_status()
        
        can_buy = status.regime in [
            MarketRegime.CONFIRMED_UPTREND,
            MarketRegime.UPTREND_UNDER_PRESSURE,
            MarketRegime.RALLY_ATTEMPT,
        ]
        
        return can_buy, status.position_sizing
    
    def get_distribution_calendar(self) -> pd.DataFrame:
        """
        Get a calendar view of recent distribution days.
        
        Useful for visualizing selling pressure.
        """
        if not self._distribution_days:
            self.count_distribution_days()
        
        if not self._distribution_days:
            return pd.DataFrame()
        
        records = []
        for date in self._distribution_days:
            idx = self._data.index.get_loc(date)
            day_data = self._data.iloc[idx]
            prev_data = self._data.iloc[idx - 1]
            
            pct_change = (day_data['Close'] - prev_data['Close']) / prev_data['Close'] * 100
            vol_change = (day_data['Volume'] - prev_data['Volume']) / prev_data['Volume'] * 100
            
            records.append({
                'date': date.strftime('%Y-%m-%d'),
                'close': day_data['Close'],
                'change_pct': pct_change,
                'volume_change_pct': vol_change,
            })
        
        return pd.DataFrame(records)


# =============================================================================
# QUICK FUNCTIONS
# =============================================================================

def check_market() -> MarketStatus:
    """Quick check of market status."""
    detector = MarketRegimeDetector()
    return detector.get_status()


def is_market_healthy() -> bool:
    """Simple yes/no: is the market in a buyable state?"""
    detector = MarketRegimeDetector()
    can_buy, _ = detector.should_buy()
    return can_buy


# =============================================================================
# TEST
# =============================================================================

if __name__ == "__main__":
    print("=== Market Regime Detector Test ===\n")
    
    detector = MarketRegimeDetector()
    status = detector.get_status()
    
    print(status)
    
    # Show distribution days
    calendar = detector.get_distribution_calendar()
    if not calendar.empty:
        print("\n📉 Distribution Days (last 25 trading days):")
        print(calendar.to_string(index=False))
    else:
        print("\n✅ No distribution days in last 25 trading days!")
    
    # Quick check
    can_buy, sizing = detector.should_buy()
    print(f"\n🎯 Can buy: {'Yes' if can_buy else 'No'}")
    print(f"   Position sizing: {sizing * 100:.0f}%")
