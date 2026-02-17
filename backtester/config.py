"""
Configuration file for the backtester.

Loads API keys and settings from files/environment.
Keeps sensitive data separate from code.
"""

import json
import os
from pathlib import Path


# =============================================================================
# FILE PATHS
# =============================================================================

# Base directory for services (where API keys are stored)
SERVICES_DIR = Path(os.path.expanduser("~/Desktop/services"))

# Path to Alpaca API keys
ALPACA_KEYS_FILE = SERVICES_DIR / "alpaca_keys.json"


# =============================================================================
# LOAD ALPACA CREDENTIALS
# =============================================================================

def load_alpaca_keys() -> dict:
    """
    Load Alpaca API keys from the JSON file.
    
    Returns:
        dict with keys: key_id, secret_key, base_url, data_url, environment
    
    Raises:
        FileNotFoundError: If alpaca_keys.json doesn't exist
        json.JSONDecodeError: If the file isn't valid JSON
    """
    if not ALPACA_KEYS_FILE.exists():
        raise FileNotFoundError(
            f"Alpaca keys not found at {ALPACA_KEYS_FILE}\n"
            "Create this file with your API credentials."
        )
    
    with open(ALPACA_KEYS_FILE, "r") as f:
        keys = json.load(f)
    
    # Validate required fields exist
    required_fields = ["key_id", "secret_key", "base_url"]
    for field in required_fields:
        if field not in keys:
            raise ValueError(f"Missing required field '{field}' in alpaca_keys.json")
    
    return keys


# Load keys at module import time (so other modules can use them)
# Wrapped in try/except so the module can still be imported for testing
try:
    ALPACA_KEYS = load_alpaca_keys()
    ALPACA_KEY_ID = ALPACA_KEYS["key_id"]
    ALPACA_SECRET_KEY = ALPACA_KEYS["secret_key"]
    ALPACA_BASE_URL = ALPACA_KEYS["base_url"]
    ALPACA_DATA_URL = ALPACA_KEYS.get("data_url", "https://data.alpaca.markets")
except FileNotFoundError:
    # Keys not found - will fail when actually trying to use them
    ALPACA_KEYS = None
    ALPACA_KEY_ID = None
    ALPACA_SECRET_KEY = None
    ALPACA_BASE_URL = None
    ALPACA_DATA_URL = None


# =============================================================================
# BACKTEST DEFAULTS
# =============================================================================

# Default starting cash for backtests
DEFAULT_INITIAL_CASH = 100_000  # $100,000

# Default commission per trade (Alpaca is commission-free for stocks)
DEFAULT_COMMISSION = 0.0

# Default slippage estimate (0.1% = 10 basis points)
# Slippage = difference between expected price and actual fill price
DEFAULT_SLIPPAGE = 0.001


# =============================================================================
# DATA SETTINGS
# =============================================================================

# Default timeframe for historical data
# Options: "1Min", "5Min", "15Min", "1Hour", "1Day"
DEFAULT_TIMEFRAME = "1Day"

# How many years of historical data to fetch by default
DEFAULT_LOOKBACK_YEARS = 3


if __name__ == "__main__":
    # Quick test - run this file directly to verify config loads
    print("=== Backtester Configuration ===")
    print(f"Services directory: {SERVICES_DIR}")
    print(f"Alpaca keys file: {ALPACA_KEYS_FILE}")
    
    if ALPACA_KEYS:
        print(f"Alpaca environment: {ALPACA_KEYS.get('environment', 'unknown')}")
        print(f"Alpaca base URL: {ALPACA_BASE_URL}")
        print("✅ Configuration loaded successfully!")
    else:
        print("❌ Alpaca keys not loaded")
