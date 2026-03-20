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
import importlib
import io
import inspect
import json
import logging
import os
import time
from contextlib import redirect_stderr, redirect_stdout
from datetime import UTC, datetime
from pathlib import Path
from typing import List, Dict, Optional
import pandas as pd
from data.confidence import (
    build_confidence_assessment,
    build_trade_quality_score,
    churn_penalty_proxy,
    downside_risk_proxy,
    regime_quality_modifier,
    risk_adjusted_size_multiplier,
)
from data.polymarket_context import load_symbol_context
from data.universe import (
    UniverseScreener,
    GROWTH_WATCHLIST,
    UNIVERSE_PROFILE_QUICK,
    UNIVERSE_PROFILE_STANDARD,
    UNIVERSE_PROFILE_NIGHTLY_DISCOVERY,
)
from data.market_data_provider import MarketDataProvider
from data.market_regime import MarketRegimeDetector, MarketRegime, MarketStatus
from data.fundamentals import FundamentalsFetcher
from data.risk_signals import RiskSignalFetcher
from data.wave2 import (
    HeadlineSentimentAnalyzer,
    build_sentiment_overlay,
    score_breakout_follow_through,
    score_exit_risk,
)
from data.wave3 import (
    SectorStrengthAnalyzer,
    build_position_sizing_guidance,
    score_catalyst_weighting,
)
from data.x_sentiment import XSentimentAnalyzer
from evaluation.comparison import (
    attach_model_family_scores,
    build_default_model_families,
    compare_model_families as evaluate_model_families,
    render_model_comparison_report,
    score_enhanced_rank,
)
from strategies.dip_buyer import DipBuyerStrategy

LOGGER = logging.getLogger(__name__)

CRYPTO_ALIAS_MAP = {
    "BTC": "BTC-USD",
    "ETH": "ETH-USD",
    "SOL": "SOL-USD",
}

