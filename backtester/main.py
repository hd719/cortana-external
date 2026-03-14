#!/usr/bin/env python3
"""
Backtester Main Entry Point

This is the main script that ties everything together.
Run this to backtest strategies against real market data.

Usage:
    python main.py                    # Run with defaults
    python main.py --symbol AAPL      # Test on specific stock
    python main.py --strategy momentum  # Run momentum strategy
    python main.py --years 3          # Test over 3 years of data

=============================================================================
WHAT THIS SCRIPT DOES
=============================================================================

1. Fetch historical price data from Alpaca
2. Run a trading strategy against that data
3. Calculate performance metrics
4. Print results

Think of it as a "test drive" for a trading strategy before you risk
real money.

=============================================================================
"""

import argparse
import sys

# Our modules
from data.market_data_provider import MarketDataProvider, MarketDataError
from strategies.momentum import MomentumStrategy, AggressiveMomentum, ConservativeMomentum
from backtest import Backtester, compare_strategies


def normalize_market_frame(frame):
    """Normalize provider-backed OHLCV data to the legacy backtester schema."""
    if frame is None or frame.empty:
        raise ValueError("No market data returned")

    renamed = frame.rename(
        columns={
            "Open": "open",
            "High": "high",
            "Low": "low",
            "Close": "close",
            "Volume": "volume",
        }
    )
    required = ["open", "high", "low", "close", "volume"]
    missing = [column for column in required if column not in renamed.columns]
    if missing:
        raise ValueError(f"Market data missing required columns: {', '.join(missing)}")
    return renamed[required].sort_index()


def load_backtest_data(
    *,
    symbol: str,
    benchmark: str | None,
    years: int,
    provider: MarketDataProvider | None = None,
):
    """Load primary and benchmark price history through the resilient provider path."""
    provider = provider or MarketDataProvider()
    period = f"{max(int(years), 1)}y"

    data_result = provider.get_history(symbol, period=period, auto_adjust=False)
    data = normalize_market_frame(data_result.frame)

    benchmark_data = None
    benchmark_result = None
    if benchmark:
        benchmark_result = provider.get_history(benchmark, period=period, auto_adjust=False)
        benchmark_data = normalize_market_frame(benchmark_result.frame)

    return {
        "data": data,
        "data_result": data_result,
        "benchmark_data": benchmark_data,
        "benchmark_result": benchmark_result,
    }


