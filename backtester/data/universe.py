"""
Universe Screening Module

Filters and screens stocks to find CANSLIM candidates.

=============================================================================
WHY DO WE NEED A UNIVERSE?
=============================================================================

We can't analyze every stock in the market (6000+). We need to filter
down to a manageable universe of candidates that meet basic criteria.

CANSLIM Universe Criteria (from PRD):
- Market cap > $1B (mid to large cap)
- Average volume > 400K shares/day (liquid)
- Price > $15 (no penny stocks)

Then we score each candidate on CANSLIM factors to find the best setups.

=============================================================================
"""

import pandas as pd
import numpy as np
import yfinance as yf
from typing import List, Dict, Optional
from datetime import datetime, timedelta
import json
from pathlib import Path
import time


# S&P 500 tickers (we'll use this as our base universe)
# In production, this should be fetched dynamically
SP500_TICKERS = [
    # === Mega Cap / Top 30 by market cap ===
    "AAPL", "MSFT", "AMZN", "NVDA", "GOOGL", "GOOG", "META", "TSLA", "BRK-B",
    "UNH", "LLY", "JPM", "V", "AVGO", "XOM", "MA", "JNJ", "PG", "HD",
    "COST", "MRK", "ABBV", "CRM", "CVX", "KO", "PEP", "WMT", "BAC", "NFLX",
    "TMO", "MCD", "CSCO", "ABT", "ACN", "LIN", "DHR", "ORCL", "AMD", "TXN",

    # === Technology & Software ===
    "ADBE", "INTU", "NOW", "SNPS", "CDNS", "PANW", "CRWD", "FTNT", "WDAY",
    "TEAM", "HUBS", "DDOG", "ZS", "MNDY", "BILL", "PCTY", "PAYC", "TTD",
    "VEEV", "ANSS", "CPAY", "GDDY", "GEN", "AKAM", "EPAM", "GLOB",

    # === Semiconductors ===
    "AVGO", "AMD", "QCOM", "TXN", "ADI", "LRCX", "KLAC", "AMAT", "MRVL",
    "ON", "NXPI", "MCHP", "SWKS", "MPWR", "ARM", "SMCI", "CRUS", "WOLF",

    # === Financials ===
    "JPM", "BAC", "WFC", "GS", "MS", "SCHW", "BLK", "SPGI", "ICE", "CME",
    "CB", "PGR", "AIG", "MET", "PRU", "TRV", "ALL", "AXP", "FI", "PYPL",
    "COF", "USB", "PNC", "BK", "AMP", "RJF", "HOOD", "SOFI",

    # === Healthcare & Biotech ===
    "LLY", "UNH", "JNJ", "MRK", "ABBV", "TMO", "ABT", "DHR", "PFE", "BMY",
    "AMGN", "GILD", "VRTX", "REGN", "ISRG", "SYK", "BSX", "MDT", "EW", "ZTS",
    "IDXX", "DXCM", "ALGN", "HOLX", "IQV", "CI", "ELV", "HUM", "MOH",
    "MRNA", "BMRN", "SGEN", "ALNY", "PCVX", "ARGX", "NBIX", "SRPT", "IONS",

    # === Industrials & Defense ===
    "GE", "CAT", "HON", "UNP", "UPS", "RTX", "DE", "BA", "LMT", "NOC",
    "GD", "ITW", "ETN", "PH", "EMR", "ROK", "AME", "FTV", "CARR",
    "TT", "AXON", "VRSK", "TDG", "HWM", "GWW", "FAST", "IR",

    # === Consumer / Retail ===
    "COST", "WMT", "HD", "LOW", "TJX", "NKE", "SBUX", "MCD", "CMG", "YUM",
    "DPZ", "LULU", "DECK", "BIRD", "ONON", "CAVA", "ELF", "CELH",
    "ORLY", "AZO", "ULTA", "ROST", "DG", "DLTR", "FIVE",

    # === Energy ===
    "XOM", "CVX", "COP", "EOG", "SLB", "PXD", "MPC", "PSX", "VLO", "OXY",
    "DVN", "FANG", "HES", "HAL", "TRGP", "WMB", "KMI", "OKE", "LNG",

    # === Communication & Media ===
    "GOOGL", "META", "NFLX", "DIS", "CMCSA", "T", "VZ", "TMUS", "CHTR",
    "SPOT", "RBLX", "ROKU", "ZM", "MTCH",

    # === REITs & Utilities ===
    "PLD", "AMT", "CCI", "EQIX", "SPG", "PSA", "WELL", "DLR", "O",
    "NEE", "SO", "DUK", "AEP", "SRE", "D", "PCG", "VST", "CEG",

    # === Materials & Chemicals ===
    "APD", "SHW", "ECL", "LIN", "FCX", "NEM", "NUE", "STLD", "VMC", "MLM",
    "CL", "CLX", "DD", "EMN",
]

