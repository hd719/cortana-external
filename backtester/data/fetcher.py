"""
Data Fetcher Module

Fetches historical price data from Alpaca's API.
This data is what we'll use to run backtests against.

Alpaca provides free historical data for stocks, which makes it perfect
for backtesting before trading with real money.
"""

import pandas as pd
from datetime import datetime, timedelta
from typing import Optional, List
import requests

# Import our configuration
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import (
    ALPACA_KEY_ID, 
    ALPACA_SECRET_KEY, 
    ALPACA_DATA_URL,
    DEFAULT_TIMEFRAME,
    DEFAULT_LOOKBACK_YEARS
)


# =============================================================================
# MAIN DATA FETCHING FUNCTION
# =============================================================================

def get_historical_data(
    symbol: str,
    start: Optional[str] = None,
    end: Optional[str] = None,
    timeframe: str = DEFAULT_TIMEFRAME
) -> pd.DataFrame:
    """
    Fetch historical OHLCV data for a symbol from Alpaca.
    
    OHLCV = Open, High, Low, Close, Volume — the standard price data format.
    
    Args:
        symbol: Stock ticker (e.g., "AAPL", "MSFT", "SPY")
        start: Start date as string "YYYY-MM-DD" (default: 3 years ago)
        end: End date as string "YYYY-MM-DD" (default: today)
        timeframe: Bar size - "1Day", "1Hour", "1Min", etc.
    
    Returns:
        DataFrame with columns: open, high, low, close, volume
        Index is datetime
    
    Example:
        >>> data = get_historical_data("AAPL", start="2023-01-01", end="2024-12-31")
        >>> print(data.head())
                           open    high     low   close     volume
        2023-01-03       130.28  130.90  124.17  125.07  112117500
        2023-01-04       126.89  128.66  125.08  126.36   89113600
        ...
    """
    # Set default dates if not provided
    if end is None:
        end = datetime.now().strftime("%Y-%m-%d")
    
    if start is None:
        start_date = datetime.now() - timedelta(days=365 * DEFAULT_LOOKBACK_YEARS)
        start = start_date.strftime("%Y-%m-%d")
    
    print(f"📊 Fetching {symbol} data from {start} to {end}...")
    
    # Build the API request
    # Alpaca's data API endpoint for historical bars
    url = f"{ALPACA_DATA_URL}/v2/stocks/{symbol}/bars"
    
    # Request headers with authentication
    headers = {
        "APCA-API-KEY-ID": ALPACA_KEY_ID,
        "APCA-API-SECRET-KEY": ALPACA_SECRET_KEY
    }
    
    # Query parameters
    params = {
        "start": f"{start}T00:00:00Z",  # ISO format with timezone
        "end": f"{end}T23:59:59Z",
        "timeframe": timeframe,
        "limit": 10000,  # Max bars per request
        "adjustment": "split"  # Adjust for stock splits
    }
    
    # Make the request
    response = requests.get(url, headers=headers, params=params)
    
    # Check for errors
    if response.status_code != 200:
        raise Exception(f"API Error {response.status_code}: {response.text}")
    
    # Parse the response
    data = response.json()
    bars = data.get("bars", [])
    
    if not bars:
        raise ValueError(f"No data returned for {symbol}")
    
    # Convert to DataFrame
    df = pd.DataFrame(bars)
    
    # Rename columns to standard format
    # Alpaca uses: t, o, h, l, c, v, n, vw
    column_map = {
        't': 'timestamp',
        'o': 'open',
        'h': 'high',
        'l': 'low',
        'c': 'close',
        'v': 'volume',
        'n': 'trades',      # Number of trades
        'vw': 'vwap'        # Volume-weighted average price
    }
    df = df.rename(columns=column_map)
    
    # Convert timestamp to datetime and set as index
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df = df.set_index('timestamp')
    
    # Keep only the columns we need for backtesting
    df = df[['open', 'high', 'low', 'close', 'volume']]
    
    print(f"✅ Fetched {len(df)} bars for {symbol}")
    
    return df


def get_multiple_symbols(
    symbols: List[str],
    start: Optional[str] = None,
    end: Optional[str] = None,
    timeframe: str = DEFAULT_TIMEFRAME
) -> dict:
    """
    Fetch historical data for multiple symbols.
    
    Useful when backtesting strategies that trade multiple stocks.
    
    Args:
        symbols: List of tickers (e.g., ["AAPL", "MSFT", "GOOGL"])
        start: Start date
        end: End date
        timeframe: Bar size
    
    Returns:
        Dictionary mapping symbol -> DataFrame
        
    Example:
        >>> data = get_multiple_symbols(["AAPL", "MSFT"])
        >>> aapl_data = data["AAPL"]
        >>> msft_data = data["MSFT"]
    """
    results = {}
    
    for symbol in symbols:
        try:
            results[symbol] = get_historical_data(symbol, start, end, timeframe)
        except Exception as e:
            print(f"⚠️ Failed to fetch {symbol}: {e}")
    
    return results


