#!/usr/bin/env python3
"""
Trading Advisor

The main interface for generating trade recommendations.
This is what Cortana uses to advise Hamel on trades.

=============================================================================
WHAT THIS DOES
=============================================================================

1. Checks market regime (M factor) — are we in a buyable market?
2. Screens universe for CANSLIM candidates
3. Scores candidates on fundamental + technical factors
4. Generates specific trade recommendations with:
   - Entry price
   - Stop loss
   - Position size
   - Reasoning

=============================================================================
USAGE
=============================================================================

    python advisor.py                    # Full scan + recommendations
    python advisor.py --quick            # Quick scan (watchlist only)
    python advisor.py --market           # Market status only
    python advisor.py --symbol NVDA      # Analyze specific stock

=============================================================================
"""

import argparse
import sys
from datetime import datetime
from typing import List, Dict, Optional
import pandas as pd

from data.universe import UniverseScreener, GROWTH_WATCHLIST
from data.market_regime import MarketRegimeDetector, MarketRegime, MarketStatus
from data.fundamentals import FundamentalsFetcher


class TradingAdvisor:
    """
    The main trading advisor class.
    
    Combines market regime detection, universe screening, and CANSLIM
    scoring to generate actionable trade recommendations.
    """
    
    def __init__(self):
        """Initialize the advisor components."""
        self.market_detector = MarketRegimeDetector()
        self.screener = UniverseScreener()
        self.fundamentals = FundamentalsFetcher()
        
        # Cache
        self._market_status: Optional[MarketStatus] = None
    
    def get_market_status(self, refresh: bool = False) -> MarketStatus:
        """Get current market regime status."""
        if self._market_status is None or refresh:
            self._market_status = self.market_detector.get_status()
        return self._market_status
    
    def analyze_stock(self, symbol: str) -> Dict:
        """
        Full CANSLIM analysis of a single stock.
        
        Returns:
            Dictionary with all scores and recommendation
        """
        print(f"\n{'='*60}")
        print(f"📊 Analyzing {symbol}")
        print(f"{'='*60}\n")
        
        # Get fundamentals
        fund = self.fundamentals.get_fundamentals(symbol)
        fund_scores = self.fundamentals.score_canslim_fundamentals(fund)
        
        # Get technicals
        tech = self.screener.calculate_technical_score(symbol)
        
        if 'error' in tech:
            return {'symbol': symbol, 'error': tech['error']}
        
        # Get market status
        market = self.get_market_status()
        
        # Calculate total score
        total_score = (
            fund_scores.get('C', 0) +
            fund_scores.get('A', 0) +
            fund_scores.get('I', 0) +
            fund_scores.get('S', 0) +
            tech.get('N_score', 0) +
            tech.get('L_score', 0)
        )
        
        # Generate recommendation
        recommendation = self._generate_recommendation(
            symbol=symbol,
            total_score=total_score,
            fund_scores=fund_scores,
            tech_scores=tech,
            market=market,
        )
        
        return {
            'symbol': symbol,
            'price': tech.get('price'),
            'fundamentals': fund,
            'fundamental_scores': fund_scores,
            'technical_scores': tech,
            'total_score': total_score,
            'market_regime': market.regime.value,
            'position_sizing': market.position_sizing,
            'recommendation': recommendation,
        }
    
    def _generate_recommendation(
        self,
        symbol: str,
        total_score: int,
        fund_scores: Dict,
        tech_scores: Dict,
        market: MarketStatus,
    ) -> Dict:
        """
        Generate a specific trade recommendation.
        
        Returns:
            Dict with action, entry, stop, size, reasoning
        """
        price = tech_scores.get('price', 0)
        pct_from_high = tech_scores.get('pct_from_high', 0)
        
        # Check if we should buy
        if market.regime == MarketRegime.CORRECTION:
            return {
                'action': 'NO_BUY',
                'reason': 'Market in correction. No new positions.',
            }
        
        if total_score < 7:
            return {
                'action': 'NO_BUY',
                'reason': f'Score too low ({total_score}/12). Need >= 7.',
            }
        
        if pct_from_high < 85:
            return {
                'action': 'WATCH',
                'reason': f'Stock {100 - pct_from_high:.1f}% below 52-week high. Wait for strength.',
            }
        
        # Calculate entry and stop
        stop_loss_pct = 0.08  # 8% trailing stop
        stop_price = price * (1 - stop_loss_pct)
        
        # Position sizing based on market regime
        base_size = 0.10  # 10% of portfolio per position
        adjusted_size = base_size * market.position_sizing
        
        # Build reasoning
        reasons = []
        
        if fund_scores.get('C', 0) >= 2:
            reasons.append(f"✅ Strong current earnings (C={fund_scores['C']})")
        if fund_scores.get('A', 0) >= 2:
            reasons.append(f"✅ Strong annual growth (A={fund_scores['A']})")
        if tech_scores.get('L_score', 0) >= 2:
            reasons.append(f"✅ Market leader (L={tech_scores['L_score']})")
        if tech_scores.get('N_score', 0) >= 2:
            reasons.append(f"✅ Near 52-week high (N={tech_scores['N_score']})")
        
        return {
            'action': 'BUY',
            'entry': price,
            'stop_loss': stop_price,
            'stop_loss_pct': stop_loss_pct * 100,
            'position_size_pct': adjusted_size * 100,
            'score': total_score,
            'reasons': reasons,
            'market_note': market.notes,
        }
    
    def scan_for_opportunities(
        self,
        quick: bool = False,
        min_score: int = 6,
    ) -> pd.DataFrame:
        """
        Scan the universe for trading opportunities.
        
        Args:
            quick: Use watchlist only (faster)
            min_score: Minimum technical score to include
        
        Returns:
            DataFrame of opportunities sorted by score
        """
        print("\n" + "="*60)
        print("🔍 SCANNING FOR OPPORTUNITIES")
        print("="*60 + "\n")
        
        # Check market first
        market = self.get_market_status(refresh=True)
        print(market)
        
        if market.regime == MarketRegime.CORRECTION:
            print("⚠️  Market in correction. Skipping scan.")
            return pd.DataFrame()
        
        # Run screen
        if quick:
            symbols = GROWTH_WATCHLIST
            results = self.screener.screen(symbols, min_technical_score=min_score - 2)
        else:
            results = self.screener.screen(min_technical_score=min_score - 2)
        
        if results.empty:
            print("No candidates found.")
            return results
        
        # Enrich with fundamental scores for top candidates
        print("\n📊 Enriching top candidates with fundamental data...")
        
        enriched = []
        for _, row in results.head(15).iterrows():
            symbol = row['symbol']
            
            try:
                fund = self.fundamentals.get_fundamentals(symbol)
                scores = self.fundamentals.score_canslim_fundamentals(fund)
                
                row_dict = row.to_dict()
                row_dict['C_score'] = scores.get('C', 0)
                row_dict['A_score'] = scores.get('A', 0)
                row_dict['I_score'] = scores.get('I', 0)
                row_dict['S_fund_score'] = scores.get('S', 0)
                row_dict['total_score'] = (
                    scores.get('C', 0) + scores.get('A', 0) +
                    scores.get('I', 0) + scores.get('S', 0) +
                    row.get('N_score', 0) + row.get('L_score', 0)
                )
                enriched.append(row_dict)
                
            except Exception as e:
                print(f"   ⚠️ Error enriching {symbol}: {e}")
                continue
        
        if not enriched:
            return results
        
        enriched_df = pd.DataFrame(enriched)
        enriched_df = enriched_df.sort_values('total_score', ascending=False)
        
        # Filter by minimum total score
        enriched_df = enriched_df[enriched_df['total_score'] >= min_score]
        
        return enriched_df
    
    def get_recommendations(self, limit: int = 5) -> List[Dict]:
        """
        Get top trade recommendations.
        
        This is the main method Cortana uses to advise Hamel.
        
        Returns:
            List of trade recommendation dictionaries
        """
        # Scan for opportunities
        candidates = self.scan_for_opportunities(quick=True, min_score=6)
        
        if candidates.empty:
            return []
        
        # Generate recommendations for top candidates
        recommendations = []
        
        for _, row in candidates.head(limit).iterrows():
            analysis = self.analyze_stock(row['symbol'])
            
            if analysis.get('recommendation', {}).get('action') == 'BUY':
                recommendations.append(analysis)
        
        return recommendations
    
    def print_recommendations(self, recommendations: List[Dict]):
        """Print recommendations in a nice format."""
        if not recommendations:
            print("\n📭 No buy recommendations at this time.")
            return
        
        print("\n" + "="*70)
        print("📈 TRADE RECOMMENDATIONS")
        print("="*70)
        
        for i, rec in enumerate(recommendations, 1):
            symbol = rec['symbol']
            r = rec['recommendation']
            
            print(f"""
{'─'*70}
#{i} {symbol} — SCORE: {rec['total_score']}/12

  Action: {r['action']}
  Entry:  ${r['entry']:.2f}
  Stop:   ${r['stop_loss']:.2f} ({r['stop_loss_pct']:.0f}% risk)
  Size:   {r['position_size_pct']:.0f}% of portfolio

  Reasons:
{chr(10).join('    ' + reason for reason in r['reasons'])}

  Market: {r['market_note']}
""")
        
        print("="*70)
        print("⚠️  These are recommendations only. Execute at your own discretion.")
        print("="*70)


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description='Trading Advisor')
    
    parser.add_argument('--quick', action='store_true',
                       help='Quick scan (watchlist only)')
    parser.add_argument('--market', action='store_true',
                       help='Show market status only')
    parser.add_argument('--symbol', '-s', type=str,
                       help='Analyze specific stock')
    parser.add_argument('--scan', action='store_true',
                       help='Full universe scan')
    
    args = parser.parse_args()
    
    advisor = TradingAdvisor()
    
    if args.market:
        # Market status only
        status = advisor.get_market_status()
        print(status)
        
        calendar = advisor.market_detector.get_distribution_calendar()
        if not calendar.empty:
            print("📉 Distribution Days:")
            print(calendar.to_string(index=False))
        
        return
    
    if args.symbol:
        # Analyze specific stock
        analysis = advisor.analyze_stock(args.symbol)
        
        print(f"\n📊 {args.symbol} Analysis")
        print(f"   Price: ${analysis.get('price', 0):.2f}")
        print(f"   Total Score: {analysis.get('total_score', 0)}/12")
        
        fs = analysis.get('fundamental_scores', {})
        ts = analysis.get('technical_scores', {})
        
        print(f"\n   Fundamental: C={fs.get('C',0)} A={fs.get('A',0)} I={fs.get('I',0)} S={fs.get('S',0)}")
        print(f"   Technical:   N={ts.get('N_score',0)} L={ts.get('L_score',0)} S={ts.get('S_score',0)}")
        
        rec = analysis.get('recommendation', {})
        print(f"\n   Recommendation: {rec.get('action', 'N/A')}")
        if rec.get('action') == 'BUY':
            print(f"   Entry: ${rec.get('entry', 0):.2f}")
            print(f"   Stop:  ${rec.get('stop_loss', 0):.2f}")
        else:
            print(f"   Reason: {rec.get('reason', 'N/A')}")
        
        return
    
    # Default: get recommendations
    recommendations = advisor.get_recommendations(limit=5)
    advisor.print_recommendations(recommendations)


if __name__ == "__main__":
    main()