def main():
    """Main entry point."""
    
    # =========================================================================
    # Parse command line arguments
    # =========================================================================
    parser = argparse.ArgumentParser(
        description='Backtest trading strategies against historical data',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python main.py                           # Default: AAPL, 2 years, momentum
    python main.py --symbol NVDA             # Test on NVIDIA
    python main.py --symbol AAPL --years 5   # 5 years of AAPL data
    python main.py --strategy aggressive     # Use aggressive momentum
    python main.py --compare                 # Compare all strategies
        """
    )
    
    parser.add_argument(
        '--symbol', '-s',
        type=str,
        default='AAPL',
        help='Stock symbol to backtest (default: AAPL)'
    )
    
    parser.add_argument(
        '--years', '-y',
        type=int,
        default=2,
        help='Years of historical data (default: 2)'
    )
    
    parser.add_argument(
        '--strategy',
        type=str,
        choices=['momentum', 'aggressive', 'conservative'],
        default='momentum',
        help='Strategy to test (default: momentum)'
    )
    
    parser.add_argument(
        '--cash',
        type=float,
        default=10000,
        help='Initial cash for backtest (default: $10,000)'
    )
    
    parser.add_argument(
        '--compare',
        action='store_true',
        help='Compare all strategy variants'
    )
    
    parser.add_argument(
        '--benchmark',
        type=str,
        default='SPY',
        help='Benchmark symbol for comparison (default: SPY)'
    )
    
    args = parser.parse_args()
    
    print("="*60)
    print("🚀 BACKTESTER")
    print("="*60)
    print(f"Symbol:     {args.symbol}")
    print(f"Period:     {args.years} years")
    print(f"Cash:       ${args.cash:,.0f}")
    print(f"Benchmark:  {args.benchmark}")
    print("="*60)
    
    # =========================================================================
    # Fetch historical data
    # =========================================================================
    print(f"\n📊 Fetching historical data for {args.symbol}...")

    try:
        loaded = load_backtest_data(
            symbol=args.symbol,
            benchmark=args.benchmark,
            years=args.years,
        )
        data = loaded["data"]
        data_result = loaded["data_result"]
        benchmark_data = loaded["benchmark_data"]
        benchmark_result = loaded["benchmark_result"]
        print(f"   ✅ Loaded {len(data)} days of data")
        print(f"   📅 {data.index[0].strftime('%Y-%m-%d')} to {data.index[-1].strftime('%Y-%m-%d')}")
        print(f"   💰 Price range: ${data['close'].min():.2f} - ${data['close'].max():.2f}")
        print(f"   📡 Source: {data_result.source} ({data_result.status})")
        if data_result.degraded_reason:
            print(f"   ⚠️  {data_result.degraded_reason}")
    except (MarketDataError, ValueError) as e:
        print(f"   ❌ Error fetching data: {e}")
        sys.exit(1)

    if args.benchmark and benchmark_data is not None and benchmark_result is not None:
        print(f"\n📊 Fetching benchmark data ({args.benchmark})...")
        print(f"   ✅ Loaded {len(benchmark_data)} days")
        print(f"   📡 Source: {benchmark_result.source} ({benchmark_result.status})")
        if benchmark_result.degraded_reason:
            print(f"   ⚠️  {benchmark_result.degraded_reason}")
    
    # =========================================================================
    # Run backtest(s)
    # =========================================================================
    
    if args.compare:
        # Compare all strategy variants
        print("\n🔄 Comparing all momentum strategy variants...")
        
        strategies = [
            MomentumStrategy(),
            AggressiveMomentum(),
            ConservativeMomentum(),
        ]
        
        comparison = compare_strategies(strategies, data, initial_cash=args.cash)
        
        print("\n" + "="*70)
        print("STRATEGY COMPARISON")
        print("="*70)
        print(comparison.to_string(index=False))
        print("="*70)
        
        # Find the best strategy
        best_idx = comparison['Sharpe'].idxmax()
        best_name = comparison.loc[best_idx, 'Strategy']
        print(f"\n🏆 Best risk-adjusted performance: {best_name}")
        
    else:
        # Run single strategy
        strategy_map = {
            'momentum': MomentumStrategy(),
            'aggressive': AggressiveMomentum(),
            'conservative': ConservativeMomentum(),
        }
        
        strategy = strategy_map[args.strategy]
        print(f"\n🎯 Running {strategy.name}...")
        print(strategy.describe())
        
        # Create backtester and run
        backtester = Backtester(
            initial_cash=args.cash,
            commission=0.0,     # Alpaca is commission-free
            slippage=0.001,     # 0.1% slippage
        )
        
        result = backtester.run(strategy, data, benchmark=benchmark_data)
        
        # Print results
        print(result.metrics)
        
        # Show some trades
        if result.trades:
            result.print_trades(limit=5)
        
        # Performance interpretation
        print("\n" + "="*60)
        print("INTERPRETATION")
        print("="*60)
        
        metrics = result.metrics
        
        # Return assessment
        if metrics.total_return > 0:
            print(f"✅ Strategy made money: +{metrics.total_return:.1f}%")
        else:
            print(f"❌ Strategy lost money: {metrics.total_return:.1f}%")
        
        # Benchmark comparison
        if metrics.benchmark_return != 0:
            if metrics.excess_return > 0:
                print(f"✅ Beat benchmark by {metrics.excess_return:.1f}%")
            else:
                print(f"❌ Underperformed benchmark by {abs(metrics.excess_return):.1f}%")
        
        # Risk assessment
        if metrics.max_drawdown > -15:
            print(f"✅ Max drawdown acceptable: {metrics.max_drawdown:.1f}%")
        else:
            print(f"⚠️  Large max drawdown: {metrics.max_drawdown:.1f}%")
        
        # Sharpe assessment
        if metrics.sharpe_ratio >= 1.0:
            print(f"✅ Good risk-adjusted return (Sharpe: {metrics.sharpe_ratio:.2f})")
        elif metrics.sharpe_ratio > 0:
            print(f"⚠️  Mediocre risk-adjusted return (Sharpe: {metrics.sharpe_ratio:.2f})")
        else:
            print(f"❌ Poor risk-adjusted return (Sharpe: {metrics.sharpe_ratio:.2f})")
        
        # Trade quality
        if metrics.win_rate >= 50:
            print(f"✅ Win rate: {metrics.win_rate:.1f}%")
        else:
            print(f"⚠️  Low win rate: {metrics.win_rate:.1f}% (check avg win vs avg loss)")
        
        # Overall verdict
        print("\n" + "-"*60)
        passes = sum([
            metrics.total_return > 0,
            metrics.sharpe_ratio >= 0.5,
            metrics.max_drawdown > -20,
            metrics.win_rate >= 40,
        ])
        
        if passes >= 4:
            print("🟢 VERDICT: Strategy looks promising. Consider paper trading.")
        elif passes >= 2:
            print("🟡 VERDICT: Strategy needs refinement. Review parameters.")
        else:
            print("🔴 VERDICT: Strategy underperforming. Try different approach.")
    
    print("\n✅ Backtest complete!")


if __name__ == "__main__":
    main()
