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
  - BUY: >= 8
  - WATCH: >= 6
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Dict

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))

from strategies.base import Strategy
from indicators import rsi
from data.fundamentals import FundamentalsFetcher
from data.market_regime import MarketRegimeDetector, MarketRegime
from data.risk_signals import RiskSignalFetcher


DIPBUYER_CONFIG = {
    "score_thresholds": {
        "buy": 8,
        "watch": 6,
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

        vix = risk['vix']
        put_call = risk['put_call']
        fear = risk['fear_greed']

        vix_score = pd.Series(0, index=risk.index)
        vix_score[(vix >= cfg["vix_strong"][0]) & (vix <= cfg["vix_strong"][1])] = 2

        soft_ranges = cfg["vix_soft"]
        vix_score[
            ((vix >= soft_ranges[0][0]) & (vix < soft_ranges[0][1])) |
            ((vix > soft_ranges[1][0]) & (vix <= soft_ranges[1][1]))
        ] = 1

        put_call_score = pd.Series(0, index=risk.index)
        put_call_score[(put_call >= cfg["put_call_range"][0]) & (put_call <= cfg["put_call_range"][1])] = 1

        fear_score = pd.Series(0, index=risk.index)
        fear_score[fear <= cfg["fear_proxy_max"]] = 1

        return vix_score + put_call_score + fear_score

    def _credit_score(self, risk: pd.DataFrame) -> pd.Series:
        cfg = DIPBUYER_CONFIG["credit"]
        hy_spread = risk['hy_spread']
        widening = risk['hy_spread_change_10d'] > cfg["spread_widening_bps"]

        credit_score = pd.Series(0, index=risk.index)
        credit_score[hy_spread < cfg["hy_spread_strong"]] = 4
        credit_score[(hy_spread >= cfg["hy_spread_strong"]) & (hy_spread < cfg["hy_spread_moderate"])] = 2
        credit_score[(hy_spread >= cfg["hy_spread_moderate"]) & (hy_spread < cfg["hy_spread_weak"])] = 1

        credit_score = credit_score.where(~widening, credit_score - 1)
        credit_score = credit_score.clip(lower=0)

        return credit_score

    def generate_signals(self, data: pd.DataFrame) -> pd.Series:
        """
        Generate buy/sell signals for the Dip Buyer strategy.
        """
        close = data['close']
        signals = pd.Series(0, index=data.index)

        market = self.market_detector.get_status()
        market_active = market.regime in [
            MarketRegime.CORRECTION,
            MarketRegime.UPTREND_UNDER_PRESSURE,
        ]

        rsi_values = rsi(close, self.rsi_period)
        q_score = self._quality_score(rsi_values)

        risk_history = self.risk_fetcher.get_history(days=max(len(data), 200))
        risk_history.index = pd.to_datetime(risk_history.index).tz_localize(None)
        data_index = pd.to_datetime(data.index).tz_localize(None)
        risk = risk_history.reindex(data_index, method='ffill')
        risk.index = data.index
        risk = risk.fillna(method='ffill').fillna(method='bfill')

        # Fill missing values with neutral defaults
        risk = risk.fillna({
            'vix': 20.0,
            'put_call': 1.0,
            'hy_spread': 500.0,
            'fear_greed': 50.0,
        })
        risk['hy_spread_change_10d'] = risk['hy_spread'].diff(10).fillna(0)

        v_score = self._volatility_score(risk)
        c_score = self._credit_score(risk)

        total_score = q_score + v_score + c_score

        credit_veto = risk['hy_spread'] > DIPBUYER_CONFIG["credit"]["hy_spread_weak"]

        buy_condition = market_active & (total_score >= self.min_buy_score) & (~credit_veto)
        sell_condition = (~market_active) | credit_veto

        signals[buy_condition] = 1
        signals[sell_condition] = -1

        self._scores = pd.DataFrame({
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
            'Credit_Veto': credit_veto,
        }, index=data.index)

        return signals

    def should_use_stop_loss(self) -> bool:
        return True

    def stop_loss_pct(self) -> float:
        return DIPBUYER_CONFIG["exits"]["hard_stop"]

    def get_current_scores(self) -> pd.DataFrame:
        return self._scores if hasattr(self, '_scores') else None

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
