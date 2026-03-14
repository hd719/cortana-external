from unittest.mock import MagicMock

from advisor import TradingAdvisor

def test_analyze_dip_stock_uses_resilient_helper_path(monkeypatch):
    advisor = TradingAdvisor()
    advisor.get_market_status = MagicMock(return_value=object())
    advisor.risk_fetcher.get_snapshot = MagicMock(return_value={"vix": 25.0})

    expected = {"symbol": "NVDA", "total_score": 8, "recommendation": {"action": "BUY"}}
    helper = MagicMock(return_value=expected)
    monkeypatch.setattr(advisor, "_analyze_dip_with_context", helper)

    result = advisor.analyze_dip_stock("NVDA")

    assert result == expected
    helper.assert_called_once_with("NVDA", advisor.get_market_status.return_value, {"vix": 25.0}, quiet=False)

def test_scan_dip_opportunities_uses_resilient_helper_path(monkeypatch):
    advisor = TradingAdvisor()
    from data.market_regime import MarketRegime
    market = MagicMock()
    market.regime = MarketRegime.CORRECTION
    advisor.get_market_status = MagicMock(return_value=market)
    advisor.risk_fetcher.get_snapshot = MagicMock(return_value={"vix": 25.0})
    advisor.screener.get_universe = MagicMock(return_value=["NVDA", "META"])

    monkeypatch.setattr(
        advisor,
        "_analyze_dip_with_context",
        MagicMock(
            side_effect=[
                {"symbol": "NVDA", "price": 100.0, "rsi": 30.0, "scores": {"Q": 3, "V": 3, "C": 2}, "total_score": 8, "recommendation": {"action": "BUY"}},
                {"symbol": "META", "price": 200.0, "rsi": 35.0, "scores": {"Q": 2, "V": 2, "C": 2}, "total_score": 6, "recommendation": {"action": "WATCH"}},
            ]
        ),
    )

    df = advisor.scan_dip_opportunities(quick=False, min_score=6)

    assert list(df["symbol"]) == ["NVDA", "META"]
    assert list(df["total_score"]) == [8, 6]

def test_scan_dip_opportunities_prioritizes_buyable_lower_uncertainty_setups(monkeypatch):
    advisor = TradingAdvisor()
    from data.market_regime import MarketRegime
    market = MagicMock()
    market.regime = MarketRegime.CORRECTION
    advisor.get_market_status = MagicMock(return_value=market)
    advisor.risk_fetcher.get_snapshot = MagicMock(return_value={"vix": 25.0})
    advisor.screener.get_universe = MagicMock(return_value=["AAA", "BBB"])

    monkeypatch.setattr(
        advisor,
        "_analyze_dip_with_context",
        MagicMock(
            side_effect=[
                {
                    "symbol": "AAA",
                    "price": 100.0,
                    "rsi": 30.0,
                    "scores": {"Q": 3, "V": 3, "C": 3},
                    "total_score": 9,
                    "confidence": 43,
                    "effective_confidence": 43,
                    "uncertainty_pct": 39,
                    "abstain": True,
                    "abstain_reason_codes": ["risk_data_incomplete"],
                    "recommendation": {"action": "WATCH", "position_size_pct": 0.0, "size_label": "STARTER"},
                },
                {
                    "symbol": "BBB",
                    "price": 95.0,
                    "rsi": 32.0,
                    "scores": {"Q": 3, "V": 2, "C": 3},
                    "total_score": 8,
                    "confidence": 76,
                    "effective_confidence": 76,
                    "uncertainty_pct": 8,
                    "abstain": False,
                    "abstain_reason_codes": [],
                    "recommendation": {"action": "BUY", "position_size_pct": 4.5, "size_label": "STANDARD"},
                },
            ]
        ),
    )

    df = advisor.scan_dip_opportunities(quick=False, min_score=6)

    assert list(df["symbol"]) == ["BBB", "AAA"]
    assert list(df["action"]) == ["BUY", "WATCH"]
    assert list(df["abstain"]) == [False, True]