def get_spy_benchmark(
    start: Optional[str] = None,
    end: Optional[str] = None
) -> pd.DataFrame:
    """
    Fetch SPY data to use as a benchmark.
    
    SPY is the S&P 500 ETF — the most common benchmark for US stocks.
    We compare strategy performance against "just buying SPY" to see
    if our strategy adds value.
    
    Args:
        start: Start date
        end: End date
    
    Returns:
        DataFrame with SPY OHLCV data
    """
    return get_historical_data("SPY", start, end)


# =============================================================================
# HELPER: SAVE/LOAD DATA LOCALLY
# =============================================================================

def save_data(df: pd.DataFrame, symbol: str, directory: str = "cache") -> str:
    """
    Save fetched data to a CSV file for later use.
    
    Avoids hitting the API repeatedly for the same data.
    
    Args:
        df: DataFrame to save
        symbol: Stock symbol (used in filename)
        directory: Folder to save to
    
    Returns:
        Path to the saved file
    """
    from pathlib import Path
    
    cache_dir = Path(__file__).parent / directory
    cache_dir.mkdir(exist_ok=True)
    
    filepath = cache_dir / f"{symbol}.csv"
    df.to_csv(filepath)
    
    print(f"💾 Saved {symbol} data to {filepath}")
    return str(filepath)


def load_data(symbol: str, directory: str = "cache") -> pd.DataFrame:
    """
    Load previously saved data from CSV.
    
    Args:
        symbol: Stock symbol
        directory: Folder to load from
    
    Returns:
        DataFrame with OHLCV data
    """
    from pathlib import Path
    
    filepath = Path(__file__).parent / directory / f"{symbol}.csv"
    
    if not filepath.exists():
        raise FileNotFoundError(f"No cached data for {symbol}")
    
    df = pd.read_csv(filepath, index_col=0, parse_dates=True)
    print(f"📂 Loaded {symbol} data from cache ({len(df)} bars)")
    
    return df


# =============================================================================
# CLASS WRAPPER (for cleaner API in main.py)
# =============================================================================

class AlpacaDataFetcher:
    """
    Class-based wrapper for data fetching.
    
    Provides a clean interface for main.py and other modules.
    
    Example:
        fetcher = AlpacaDataFetcher(api_key, secret_key)
        data = fetcher.get_bars("AAPL", start="2023-01-01", end="2024-01-01")
    """
    
    def __init__(self, api_key: str, secret_key: str, data_url: str = None):
        """
        Initialize the fetcher with API credentials.
        
        Args:
            api_key: Alpaca API key ID
            secret_key: Alpaca API secret key
            data_url: Alpaca data API URL (optional, uses default)
        """
        self.api_key = api_key
        self.secret_key = secret_key
        self.data_url = data_url or ALPACA_DATA_URL or "https://data.alpaca.markets"
    
    def get_bars(
        self,
        symbol: str,
        start: str,
        end: str,
        timeframe: str = "1Day"
    ) -> pd.DataFrame:
        """
        Fetch historical bars for a symbol.
        
        Args:
            symbol: Stock ticker
            start: Start date "YYYY-MM-DD"
            end: End date "YYYY-MM-DD"
            timeframe: Bar size (default "1Day")
        
        Returns:
            DataFrame with OHLCV data
        """
        url = f"{self.data_url}/v2/stocks/{symbol}/bars"
        
        headers = {
            "APCA-API-KEY-ID": self.api_key,
            "APCA-API-SECRET-KEY": self.secret_key
        }
        
        params = {
            "start": f"{start}T00:00:00Z",
            "end": f"{end}T23:59:59Z",
            "timeframe": timeframe,
            "limit": 10000,
            "adjustment": "split"
        }
        
        response = requests.get(url, headers=headers, params=params)
        
        if response.status_code != 200:
            raise Exception(f"API Error {response.status_code}: {response.text}")
        
        data = response.json()
        bars = data.get("bars", [])
        
        if not bars:
            raise ValueError(f"No data returned for {symbol}")
        
        # Convert to DataFrame
        df = pd.DataFrame(bars)
        
        column_map = {
            't': 'timestamp',
            'o': 'open',
            'h': 'high',
            'l': 'low',
            'c': 'close',
            'v': 'volume',
        }
        df = df.rename(columns=column_map)
        
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        df = df.set_index('timestamp')
        df = df[['open', 'high', 'low', 'close', 'volume']]
        
        return df


if __name__ == "__main__":
    # Test the data fetcher
    print("=== Testing Data Fetcher ===\n")
    
    # Fetch some AAPL data
    try:
        data = get_historical_data(
            "AAPL", 
            start="2024-01-01", 
            end="2024-12-31"
        )
        
        print(f"\nData shape: {data.shape}")
        print(f"\nFirst 5 rows:")
        print(data.head())
        print(f"\nLast 5 rows:")
        print(data.tail())
        print(f"\nData types:")
        print(data.dtypes)
        
        print("\n✅ Data fetcher working!")
        
    except Exception as e:
        print(f"❌ Error: {e}")
