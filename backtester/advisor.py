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
import numpy as np
import pandas as pd
from data.universe import UniverseScreener, GROWTH_WATCHLIST
from data.market_data_provider import MarketDataProvider
from data.market_regime import MarketRegimeDetector, MarketRegime, MarketStatus
from data.fundamentals import FundamentalsFetcher
from data.risk_signals import RiskSignalFetcher
from indicators import rsi
from strategies.dip_buyer import DipBuyerStrategy, DIPBUYER_CONFIG


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
        self.risk_fetcher = RiskSignalFetcher()
        self.market_data = MarketDataProvider()
        
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

    def _analyze_dip_with_context(
        self,
        symbol: str,
        market: MarketStatus,
        risk_snapshot: Dict,
        quiet: bool = False,
    ) -> Dict:
        if not quiet:
            print(f"\n{'='*60}")
            print(f"📉 Dip Buyer Analysis: {symbol}")
            print(f"{'='*60}\n")

        try:
            hist_result = self.market_data.get_history(symbol, period="6mo")
            hist = hist_result.frame
        except Exception as e:
            return {'symbol': symbol, 'error': str(e)}

        if hist is None or hist.empty or len(hist) < 30:
            return {'symbol': symbol, 'error': 'Insufficient price data'}

        close = hist['Close']
        price = close.iloc[-1]

        rsi_values = rsi(close, DIPBUYER_CONFIG['quality']['rsi_period'])
        current_rsi = rsi_values.iloc[-1]

        fund = self.fundamentals.get_fundamentals(symbol)
        eps_growth = fund.get('eps_growth')
        rev_growth = fund.get('revenue_growth')

        cfg = DIPBUYER_CONFIG

        # Quality score
        if current_rsi <= cfg['quality']['rsi_strong']:
            rsi_score = 2
        elif current_rsi <= cfg['quality']['rsi_soft']:
            rsi_score = 1
        else:
            rsi_score = 0

        eps_score = 1 if eps_growth is not None and eps_growth >= cfg['quality']['eps_growth_min'] else 0
        rev_score = 1 if rev_growth is not None and rev_growth >= cfg['quality']['revenue_growth_min'] else 0
        q_score = rsi_score + eps_score + rev_score

        # Volatility / sentiment score
        vix = risk_snapshot.get('vix', np.nan)
        put_call = risk_snapshot.get('put_call', np.nan)
        fear = risk_snapshot.get('fear_greed', np.nan)

        vix_score = 0
        if vix == vix:
            if cfg['volatility']['vix_strong'][0] <= vix <= cfg['volatility']['vix_strong'][1]:
                vix_score = 2
            elif (cfg['volatility']['vix_soft'][0][0] <= vix < cfg['volatility']['vix_soft'][0][1]) or (
                cfg['volatility']['vix_soft'][1][0] < vix <= cfg['volatility']['vix_soft'][1][1]
            ):
                vix_score = 1

        put_call_score = 0
        if put_call == put_call and cfg['volatility']['put_call_range'][0] <= put_call <= cfg['volatility']['put_call_range'][1]:
            put_call_score = 1

        fear_score = 0
        if fear == fear and fear <= cfg['volatility']['fear_proxy_max']:
            fear_score = 1

        v_score = vix_score + put_call_score + fear_score

        # Credit score
        hy_spread = risk_snapshot.get('hy_spread', np.nan)
        hy_change_10d = risk_snapshot.get('hy_spread_change_10d', np.nan)

        credit_veto = False
        if hy_spread == hy_spread:
            if hy_spread < cfg['credit']['hy_spread_strong']:
                c_score = 4
            elif hy_spread < cfg['credit']['hy_spread_moderate']:
                c_score = 2
            elif hy_spread < cfg['credit']['hy_spread_weak']:
                c_score = 1
            else:
                c_score = 0
                credit_veto = True
        else:
            c_score = 0

        if hy_change_10d == hy_change_10d and hy_change_10d > cfg['credit']['spread_widening_bps']:
            c_score = max(c_score - 1, 0)

        total_score = q_score + v_score + c_score

        market_active = market.regime in [
            MarketRegime.CORRECTION,
            MarketRegime.UPTREND_UNDER_PRESSURE,
        ]

        if not market_active:
            recommendation = {
                'action': 'NO_BUY',
                'reason': 'Dip Buyer only active in corrections or pressured uptrends.',
            }
        elif credit_veto:
            recommendation = {
                'action': 'NO_BUY',
                'reason': 'Credit veto: HY spreads above 650 bps.',
            }
        elif total_score >= cfg['score_thresholds']['buy']:
            stop_loss_pct = cfg['exits']['hard_stop']
            stop_price = price * (1 - stop_loss_pct)

            max_exposure = cfg['risk']['max_exposure_correction']
            if market.regime == MarketRegime.UPTREND_UNDER_PRESSURE:
                max_exposure = cfg['risk']['max_exposure_under_pressure']

            recommendation = {
                'action': 'BUY',
                'entry': price,
                'stop_loss': stop_price,
                'stop_loss_pct': stop_loss_pct * 100,
                'position_size_pct': cfg['risk']['max_position_pct'] * 100,
                'max_exposure_pct': max_exposure * 100,
                'tranches': '1/3 now, 1/3 at -3%, 1/3 on breadth stabilization',
                'trim_targets': '+8%, +12%, trail runner',
                'score': total_score,
                'market_note': market.notes,
            }
        elif total_score >= cfg['score_thresholds']['watch']:
            recommendation = {
                'action': 'WATCH',
                'reason': f'Score {total_score}/12 below buy threshold.',
            }
        else:
            recommendation = {
                'action': 'NO_BUY',
                'reason': f'Score too low ({total_score}/12).',
            }

        return {
            'symbol': symbol,
            'price': price,
            'rsi': current_rsi,
            'fundamentals': fund,
            'scores': {
                'Q': q_score,
                'V': v_score,
                'C': c_score,
            },
            'total_score': total_score,
            'market_regime': market.regime.value,
            'data_source': hist_result.source,
            'data_staleness_seconds': hist_result.staleness_seconds,
            'data_status': hist_result.status,
            'recommendation': recommendation,
        }

    def analyze_dip_stock(self, symbol: str) -> Dict:
        """
        Dip Buyer analysis of a single stock.

        Returns:
            Dictionary with scores and recommendation
        """
        market = self.get_market_status()
        risk_snapshot = self.risk_fetcher.get_snapshot()
        return self._analyze_dip_with_context(symbol, market, risk_snapshot)

    def scan_dip_opportunities(
        self,
        quick: bool = False,
        min_score: int = 6,
    ) -> pd.DataFrame:
        """
        Scan the universe for Dip Buyer opportunities.

        Args:
            quick: Use watchlist only (faster)
            min_score: Minimum total score to include

        Returns:
            DataFrame of opportunities sorted by score
        """
        print("\n" + "="*60)
        print("🔍 SCANNING FOR DIP BUYER OPPORTUNITIES")
        print("="*60 + "\n")

        market = self.get_market_status(refresh=True)
        print(market)

        if market.regime not in [MarketRegime.CORRECTION, MarketRegime.UPTREND_UNDER_PRESSURE]:
            print("⚠️  Dip Buyer active only in corrections or pressured uptrends.")
            return pd.DataFrame()

        risk_snapshot = self.risk_fetcher.get_snapshot()

        if quick:
            symbols = GROWTH_WATCHLIST
        else:
            symbols = self.screener.get_universe()

        candidates = []
        for i, symbol in enumerate(symbols):
            if (i + 1) % 10 == 0:
                print(f"   Progress: {i + 1}/{len(symbols)}")

            analysis = self._analyze_dip_with_context(
                symbol,
                market,
                risk_snapshot,
                quiet=True,
            )

            if 'error' in analysis:
                continue

            if analysis.get('total_score', 0) < min_score:
                continue

            scores = analysis.get('scores', {})
            candidates.append({
                'symbol': symbol,
                'price': analysis.get('price'),
                'rsi': analysis.get('rsi'),
                'Q_score': scores.get('Q', 0),
                'V_score': scores.get('V', 0),
                'C_score': scores.get('C', 0),
                'total_score': analysis.get('total_score', 0),
            })

        if not candidates:
            return pd.DataFrame()

        df = pd.DataFrame(candidates)
        df = df.sort_values('total_score', ascending=False)
        return df
    
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
    
    def scan_dip_opportunities(
        self,
        quick: bool = False,
        min_score: int = 6,
    ) -> pd.DataFrame:
        """
        Scan for Dip Buyer candidates.

        Args:
            quick: Use watchlist only (faster)
            min_score: Minimum Dip Buyer score to include

        Returns:
            DataFrame of Dip Buyer opportunities sorted by score
        """
        print("\n" + "="*60)
        print("📉 SCANNING FOR DIP BUYER OPPORTUNITIES")
        print("="*60 + "\n")

        market = self.get_market_status(refresh=True)
        print(market)

        if market.regime not in [
            MarketRegime.CORRECTION,
            MarketRegime.UPTREND_UNDER_PRESSURE,
        ]:
            print("⚠️  Dip Buyer only active in correction / under-pressure regimes.")
            return pd.DataFrame()

        if quick:
            symbols = GROWTH_WATCHLIST
            results = self.screener.screen(symbols, min_technical_score=max(min_score - 3, 0))
        else:
            results = self.screener.screen(min_technical_score=max(min_score - 3, 0))

        if results.empty:
            print("No candidates found.")
            return results

        print("\n📊 Scoring candidates with Dip Buyer strategy...")

        enriched = []
        for _, row in results.head(20).iterrows():
            symbol = row['symbol']

            try:
                analysis = self.analyze_dip_stock(symbol)
                if 'error' in analysis:
                    continue

                rec = analysis.get('recommendation', {})
                row_dict = row.to_dict()
                row_dict['Q_score'] = analysis.get('quality_score', 0)
                row_dict['V_score'] = analysis.get('volatility_score', 0)
                row_dict['C_credit_score'] = analysis.get('credit_score', 0)
                row_dict['total_score'] = analysis.get('total_score', 0)
                row_dict['action'] = rec.get('action', 'NO_BUY')
                enriched.append(row_dict)

            except Exception as e:
                print(f"   ⚠️ Error scoring {symbol}: {e}")
                continue

        if not enriched:
            return pd.DataFrame()

        enriched_df = pd.DataFrame(enriched)
        enriched_df = enriched_df.sort_values('total_score', ascending=False)
        enriched_df = enriched_df[enriched_df['total_score'] >= min_score]

        return enriched_df

    def analyze_dip_stock(self, symbol: str) -> Dict:
        """
        Full Dip Buyer analysis of a single stock.

        Returns:
            Dictionary with Dip Buyer scores and recommendation
        """
        print(f"\n{'='*60}")
        print(f"📉 Analyzing {symbol} (Dip Buyer)")
        print(f"{'='*60}\n")

        strategy = DipBuyerStrategy()
        strategy.set_symbol(symbol)

        try:
            history_result = self.market_data.get_history(symbol, period='1y', auto_adjust=False)
            data = history_result.frame
        except Exception as e:
            return {'symbol': symbol, 'error': str(e)}
        if data is None or data.empty:
            return {'symbol': symbol, 'error': 'No price history available'}

        if 'Close' not in data.columns:
            return {'symbol': symbol, 'error': 'Close price not found in history'}

        strategy_data = pd.DataFrame(index=data.index)
        strategy_data['close'] = data['Close']

        try:
            strategy.generate_signals(strategy_data)
            scores = strategy.get_current_scores()
        except Exception as e:
            return {'symbol': symbol, 'error': f'Dip Buyer scoring failed: {e}'}

        if scores is None or scores.empty:
            return {'symbol': symbol, 'error': 'No Dip Buyer scores generated'}

        latest = scores.iloc[-1]

        market = self.get_market_status()
        risk_snapshot = self.risk_fetcher.get_snapshot()

        price = float(strategy_data['close'].iloc[-1])
        total_score = int(latest.get('Total', 0))
        quality_score = int(latest.get('Q', 0))
        volatility_score = int(latest.get('V', 0))
        credit_score = int(latest.get('C', 0))
        credit_veto = bool(latest.get('Credit_Veto', False))
        market_active = bool(latest.get('Market_Active', False))

        profile_name, profile_cfg = strategy.get_active_profile()
        score_buy_threshold = latest.get('Buy_Threshold', DIPBUYER_CONFIG['score_thresholds']['buy'])
        score_watch_threshold = latest.get('Watch_Threshold', DIPBUYER_CONFIG['score_thresholds']['watch'])
        buy_threshold = int(score_buy_threshold) if pd.notna(score_buy_threshold) else DIPBUYER_CONFIG['score_thresholds']['buy']
        watch_threshold = int(score_watch_threshold) if pd.notna(score_watch_threshold) else DIPBUYER_CONFIG['score_thresholds']['watch']

        profile_risk = profile_cfg.get('risk', {}) if isinstance(profile_cfg, dict) else {}
        stop_loss_pct = float(profile_risk.get('hard_stop', strategy.stop_loss_pct()))
        max_position_pct_cfg = float(profile_risk.get('max_position_pct', DIPBUYER_CONFIG['risk']['max_position_pct']))

        if credit_veto:
            recommendation = {
                'action': 'NO_BUY',
                'reason': 'Credit veto active (HY spread too high).',
            }
        elif not market_active:
            recommendation = {
                'action': 'NO_BUY',
                'reason': 'Dip Buyer inactive outside correction / under-pressure regimes.',
            }
        elif total_score >= buy_threshold:
            stop_price = price * (1 - stop_loss_pct)
            max_position_pct = max_position_pct_cfg * market.position_sizing

            recommendation = {
                'action': 'BUY',
                'entry': price,
                'stop_loss': stop_price,
                'stop_loss_pct': stop_loss_pct * 100,
                'position_size_pct': max_position_pct * 100,
                'score': total_score,
                'market_note': market.notes,
                'reasons': [
                    f"Quality score {quality_score}/4",
                    f"Sentiment score {volatility_score}/4",
                    f"Credit score {credit_score}/4",
                ],
            }
        elif total_score >= watch_threshold:
            recommendation = {
                'action': 'WATCH',
                'reason': f'Score {total_score}/12 in watch zone (need >= {buy_threshold} for BUY).',
            }
        else:
            recommendation = {
                'action': 'NO_BUY',
                'reason': f'Score too low ({total_score}/12). Need >= {watch_threshold} to WATCH.',
            }

        return {
            'symbol': symbol,
            'price': price,
            'fundamentals': strategy.fundamentals,
            'total_score': total_score,
            'quality_score': quality_score,
            'volatility_score': volatility_score,
            'credit_score': credit_score,
            'rsi': float(latest.get('RSI', np.nan)) if pd.notna(latest.get('RSI', np.nan)) else np.nan,
            'market_active': market_active,
            'credit_veto': credit_veto,
            'risk_snapshot': risk_snapshot,
            'market_regime': market.regime.value,
            'position_sizing': market.position_sizing,
            'profile': profile_name,
            'buy_threshold': buy_threshold,
            'watch_threshold': watch_threshold,
            'data_source': history_result.source,
            'data_staleness_seconds': history_result.staleness_seconds,
            'data_status': history_result.status,
            'recommendation': recommendation,
        }

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