CRYPTO_PROXY_SYMBOLS = {"COIN", "HOOD", "MSTR", "MARA", "RIOT", "CLSK", "BITO", "IBIT", "ETHA"}
ANALYSIS_PROFILE_DEFAULT = "default"
ANALYSIS_PROFILE_BULK_SCAN = "bulk_scan"
DEFAULT_OVERLAY_REGISTRY_PATH = Path(__file__).parent / "data" / "overlay_registry.json"
DEFAULT_OVERLAY_PROMOTION_STATE_PATH = Path(__file__).parent / "data" / "cache" / "overlay-promotion-state.json"


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
        self.headline_sentiment = HeadlineSentimentAnalyzer()
        self.x_sentiment = XSentimentAnalyzer()
        self.sector_strength = SectorStrengthAnalyzer(self.market_data)
        self.enable_timing = os.getenv("BACKTESTER_TIMING", "0") not in {"", "0", "false", "False"}
        
        # Cache
        self._market_status: Optional[MarketStatus] = None
        self._candidate_context_by_symbol: Dict[str, Dict] = {}
    
    def get_market_status(self, refresh: bool = False) -> MarketStatus:
        """Get current market regime status."""
        if self._market_status is None or refresh:
            self._market_status = self.market_detector.get_status()
        return self._market_status
    
    def _calculate_technical_score_from_history(self, symbol: str, hist: pd.DataFrame) -> Dict:
        """Reuse provider-backed history so Wave 2 analysis does not trigger another price fetch."""
        if hist is None or hist.empty or len(hist) < 50:
            return {'symbol': symbol, 'error': 'Insufficient data'}

        close = pd.to_numeric(hist['Close'], errors='coerce')
        volume = pd.to_numeric(hist['Volume'], errors='coerce')
        current = float(close.iloc[-1])
        high_52w = float(close.max())
        pct_from_high = current / high_52w if high_52w > 0 else 0.0

        if pct_from_high >= 0.95:
            n_score = 2
        elif pct_from_high >= 0.90:
            n_score = 1
        else:
            n_score = 0

        if len(close) >= 126:
            momentum_6m = (current / float(close.iloc[-126]) - 1) * 100
        else:
            momentum_6m = (current / float(close.iloc[0]) - 1) * 100

        if momentum_6m >= 25:
            l_score = 2
        elif momentum_6m >= 10:
            l_score = 1
        else:
            l_score = 0

        daily_return = close.pct_change()
        up_days = daily_return > 0
        avg_up_volume = float(volume[up_days].mean()) if up_days.any() else 0.0
        avg_down_volume = float(volume[~up_days].mean()) if (~up_days).any() else 1.0
        vol_ratio = avg_up_volume / avg_down_volume if avg_down_volume > 0 else 0.0

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
            'price_history': close,
            'N_score': n_score,
            'L_score': l_score,
            'S_score': s_score,
            'technical_score': n_score + l_score + s_score,
        }

    @staticmethod
    def _rank_score(
        total_score: int,
        breakout_score: int,
        sentiment_score: int,
        exit_risk_score: int,
        sector_score: int = 0,
        catalyst_score: int = 0,
    ) -> float:
        return score_enhanced_rank(
            total_score,
            breakout_score,
            sentiment_score,
            exit_risk_score,
            sector_score=sector_score,
            catalyst_score=catalyst_score,
        )

    @staticmethod
    def _build_canslim_trade_quality(
        *,
        market: MarketStatus,
        rank_score: float,
        confidence_assessment: Dict,
        exit_risk: Dict,
        price_history: Optional[pd.Series] = None,
    ) -> Dict:
        churn_proxy = churn_penalty_proxy(exit_risk_score=(exit_risk or {}).get('score', 0))
        downside_proxy = downside_risk_proxy(price_history)
        adverse_regime = dict((confidence_assessment or {}).get('adverse_regime', {}) or {})
        return build_trade_quality_score(
            raw_setup_score=rank_score,
            setup_scale=16,
            confidence_pct=confidence_assessment.get('raw_confidence_pct', confidence_assessment.get('effective_confidence_pct', 0)),
            uncertainty_pct=confidence_assessment.get('uncertainty_pct', 0),
            regime_modifier=regime_quality_modifier(market=market),
            cost_penalty=round(churn_proxy['penalty'] * 0.5, 2),
            cost_penalty_reason='exit_risk_score proxy',
            downside_penalty=downside_proxy['penalty'],
            downside_penalty_reason=downside_proxy['source'],
            churn_penalty=round(churn_proxy['penalty'] * 0.5, 2),
            churn_penalty_reason=churn_proxy['reason'],
            adverse_regime_penalty=adverse_regime.get('trade_quality_penalty', 0.0),
            adverse_regime_reason=adverse_regime.get('reason', ''),
        )

    @staticmethod
    def _build_dip_trade_quality(
        *,
        market: MarketStatus,
        total_score: float,
        confidence_assessment: Dict,
        recovery_ready: bool,
        falling_knife: bool,
        price_history: Optional[pd.Series] = None,
    ) -> Dict:
        churn_proxy = churn_penalty_proxy(recovery_ready=recovery_ready, falling_knife=falling_knife)
        downside_proxy = downside_risk_proxy(price_history)
        adverse_regime = dict((confidence_assessment or {}).get('adverse_regime', {}) or {})
        return build_trade_quality_score(
            raw_setup_score=total_score,
            setup_scale=12,
            confidence_pct=confidence_assessment.get('raw_confidence_pct', confidence_assessment.get('effective_confidence_pct', 0)),
            uncertainty_pct=confidence_assessment.get('uncertainty_pct', 0),
            regime_modifier=regime_quality_modifier(market=market),
            cost_penalty=round(churn_proxy['penalty'] * 0.5, 2),
            cost_penalty_reason='recovery_ready/falling_knife proxy',
            downside_penalty=downside_proxy['penalty'],
            downside_penalty_reason=downside_proxy['source'],
            churn_penalty=round(churn_proxy['penalty'] * 0.5, 2),
            churn_penalty_reason=churn_proxy['reason'],
            adverse_regime_penalty=adverse_regime.get('trade_quality_penalty', 0.0),
            adverse_regime_reason=adverse_regime.get('reason', ''),
        )

    @staticmethod
    def _action_priority(action: object) -> int:
        return {
            'BUY': 0,
            'WATCH': 1,
            'NO_BUY': 2,
        }.get(str(action or '').upper(), 3)

    @classmethod
    def _sort_runtime_candidates(
        cls,
        frame: pd.DataFrame,
        *,
        primary_desc_columns: List[str],
    ) -> pd.DataFrame:
        if frame is None or frame.empty:
            return pd.DataFrame() if frame is None else frame

        ordered = frame.copy()
        action_series = ordered['action'] if 'action' in ordered.columns else pd.Series('', index=ordered.index, dtype=object)
        abstain_series = ordered['abstain'] if 'abstain' in ordered.columns else pd.Series(False, index=ordered.index, dtype=bool)
        ordered['_action_priority'] = action_series.map(cls._action_priority)
        ordered['_abstain_priority'] = pd.to_numeric(abstain_series, errors='coerce').fillna(0).astype(int)

        sort_columns = ['_action_priority', '_abstain_priority']
        ascending = [True, True]

        for column in primary_desc_columns:
            if column in ordered.columns and column not in sort_columns:
                sort_columns.append(column)
                ascending.append(False)

        for column, column_ascending in (
            ('trade_quality_score', False),
            ('downside_penalty', True),
            ('churn_penalty', True),
            ('effective_confidence', False),
            ('confidence', False),
            ('uncertainty_pct', True),
            ('position_size_pct', False),
            ('total_score', False),
            ('symbol', True),
        ):
            if column in ordered.columns and column not in sort_columns:
                sort_columns.append(column)
                ascending.append(column_ascending)

        ordered = ordered.sort_values(sort_columns, ascending=ascending, kind='mergesort')
        return ordered.drop(columns=['_action_priority', '_abstain_priority'])

    def analyze_stock(
        self,
        symbol: str,
        quiet: bool = False,
        analysis_profile: str = ANALYSIS_PROFILE_DEFAULT,
    ) -> Dict:
        """
        Full CANSLIM analysis of a single stock.
        
        Returns:
            Dictionary with all scores and recommendation
        """
        if not quiet:
            print(f"\n{'='*60}")
            print(f"📊 Analyzing {symbol}")
            print(f"{'='*60}\n")

        timings: Dict[str, float] = {}

        def _time_block(label: str, fn):
            start = time.perf_counter()
            result = fn()
            if self.enable_timing:
                timings[label] = round(time.perf_counter() - start, 4)
            return result

        include_x_sentiment = analysis_profile != ANALYSIS_PROFILE_BULK_SCAN

        try:
            history_result = _time_block(
                "history",
                lambda: self.market_data.get_history(symbol, period='1y', auto_adjust=False),
            )
            hist = history_result.frame
        except Exception as e:
            return {'symbol': symbol, 'error': str(e)}
        
        # Get fundamentals
        fund = _time_block("fundamentals", lambda: self.fundamentals.get_fundamentals(symbol))
        fund_scores = _time_block("fundamental_scores", lambda: self.fundamentals.score_canslim_fundamentals(fund))
        candidate_context = self._candidate_context_by_symbol.get(symbol, {})
        sector_name = candidate_context.get("sector") or fund.get("sector")
        
        # Get technicals
        tech = _time_block("technicals", lambda: self._calculate_technical_score_from_history(symbol, hist))
        
        if 'error' in tech:
            return {'symbol': symbol, 'error': tech['error']}
        
        # Get market status
        market = _time_block("market_status", lambda: self.get_market_status())
        breakout = _time_block("breakout", lambda: score_breakout_follow_through(hist))
        sentiment_overlay = _time_block(
            "sentiment",
            lambda: build_sentiment_overlay(
                symbol,
                headline_analyzer=self.headline_sentiment,
                x_analyzer=self.x_sentiment if include_x_sentiment else None,
            ),
        )
        exit_risk = _time_block("exit_risk", lambda: score_exit_risk(hist, breakout))
        sector_context = _time_block("sector", lambda: self.sector_strength.analyze(hist, sector_name))
        catalyst_weighting = _time_block(
            "catalyst",
            lambda: score_catalyst_weighting(
                fund.get("earnings_event_window"),
                sentiment_overlay=sentiment_overlay,
                breakout=breakout,
            ),
        )
        
        # Calculate total score
        total_score = (
            fund_scores.get('C', 0) +
            fund_scores.get('A', 0) +
            fund_scores.get('I', 0) +
            fund_scores.get('S', 0) +
            tech.get('N_score', 0) +
            tech.get('L_score', 0)
        )
        confidence_assessment = _time_block(
            "confidence",
            lambda: build_confidence_assessment(
                market=market,
                total_score=total_score,
                breakout=breakout,
                sentiment_overlay=sentiment_overlay,
                exit_risk=exit_risk,
                sector_context=sector_context,
                catalyst_weighting=catalyst_weighting,
                data_status=history_result.status,
                data_staleness_seconds=history_result.staleness_seconds,
                history_bars=len(hist),
                symbol=symbol,
            ),
        )
        confidence = int(confidence_assessment["effective_confidence_pct"])
        rank_score = self._rank_score(
            total_score,
            breakout.get('score', 0),
            sentiment_overlay.get('score', 0),
            exit_risk.get('score', 0),
            sector_context.get('score', 0),
            catalyst_weighting.get('score', 0),
        )
        
        # Generate recommendation
        trade_quality = _time_block(
            "trade_quality",
            lambda: self._build_canslim_trade_quality(
                market=market,
                rank_score=rank_score,
                confidence_assessment=confidence_assessment,
                exit_risk=exit_risk,
                price_history=hist['Close'],
            ),
        )

        recommendation = _time_block(
            "recommendation",
            lambda: self._generate_recommendation(
                symbol=symbol,
                total_score=total_score,
                fund_scores=fund_scores,
                tech_scores=tech,
                market=market,
                breakout=breakout,
                sentiment_overlay=sentiment_overlay,
                exit_risk=exit_risk,
                sector_context=sector_context,
                catalyst_weighting=catalyst_weighting,
                confidence_assessment=confidence_assessment,
                rank_score=rank_score,
            ),
        )
        
        return {
            'symbol': symbol,
            'price': tech.get('price'),
            'fundamentals': fund,
            'fundamental_scores': fund_scores,
            'technical_scores': tech,
            'total_score': total_score,
            'rank_score': rank_score,
            'market_regime': market.regime.value,
            'position_sizing': market.position_sizing,
            'breakout_follow_through': breakout,
            'sentiment_overlay': sentiment_overlay,
            'exit_risk': exit_risk,
            'sector_context': sector_context,
            'catalyst_weighting': catalyst_weighting,
            'confidence': confidence,
            'raw_confidence': confidence_assessment["raw_confidence_pct"],
            'effective_confidence': confidence,
            'uncertainty_pct': confidence_assessment["uncertainty_pct"],
            'abstain': confidence_assessment["abstain"],
            'abstain_reason_codes': confidence_assessment["abstain_reason_codes"],
            'abstain_reasons': confidence_assessment["abstain_reasons"],
            'confidence_assessment': confidence_assessment,
            'trade_quality_score': trade_quality['score'],
            'trade_quality': trade_quality,
            'downside_penalty': trade_quality.get('downside_penalty', 0.0),
            'churn_penalty': trade_quality.get('churn_penalty', 0.0),
            'adverse_regime': confidence_assessment.get('adverse_regime', {}),
            'data_source': history_result.source,
            'data_staleness_seconds': history_result.staleness_seconds,
            'data_status': history_result.status,
            'analysis_profile': analysis_profile,
            'timing': timings if self.enable_timing else {},
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

        strategy = DipBuyerStrategy()
        strategy.set_symbol(symbol)
        strategy_data = pd.DataFrame({'close': hist['Close']}, index=hist.index)
        setup = strategy.evaluate_setup(
            strategy_data,
            market=market,
            risk_snapshot=risk_snapshot,
            data_status=hist_result.status,
            data_staleness_seconds=hist_result.staleness_seconds,
        )
        scores = setup.get('scores', {})

        return {
            'symbol': symbol,
            'price': setup.get('price'),
            'rsi': setup.get('rsi'),
            'fundamentals': strategy.fundamentals,
            'scores': scores,
            'quality_score': scores.get('Q', 0),
            'volatility_score': scores.get('V', 0),
            'credit_score': scores.get('C', 0),
            'total_score': setup.get('total_score', 0),
            'market_regime': market.regime.value,
            'data_source': hist_result.source,
            'data_staleness_seconds': hist_result.staleness_seconds,
            'data_status': hist_result.status,
            'market_active': setup.get('market_active'),
            'credit_veto': setup.get('credit_veto'),
            'recovery_ready': setup.get('recovery_ready'),
            'falling_knife': setup.get('falling_knife'),
            'pullback_pct': setup.get('pullback_pct'),
            'rebound_pct': setup.get('rebound_pct'),
            'five_day_return_pct': setup.get('five_day_return_pct'),
            'profile': setup.get('profile'),
            'buy_threshold': setup.get('buy_threshold'),
            'watch_threshold': setup.get('watch_threshold'),
            'confidence': setup.get('confidence', 0),
            'raw_confidence': setup.get('raw_confidence', 0),
            'effective_confidence': setup.get('effective_confidence', setup.get('confidence', 0)),
            'uncertainty_pct': setup.get('uncertainty_pct', 0),
            'abstain': setup.get('abstain', False),
            'abstain_reason_codes': setup.get('abstain_reason_codes', []),
            'abstain_reasons': setup.get('abstain_reasons', []),
            'confidence_assessment': setup.get('confidence_assessment', {}),
            'trade_quality_score': setup.get('trade_quality_score', setup.get('recommendation', {}).get('trade_quality_score', 0.0)),
            'trade_quality': setup.get('trade_quality', setup.get('recommendation', {}).get('trade_quality', {})),
            'downside_penalty': setup.get('trade_quality', setup.get('recommendation', {}).get('trade_quality', {})).get('downside_penalty', 0.0),
            'churn_penalty': setup.get('trade_quality', setup.get('recommendation', {}).get('trade_quality', {})).get('churn_penalty', 0.0),
            'adverse_regime': setup.get('adverse_regime', setup.get('confidence_assessment', {}).get('adverse_regime', {})),
            'recommendation': setup.get('recommendation', {}),
        }

    def analyze_dip_stock(self, symbol: str, quiet: bool = False) -> Dict:
        """
        Dip Buyer analysis of a single stock.

        Returns:
            Dictionary with scores and recommendation
        """
        market = self.get_market_status()
        risk_snapshot = self.risk_fetcher.get_snapshot()
        return self._analyze_dip_with_context(symbol, market, risk_snapshot, quiet=quiet)

    @staticmethod
    def _normalize_quick_check_symbol(symbol: str) -> Dict[str, str]:
        raw = str(symbol or "").strip().upper()
        if raw.endswith("-USD"):
            base = raw[:-4]
            if base in CRYPTO_ALIAS_MAP:
                return {
                    "input_symbol": raw,
                    "display_symbol": base,
                    "provider_symbol": raw,
                    "asset_class": "crypto",
                }

        if raw in CRYPTO_ALIAS_MAP:
            return {
                "input_symbol": raw,
                "display_symbol": raw,
                "provider_symbol": CRYPTO_ALIAS_MAP[raw],
                "asset_class": "crypto",
            }

        if raw in CRYPTO_PROXY_SYMBOLS:
            return {
                "input_symbol": raw,
                "display_symbol": raw,
                "provider_symbol": raw,
                "asset_class": "crypto_proxy",
            }

        return {
            "input_symbol": raw,
            "display_symbol": raw,
            "provider_symbol": raw,
            "asset_class": "stock",
        }

    @staticmethod
    def _overlay_as_dict(payload: object) -> Dict:
        if isinstance(payload, dict):
            return dict(payload)
        as_dict = getattr(payload, "as_dict", None)
        if callable(as_dict):
            converted = as_dict()
            if isinstance(converted, dict):
                return dict(converted)
        raw = getattr(payload, "__dict__", None)
        if isinstance(raw, dict):
            return dict(raw)
        return {}

    @classmethod
    def _call_optional_overlay_builder(
        cls,
        *,
        modules: List[str],
        function_names: List[str],
        kwargs: Dict[str, object],
    ) -> Dict:
        for module_name in modules:
            try:
                module = importlib.import_module(module_name)
            except Exception:
                continue
            for function_name in function_names:
                builder = getattr(module, function_name, None)
                if not callable(builder):
                    continue
                try:
                    signature = inspect.signature(builder)
                    accepted = {
                        key: value
                        for key, value in kwargs.items()
                        if key in signature.parameters and value is not None
                    }
                    return cls._overlay_as_dict(builder(**accepted))
                except Exception:
                    try:
                        return cls._overlay_as_dict(builder(kwargs.get("market")))
                    except Exception:
                        continue
        return {}

    def _load_context_overlays(
        self,
        *,
        market: Optional[MarketStatus],
        risk_snapshot: Dict,
        symbol: str,
        selected_symbols: Optional[list[str]] = None,
        analysis: Dict,
    ) -> Dict[str, Dict]:
        risk_overlay = self._overlay_as_dict(
            analysis.get("risk_budget_overlay") or analysis.get("risk_budget")
        )
        execution_overlay = self._overlay_as_dict(
            analysis.get("execution_quality_overlay")
            or analysis.get("liquidity_overlay")
            or analysis.get("execution_quality")
        )

        payload = {
            "market": market,
            "risk_inputs": risk_snapshot,
            "risk_snapshot": risk_snapshot,
            "symbol": symbol,
            "symbols": selected_symbols or [symbol] if symbol else [],
            "analysis": analysis,
        }
        if not risk_overlay and market is not None:
            risk_overlay = self._call_optional_overlay_builder(
                modules=["data.risk_budget"],
                function_names=["build_risk_budget_overlay", "build_risk_budget", "compute_risk_budget_overlay"],
                kwargs=payload,
            )
        if not execution_overlay:
            execution_overlay = self._call_optional_overlay_builder(
                modules=["data.execution_quality", "data.liquidity_overlay", "data.execution_overlay"],
                function_names=["build_execution_quality_overlay", "build_liquidity_overlay", "build_execution_overlay"],
                kwargs=payload,
            )
        return {
            "risk_budget_overlay": risk_overlay,
            "execution_quality_overlay": execution_overlay,
        }

    @staticmethod
    def _load_json_file(path: Path) -> Optional[Dict]:
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return None
        return payload if isinstance(payload, dict) else None

    @staticmethod
    def _lookup_overlay_entry(payload: Dict, overlay_name: str) -> Optional[Dict]:
        overlays = payload.get("overlays")
        if isinstance(overlays, dict):
            entry = overlays.get(overlay_name)
            return entry if isinstance(entry, dict) else None
        if isinstance(overlays, list):
            for entry in overlays:
                if not isinstance(entry, dict):
                    continue
                name = str(entry.get("name") or entry.get("overlay") or "").strip().lower()
                if name == overlay_name:
                    return entry
        return None

    @staticmethod
    def _age_hours(iso_timestamp: object) -> Optional[float]:
        if not isinstance(iso_timestamp, str) or not iso_timestamp.strip():
            return None
        try:
            parsed = datetime.fromisoformat(iso_timestamp)
        except Exception:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return max((datetime.now(UTC) - parsed).total_seconds(), 0.0) / 3600.0

    def _load_overlay_promotion_context(self) -> Dict:
        registry_path = Path(
            os.getenv("TRADING_OVERLAY_REGISTRY_PATH") or DEFAULT_OVERLAY_REGISTRY_PATH
        ).expanduser()
        state_path = Path(
            os.getenv("TRADING_OVERLAY_PROMOTION_STATE_PATH") or DEFAULT_OVERLAY_PROMOTION_STATE_PATH
        ).expanduser()
        max_age_hours = float(os.getenv("TRADING_OVERLAY_PROMOTION_MAX_AGE_HOURS", "36"))

        registry = self._load_json_file(registry_path)
        state = self._load_json_file(state_path)
        if not registry or not state:
            return {"source": "unavailable", "overlays": {}}

        age_hours = self._age_hours(state.get("generated_at"))
        if age_hours is None or age_hours > max_age_hours:
            return {"source": "stale", "overlays": {}}

        out: Dict[str, Dict] = {}
        for overlay_name in ("execution_quality", "liquidity_tier", "risk_budget_state"):
            registry_entry = self._lookup_overlay_entry(registry, overlay_name) or {}
            state_entry = self._lookup_overlay_entry(state, overlay_name) or {}
            stage = str(
                state_entry.get("stage")
                or registry_entry.get("stage")
                or "logged"
            ).strip().lower()
            allowlisted = bool(
                state_entry.get("allow_rank_modifier")
                if "allow_rank_modifier" in state_entry
                else (
                    state_entry.get("rank_modifier_eligible")
                    if "rank_modifier_eligible" in state_entry
                    else (
                        registry_entry.get("allow_rank_modifier")
                        if "allow_rank_modifier" in registry_entry
                        else registry_entry.get("rank_modifier_eligible", False)
                    )
                )
            )
            cap_pct = state_entry.get("max_effect_pct")
            if cap_pct is None:
                cap_pct = registry_entry.get("max_effect_pct")
            if cap_pct is None:
                modifier_bounds = state_entry.get("modifier_bounds")
                if isinstance(modifier_bounds, dict):
                    cap_pct = modifier_bounds.get("max")
            if cap_pct is None:
                modifier_bounds = registry_entry.get("modifier_bounds")
                if isinstance(modifier_bounds, dict):
                    cap_pct = modifier_bounds.get("max")
            try:
                cap_value = float(cap_pct)
            except (TypeError, ValueError):
                cap_value = 0.05
            out[overlay_name] = {
                "stage": stage,
                "allow_rank_modifier": allowlisted,
                "max_effect_pct": max(0.01, min(cap_value, 0.05)),
            }

        return {"source": "promotion_state", "overlays": out}

    @staticmethod
    def _format_overlay_pct(value: object) -> str:
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            return ""
        if numeric != numeric:
            return ""
        if numeric <= 1.0:
            numeric *= 100.0
        return f"{numeric:.0f}%"

    @classmethod
    def _compact_risk_budget_line(cls, overlay: Dict) -> str:
        if not overlay:
            return ""

        remaining = cls._format_overlay_pct(overlay.get("risk_budget_remaining"))
        cap = cls._format_overlay_pct(overlay.get("exposure_cap_hint"))
        aggression = str(
            overlay.get("aggression_dial")
            or overlay.get("aggression")
            or overlay.get("posture")
            or ""
        ).strip()
        reasons = overlay.get("reasons") if isinstance(overlay.get("reasons"), (list, tuple)) else []
        reason_note = str(reasons[0]).strip() if reasons else ""
        if not (remaining or cap or aggression or reason_note):
            return ""

        bits = []
        if remaining:
            bits.append(f"remaining {remaining}")
        if cap:
            bits.append(f"cap {cap}")
        if aggression:
            bits.append(f"aggression {aggression.replace('_', ' ')}")
        if reason_note:
            bits.append(f"note {reason_note[:72]}")
        return "Risk budget: " + " | ".join(bits)

    @classmethod
    def _compact_execution_quality_line(cls, overlay: Dict) -> str:
        if not overlay:
            return ""

        quality = str(
            overlay.get("execution_quality")
            or overlay.get("quality_label")
            or overlay.get("liquidity_quality")
            or ""
        ).strip()
        liquidity = str(
            overlay.get("liquidity_posture")
            or overlay.get("liquidity_label")
            or overlay.get("liquidity")
            or ""
        ).strip()
        slippage = str(
            overlay.get("slippage_risk")
            or overlay.get("slippage_label")
            or overlay.get("slippage_band")
            or ""
        ).strip()
        annotation = str(
            overlay.get("annotation")
            or overlay.get("summary")
            or overlay.get("note")
            or ""
        ).strip()
        if not (quality or liquidity or slippage or annotation):
            return ""

        bits = []
        if quality:
            bits.append(f"quality {quality.replace('_', ' ')}")
        if liquidity:
            bits.append(f"liquidity {liquidity.replace('_', ' ')}")
        if slippage:
            bits.append(f"slippage {slippage.replace('_', ' ')}")
        if annotation:
            bits.append(annotation[:72])
        return "Execution quality: " + " | ".join(bits)

    @staticmethod
    def _compact_overlay_promotion_line(promotion: Dict) -> str:
        if not isinstance(promotion, dict):
            return ""
        overlays = promotion.get("overlays")
        if not isinstance(overlays, dict) or not overlays:
            return ""

        segments: List[str] = []
        for name in ("execution_quality", "liquidity_tier"):
            entry = overlays.get(name)
            if not isinstance(entry, dict):
                continue
            stage = str(entry.get("stage", "logged")).strip().lower() or "logged"
            allowlisted = bool(entry.get("allow_rank_modifier", False))
            cap_pct = entry.get("max_effect_pct")
            try:
                cap_pct_value = float(cap_pct)
            except (TypeError, ValueError):
                cap_pct_value = 0.05
            if stage == "rank_modifier" and allowlisted:
                segments.append(f"{name.replace('_', ' ')} rank active (cap {cap_pct_value * 100:.0f}%)")
            else:
                segments.append(f"{name.replace('_', ' ')} {stage}")

        if not segments:
            return ""
        return "Overlay promotion: " + " | ".join(segments)

    def quick_check(self, symbol: str) -> Dict:
        target = self._normalize_quick_check_symbol(symbol)
        display_symbol = target["display_symbol"]
        provider_symbol = target["provider_symbol"]
        asset_class = target["asset_class"]
        polymarket = load_symbol_context(display_symbol)
        market = self.get_market_status()
        risk_snapshot: Dict = {}
        try:
            snapshot = self.risk_fetcher.get_snapshot()
            if isinstance(snapshot, dict):
                risk_snapshot = snapshot
        except Exception:
            risk_snapshot = {}

        if asset_class == "crypto":
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                analysis = self.analyze_dip_stock(provider_symbol, quiet=True)
            path = "dip_buyer"
            verdict, reason = self._quick_check_dip_verdict(analysis)
        else:
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                analysis = self.analyze_stock(provider_symbol, quiet=True)
            path = "canslim"
            verdict, reason = self._quick_check_stock_verdict(analysis)

        verdict, modifier = self._apply_polymarket_quick_check_overlay(
            verdict=verdict,
            asset_class=asset_class,
            polymarket=polymarket,
        )

        if modifier:
            reason = f"{reason} {modifier}".strip()

        overlays = self._load_context_overlays(
            market=market,
            risk_snapshot=risk_snapshot,
            symbol=display_symbol,
            selected_symbols=[display_symbol],
            analysis=analysis if isinstance(analysis, dict) else {},
        )
        promotion_context = self._load_overlay_promotion_context()

        return {
            "input_symbol": target["input_symbol"],
            "symbol": display_symbol,
            "provider_symbol": provider_symbol,
            "asset_class": asset_class,
            "analysis_path": path,
            "verdict": verdict,
            "reason": reason,
            "analysis": analysis,
            "polymarket": polymarket,
            "risk_budget_overlay": overlays.get("risk_budget_overlay", {}),
            "execution_quality_overlay": overlays.get("execution_quality_overlay", {}),
            "overlay_promotion": promotion_context,
        }

    @staticmethod
    def _quick_check_stock_verdict(analysis: Dict) -> tuple[str, str]:
        if analysis.get("error"):
            return "avoid for now", str(analysis.get("error"))

        rec = analysis.get("recommendation", {})
        tech = analysis.get("technical_scores", {})
        action = str(rec.get("action", "NO_BUY")).upper()
        breakout_score = int(analysis.get("breakout_follow_through", {}).get("score", rec.get("breakout_score", 0)) or 0)
        exit_risk_score = int(analysis.get("exit_risk", {}).get("score", rec.get("exit_risk_score", 0)) or 0)
        confidence = int(rec.get("effective_confidence", analysis.get("effective_confidence", analysis.get("confidence", 0))) or 0)
        pct_from_high = float(tech.get("pct_from_high", 0.0) or 0.0)
        total_score = int(analysis.get("total_score", rec.get("score", 0)) or 0)

        if action == "BUY":
            if pct_from_high >= 99.5 and exit_risk_score >= 2:
                return "extended", "Setup is working, but extension and exit risk are rising."
            if breakout_score >= 4 and confidence >= 70:
                return "actionable", "Base stock setup is valid and follow-through is strong enough to act on."
            return "needs confirmation", "Setup is close, but still needs cleaner follow-through."

        if action == "WATCH":
            if breakout_score >= 3 and confidence >= 60:
                return "needs confirmation", "Setup is constructive, but confirmation is still incomplete."
            if total_score >= 7 and pct_from_high >= 90:
                return "early / interesting", "Name is technically relevant, but it is still early rather than actionable."
            return "avoid for now", str(rec.get("reason", "Setup quality is not high enough right now."))

        if action == "NO_BUY" and exit_risk_score >= 3 and pct_from_high >= 98:
            return "manage winners / exhaustion risk", "Risk is skewing toward exhaustion rather than a fresh entry."

        return "avoid for now", str(rec.get("reason", "Base setup did not clear the current stock filters."))

    @staticmethod
    def _quick_check_dip_verdict(analysis: Dict) -> tuple[str, str]:
        if analysis.get("error"):
            return "avoid for now", str(analysis.get("error"))

        rec = analysis.get("recommendation", {})
        action = str(rec.get("action", "NO_BUY")).upper()
        recovery_ready = bool(analysis.get("recovery_ready", False))
        falling_knife = bool(analysis.get("falling_knife", False))
        total_score = int(analysis.get("total_score", 0) or 0)
        confidence = int(rec.get("effective_confidence", analysis.get("effective_confidence", analysis.get("confidence", 0))) or 0)
        rebound_pct = float(analysis.get("rebound_pct", 0.0) or 0.0)

        if action == "BUY":
            if rebound_pct >= 0.12:
                return "extended", "Bounce is real, but a lot of the easy recovery may already be behind it."
            return "actionable", "Dip/recovery setup is valid enough to act on if execution conditions still look clean."

        if action == "WATCH":
            if recovery_ready and not falling_knife and total_score >= 6 and confidence >= 50:
                return "needs confirmation", "Recovery is improving, but the dip setup still needs confirmation."
            if not falling_knife and total_score >= 5:
                return "early / interesting", "Recovery context is starting to improve, but it is still early."
            return "avoid for now", str(rec.get("reason", "Crypto setup quality is not strong enough yet."))

        return "avoid for now", str(rec.get("reason", "Recovery setup is not ready."))

    @staticmethod
    def _apply_polymarket_quick_check_overlay(
        *,
        verdict: str,
        asset_class: str,
        polymarket: Optional[Dict],
    ) -> tuple[str, str]:
        if not polymarket:
            return verdict, ""

        matched = polymarket.get("matched") if isinstance(polymarket, dict) else None
        conviction = str(polymarket.get("conviction", "")).strip().lower() if isinstance(polymarket, dict) else ""
        divergence_state = str(polymarket.get("divergence_state", "")).strip().lower() if isinstance(polymarket, dict) else ""
        severity = str((matched or {}).get("severity", "")).strip().lower() if isinstance(matched, dict) else ""
        persistence = str((matched or {}).get("persistence", "")).strip().lower() if isinstance(matched, dict) else ""
        themes = ", ".join((matched or {}).get("themes", [])[:2]) if isinstance(matched, dict) else ""

        if conviction == "conflicting" and verdict == "actionable":
            note = "Polymarket context is conflicting, so this is downgraded to confirmation-only."
            if themes:
                note += f" Themes: {themes}."
            return "needs confirmation", note

        if (
            asset_class == "crypto"
            and verdict == "early / interesting"
            and conviction == "supportive"
            and severity in {"notable", "major"}
            and persistence in {"persistent", "accelerating"}
        ):
            note = "Supportive Polymarket context lifts this from curiosity to confirmation-watch only."
            if themes:
                note += f" Themes: {themes}."
            return "needs confirmation", note

        if conviction == "conflicting" and divergence_state == "persistent" and verdict == "needs confirmation":
            note = "Persistent divergence keeps the bar high even though the setup is worth tracking."
            if themes:
                note += f" Themes: {themes}."
            return verdict, note

        if matched and themes:
            return verdict, f"Polymarket context: {conviction or 'neutral'} on {themes}."

        return verdict, ""

    @staticmethod
    def format_quick_check(result: Dict) -> str:
        lines = [
            f"Quick check: {result.get('symbol')} -> {result.get('verdict')}",
            f"Path: {result.get('analysis_path')} | Asset: {result.get('asset_class')}",
        ]

        polymarket = result.get("polymarket") or {}
        if polymarket:
            divergence = polymarket.get("divergence_summary", "")
            conviction = polymarket.get("conviction", "") or "neutral"
            matched = polymarket.get("matched") or {}
            themes = ", ".join(matched.get("themes", [])[:3]) if isinstance(matched, dict) else ""
            if themes or divergence:
                lines.append(
                    f"Polymarket: {conviction}"
                    + (f" | {divergence}" if divergence else "")
                    + (f" | themes {themes}" if themes else "")
                )

        risk_line = TradingAdvisor._compact_risk_budget_line(result.get("risk_budget_overlay") or {})
        if risk_line:
            lines.append(risk_line)
        execution_line = TradingAdvisor._compact_execution_quality_line(result.get("execution_quality_overlay") or {})
        if execution_line:
            lines.append(execution_line)
        promotion_line = TradingAdvisor._compact_overlay_promotion_line(result.get("overlay_promotion") or {})
        if promotion_line:
            lines.append(promotion_line)

        analysis = result.get("analysis", {})
        rec = analysis.get("recommendation", {}) if isinstance(analysis, dict) else {}
        if analysis.get("error"):
            lines.append(f"Reason: {analysis.get('error')}")
            return "\n".join(lines)

        lines.append(f"Reason: {result.get('reason')}")
        lines.append(
            f"Base action: {rec.get('action', 'N/A')} | Score {analysis.get('total_score', 0)}/12 | Confidence {analysis.get('effective_confidence', analysis.get('confidence', 0))}%"
        )
        return "\n".join(lines)

    def scan_dip_opportunities(
        self,
        quick: bool = False,
        min_score: int = 6,
        universe_profile: str = UNIVERSE_PROFILE_STANDARD,
        enforce_market_gate: bool = True,
        refresh_sp500: bool = False,
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

        if enforce_market_gate and market.regime not in [MarketRegime.CORRECTION, MarketRegime.UPTREND_UNDER_PRESSURE]:
            print("⚠️  Dip Buyer active only in corrections or pressured uptrends.")
            return pd.DataFrame()

        risk_snapshot = self.risk_fetcher.get_snapshot()

        profile = UNIVERSE_PROFILE_QUICK if quick else universe_profile
        symbols = self.screener.get_universe_for_profile(profile, refresh_sp500=refresh_sp500)

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
                'C_credit_score': scores.get('C', 0),
                'total_score': analysis.get('total_score', 0),
                'confidence': analysis.get('confidence', 0),
                'raw_confidence': analysis.get('raw_confidence', analysis.get('confidence', 0)),
                'effective_confidence': analysis.get('effective_confidence', analysis.get('confidence', 0)),
                'uncertainty_pct': analysis.get('uncertainty_pct', 0),
                'market_regime': analysis.get('market_regime', market.regime.value),
                'abstain': analysis.get('abstain', False),
                'abstain_reason_codes': analysis.get('abstain_reason_codes', []),
                'action': analysis.get('recommendation', {}).get('action', 'NO_BUY'),
                'position_size_pct': analysis.get('recommendation', {}).get('position_size_pct', 0.0),
                'size_label': analysis.get('recommendation', {}).get('size_label', 'STANDARD'),
                'trade_quality_score': analysis.get('trade_quality_score', analysis.get('effective_confidence', analysis.get('confidence', 0))),
                'downside_penalty': analysis.get('downside_penalty', analysis.get('trade_quality', {}).get('downside_penalty', 0.0)),
                'churn_penalty': analysis.get('churn_penalty', analysis.get('trade_quality', {}).get('churn_penalty', 0.0)),
                'adverse_regime_score': analysis.get('adverse_regime', {}).get('score', 0.0),
                'adverse_regime_label': analysis.get('adverse_regime', {}).get('label', 'normal'),
            })

        if not candidates:
            return pd.DataFrame()

        df = pd.DataFrame(candidates)
        return self._sort_runtime_candidates(
            df,
            primary_desc_columns=['trade_quality_score', 'position_size_pct', 'total_score'],
        )
    
    def _generate_recommendation(
        self,
        symbol: str,
        total_score: int,
        fund_scores: Dict,
        tech_scores: Dict,
        market: MarketStatus,
        breakout: Dict,
        sentiment_overlay: Dict,
        exit_risk: Dict,
        sector_context: Dict,
        catalyst_weighting: Dict,
        confidence_assessment: Dict,
        rank_score: float,
    ) -> Dict:
        """
        Generate a specific trade recommendation.
        
        Returns:
            Dict with action, entry, stop, size, reasoning
        """
        price = tech_scores.get('price', 0)
        pct_from_high = tech_scores.get('pct_from_high', 0)
        breakout_score = int(breakout.get('score', 0))
        sentiment_score = int(sentiment_overlay.get('score', 0))
        exit_risk_score = int(exit_risk.get('score', 0))
        sector_score = int(sector_context.get('score', 0))
        catalyst_score = int(catalyst_weighting.get('score', 0))
        confidence = int(confidence_assessment.get('effective_confidence_pct', 0))
        uncertainty_pct = int(confidence_assessment.get('uncertainty_pct', 0))
        abstain = bool(confidence_assessment.get('abstain', False))
        adverse_regime = dict(confidence_assessment.get('adverse_regime', {}) or {})
        sizing = build_position_sizing_guidance(
            market=market,
            confidence=confidence,
            confidence_assessment=confidence_assessment,
            breakout=breakout,
            exit_risk=exit_risk,
            sector_context=sector_context,
            catalyst=catalyst_weighting,
        )

        trade_quality = self._build_canslim_trade_quality(
            market=market,
            rank_score=rank_score,
            confidence_assessment=confidence_assessment,
            exit_risk=exit_risk,
            price_history=tech_scores.get('price_history'),
        )
        risk_size_multiplier = risk_adjusted_size_multiplier(
            downside_penalty=trade_quality.get('downside_penalty', 0.0),
            churn_penalty=trade_quality.get('churn_penalty', 0.0),
        )
        sizing['recommended_position_pct'] = round(sizing.get('recommended_position_pct', 0.0) * risk_size_multiplier, 2)
        if sizing['recommended_position_pct'] <= 0:
            sizing['label'] = 'OFF'
        elif sizing['recommended_position_pct'] >= sizing.get('base_position_pct', sizing['recommended_position_pct']) * 0.95:
            sizing['label'] = 'FULL'
        elif sizing['recommended_position_pct'] >= sizing.get('base_position_pct', sizing['recommended_position_pct']) * 0.7:
            sizing['label'] = 'STANDARD'
        else:
            sizing['label'] = 'STARTER'
        sizing['risk_adjusted_multiplier'] = risk_size_multiplier

        base_fields = {
            'score': total_score,
            'rank_score': rank_score,
            'trade_quality_score': trade_quality['score'],
            'trade_quality': trade_quality,
            'downside_penalty': trade_quality.get('downside_penalty', 0.0),
            'churn_penalty': trade_quality.get('churn_penalty', 0.0),
            'confidence': confidence,
            'raw_confidence': int(confidence_assessment.get('raw_confidence_pct', confidence)),
            'effective_confidence': confidence,
            'uncertainty_pct': uncertainty_pct,
            'confidence_assessment': confidence_assessment,
            'abstain': abstain,
            'abstain_reason_codes': confidence_assessment.get('abstain_reason_codes', []),
            'abstain_reasons': confidence_assessment.get('abstain_reasons', []),
            'adverse_regime': adverse_regime,
            'breakout_score': breakout_score,
            'sentiment_score': sentiment_score,
            'exit_risk_score': exit_risk_score,
            'sector_score': sector_score,
            'catalyst_score': catalyst_score,
            'market_note': market.notes,
            'sizing': sizing,
            'size_label': sizing.get('label', 'STANDARD'),
        }
        
        # Check if we should buy
        if market.regime == MarketRegime.CORRECTION:
            return {
                'action': 'NO_BUY',
                'reason': 'Market in correction. No new positions.',
                **base_fields,
            }
        
        if total_score < 7:
            return {
                'action': 'NO_BUY',
                'reason': f'Score too low ({total_score}/12). Need >= 7.',
                **base_fields,
            }

        if sentiment_overlay.get('veto'):
            return {
                'action': 'WATCH',
                'reason': f"Sentiment overlay veto: {sentiment_overlay.get('reason', 'bearish sentiment.')}",
                **base_fields,
            }

        if exit_risk.get('veto'):
            action = 'WATCH' if total_score >= 8 and breakout_score >= 3 else 'NO_BUY'
            return {
                'action': action,
                'reason': f"Exit risk too high ({exit_risk.get('status', 'high')}): {', '.join(exit_risk.get('reasons', []))}.",
                **base_fields,
            }

        if abstain:
            abstain_reasons = confidence_assessment.get('abstain_reasons', [])
            return {
                'action': 'WATCH',
                'reason': f"Uncertainty too high ({uncertainty_pct}%): {' | '.join(abstain_reasons[:2]) or 'confidence assessment abstained.'}",
                **base_fields,
            }

        if breakout_score <= 1:
            return {
                'action': 'WATCH',
                'reason': f"Breakout follow-through is weak ({breakout_score}/5). Wait for stronger confirmation.",
                **base_fields,
            }

        if confidence < 55:
            confidence_drags = [reason for reason in [sector_context.get('reason'), catalyst_weighting.get('reason')] if reason]
            if adverse_regime.get('label') != 'normal':
                confidence_drags.append(
                    f"market stress {adverse_regime.get('label')} ({float(adverse_regime.get('score', 0.0)):.0f})"
                )
            return {
                'action': 'WATCH',
                'reason': f"Composite confidence fell to {confidence}%: {' | '.join(confidence_drags[:2])}",
                **base_fields,
            }

        if pct_from_high < 85:
            return {
                'action': 'WATCH',
                'reason': f'Stock {100 - pct_from_high:.1f}% below 52-week high. Wait for strength.',
                **base_fields,
            }
        
        # Calculate entry and stop
        stop_loss_pct = 0.08
        if breakout_score >= 4 and exit_risk_score <= 1:
            stop_loss_pct = 0.07
        elif exit_risk_score >= 3:
            stop_loss_pct = 0.06
        stop_price = price * (1 - stop_loss_pct)
        
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
        if breakout_score >= 3:
            reasons.append(f"✅ Breakout follow-through {breakout_score}/5 ({breakout.get('status', 'mixed')})")
        if sentiment_score > 0:
            reasons.append(f"✅ Sentiment tailwind: {sentiment_overlay.get('reason')}")
        if sector_score > 0:
            reasons.append(f"✅ Sector context: {sector_context.get('reason')}")
        elif sector_score < 0:
            reasons.append(f"⚠️ Sector drag: {sector_context.get('reason')}")
        if catalyst_score > 0:
            reasons.append(f"✅ Catalyst support: {catalyst_weighting.get('reason')}")
        elif catalyst_score < 0:
            reasons.append(f"⚠️ Catalyst caution: {catalyst_weighting.get('reason')}")
        if exit_risk_score <= 1:
            reasons.append("✅ Exit risk remains contained")
        if adverse_regime.get('label') != 'normal':
            reasons.append(
                f"⚠️ Adverse regime {adverse_regime.get('label')} ({float(adverse_regime.get('score', 0.0)):.0f}): {adverse_regime.get('reason')}"
            )
        reasons.append(f"📏 Size as {sizing.get('label', 'STANDARD').lower()} position ({sizing.get('reason')})")
        
        return {
            'action': 'BUY',
            'entry': price,
            'stop_loss': stop_price,
            'stop_loss_pct': stop_loss_pct * 100,
            'position_size_pct': sizing.get('recommended_position_pct', 0.0),
            'reasons': reasons,
            **base_fields,
        }
    
    def scan_for_opportunities(
        self,
        quick: bool = False,
        min_score: int = 6,
        universe_profile: str = UNIVERSE_PROFILE_STANDARD,
        enforce_market_gate: bool = True,
        refresh_sp500: bool = False,
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
        
        if enforce_market_gate and market.regime == MarketRegime.CORRECTION:
            print("⚠️  Market in correction. Skipping scan.")
            return pd.DataFrame()
        
        # Run screen
        profile = UNIVERSE_PROFILE_QUICK if quick else universe_profile
        symbols = self.screener.get_universe_for_profile(profile, refresh_sp500=refresh_sp500)
        results = self.screener.screen(symbols, min_technical_score=min_score - 2)
        
        if results.empty:
            print("No candidates found.")
            return results
        
        # Enrich with fundamental scores for top candidates
        print("\n📊 Enriching top candidates with fundamental data...")
        
        enriched = []
        previous_context = dict(self._candidate_context_by_symbol)
        self._candidate_context_by_symbol = {
            row['symbol']: row.to_dict()
            for _, row in results.head(15).iterrows()
        }

        try:
            for _, row in results.head(15).iterrows():
                symbol = row['symbol']

                try:
                    analysis = self.analyze_stock(symbol, quiet=True)
                    if 'error' in analysis:
                        continue

                    row_dict = row.to_dict()
                    scores = analysis.get('fundamental_scores', {})
                    rec = analysis.get('recommendation', {})
                    row_dict['C_score'] = scores.get('C', 0)
                    row_dict['A_score'] = scores.get('A', 0)
                    row_dict['I_score'] = scores.get('I', 0)
                    row_dict['S_fund_score'] = scores.get('S', 0)
                    row_dict['total_score'] = analysis.get('total_score', 0)
                    row_dict['breakout_score'] = analysis.get('breakout_follow_through', {}).get('score', 0)
                    row_dict['sentiment_score'] = analysis.get('sentiment_overlay', {}).get('score', 0)
                    row_dict['exit_risk_score'] = analysis.get('exit_risk', {}).get('score', 0)
                    row_dict['sector_score'] = analysis.get('sector_context', {}).get('score', 0)
                    row_dict['catalyst_score'] = analysis.get('catalyst_weighting', {}).get('score', 0)
                    row_dict['rank_score'] = analysis.get('rank_score', analysis.get('total_score', 0))
                    row_dict['confidence'] = rec.get('confidence', analysis.get('confidence', 0))
                    row_dict['raw_confidence'] = analysis.get('raw_confidence', row_dict['confidence'])
                    row_dict['effective_confidence'] = analysis.get('effective_confidence', row_dict['confidence'])
                    row_dict['uncertainty_pct'] = analysis.get('uncertainty_pct', 0)
                    row_dict['market_regime'] = analysis.get('market_regime', row_dict.get('market_regime'))
                    row_dict['abstain'] = analysis.get('abstain', False)
                    row_dict['abstain_reason_codes'] = analysis.get('abstain_reason_codes', [])
                    row_dict['position_size_pct'] = rec.get('position_size_pct', 0.0)
                    row_dict['size_label'] = rec.get('size_label', rec.get('sizing', {}).get('label', 'STANDARD'))
                    row_dict['action'] = rec.get('action', 'NO_BUY')
                    row_dict['trade_quality_score'] = analysis.get('trade_quality_score', rec.get('trade_quality_score', row_dict['rank_score']))
                    row_dict['adverse_regime_score'] = analysis.get('adverse_regime', {}).get('score', 0.0)
                    row_dict['adverse_regime_label'] = analysis.get('adverse_regime', {}).get('label', 'normal')
                    enriched.append(row_dict)

                except Exception as e:
                    print(f"   ⚠️ Error enriching {symbol}: {e}")
                    continue
        finally:
            self._candidate_context_by_symbol = previous_context

        if not enriched:
            return results

        enriched_df = pd.DataFrame(enriched)
        enriched_df = self._sort_runtime_candidates(
            enriched_df,
            primary_desc_columns=['trade_quality_score', 'rank_score'],
        )
        
        # Filter by minimum total score
        enriched_df = enriched_df[enriched_df['total_score'] >= min_score]
        return attach_model_family_scores(enriched_df)

    def run_nightly_discovery(
        self,
        *,
        limit: int = 25,
        min_technical_score: int = 3,
        refresh_sp500: bool = False,
        symbols: Optional[List[str]] = None,
    ) -> pd.DataFrame:
        """Run a broader nightly discovery pass without the live market gate."""
        if symbols is None:
            symbols = self.screener.get_universe_for_profile(
                UNIVERSE_PROFILE_NIGHTLY_DISCOVERY,
                refresh_sp500=refresh_sp500,
            )
        results = self.screener.screen(symbols, min_technical_score=min_technical_score, verbose=False)
        if results.empty:
            return results

        market = self.get_market_status(refresh=True)
        enriched = []
        previous_context = dict(self._candidate_context_by_symbol)
        self._candidate_context_by_symbol = {
            row['symbol']: row.to_dict()
            for _, row in results.head(limit).iterrows()
        }

        try:
            for _, row in results.head(limit).iterrows():
                symbol = row['symbol']
                try:
                    analysis = self.analyze_stock(symbol, quiet=True)
                    if 'error' in analysis:
                        continue

                    rec = analysis.get('recommendation', {})
                    row_dict = row.to_dict()
                    row_dict['market_regime'] = getattr(getattr(market, 'regime', None), 'value', 'unknown')
                    row_dict['total_score'] = analysis.get('total_score', 0)
                    row_dict['rank_score'] = analysis.get('rank_score', analysis.get('total_score', 0))
                    row_dict['action'] = rec.get('action', 'NO_BUY')
                    row_dict['reason'] = rec.get('reason', '')
                    row_dict['confidence'] = rec.get('confidence', analysis.get('confidence', 0))
                    row_dict['trade_quality_score'] = rec.get(
                        'trade_quality_score',
                        analysis.get('trade_quality_score', analysis.get('total_score', 0)),
                    )
                    enriched.append(row_dict)
                except Exception as exc:
                    LOGGER.debug("Skipping %s during nightly enrichment: %s", symbol, exc)
        finally:
            self._candidate_context_by_symbol = previous_context

        if not enriched:
            return pd.DataFrame()

        return pd.DataFrame(enriched).sort_values(
            ['rank_score', 'technical_score', 'confidence', 'symbol'],
            ascending=[False, False, False, True],
        ).reset_index(drop=True)

    def compare_model_families(
        self,
        quick: bool = False,
        min_score: int = 6,
        top_n: int = 5,
    ) -> Dict:
        """Compare baseline, tactical, and enhanced score families on the same scan output."""
        candidates = self.scan_for_opportunities(quick=quick, min_score=min_score)
        if candidates.empty:
            report = "Wave 4 Model Comparison\nNo candidates available for comparison."
            return {
                "candidates": candidates,
                "summary": pd.DataFrame(),
                "selections": {},
                "review_slices": [],
                "report": report,
            }

        families = build_default_model_families(
            top_n=top_n,
            baseline_min_score=max(min_score, 7),
        )
        summary, selections = evaluate_model_families(
            candidates,
            families,
            baseline_name=families[0].name,
        )
        report = render_model_comparison_report(
            summary,
            selections,
            baseline_name=families[0].name,
        )
        return {
            "candidates": candidates,
            "summary": summary,
            "selections": selections,
            "review_slices": list(summary.attrs.get("review_slices", [])),
            "report": report,
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
        
        if 'action' not in candidates.columns or 'symbol' not in candidates.columns:
            return []

        buy_rows = candidates.loc[candidates['action'] == 'BUY'].copy()
        if buy_rows.empty:
            return []

        if 'trade_quality_score' in buy_rows.columns:
            sort_columns = ['trade_quality_score']
            ascending = [False]
            for column, column_ascending in (
                ('downside_penalty', True),
                ('churn_penalty', True),
                ('effective_confidence', False),
                ('confidence', False),
                ('uncertainty_pct', True),
                ('rank_score', False),
                ('total_score', False),
                ('symbol', True),
            ):
                if column in buy_rows.columns and column not in sort_columns:
                    sort_columns.append(column)
                    ascending.append(column_ascending)
            buy_rows = buy_rows.sort_values(sort_columns, ascending=ascending, kind='mergesort')

        buy_symbols = buy_rows['symbol'].head(limit).tolist()

        recommendations = []

        for symbol in buy_symbols:
            analysis = self.analyze_stock(symbol)

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
  Conf:   {r.get('confidence', 0)}%
  Wave2:  Breakout {r.get('breakout_score', 0)}/5 | Sentiment {r.get('sentiment_score', 0):+d} | Exit risk {r.get('exit_risk_score', 0)}/5

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
    parser.add_argument('--quick-check', type=str,
                       help='Run a fast stock/coin/proxy verdict with Polymarket context')
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
        breakout = analysis.get('breakout_follow_through', {})
        sentiment = analysis.get('sentiment_overlay', {})
        exit_risk = analysis.get('exit_risk', {})
        
        print(f"\n   Fundamental: C={fs.get('C',0)} A={fs.get('A',0)} I={fs.get('I',0)} S={fs.get('S',0)}")
        print(f"   Technical:   N={ts.get('N_score',0)} L={ts.get('L_score',0)} S={ts.get('S_score',0)}")
        print(
            f"   Wave 2:      Breakout={breakout.get('score',0)}/5 "
            f"Sentiment={sentiment.get('label','NEUTRAL')} "
            f"ExitRisk={exit_risk.get('score',0)}/5"
        )
        sector_context = analysis.get('sector_context', {})
        catalyst = analysis.get('catalyst_weighting', {})
        print(
            f"   Wave 3:      Sector={sector_context.get('score',0):+d} "
            f"({sector_context.get('status','neutral')}) "
            f"Catalyst={catalyst.get('score',0):+d} "
            f"({catalyst.get('label','NEUTRAL')})"
        )
        
        rec = analysis.get('recommendation', {})
        print(f"\n   Recommendation: {rec.get('action', 'N/A')}")
        if rec.get('action') == 'BUY':
            print(f"   Entry: ${rec.get('entry', 0):.2f}")
            print(f"   Stop:  ${rec.get('stop_loss', 0):.2f}")
            print(f"   Confidence: {rec.get('confidence', 0)}%")
            print(f"   Size:  {rec.get('position_size_pct', 0):.1f}%")
        else:
            print(f"   Reason: {rec.get('reason', 'N/A')}")
        
        return

    if args.quick_check:
        result = advisor.quick_check(args.quick_check)
        print("\n" + advisor.format_quick_check(result))
        return
    
    # Default: get recommendations
    recommendations = advisor.get_recommendations(limit=5)
    advisor.print_recommendations(recommendations)


if __name__ == "__main__":
    main()
