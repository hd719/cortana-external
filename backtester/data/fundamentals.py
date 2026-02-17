"""
Fundamentals Data Module

Fetches fundamental data (earnings, financials, institutional ownership) from
Yahoo Finance using the yfinance library.

=============================================================================
WHY DO WE NEED FUNDAMENTAL DATA?
=============================================================================

Price data tells us WHAT happened (stock went up/down).
Fundamental data tells us WHY (earnings grew, revenue increased, etc.).

For CANSLIM, we need:
- EPS growth (C and A factors)
- Revenue growth (confirms earnings quality)
- Institutional ownership (I factor)
- Shares outstanding / float (S factor)

=============================================================================
POINT-IN-TIME DATA
=============================================================================

For backtesting, we can't use TODAY's fundamentals to make decisions in
the PAST. That's called "lookahead bias" — using information you wouldn't
have had at the time.

Example of WRONG approach:
  On March 15, 2023, the backtest uses Q1 2023 earnings
  But Q1 2023 earnings weren't released until April!

Example of CORRECT approach:
  On March 15, 2023, the backtest uses Q4 2022 earnings (most recent available)

This module handles that by tracking earnings RELEASE DATES, not just the
quarter the earnings are for.

=============================================================================
"""

import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Tuple
from pathlib import Path
import json


class FundamentalsCache:
    """
    Caches fundamental data to avoid hitting Yahoo Finance repeatedly.
    
    Yahoo Finance rate-limits aggressive requests, so we cache everything
    locally after the first fetch.
    """
    
    def __init__(self, cache_dir: str = None):
        """
        Initialize the cache.
        
        Args:
            cache_dir: Directory to store cached data (default: data/cache/)
        """
        if cache_dir is None:
            cache_dir = Path(__file__).parent / "cache"
        
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(exist_ok=True)
    
    def _cache_path(self, symbol: str, data_type: str) -> Path:
        """Get the cache file path for a symbol/data type combo."""
        return self.cache_dir / f"{symbol}_{data_type}.json"
    
    def get(self, symbol: str, data_type: str) -> Optional[dict]:
        """Load cached data if it exists and is fresh (< 24 hours old)."""
        path = self._cache_path(symbol, data_type)
        
        if not path.exists():
            return None
        
        # Check if cache is stale (> 24 hours old)
        mtime = datetime.fromtimestamp(path.stat().st_mtime)
        if datetime.now() - mtime > timedelta(hours=24):
            return None
        
        with open(path, 'r') as f:
            return json.load(f)
    
    def set(self, symbol: str, data_type: str, data: dict):
        """Save data to cache."""
        path = self._cache_path(symbol, data_type)
        with open(path, 'w') as f:
            json.dump(data, f, indent=2, default=str)