def test_scan_dip_opportunities_keeps_vetoed_high_score_setup_below_buyable_trade(monkeypatch):
    advisor = TradingAdvisor()
    from data.market_regime import MarketRegime
    market = MagicMock()
    market.regime = MarketRegime.CORRECTION
    advisor.get_market_status = MagicMock(return_value=market)
    advisor.risk_fetcher.get_snapshot = MagicMock(return_value={"vix": 25.0})
    advisor.screener.get_universe = MagicMock(return_value=["AAA", "BBB"])

    monkeypatch.setattr(
        advisor,
        "_analyze_dip_with_context",
        MagicMock(
            side_effect=[
                {
                    "symbol": "AAA",
                    "price": 100.0,
                    "rsi": 30.0,
                    "scores": {"Q": 3, "V": 3, "C": 3},
                    "total_score": 9,
                    "confidence": 42,
                    "effective_confidence": 42,
                    "uncertainty_pct": 38,
                    "abstain": True,
                    "abstain_reason_codes": ["credit_veto"],
                    "trade_quality_score": 34.0,
                    "recommendation": {"action": "NO_BUY", "position_size_pct": 0.0, "size_label": "STARTER"},
                },
                {
                    "symbol": "BBB",
                    "price": 95.0,
                    "rsi": 32.0,
                    "scores": {"Q": 3, "V": 2, "C": 2},
                    "total_score": 7,
                    "confidence": 74,
                    "effective_confidence": 74,
                    "uncertainty_pct": 9,
                    "abstain": False,
                    "abstain_reason_codes": [],
                    "trade_quality_score": 83.0,
                    "recommendation": {"action": "BUY", "position_size_pct": 4.5, "size_label": "STANDARD"},
                },
            ]
        ),
    )

    df = advisor.scan_dip_opportunities(quick=False, min_score=6)

    assert list(df["symbol"]) == ["BBB", "AAA"]
    assert list(df["action"]) == ["BUY", "NO_BUY"]



def test_scan_dip_opportunities_prefers_cleaner_recovery_when_scores_are_close(monkeypatch):
    advisor = TradingAdvisor()
    from data.market_regime import MarketRegime
    market = MagicMock()
    market.regime = MarketRegime.CORRECTION
    advisor.get_market_status = MagicMock(return_value=market)
    advisor.risk_fetcher.get_snapshot = MagicMock(return_value={"vix": 25.0})
    advisor.screener.get_universe = MagicMock(return_value=["AAA", "BBB"])

    monkeypatch.setattr(
        advisor,
        "_analyze_dip_with_context",
        MagicMock(
            side_effect=[
                {
                    "symbol": "AAA",
                    "price": 100.0,
                    "rsi": 31.0,
                    "scores": {"Q": 3, "V": 3, "C": 2},
                    "total_score": 8,
                    "confidence": 78,
                    "effective_confidence": 78,
                    "uncertainty_pct": 7,
                    "abstain": False,
                    "abstain_reason_codes": [],
                    "trade_quality_score": 88.0,
                    "trade_quality": {"downside_penalty": 13.0, "churn_penalty": 6.0},
                    "recommendation": {"action": "BUY", "position_size_pct": 2.5, "size_label": "STARTER"},
                },
                {
                    "symbol": "BBB",
                    "price": 96.0,
                    "rsi": 33.0,
                    "scores": {"Q": 3, "V": 2, "C": 2},
                    "total_score": 7,
                    "confidence": 76,
                    "effective_confidence": 76,
                    "uncertainty_pct": 8,
                    "abstain": False,
                    "abstain_reason_codes": [],
                    "trade_quality_score": 88.0,
                    "trade_quality": {"downside_penalty": 4.0, "churn_penalty": 2.0},
                    "recommendation": {"action": "BUY", "position_size_pct": 4.5, "size_label": "STANDARD"},
                },
            ]
        ),
    )

    df = advisor.scan_dip_opportunities(quick=False, min_score=6)

    assert list(df["symbol"]) == ["BBB", "AAA"]
