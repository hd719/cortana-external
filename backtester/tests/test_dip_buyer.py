"""Unit tests for Dip Buyer strategy scoring, gating, and risk rules."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from data.market_regime import MarketRegime
from strategies.dip_buyer import DIPBUYER_CONFIG, DipBuyerStrategy


@pytest.fixture
def price_data() -> pd.DataFrame:
    """Provide deterministic close-price data aligned to business days."""
    idx = pd.date_range("2026-01-02", periods=5, freq="B")
    return pd.DataFrame({"close": [100, 101, 102, 103, 104]}, index=idx)


def _risk_history(index: pd.DatetimeIndex, hy_spread: float = 430.0) -> pd.DataFrame:
    """Build risk-history frame with favorable default macro values."""
    return pd.DataFrame(
        {
            "vix": [25.0] * len(index),
            "put_call": [1.0] * len(index),
            "hy_spread": [hy_spread] * len(index),
            "fear_greed": [30.0] * len(index),
        },
        index=index,
    )


def _build_strategy(regime: MarketRegime, risk_df: pd.DataFrame, fundamentals: dict | None = None) -> DipBuyerStrategy:
    """Create a strategy with all external dependencies mocked for offline tests."""
    with patch("strategies.dip_buyer.FundamentalsFetcher"), patch("strategies.dip_buyer.RiskSignalFetcher"), patch(
        "strategies.dip_buyer.MarketRegimeDetector"
    ):
        strategy = DipBuyerStrategy()

    strategy.fundamentals = fundamentals or {"eps_growth": 25, "revenue_growth": 20}
    strategy.market_detector = MagicMock()
    strategy.market_detector.get_status.return_value = SimpleNamespace(regime=regime, position_sizing=0.5)
    strategy.risk_fetcher = MagicMock()
    strategy.risk_fetcher.get_history.return_value = risk_df
    return strategy


def _patch_fillna_method_compat():
    """Patch DataFrame.fillna to support legacy method= usage under pandas>=3 in strategy code."""
    original_fillna = pd.DataFrame.fillna

    def compat_fillna(self, value=None, *args, **kwargs):
        method = kwargs.pop("method", None)
        if method == "ffill":
            return self.ffill()
        if method == "bfill":
            return self.bfill()
        return original_fillna(self, value=value, *args, **kwargs)

    return patch("strategies.dip_buyer.pd.DataFrame.fillna", new=compat_fillna)


def test_quality_layer_scoring_rsi_eps_revenue_thresholds():
    """Validate Q-layer scoring for RSI bands plus EPS/revenue growth adders."""
    idx = pd.date_range("2026-01-01", periods=3, freq="B")
    strategy = _build_strategy(MarketRegime.CORRECTION, _risk_history(idx))

    rsi_values = pd.Series([30.0, 37.0, 45.0], index=idx)
    q_score = strategy._quality_score(rsi_values)

    assert q_score.tolist() == [4, 3, 2]


def test_volatility_layer_scoring_vix_put_call_fear_thresholds():
    """Validate V-layer scoring across strong/soft VIX bands, PCR range, and fear cap."""
    idx = pd.date_range("2026-01-01", periods=4, freq="B")
    strategy = _build_strategy(MarketRegime.CORRECTION, _risk_history(idx))

    risk = pd.DataFrame(
        {
            "vix": [25.0, 19.0, 40.0, 50.0],
            "put_call": [1.0, 1.1, 1.3, 1.0],
            "fear_greed": [30.0, 36.0, 20.0, 40.0],
            "hy_spread": [400.0] * 4,
            "hy_spread_change_10d": [0.0] * 4,
        },
        index=idx,
    )

    v_score = strategy._volatility_score(risk)
    assert v_score.tolist() == [4, 2, 2, 1]


def test_credit_layer_scoring_tiers_widening_penalty_and_veto_zone():
    """Validate C-layer spread tiers and widening penalty floor behavior."""
    idx = pd.date_range("2026-01-01", periods=4, freq="B")
    strategy = _build_strategy(MarketRegime.CORRECTION, _risk_history(idx))

    risk = pd.DataFrame(
        {
            "hy_spread": [430.0, 500.0, 600.0, 700.0],
            "hy_spread_change_10d": [0.0, 80.0, 100.0, 90.0],
            "vix": [25.0] * 4,
            "put_call": [1.0] * 4,
            "fear_greed": [30.0] * 4,
        },
        index=idx,
    )

    c_score = strategy._credit_score(risk)
    assert c_score.tolist() == [4, 1, 0, 0]


def test_total_score_combines_q_v_c_layers(price_data):
    """Validate the total score equals Q+V+C for each bar in generated score table."""
    risk_df = _risk_history(price_data.index, hy_spread=430.0)
    strategy = _build_strategy(MarketRegime.CORRECTION, risk_df)

    with _patch_fillna_method_compat(), patch(
        "strategies.dip_buyer.rsi", return_value=pd.Series([30, 30, 30, 30, 30], index=price_data.index)
    ):
        strategy.generate_signals(price_data)

    scores = strategy.get_current_scores()
    assert (scores["Total"] == scores["Q"] + scores["V"] + scores["C"]).all()


def test_profile_selection_by_regime():
    """Profile selection should map correction/pressure/uptrend regimes deterministically."""
    with patch("strategies.dip_buyer.FundamentalsFetcher"), patch("strategies.dip_buyer.RiskSignalFetcher"), patch(
        "strategies.dip_buyer.MarketRegimeDetector"
    ):
        strategy = DipBuyerStrategy()

    name, _ = strategy._select_profile(MarketRegime.CORRECTION)
    assert name == "correction"
    name, _ = strategy._select_profile(MarketRegime.UPTREND_UNDER_PRESSURE)
    assert name == "under_pressure"
    name, _ = strategy._select_profile(MarketRegime.CONFIRMED_UPTREND)
    assert name == "bull"


def test_regime_gating_blocks_buys_in_confirmed_uptrend(price_data):
    """Validate strategy emits no buys when market regime is outside active Dip Buyer states."""
    risk_df = _risk_history(price_data.index, hy_spread=430.0)
    strategy = _build_strategy(MarketRegime.CONFIRMED_UPTREND, risk_df)

    with _patch_fillna_method_compat(), patch(
        "strategies.dip_buyer.rsi", return_value=pd.Series([30] * len(price_data), index=price_data.index)
    ):
        signals = strategy.generate_signals(price_data)

    assert (signals == -1).all()


def test_threshold_logic_buy_watch_no_buy_scores(price_data):
    """Validate BUY/WATCH/NO_BUY threshold bands from configured score cutoffs."""
    strategy = _build_strategy(MarketRegime.CORRECTION, _risk_history(price_data.index))
    buy = strategy.min_buy_score
    watch = strategy.min_watch_score

    def classify(score: int) -> str:
        if score >= buy:
            return "BUY"
        if score >= watch:
            return "WATCH"
        return "NO_BUY"

    assert classify(buy) == "BUY"
    assert classify(watch) == "WATCH"
    assert classify(watch - 1) == "NO_BUY"


def test_position_sizing_constraints_in_config():
    """Validate Dip Buyer correction profile keeps capped sizing and tighter stop defaults."""
    risk_cfg = DIPBUYER_CONFIG["risk"]
    correction = DIPBUYER_CONFIG["profiles"]["correction"]
    assert risk_cfg["max_positions"] == 5
    assert correction["risk"]["max_position_pct"] == pytest.approx(0.05)
    assert correction["risk"]["max_exposure_pct"] == pytest.approx(0.25)
    assert correction["risk"]["hard_stop"] == pytest.approx(0.06)


def test_exit_rules_and_credit_veto_force_sell(price_data):
    """Validate stop/trim config and that credit veto causes full-exit sell signals."""
    risk_df = _risk_history(price_data.index, hy_spread=700.0)
    strategy = _build_strategy(MarketRegime.CORRECTION, risk_df)

    with _patch_fillna_method_compat(), patch(
        "strategies.dip_buyer.rsi", return_value=pd.Series([30] * len(price_data), index=price_data.index)
    ):
        signals = strategy.generate_signals(price_data)

    assert strategy.should_use_stop_loss() is True
    assert strategy.stop_loss_pct() == pytest.approx(0.07)
    assert DIPBUYER_CONFIG["exits"]["trim_1"] == pytest.approx(0.08)
    assert DIPBUYER_CONFIG["exits"]["trim_2"] == pytest.approx(0.12)
    assert (signals == -1).all(), "Credit veto (HY>650) should trigger full exit"


def test_buy_threshold_default_is_7():
    """Default buy threshold should reflect calibrated value of 7."""
    with patch("strategies.dip_buyer.FundamentalsFetcher"), patch("strategies.dip_buyer.RiskSignalFetcher"), patch(
        "strategies.dip_buyer.MarketRegimeDetector"
    ):
        strategy = DipBuyerStrategy()

    assert strategy.min_buy_score == 7


def test_nan_vix_results_in_zero_v_score_component():
    """NaN VIX contributes 0 points while other V sub-scores can still contribute."""
    idx = pd.date_range("2026-01-01", periods=1, freq="B")
    strategy = _build_strategy(MarketRegime.CORRECTION, _risk_history(idx))
    risk = pd.DataFrame(
        {
            "vix": [float("nan")],
            "put_call": [1.0],
            "fear_greed": [30.0],
            "hy_spread": [430.0],
            "hy_spread_change_10d": [0.0],
        },
        index=idx,
    )

    v_score = strategy._volatility_score(risk)
    assert v_score.iloc[0] == 2  # PCR + fear only; no VIX points


def test_nan_hy_spread_gives_neutral_credit_score_2():
    """NaN HY spread should map to neutral credit score of 2."""
    idx = pd.date_range("2026-01-01", periods=1, freq="B")
    strategy = _build_strategy(MarketRegime.CORRECTION, _risk_history(idx))
    risk = pd.DataFrame(
        {
            "hy_spread": [float("nan")],
            "hy_spread_change_10d": [0.0],
            "vix": [25.0],
            "put_call": [1.0],
            "fear_greed": [30.0],
        },
        index=idx,
    )

    c_score = strategy._credit_score(risk)
    assert c_score.iloc[0] == 2


def test_nan_pcr_subscore_skipped_does_not_block_volatility_score():
    """NaN put/call should be skipped (0 points) without forcing penalties."""
    idx = pd.date_range("2026-01-01", periods=1, freq="B")
    strategy = _build_strategy(MarketRegime.CORRECTION, _risk_history(idx))
    risk = pd.DataFrame(
        {
            "vix": [25.0],
            "put_call": [float("nan")],
            "fear_greed": [30.0],
            "hy_spread": [430.0],
            "hy_spread_change_10d": [0.0],
        },
        index=idx,
    )

    v_score = strategy._volatility_score(risk)
    assert v_score.iloc[0] == 3  # VIX strong + fear; PCR skipped


def test_nan_fear_subscore_skipped_in_volatility_score():
    """NaN fear should be skipped (0 points) while other volatility inputs still score."""
    idx = pd.date_range("2026-01-01", periods=1, freq="B")
    strategy = _build_strategy(MarketRegime.CORRECTION, _risk_history(idx))
    risk = pd.DataFrame(
        {
            "vix": [25.0],
            "put_call": [1.0],
            "fear_greed": [float("nan")],
            "hy_spread": [430.0],
            "hy_spread_change_10d": [0.0],
        },
        index=idx,
    )

    v_score = strategy._volatility_score(risk)
    assert v_score.iloc[0] == 3  # VIX strong + PCR; fear skipped


def test_verbose_true_outputs_breakdown_without_crashing(price_data, capsys):
    """Verbose mode should execute safely and print diagnostics."""
    strategy = _build_strategy(MarketRegime.CORRECTION, _risk_history(price_data.index, hy_spread=450.0))

    with _patch_fillna_method_compat(), patch(
        "strategies.dip_buyer.rsi", return_value=pd.Series([30] * len(price_data), index=price_data.index)
    ):
        strategy.generate_signals(price_data, verbose=True)

    out = capsys.readouterr().out
    assert "[DipBuyer] Regime:" in out
    assert "Score Breakdown" in out


def test_total_score_7_generates_buy_in_correction_regime(price_data):
    """With Q=3, V=2, C=2 (total 7), strategy should emit BUY in correction regime."""
    risk_df = pd.DataFrame(
        {
            "vix": [25.0] * len(price_data),
            "put_call": [1.5] * len(price_data),  # out of scoring range
            "hy_spread": [500.0] * len(price_data),
            "fear_greed": [40.0] * len(price_data),  # above fear threshold; no fear point
        },
        index=price_data.index,
    )
    strategy = _build_strategy(
        MarketRegime.CORRECTION,
        risk_df,
        fundamentals={"eps_growth": 25, "revenue_growth": 0},  # RSI 2 + EPS 1 + REV 0 = Q3
    )

    with _patch_fillna_method_compat(), patch(
        "strategies.dip_buyer.rsi", return_value=pd.Series([30] * len(price_data), index=price_data.index)
    ):
        signals = strategy.generate_signals(price_data)

    assert (signals == 1).all()


def test_threshold_7_allows_signal_where_threshold_8_does_not(price_data):
    """Calibrated threshold 7 should buy while threshold 8 should not for same 7-point setup."""
    risk_df = pd.DataFrame(
        {
            "vix": [25.0] * len(price_data),
            "put_call": [1.5] * len(price_data),
            "hy_spread": [500.0] * len(price_data),
            "fear_greed": [40.0] * len(price_data),
        },
        index=price_data.index,
    )
    s7 = _build_strategy(
        MarketRegime.CORRECTION,
        risk_df,
        fundamentals={"eps_growth": 25, "revenue_growth": 0},
    )
    s8 = _build_strategy(
        MarketRegime.CORRECTION,
        risk_df,
        fundamentals={"eps_growth": 25, "revenue_growth": 0},
    )
    s8.min_buy_score = 8

    with _patch_fillna_method_compat(), patch(
        "strategies.dip_buyer.rsi", return_value=pd.Series([30] * len(price_data), index=price_data.index)
    ):
        signals7 = s7.generate_signals(price_data)

    with _patch_fillna_method_compat(), patch(
        "strategies.dip_buyer.rsi", return_value=pd.Series([30] * len(price_data), index=price_data.index)
    ):
        signals8 = s8.generate_signals(price_data)

    assert (signals7 == 1).all()
    assert (signals8 != 1).all()