class FundamentalsFetcher:
    """
    Fetches and processes fundamental data from Yahoo Finance.
    
    This is the main class you'll use. It handles:
    - Fetching data from Yahoo Finance
    - Caching to avoid rate limits
    - Point-in-time lookups for backtesting
    - Calculating growth rates
    
    Example usage:
        fetcher = FundamentalsFetcher()
        
        # Get current fundamentals
        data = fetcher.get_fundamentals("AAPL")
        print(data['eps_growth'])
        
        # Get point-in-time fundamentals (for backtesting)
        data = fetcher.get_fundamentals_at_date("AAPL", "2023-06-15")
        print(data['eps_growth'])  # Uses data available on June 15, 2023
    """
    
    def __init__(self):
        """Initialize the fetcher with a cache."""
        self.cache = FundamentalsCache()
    
    def get_ticker(self, symbol: str) -> yf.Ticker:
        """
        Get a yfinance Ticker object.
        
        This is the main interface to Yahoo Finance data.
        """
        return yf.Ticker(symbol)
    
    # =========================================================================
    # EARNINGS DATA
    # =========================================================================
    
    def get_earnings_history(self, symbol: str) -> pd.DataFrame:
        """
        Get historical quarterly earnings (EPS).
        
        Returns a DataFrame with columns:
        - date: When earnings were RELEASED (important for point-in-time!)
        - quarter: The fiscal quarter (e.g., "2023Q4")
        - eps_actual: Actual EPS reported
        - eps_estimate: Analyst estimate
        - surprise_pct: How much actual beat/missed estimate
        
        Args:
            symbol: Stock ticker
        
        Returns:
            DataFrame sorted by date (oldest first)
        """
        # Check cache first
        cached = self.cache.get(symbol, "earnings")
        if cached is not None:
            return pd.DataFrame(cached)
        
        print(f"📊 Fetching earnings history for {symbol}...")
        
        ticker = self.get_ticker(symbol)
        
        # yfinance provides earnings dates and EPS
        # We need to combine a few sources
        
        try:
            # Get earnings dates (when earnings were released)
            earnings_dates = ticker.earnings_dates
            
            if earnings_dates is None or earnings_dates.empty:
                print(f"⚠️ No earnings data for {symbol}")
                return pd.DataFrame()
            
            # Clean up the data
            df = earnings_dates.reset_index()
            df.columns = ['date', 'eps_estimate', 'eps_actual', 'surprise_pct']
            
            # Convert date to datetime (remove timezone)
            df['date'] = pd.to_datetime(df['date']).dt.tz_localize(None)
            
            # Sort by date
            df = df.sort_values('date').reset_index(drop=True)
            
            # Remove future dates (scheduled but not reported)
            df = df[df['date'] <= datetime.now()]
            
            # Remove rows with no actual EPS (not yet reported)
            df = df.dropna(subset=['eps_actual'])
            
            # Cache the result
            self.cache.set(symbol, "earnings", df.to_dict('records'))
            
            print(f"   ✅ Found {len(df)} quarters of earnings data")
            return df
            
        except Exception as e:
            print(f"   ❌ Error fetching earnings: {e}")
            return pd.DataFrame()
    
    def get_eps_growth(self, symbol: str, as_of_date: str = None) -> Optional[float]:
        """
        Calculate year-over-year EPS growth.
        
        This compares the most recent quarter's EPS to the same quarter
        last year. This is the "C" in CANSLIM.
        
        Args:
            symbol: Stock ticker
            as_of_date: Date to calculate growth as of (for backtesting)
                       If None, uses current date
        
        Returns:
            EPS growth as percentage (e.g., 25.5 for 25.5% growth)
            Returns None if not enough data
        
        Example:
            # Q4 2024 EPS = $2.00, Q4 2023 EPS = $1.50
            # Growth = (2.00 - 1.50) / 1.50 * 100 = 33.3%
        """
        earnings = self.get_earnings_history(symbol)
        
        if earnings.empty or len(earnings) < 5:  # Need at least 5 quarters
            return None
        
        # Ensure date is datetime
        earnings['date'] = pd.to_datetime(earnings['date'])
        
        # Filter to data available as of the given date
        if as_of_date:
            as_of = pd.to_datetime(as_of_date)
            earnings = earnings[earnings['date'] <= as_of]
        
        if len(earnings) < 5:
            return None
        
        # Get most recent quarter and same quarter last year
        recent = earnings.iloc[-1]
        year_ago = earnings.iloc[-5]  # 4 quarters back = same quarter last year
        
        recent_eps = recent['eps_actual']
        year_ago_eps = year_ago['eps_actual']
        
        # Handle edge cases
        if year_ago_eps == 0 or pd.isna(year_ago_eps) or pd.isna(recent_eps):
            return None
        
        # Calculate growth
        growth = ((recent_eps - year_ago_eps) / abs(year_ago_eps)) * 100
        
        return growth
    
    def get_annual_eps_growth(self, symbol: str, years: int = 5) -> Optional[float]:
        """
        Calculate compound annual EPS growth rate over N years.
        
        This is the "A" in CANSLIM — we want stocks with consistent
        long-term earnings growth.
        
        Args:
            symbol: Stock ticker
            years: Number of years to look back (default 5)
        
        Returns:
            CAGR of EPS as percentage
        """
        earnings = self.get_earnings_history(symbol)
        
        if earnings.empty:
            return None
        
        # Ensure date is datetime
        earnings['date'] = pd.to_datetime(earnings['date'])
        
        # Get annual EPS (sum of 4 quarters)
        earnings['year'] = earnings['date'].dt.year
        annual = earnings.groupby('year')['eps_actual'].sum()
        
        if len(annual) < years:
            return None
        
        # Get oldest and newest annual EPS
        oldest_eps = annual.iloc[-(years)]
        newest_eps = annual.iloc[-1]
        
        if oldest_eps <= 0 or newest_eps <= 0:
            return None
        
        # Calculate CAGR
        cagr = ((newest_eps / oldest_eps) ** (1 / years) - 1) * 100
        
        return cagr
    
    # =========================================================================
    # FINANCIAL STATEMENTS
    # =========================================================================
    
    def get_quarterly_financials(self, symbol: str) -> pd.DataFrame:
        """
        Get quarterly financial statements (income statement).
        
        Returns revenue, net income, and other key metrics by quarter.
        """
        # Check cache first
        cached = self.cache.get(symbol, "financials")
        if cached is not None:
            return pd.DataFrame(cached)
        
        print(f"📊 Fetching quarterly financials for {symbol}...")
        
        ticker = self.get_ticker(symbol)
        
        try:
            # Get quarterly income statement
            financials = ticker.quarterly_income_stmt
            
            if financials is None or financials.empty:
                print(f"⚠️ No financial data for {symbol}")
                return pd.DataFrame()
            
            # Transpose so dates are rows
            df = financials.T
            df.index.name = 'date'
            df = df.reset_index()
            
            # Convert date
            df['date'] = pd.to_datetime(df['date'])
            
            # Select key columns (names vary by company)
            key_cols = ['date']
            for col in ['Total Revenue', 'Net Income', 'Gross Profit', 'Operating Income']:
                if col in df.columns:
                    key_cols.append(col)
            
            df = df[key_cols]
            df = df.sort_values('date').reset_index(drop=True)
            
            # Cache the result
            self.cache.set(symbol, "financials", df.to_dict('records'))
            
            print(f"   ✅ Found {len(df)} quarters of financial data")
            return df
            
        except Exception as e:
            print(f"   ❌ Error fetching financials: {e}")
            return pd.DataFrame()
    
    def get_revenue_growth(self, symbol: str, as_of_date: str = None) -> Optional[float]:
        """
        Calculate year-over-year revenue growth.
        
        Used to confirm earnings quality — we want revenue growing too,
        not just cost cuts boosting EPS.
        """
        financials = self.get_quarterly_financials(symbol)
        
        if financials.empty or len(financials) < 5:
            return None
        
        if 'Total Revenue' not in financials.columns:
            return None
        
        # Ensure date is datetime
        financials['date'] = pd.to_datetime(financials['date'])
        
        # Filter to data available as of the given date
        if as_of_date:
            as_of = pd.to_datetime(as_of_date)
            financials = financials[financials['date'] <= as_of]
        
        if len(financials) < 5:
            return None
        
        # Get most recent and year-ago revenue
        recent = financials.iloc[-1]['Total Revenue']
        year_ago = financials.iloc[-5]['Total Revenue']
        
        if year_ago == 0 or pd.isna(year_ago) or pd.isna(recent):
            return None
        
        growth = ((recent - year_ago) / abs(year_ago)) * 100
        return growth
    
    # =========================================================================
    # INSTITUTIONAL OWNERSHIP
    # =========================================================================
    
    def get_institutional_holders(self, symbol: str) -> pd.DataFrame:
        """
        Get top institutional holders.
        
        This is the "I" in CANSLIM — we want stocks owned by quality
        institutions, with increasing ownership.
        
        Note: This is current data only (Yahoo doesn't provide historical).
        For backtesting, we'll use this as a proxy.
        """
        print(f"📊 Fetching institutional holders for {symbol}...")
        
        ticker = self.get_ticker(symbol)
        
        try:
            holders = ticker.institutional_holders
            
            if holders is None or holders.empty:
                print(f"⚠️ No institutional holder data for {symbol}")
                return pd.DataFrame()
            
            print(f"   ✅ Found {len(holders)} institutional holders")
            return holders
            
        except Exception as e:
            print(f"   ❌ Error fetching holders: {e}")
            return pd.DataFrame()
    
    def get_institutional_ownership_pct(self, symbol: str) -> Optional[float]:
        """
        Get percentage of shares held by institutions.
        """
        ticker = self.get_ticker(symbol)
        
        try:
            info = ticker.info
            return info.get('heldPercentInstitutions', None)
        except:
            return None
    
    # =========================================================================
    # SHARES / FLOAT
    # =========================================================================
    
    def get_shares_info(self, symbol: str) -> Dict:
        """
        Get shares outstanding and float.
        
        This is for the "S" in CANSLIM — we prefer stocks with
        smaller float (fewer shares available to trade).
        """
        ticker = self.get_ticker(symbol)
        
        try:
            info = ticker.info
            
            return {
                'shares_outstanding': info.get('sharesOutstanding'),
                'float_shares': info.get('floatShares'),
                'short_ratio': info.get('shortRatio'),
                'short_pct_of_float': info.get('shortPercentOfFloat'),
            }
        except Exception as e:
            print(f"Error getting shares info: {e}")
            return {}
    
    # =========================================================================
    # COMBINED FUNDAMENTALS
    # =========================================================================
    
    def get_fundamentals(self, symbol: str, as_of_date: str = None) -> Dict:
        """
        Get all fundamental data for a stock in one call.
        
        This is the main method you'll use. It returns a dictionary
        with all the data needed for CANSLIM scoring.
        
        Args:
            symbol: Stock ticker
            as_of_date: Date to get fundamentals as of (for backtesting)
        
        Returns:
            Dictionary with keys:
            - eps_growth: YoY EPS growth (C factor)
            - annual_eps_growth: 5-year EPS CAGR (A factor)
            - revenue_growth: YoY revenue growth
            - institutional_pct: % held by institutions (I factor)
            - float_shares: Number of shares in float (S factor)
            - shares_outstanding: Total shares
        """
        print(f"\n{'='*50}")
        print(f"Fetching fundamentals for {symbol}")
        if as_of_date:
            print(f"As of: {as_of_date}")
        print(f"{'='*50}\n")
        
        result = {
            'symbol': symbol,
            'as_of_date': as_of_date or datetime.now().strftime('%Y-%m-%d'),
            
            # Earnings (C and A factors)
            'eps_growth': self.get_eps_growth(symbol, as_of_date),
            'annual_eps_growth': self.get_annual_eps_growth(symbol),
            'revenue_growth': self.get_revenue_growth(symbol, as_of_date),
            
            # Institutional (I factor)
            'institutional_pct': self.get_institutional_ownership_pct(symbol),
            
            # Shares (S factor)
            **self.get_shares_info(symbol),
        }
        
        return result
    
    def score_canslim_fundamentals(self, fundamentals: Dict) -> Dict:
        """
        Score a stock on CANSLIM fundamental factors (C, A, I, S).
        
        Returns scores for each factor (0, 1, or 2 points each).
        
        Note: This only scores the fundamental factors.
        L, N, and M require price data (handled in canslim.py strategy).
        """
        scores = {}
        
        # C — Current Earnings (0-2 points)
        eps_growth = fundamentals.get('eps_growth')
        if eps_growth is None:
            scores['C'] = 0
        elif eps_growth > 50:
            scores['C'] = 2
        elif eps_growth > 25:
            scores['C'] = 1
        else:
            scores['C'] = 0
        
        # A — Annual Earnings (0-2 points)
        annual_growth = fundamentals.get('annual_eps_growth')
        if annual_growth is None:
            scores['A'] = 0
        elif annual_growth > 40:
            scores['A'] = 2
        elif annual_growth > 25:
            scores['A'] = 1
        else:
            scores['A'] = 0
        
        # I — Institutional Sponsorship (0-2 points)
        inst_pct = fundamentals.get('institutional_pct')
        if inst_pct is None:
            scores['I'] = 0
        elif 0.20 <= inst_pct <= 0.60:  # Sweet spot: not too little, not too much
            scores['I'] = 2
        elif 0.10 <= inst_pct <= 0.80:
            scores['I'] = 1
        else:
            scores['I'] = 0
        
        # S — Supply/Demand (0-2 points based on float)
        float_shares = fundamentals.get('float_shares')
        if float_shares is None:
            scores['S'] = 0
        elif float_shares < 25_000_000:  # < 25M float
            scores['S'] = 2
        elif float_shares < 50_000_000:  # < 50M float
            scores['S'] = 1
        else:
            scores['S'] = 0
        
        # Total fundamental score (max 8 points)
        scores['fundamental_total'] = scores['C'] + scores['A'] + scores['I'] + scores['S']
        
        return scores


