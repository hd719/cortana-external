"""
Dip Buyer Strategy Implementation

Designed to operate during market corrections or uptrends under pressure.
It looks for quality growth names pulling back with favorable sentiment
and improving credit conditions.

Scoring (0-12):
  Q (Quality, 0-4)
    - RSI(14) <= 35: +2
    - RSI(14) 35-40: +1
    - EPS growth >= 20%: +1
    - Revenue growth >= 15%: +1

  V (Volatility/Sentiment, 0-4)
    - VIX 22-38: +2
    - VIX 18-22 or 38-45: +1
    - Put/Call 0.9-1.2: +1
    - Fear proxy <= 35: +1

  C (Credit, 0-4)
    - HY spread < 450 bps: +4
    - HY spread 450-550 bps: +2
    - HY spread 550-650 bps: +1
    - HY spread > 650 bps: 0 + credit veto
    - Spread widening > 75 bps / 10d: -1 (floor at 0)

Thresholds:
  - BUY: >= 7
  - WATCH: >= 6
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Optional

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))

from strategies.base import Strategy
from indicators import rsi
from data.confidence import (
    build_dip_confidence_assessment,
    build_trade_quality_score,
    churn_penalty_proxy,
    downside_risk_proxy,
    regime_quality_modifier,
    risk_adjusted_size_multiplier,
)
from data.fundamentals import FundamentalsFetcher
from data.market_regime import MarketRegimeDetector, MarketRegime, MarketStatus
from data.risk_signals import RiskSignalFetcher


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw in (None, ""):
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw in (None, ""):
        return default
    try:
        return int(raw)
    except ValueError:
        return default


DIPBUYER_CONFIG = {
    "score_thresholds": {
        "buy": _env_int("DIPBUYER_DEFAULT_BUY_THRESHOLD", 7),
        "watch": _env_int("DIPBUYER_DEFAULT_WATCH_THRESHOLD", 6),
    },
    "quality": {
        "rsi_period": 14,
        "rsi_strong": 35,
        "rsi_soft": 40,
        "eps_growth_min": 20,
        "revenue_growth_min": 15,
    },
    "volatility": {
        "vix_strong": (22, 38),
        "vix_soft": [(18, 22), (38, 45)],
        "put_call_range": (0.9, 1.2),
        "fear_proxy_max": 35,
    },
    "credit": {
        "hy_spread_strong": 450,
        "hy_spread_moderate": 550,
        "hy_spread_weak": 650,
        "spread_widening_bps": 75,
    },
    "dip_recovery": {
        "lookback_high_days": 20,
        "lookback_low_days": 10,
        "short_ma_period": 5,
        "min_pullback_pct": 0.05,
        "max_pullback_pct": 0.25,
        "min_rebound_pct": 0.02,
        "max_5d_drop_pct": -0.08,
    },
    "entries": {
        "tranches": 3,
        "initial_pct": 1 / 3,
        "add_on_pullback_pct": -0.03,
        "add_on_breadth": "stabilization",
    },
    "exits": {
        "trim_1": 0.08,
        "trim_2": 0.12,
        "trail_runner": True,
        "hard_stop": 0.07,
        "credit_veto": True,
    },
    "risk": {
        "max_position_pct": 0.06,
        "max_exposure_correction": 0.25,
        "max_exposure_under_pressure": 0.40,
        "max_positions": 5,
    },
    "profiles": {
        "bull": {
            "score_thresholds": {
                "buy": _env_int("DIPBUYER_BULL_BUY_THRESHOLD", 8),
                "watch": _env_int("DIPBUYER_BULL_WATCH_THRESHOLD", 7),
            },
            "risk": {
                "max_position_pct": _env_float("DIPBUYER_BULL_MAX_POSITION_PCT", 0.04),
                "max_exposure_pct": _env_float("DIPBUYER_BULL_MAX_EXPOSURE_PCT", 0.20),
            },
            "notes": "Healthy uptrend profile: selective dip exposure.",
        },
        "correction": {
            "score_thresholds": {
                "buy": _env_int("DIPBUYER_CORRECTION_BUY_THRESHOLD", 7),
                "watch": _env_int("DIPBUYER_CORRECTION_WATCH_THRESHOLD", 6),
            },
            "risk": {
                "max_position_pct": _env_float("DIPBUYER_CORRECTION_MAX_POSITION_PCT", 0.05),
                "max_exposure_pct": _env_float("DIPBUYER_CORRECTION_MAX_EXPOSURE_PCT", 0.25),
                "hard_stop": _env_float("DIPBUYER_CORRECTION_HARD_STOP", 0.06),
            },
            "notes": "Correction profile: tactical entries only, tight risk, no averaging down outside plan.",
        },
        "under_pressure": {
            "score_thresholds": {
                "buy": _env_int("DIPBUYER_UNDER_PRESSURE_BUY_THRESHOLD", 7),
                "watch": _env_int("DIPBUYER_UNDER_PRESSURE_WATCH_THRESHOLD", 6),
            },
            "risk": {
                "max_position_pct": _env_float("DIPBUYER_UNDER_PRESSURE_MAX_POSITION_PCT", 0.06),
                "max_exposure_pct": _env_float("DIPBUYER_UNDER_PRESSURE_MAX_EXPOSURE_PCT", 0.35),
            },
            "notes": "Under-pressure profile: reduced exposure while trend quality is mixed.",
        },
    },
}


class DipBuyerStrategy(Strategy):
    """
    Dip Buyer strategy focusing on corrections and pressured uptrends.
    """

    def __init__(
        self,
        min_buy_score: int = DIPBUYER_CONFIG["score_thresholds"]["buy"],
        min_watch_score: int = DIPBUYER_CONFIG["score_thresholds"]["watch"],
        rsi_period: int = DIPBUYER_CONFIG["quality"]["rsi_period"],
    ):
        super().__init__(name="Dip Buyer Strategy")

        self.parameters = {
            "min_buy_score": min_buy_score,
            "min_watch_score": min_watch_score,
            "rsi_period": rsi_period,
        }

        self.min_buy_score = min_buy_score
        self.min_watch_score = min_watch_score
        self.rsi_period = rsi_period

        self.fundamentals_fetcher = FundamentalsFetcher()
        self.risk_fetcher = RiskSignalFetcher()
        self.market_detector = MarketRegimeDetector()

        self.symbol = None
        self.fundamentals = None
        self.active_profile = "inactive"
        self.active_profile_config = {}

    def _select_profile(self, regime: MarketRegime) -> tuple[str, dict]:
        profiles = DIPBUYER_CONFIG.get("profiles", {})
        if regime == MarketRegime.CORRECTION:
            return "correction", profiles.get("correction", {})
        if regime == MarketRegime.UPTREND_UNDER_PRESSURE:
            return "under_pressure", profiles.get("under_pressure", {})
        if regime == MarketRegime.CONFIRMED_UPTREND:
            return "bull", profiles.get("bull", {})
        return "inactive", {}

    def set_symbol(self, symbol: str) -> None:
        """Set the symbol and pre-fetch fundamentals."""
        self.symbol = symbol
        self.fundamentals = self.fundamentals_fetcher.get_fundamentals(symbol)

    def _quality_score(self, rsi_values: pd.Series) -> pd.Series:
        cfg = DIPBUYER_CONFIG["quality"]
        rsi_score = pd.Series(0, index=rsi_values.index)
        rsi_score[rsi_values <= cfg["rsi_strong"]] = 2
        rsi_score[(rsi_values > cfg["rsi_strong"]) & (rsi_values <= cfg["rsi_soft"])] = 1

        eps_growth = self.fundamentals.get("eps_growth") if self.fundamentals else None
        rev_growth = self.fundamentals.get("revenue_growth") if self.fundamentals else None

        eps_score = 1 if eps_growth is not None and eps_growth >= cfg["eps_growth_min"] else 0
        rev_score = 1 if rev_growth is not None and rev_growth >= cfg["revenue_growth_min"] else 0

        return rsi_score + eps_score + rev_score

    def _volatility_score(self, risk: pd.DataFrame) -> pd.Series:
        cfg = DIPBUYER_CONFIG["volatility"]

        vix = pd.to_numeric(risk['vix'], errors='coerce')
        put_call = pd.to_numeric(risk['put_call'], errors='coerce')
        fear = pd.to_numeric(risk['fear_greed'], errors='coerce')

        vix_score = pd.Series(0, index=risk.index)
        vix_available = vix.notna()
        vix_score[vix_available & (vix >= cfg["vix_strong"][0]) & (vix <= cfg["vix_strong"][1])] = 2

        soft_ranges = cfg["vix_soft"]
        vix_score[
            vix_available & (
                ((vix >= soft_ranges[0][0]) & (vix < soft_ranges[0][1])) |
                ((vix > soft_ranges[1][0]) & (vix <= soft_ranges[1][1]))
            )
        ] = 1

        # If PCR/Fear are NaN, skip those sub-scores (do not force penalties).
        put_call_score = pd.Series(0, index=risk.index)
        put_call_available = put_call.notna()
        put_call_score[
            put_call_available
            & (put_call >= cfg["put_call_range"][0])
            & (put_call <= cfg["put_call_range"][1])
        ] = 1

        fear_score = pd.Series(0, index=risk.index)
        fear_available = fear.notna()
        fear_score[fear_available & (fear <= cfg["fear_proxy_max"])] = 1

        return vix_score + put_call_score + fear_score

    def _credit_score(self, risk: pd.DataFrame) -> pd.Series:
        cfg = DIPBUYER_CONFIG["credit"]
        hy_spread = pd.to_numeric(risk['hy_spread'], errors='coerce')

        # Neutral when HY is unavailable.
        credit_score = pd.Series(0, index=risk.index)
        credit_score[hy_spread.isna()] = 2

        credit_score[hy_spread < cfg["hy_spread_strong"]] = 4
        credit_score[(hy_spread >= cfg["hy_spread_strong"]) & (hy_spread < cfg["hy_spread_moderate"])] = 2
        credit_score[(hy_spread >= cfg["hy_spread_moderate"]) & (hy_spread < cfg["hy_spread_weak"])] = 1

        widening = risk['hy_spread_change_10d'] > cfg["spread_widening_bps"]
        widening = widening & hy_spread.notna()
        credit_score = credit_score.where(~widening, credit_score - 1)
        credit_score = credit_score.clip(lower=0)

        return credit_score

    def _prepare_risk_frame(self, data_index: pd.Index, risk_snapshot: Optional[dict] = None) -> pd.DataFrame:
        risk_history = self.risk_fetcher.get_history(days=max(len(data_index), 200))
        risk_history.index = pd.to_datetime(risk_history.index).tz_localize(None)
        clean_index = pd.to_datetime(data_index).tz_localize(None)
        risk = risk_history.reindex(clean_index, method='ffill')
        risk.index = data_index
        risk = risk.ffill().bfill()

        risk = risk.fillna({
            'put_call': 1.0,
            'hy_spread': 450.0,
            'fear_greed': 50.0,
        })

        if risk_snapshot:
            latest_idx = risk.index[-1]
            for field in ('vix', 'put_call', 'hy_spread', 'fear_greed'):
                value = risk_snapshot.get(field)
                if value is not None:
                    risk.loc[latest_idx, field] = value

        risk['hy_spread_change_10d'] = pd.to_numeric(risk['hy_spread'], errors='coerce').diff(10).fillna(0)
        return risk

    def _dip_recovery_features(self, close: pd.Series) -> pd.DataFrame:
        cfg = DIPBUYER_CONFIG["dip_recovery"]
        recent_high = close.rolling(cfg["lookback_high_days"], min_periods=cfg["lookback_high_days"]).max()
        recent_low = close.rolling(cfg["lookback_low_days"], min_periods=cfg["lookback_low_days"]).min()
        short_ma = close.rolling(cfg["short_ma_period"], min_periods=cfg["short_ma_period"]).mean()
        five_day_return = close.pct_change(5)

        pullback_pct = 1 - (close / recent_high)
        rebound_pct = (close / recent_low) - 1

        context_available = recent_high.notna() & recent_low.notna() & short_ma.notna()
        valid_pullback = pullback_pct.between(cfg["min_pullback_pct"], cfg["max_pullback_pct"], inclusive="both")
        recovery_ready = (~context_available) | (
            valid_pullback & (rebound_pct >= cfg["min_rebound_pct"]) & (close >= short_ma)
        )
        falling_knife = context_available & valid_pullback & (
            (five_day_return <= cfg["max_5d_drop_pct"])
            | (close < short_ma)
            | (rebound_pct < cfg["min_rebound_pct"])
        )

        return pd.DataFrame(
            {
                "Pullback_Pct": pullback_pct.fillna(0.0),
                "Rebound_Pct": rebound_pct.fillna(0.0),
                "FiveDay_Return": five_day_return.fillna(0.0),
                "Recovery_Ready": recovery_ready.fillna(False),
                "Falling_Knife": falling_knife.fillna(False),
            },
            index=close.index,
        )

    def build_score_frame(
        self,
        data: pd.DataFrame,
        market: Optional[MarketStatus] = None,
        risk_snapshot: Optional[dict] = None,
        data_status: str = "ok",
        data_staleness_seconds: float = 0.0,
    ) -> pd.DataFrame:
        """Build a reusable Dip Buyer score frame for scans, advisor analysis, and backtests."""
        data = data.copy()
        data.columns = [c.lower() for c in data.columns]
        close = data['close']

        market = market or self.market_detector.get_status()
        profile_name, profile = self._select_profile(market.regime)
        self.active_profile = profile_name
        self.active_profile_config = profile

        market_active = market.regime in [
            MarketRegime.CORRECTION,
            MarketRegime.UPTREND_UNDER_PRESSURE,
        ]

        rsi_values = rsi(close, self.rsi_period)
        q_score = self._quality_score(rsi_values)

        risk = self._prepare_risk_frame(data.index, risk_snapshot=risk_snapshot)
        v_score = self._volatility_score(risk)
        c_score = self._credit_score(risk)
        recovery = self._dip_recovery_features(close)

        total_score = q_score + v_score + c_score
        credit_veto = pd.to_numeric(risk['hy_spread'], errors='coerce') > DIPBUYER_CONFIG["credit"]["hy_spread_weak"]

        buy_threshold = profile.get("score_thresholds", {}).get("buy", self.min_buy_score)
        watch_threshold = profile.get("score_thresholds", {}).get("watch", self.min_watch_score)

        confidence_records = []
        history_bars = len(data.index)
        for idx in data.index:
            risk_inputs = {}
            for field in ("vix", "put_call", "hy_spread", "fear_greed"):
                value = risk.at[idx, field] if field in risk.columns else None
                risk_inputs[field] = None if pd.isna(value) else float(value)

            assessment = build_dip_confidence_assessment(
                symbol=self.symbol or "UNKNOWN",
                market=market,
                total_score=int(total_score.loc[idx]),
                q_score=int(q_score.loc[idx]),
                v_score=int(v_score.loc[idx]),
                c_score=int(c_score.loc[idx]),
                market_active=bool(market_active),
                credit_veto=bool(credit_veto.loc[idx]),
                recovery_ready=bool(recovery.loc[idx, "Recovery_Ready"]),
                falling_knife=bool(recovery.loc[idx, "Falling_Knife"]),
                risk_inputs=risk_inputs,
                data_status=data_status,
                data_staleness_seconds=data_staleness_seconds,
                history_bars=history_bars,
            )
            confidence_records.append(
                {
                    "Raw_Confidence": assessment["raw_confidence_pct"],
                    "Uncertainty_Pct": assessment["uncertainty_pct"],
                    "Effective_Confidence": assessment["effective_confidence_pct"],
                    "Confidence_Bucket": assessment["confidence_bucket"],
                    "Size_Multiplier": assessment["size_multiplier"],
                    "Abstain": assessment["abstain"],
                    "Abstain_Reason_Codes": assessment["abstain_reason_codes"],
                    "Abstain_Reasons": assessment["abstain_reasons"],
                    "Confidence_Assessment": assessment,
                }
            )
        confidence_frame = pd.DataFrame(confidence_records, index=data.index)

        return pd.concat(
            [
                pd.DataFrame(
                    {
                        'Q': q_score,
                        'V': v_score,
                        'C': c_score,
                        'Total': total_score,
                        'RSI': rsi_values,
                        'VIX': risk['vix'],
                        'PutCall': risk['put_call'],
                        'HY_Spread': risk['hy_spread'],
                        'FearProxy': risk['fear_greed'],
                        'Market_Active': market_active,
                        'Credit_Veto': credit_veto.fillna(False),
                        'Buy_Threshold': buy_threshold,
                        'Watch_Threshold': watch_threshold,
                        'Profile': profile_name,
                        'Pullback_Pct': recovery['Pullback_Pct'],
                        'Rebound_Pct': recovery['Rebound_Pct'],
                        'FiveDay_Return': recovery['FiveDay_Return'],
                        'Recovery_Ready': recovery['Recovery_Ready'],
                        'Falling_Knife': recovery['Falling_Knife'],
                    },
                    index=data.index,
                ),
                confidence_frame,
            ],
            axis=1,
        )

    def evaluate_setup(
        self,
        data: pd.DataFrame,
        market: Optional[MarketStatus] = None,
        risk_snapshot: Optional[dict] = None,
        data_status: str = "ok",
        data_staleness_seconds: float = 0.0,
    ) -> dict:
        """Evaluate the latest Dip Buyer setup using the shared score frame."""
        data = data.copy()
        data.columns = [c.lower() for c in data.columns]
        scores = self.build_score_frame(
            data,
            market=market,
            risk_snapshot=risk_snapshot,
            data_status=data_status,
            data_staleness_seconds=data_staleness_seconds,
        )
        latest = scores.iloc[-1]

        market = market or self.market_detector.get_status()
        price = float(data['close'].iloc[-1])
        total_score = int(latest['Total'])
        buy_threshold = int(latest['Buy_Threshold'])
        watch_threshold = int(latest['Watch_Threshold'])
        profile_name, profile_cfg = self.get_active_profile()
        profile_risk = profile_cfg.get('risk', {}) if isinstance(profile_cfg, dict) else {}
        stop_loss_pct = float(profile_risk.get('hard_stop', self.stop_loss_pct()))
        max_position_pct_cfg = float(profile_risk.get('max_position_pct', DIPBUYER_CONFIG['risk']['max_position_pct']))

        credit_veto = bool(latest['Credit_Veto'])
        market_active = bool(latest['Market_Active'])
        recovery_ready = bool(latest['Recovery_Ready'])
        falling_knife = bool(latest['Falling_Knife'])
        confidence_assessment = latest['Confidence_Assessment']
        confidence = int(confidence_assessment["effective_confidence_pct"])
        uncertainty_pct = int(confidence_assessment["uncertainty_pct"])
        abstain = bool(confidence_assessment["abstain"])
        size_multiplier = float(confidence_assessment["size_multiplier"])
        adverse_regime = dict(confidence_assessment.get("adverse_regime", {}) or {})
        base_position_pct = max_position_pct_cfg * market.position_sizing * 100
        position_size_pct = round(max(1.0, base_position_pct * size_multiplier), 2)
        size_label = (
            "FULL"
            if position_size_pct >= base_position_pct * 0.95
            else "STANDARD"
            if position_size_pct >= base_position_pct * 0.7
            else "STARTER"
        )

        churn_proxy = churn_penalty_proxy(recovery_ready=recovery_ready, falling_knife=falling_knife)
        downside_proxy = downside_risk_proxy(data['close'])
        trade_quality = build_trade_quality_score(
            raw_setup_score=total_score,
            setup_scale=12,
            confidence_pct=confidence_assessment.get('raw_confidence_pct', confidence),
            uncertainty_pct=uncertainty_pct,
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
        risk_size_multiplier = risk_adjusted_size_multiplier(
            downside_penalty=trade_quality.get('downside_penalty', 0.0),
            churn_penalty=trade_quality.get('churn_penalty', 0.0),
        )
        position_size_pct = round(max(1.0, position_size_pct * risk_size_multiplier), 2)
        size_label = (
            "FULL"
            if position_size_pct >= base_position_pct * 0.95
            else "STANDARD"
            if position_size_pct >= base_position_pct * 0.7
            else "STARTER"
        )

        recommendation_base = {
            'score': total_score,
            'trade_quality_score': trade_quality['score'],
            'trade_quality': trade_quality,
            'downside_penalty': trade_quality.get('downside_penalty', 0.0),
            'churn_penalty': trade_quality.get('churn_penalty', 0.0),
            'confidence': confidence,
            'raw_confidence': int(confidence_assessment["raw_confidence_pct"]),
            'effective_confidence': confidence,
            'uncertainty_pct': uncertainty_pct,
            'confidence_assessment': confidence_assessment,
            'abstain': abstain,
            'abstain_reason_codes': confidence_assessment.get('abstain_reason_codes', []),
            'abstain_reasons': confidence_assessment.get('abstain_reasons', []),
            'adverse_regime': adverse_regime,
            'size_label': size_label,
            'market_note': getattr(market, 'notes', ''),
        }

        if credit_veto:
            recommendation = {
                'action': 'NO_BUY',
                'reason': 'Credit veto active (HY spread too high).',
                **recommendation_base,
            }
        elif falling_knife:
            recommendation = {
                'action': 'NO_BUY',
                'reason': 'Falling-knife filter active: wait for bounce confirmation above the short-term trend.',
                **recommendation_base,
            }
        elif not market_active:
            recommendation = {
                'action': 'NO_BUY',
                'reason': 'Dip Buyer inactive outside correction / under-pressure regimes.',
                **recommendation_base,
            }
        elif abstain:
            recommendation = {
                'action': 'WATCH',
                'reason': f"Uncertainty too high ({uncertainty_pct}%): {' | '.join(confidence_assessment.get('abstain_reasons', [])[:2])}",
                **recommendation_base,
            }
        elif total_score >= buy_threshold and recovery_ready:
            stop_price = price * (1 - stop_loss_pct)
            recommendation = {
                'action': 'BUY',
                'entry': price,
                'stop_loss': stop_price,
                'stop_loss_pct': stop_loss_pct * 100,
                'position_size_pct': position_size_pct,
                'reasons': [
                    f"Quality score {int(latest['Q'])}/4",
                    f"Sentiment score {int(latest['V'])}/4",
                    f"Credit score {int(latest['C'])}/4",
                    f"Recovered {latest['Rebound_Pct'] * 100:.1f}% off the recent low",
                    f"Size as {size_label.lower()} entry ({confidence}% confidence, {uncertainty_pct}% uncertainty)",
                    (
                        f"Adverse regime {adverse_regime.get('label')} ({float(adverse_regime.get('score', 0.0)):.0f}): "
                        f"{adverse_regime.get('reason')}"
                    )
                    if adverse_regime.get('label') != 'normal'
                    else "Adverse regime: normal",
                ],
                **recommendation_base,
            }
        elif total_score >= buy_threshold and not recovery_ready:
            recommendation = {
                'action': 'WATCH',
                'reason': f'Score {total_score}/12 is buyable, but recovery confirmation is still missing.',
                **recommendation_base,
            }
        elif total_score >= watch_threshold:
            recommendation = {
                'action': 'WATCH',
                'reason': f'Score {total_score}/12 in watch zone (need >= {buy_threshold} plus recovery confirmation for BUY).',
                **recommendation_base,
            }
        else:
            recommendation = {
                'action': 'NO_BUY',
                'reason': f'Score too low ({total_score}/12). Need >= {watch_threshold} to WATCH.',
                **recommendation_base,
            }

        return {
            'price': price,
            'scores': {
                'Q': int(latest['Q']),
                'V': int(latest['V']),
                'C': int(latest['C']),
            },
            'total_score': total_score,
            'rsi': float(latest['RSI']) if pd.notna(latest['RSI']) else float('nan'),
            'market_active': market_active,
            'credit_veto': credit_veto,
            'recovery_ready': recovery_ready,
            'falling_knife': falling_knife,
            'pullback_pct': float(latest['Pullback_Pct']),
            'rebound_pct': float(latest['Rebound_Pct']),
            'five_day_return_pct': float(latest['FiveDay_Return']) * 100,
            'profile': profile_name,
            'buy_threshold': buy_threshold,
            'watch_threshold': watch_threshold,
            'confidence': confidence,
            'raw_confidence': int(confidence_assessment["raw_confidence_pct"]),
            'effective_confidence': confidence,
            'uncertainty_pct': uncertainty_pct,
            'abstain': abstain,
            'abstain_reason_codes': confidence_assessment.get('abstain_reason_codes', []),
            'abstain_reasons': confidence_assessment.get('abstain_reasons', []),
            'confidence_assessment': confidence_assessment,
            'trade_quality_score': trade_quality['score'],
            'trade_quality': trade_quality,
            'adverse_regime': adverse_regime,
            'recommendation': recommendation,
            'score_frame': scores,
        }

    def generate_signals(self, data: pd.DataFrame, verbose: bool = False) -> pd.Series:
        """
        Generate buy/sell signals for the Dip Buyer strategy.
        """
        data = data.copy()
        data.columns = [c.lower() for c in data.columns]
        signals = pd.Series(0, index=data.index)
        market = self.market_detector.get_status()
        self._scores = self.build_score_frame(data, market=market)

        buy_condition = (
            self._scores['Market_Active']
            & (self._scores['Total'] >= self._scores['Buy_Threshold'])
            & (~self._scores['Credit_Veto'])
            & self._scores['Recovery_Ready']
            & (~self._scores['Falling_Knife'])
            & (~self._scores['Abstain'])
        )
        sell_condition = (~self._scores['Market_Active']) | self._scores['Credit_Veto'] | self._scores['Falling_Knife']

        signals[buy_condition] = 1
        signals[sell_condition] = -1

        if verbose:
            latest = self._scores.iloc[-1]
            print(f"[DipBuyer] Regime: {market.regime.value} | Market Active: {bool(latest['Market_Active'])}")
            print(
                "[DipBuyer] Risk Snapshot: "
                f"VIX={latest['VIX']:.2f}, Put/Call={latest['PutCall']:.2f}, "
                f"HY={latest['HY_Spread']:.2f}, Fear={latest['FearProxy']:.2f}"
            )
            print(
                "[DipBuyer] Score Breakdown (latest): "
                f"Q={latest['Q']}, V={latest['V']}, C={latest['C']}, Total={latest['Total']}"
            )
            print(
                "[DipBuyer] Recovery Filter (latest): "
                f"RecoveryReady={bool(latest['Recovery_Ready'])}, "
                f"FallingKnife={bool(latest['Falling_Knife'])}, "
                f"Pullback={latest['Pullback_Pct'] * 100:.1f}%, "
                f"Rebound={latest['Rebound_Pct'] * 100:.1f}%"
            )
            print("[DipBuyer] Total Score Distribution:")
            print(self._scores['Total'].value_counts().sort_index().to_string())

        return signals

    def should_use_stop_loss(self) -> bool:
        return True

    def stop_loss_pct(self) -> float:
        if self.active_profile == "correction":
            return float(self.active_profile_config.get("risk", {}).get("hard_stop", DIPBUYER_CONFIG["exits"]["hard_stop"]))
        return DIPBUYER_CONFIG["exits"]["hard_stop"]

    def get_current_scores(self) -> pd.DataFrame:
        return self._scores if hasattr(self, '_scores') else None

    def get_active_profile(self) -> tuple[str, dict]:
        return self.active_profile, self.active_profile_config

    def describe(self) -> str:
        return f"""