# Growth/momentum stocks to always include in scans
GROWTH_WATCHLIST = [
    # Mega cap leaders
    "NVDA", "TSLA", "META", "AMZN", "GOOGL", "MSFT", "AAPL", "NFLX",

    # Cybersecurity & Cloud
    "CRWD", "PLTR", "NET", "SNOW", "DDOG", "ZS", "PANW", "FTNT", "S",

    # AI / Data Infrastructure
    "ARM", "SMCI", "AI", "PATH", "SNOW", "MDB", "ESTC", "CFLT", "DDOG",

    # Semiconductors
    "AMD", "AVGO", "MRVL", "ARM", "SMCI", "AMAT", "LRCX", "KLAC", "ON", "MPWR",

    # High-growth tech / fintech
    "UBER", "ABNB", "SQ", "SHOP", "COIN", "HOOD", "SOFI", "AFRM", "NU", "TOST",
    "TTD", "HUBS", "MNDY", "BILL",

    # Biotech / Healthcare growth
    "LLY", "NVO", "VRTX", "REGN", "ARGX", "NBIX", "SRPT", "ALNY", "MRNA",

    # Consumer growth / IPOs with momentum
    "CAVA", "ONON", "BIRK", "ELF", "CELH", "DUOL", "CART", "RKLB",
    "LULU", "DECK", "CMG",

    # Energy / Infrastructure
    "VST", "CEG", "TRGP", "LNG",

    # Industrials with momentum
    "AXON", "TT", "GE", "CARR", "HWM", "TDG",
]