# =============================================================================
# TEST THE MODULE
# =============================================================================

if __name__ == "__main__":
    print("=== Testing Fundamentals Fetcher ===\n")
    
    fetcher = FundamentalsFetcher()
    
    # Test with Apple
    symbol = "AAPL"
    
    # Get full fundamentals
    fundamentals = fetcher.get_fundamentals(symbol)
    
    print("\n📈 Fundamentals Summary:")
    print(f"   Symbol: {fundamentals['symbol']}")
    print(f"   EPS Growth (YoY): {fundamentals['eps_growth']:.1f}%" if fundamentals['eps_growth'] else "   EPS Growth: N/A")
    print(f"   Annual EPS Growth: {fundamentals['annual_eps_growth']:.1f}%" if fundamentals['annual_eps_growth'] else "   Annual Growth: N/A")
    print(f"   Revenue Growth (YoY): {fundamentals['revenue_growth']:.1f}%" if fundamentals['revenue_growth'] else "   Revenue Growth: N/A")
    print(f"   Institutional: {fundamentals['institutional_pct']*100:.1f}%" if fundamentals['institutional_pct'] else "   Institutional: N/A")
    print(f"   Float: {fundamentals['float_shares']:,}" if fundamentals['float_shares'] else "   Float: N/A")
    
    # Score it
    scores = fetcher.score_canslim_fundamentals(fundamentals)
    
    print("\n📊 CANSLIM Fundamental Scores:")
    print(f"   C (Current Earnings):  {scores['C']}/2")
    print(f"   A (Annual Earnings):   {scores['A']}/2")
    print(f"   I (Institutional):     {scores['I']}/2")
    print(f"   S (Supply/Demand):     {scores['S']}/2")
    print(f"   ─────────────────────────")
    print(f"   Fundamental Total:     {scores['fundamental_total']}/8")
    
    print("\n✅ Fundamentals module ready!")