╔══════════════════════════════════════════════════════════════╗
║                    DIP BUYER STRATEGY                        ║
╠══════════════════════════════════════════════════════════════╣
║ Active in: CORRECTION or UPTREND UNDER PRESSURE              ║
║ Buy Score:   >= {self.min_buy_score}/12                      ║
║ Watch Score: >= {self.min_watch_score}/12                    ║
║
║ Entry Plan (3 tranches):                                     ║
║   • 1/3 initial entry                                        ║
║   • 1/3 at -3% from entry                                    ║
║   • 1/3 on breadth stabilization                             ║
║
║ Exit Plan:                                                   ║
║   • Trim 1/3 at +8%                                          ║
║   • Trim 1/3 at +12%                                         ║
║   • Trail the runner                                         ║
║   • Hard stop: 7%                                            ║
║   • Credit veto exits fully                                 ║
║
║ Risk Limits:                                                 ║
║   • Max position: 6% of portfolio                            ║
║   • Max exposure: 25% (correction) / 40% (under pressure)    ║
║   • Max positions: 5                                         ║
╚══════════════════════════════════════════════════════════════╝
"""


if __name__ == "__main__":
    print("=== Testing Dip Buyer Strategy ===")
    strategy = DipBuyerStrategy()
    print(strategy.describe())