class UniverseScreener:
    """
    Screens stocks to find CANSLIM candidates.
    
    Usage:
        screener = UniverseScreener()
        candidates = screener.screen()
        
        # Get top 20 by score
        top_picks = screener.rank_candidates(candidates)[:20]
    """
    
    def __init__(self, cache_dir: str = None):
        """Initialize the screener."""
        if cache_dir is None:
            cache_dir = Path(__file__).parent / "cache"
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(exist_ok=True)
    
    def get_universe(self, include_growth: bool = True) -> List[str]:
        """
        Get the list of tickers to screen.
        
        Args:
            include_growth: Include growth watchlist stocks
        
        Returns:
            List of ticker symbols
        """
        universe = set(SP500_TICKERS)
        
        if include_growth:
            universe.update(GROWTH_WATCHLIST)
        
        return sorted(list(universe))
    
    def get_stock_info(self, symbol: str) -> Optional[Dict]:
        """
        Get basic info for a stock (price, market cap, volume).
        
        Returns None if the stock doesn't meet basic criteria.
        """
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info
            
            # Extract key metrics
            result = {
                'symbol': symbol,
                'name': info.get('shortName', symbol),
                'price': info.get('currentPrice') or info.get('regularMarketPrice'),
                'market_cap': info.get('marketCap'),
                'avg_volume': info.get('averageVolume'),
                'float_shares': info.get('floatShares'),
                'beta': info.get('beta'),
                'sector': info.get('sector'),
                'industry': info.get('industry'),
                '52w_high': info.get('fiftyTwoWeekHigh'),
                '52w_low': info.get('fiftyTwoWeekLow'),
            }
            
            return result
            
        except Exception as e:
            print(f"   ⚠️ Error fetching {symbol}: {e}")
            return None
    
    def passes_basic_filters(self, info: Dict) -> bool:
        """
        Check if a stock passes basic CANSLIM filters.
        
        Criteria:
        - Market cap > $1B
        - Average volume > 400K
        - Price > $15
        """
        if info is None:
            return False
        
        market_cap = info.get('market_cap')
        avg_volume = info.get('avg_volume')
        price = info.get('price')
        
        # Check each criterion
        if market_cap is None or market_cap < 1_000_000_000:  # $1B
            return False
        
        if avg_volume is None or avg_volume < 400_000:
            return False
        
        if price is None or price < 15:
            return False
        
        return True
    
    def calculate_technical_score(self, symbol: str) -> Dict:
        """
        Calculate technical CANSLIM scores (N, L, S) for a stock.
        
        Returns dict with scores and supporting data.
        """
        try:
            ticker = yf.Ticker(symbol)
            
            # Get 1 year of daily data
            hist = ticker.history(period="1y")
            
            if hist.empty or len(hist) < 50:
                return {'symbol': symbol, 'error': 'Insufficient data'}
            
            close = hist['Close']
            volume = hist['Volume']
            
            # N — New High (proximity to 52-week high)
            high_52w = close.max()
            current = close.iloc[-1]
            pct_from_high = current / high_52w
            
            if pct_from_high >= 0.95:
                n_score = 2
            elif pct_from_high >= 0.90:
                n_score = 1
            else:
                n_score = 0
            
            # L — Leader (relative strength / momentum)
            if len(close) >= 126:
                momentum_6m = (current / close.iloc[-126] - 1) * 100
            else:
                momentum_6m = (current / close.iloc[0] - 1) * 100
            
            if momentum_6m >= 25:
                l_score = 2
            elif momentum_6m >= 10:
                l_score = 1
            else:
                l_score = 0
            
            # S — Supply/Demand (volume on up days vs down days)
            daily_return = close.pct_change()
            up_days = daily_return > 0
            
            avg_up_volume = volume[up_days].mean() if up_days.any() else 0
            avg_down_volume = volume[~up_days].mean() if (~up_days).any() else 1
            
            vol_ratio = avg_up_volume / avg_down_volume if avg_down_volume > 0 else 0
            
            if vol_ratio >= 1.5:
                s_score = 2 if vol_ratio >= 2.0 else 1
            else:
                s_score = 0
            
            return {
                'symbol': symbol,
                'price': current,
                '52w_high': high_52w,
                'pct_from_high': pct_from_high * 100,
                'momentum_6m': momentum_6m,
                'volume_ratio': vol_ratio,
                'N_score': n_score,
                'L_score': l_score,
                'S_score': s_score,
                'technical_score': n_score + l_score + s_score,
            }
            
        except Exception as e:
            return {'symbol': symbol, 'error': str(e)}
    
    def screen(
        self,
        symbols: List[str] = None,
        min_technical_score: int = 3,
        verbose: bool = True,
    ) -> pd.DataFrame:
        """
        Screen stocks and calculate CANSLIM scores.
        
        Args:
            symbols: List of symbols to screen (default: full universe)
            min_technical_score: Minimum technical score to include
            verbose: Print progress
        
        Returns:
            DataFrame of candidates with scores
        """
        if symbols is None:
            symbols = self.get_universe()
        
        if verbose:
            print(f"🔍 Screening {len(symbols)} stocks...")
            print(f"   Filters: Market cap > $1B, Volume > 400K, Price > $15")
            print(f"   Min technical score: {min_technical_score}/6")
            print()
        
        candidates = []
        passed = 0
        failed = 0
        
        for i, symbol in enumerate(symbols):
            if verbose and (i + 1) % 10 == 0:
                print(f"   Progress: {i + 1}/{len(symbols)} ({passed} passed, {failed} filtered)")
            
            # Get basic info
            info = self.get_stock_info(symbol)
            
            # Apply basic filters
            if not self.passes_basic_filters(info):
                failed += 1
                continue
            
            # Calculate technical scores
            tech = self.calculate_technical_score(symbol)
            
            if 'error' in tech:
                failed += 1
                continue
            
            # Apply minimum score filter
            if tech['technical_score'] < min_technical_score:
                failed += 1
                continue
            
            # Combine info
            candidate = {
                **info,
                **tech,
            }
            candidates.append(candidate)
            passed += 1
            
            # Rate limiting (avoid Yahoo Finance blocks)
            time.sleep(0.2)
        
        if verbose:
            print(f"\n✅ Screening complete!")
            print(f"   Passed: {passed}")
            print(f"   Filtered: {failed}")
        
        if not candidates:
            return pd.DataFrame()
        
        df = pd.DataFrame(candidates)
        
        # Sort by technical score
        df = df.sort_values('technical_score', ascending=False)
        
        return df
    
    def quick_screen(self, symbols: List[str] = None) -> pd.DataFrame:
        """
        Quick screen using only the growth watchlist.
        
        Faster than full screen — good for daily checks.
        """
        if symbols is None:
            symbols = GROWTH_WATCHLIST
        
        return self.screen(symbols, min_technical_score=2, verbose=True)
    
    def rank_candidates(
        self,
        df: pd.DataFrame,
        fundamental_weight: float = 0.5,
    ) -> pd.DataFrame:
        """
        Rank candidates by combined fundamental + technical score.
        
        Args:
            df: DataFrame from screen()
            fundamental_weight: Weight for fundamental vs technical (0-1)
        
        Returns:
            Sorted DataFrame with final rankings
        """
        if df.empty:
            return df
        
        # Add fundamental scores if not present
        # (This would require calling FundamentalsFetcher for each)
        
        # For now, rank by technical score + proximity to high
        df = df.copy()
        
        # Composite score
        df['composite'] = (
            df['technical_score'] * 2 +  # Weight technical
            df['pct_from_high'] / 10     # Bonus for near highs
        )
        
        return df.sort_values('composite', ascending=False)


# =============================================================================
# QUICK SCREENER FUNCTIONS
# =============================================================================

def find_breakouts(days: int = 5) -> pd.DataFrame:
    """
    Find stocks breaking out to new highs in the last N days.
    
    A "breakout" is when a stock crosses above its recent resistance
    (prior high) on high volume.
    """
    print(f"🚀 Finding breakouts in the last {days} days...")
    
    screener = UniverseScreener()
    symbols = screener.get_universe()
    
    breakouts = []
    
    for symbol in symbols:
        try:
            ticker = yf.Ticker(symbol)
            hist = ticker.history(period="3mo")
            
            if len(hist) < 20:
                continue
            
            # Check if made new 20-day high in last N days
            close = hist['Close']
            volume = hist['Volume']
            
            rolling_high = close.rolling(20).max()
            recent = close.iloc[-days:]
            recent_highs = rolling_high.iloc[-days:]
            
            # Breakout = price crosses above rolling high
            for i in range(len(recent)):
                if i == 0:
                    continue
                if recent.iloc[i] > recent_highs.iloc[i-1]:
                    # Check volume confirmation
                    avg_vol = volume.rolling(50).mean().iloc[-1]
                    if volume.iloc[-days + i] > avg_vol * 1.5:
                        breakouts.append({
                            'symbol': symbol,
                            'breakout_date': recent.index[i].strftime('%Y-%m-%d'),
                            'price': recent.iloc[i],
                            'volume_ratio': volume.iloc[-days + i] / avg_vol,
                        })
                        break
            
            time.sleep(0.1)
            
        except Exception:
            continue
    
    if breakouts:
        df = pd.DataFrame(breakouts)
        print(f"✅ Found {len(df)} breakouts")
        return df
    
    return pd.DataFrame()


def find_leaders(min_momentum: float = 20) -> pd.DataFrame:
    """
    Find market leaders (stocks with strong relative strength).
    
    Leaders are stocks that are outperforming the market.
    """
    print(f"👑 Finding market leaders (6-month momentum > {min_momentum}%)...")
    
    screener = UniverseScreener()
    results = screener.quick_screen()
    
    if results.empty:
        return results
    
    # Filter by momentum
    leaders = results[results['momentum_6m'] >= min_momentum]
    
    print(f"✅ Found {len(leaders)} leaders")
    
    return leaders[['symbol', 'price', 'momentum_6m', 'pct_from_high', 'technical_score']]


# =============================================================================
# TEST
# =============================================================================

if __name__ == "__main__":
    print("=== Universe Screener Test ===\n")
    
    screener = UniverseScreener()
    
    # Quick screen (growth watchlist only)
    print("Running quick screen on growth watchlist...\n")
    results = screener.quick_screen()
    
    if not results.empty:
        print("\n📊 Top Candidates:")
        print(results[['symbol', 'price', 'momentum_6m', 'pct_from_high', 'technical_score']].head(10).to_string())
    
    print("\n✅ Screener ready!")
