from unittest.mock import MagicMock

import pandas as pd

from advisor import TradingAdvisor
from evaluation.comparison import (
    attach_model_family_scores,
    build_default_model_families,
    compare_model_families,
    render_model_comparison_report,
    score_enhanced_rank,
)
from scoring_tuning import ModelComparisonCalibration


def test_attach_model_family_scores_builds_wave4_comparison_columns():
    frame = pd.DataFrame(
        [
            {
                "symbol": "NVDA",
                "total_score": 8,
                "breakout_score": 4,
                "sentiment_score": 1,
                "exit_risk_score": 1,
                "sector_score": 1,
                "catalyst_score": 0,
            }
        ]
    )

    scored = attach_model_family_scores(frame)

    assert scored.loc[0, "baseline_score"] == 8.0
    assert scored.loc[0, "tactical_score"] == 10.25
    assert scored.loc[0, "enhanced_score"] == score_enhanced_rank(8, 4, 1, 1, sector_score=1, catalyst_score=0)


def test_compare_model_families_reports_selection_overlap_and_restraint_metrics():
    candidates = pd.DataFrame(
        [
            {
                "symbol": "AAA",
                "total_score": 9,
                "breakout_score": 4,
                "sentiment_score": 0,
                "exit_risk_score": 0,
                "sector_score": 1,
                "catalyst_score": 0,
                "confidence": 72,
                "effective_confidence": 68,
                "uncertainty_pct": 12,
                "trade_quality_score": 88.0,
                "downside_penalty": 4.0,
                "churn_penalty": 2.0,
                "adverse_regime_score": 16.0,
                "adverse_regime_label": "normal",
                "action": "BUY",
                "future_return_pct": 5.0,
                "outcome_bucket": "win",
            },
            {
                "symbol": "BBB",
                "total_score": 8,
                "breakout_score": 5,
                "sentiment_score": 0,
                "exit_risk_score": 2,
                "sector_score": 0,
                "catalyst_score": 0,
                "confidence": 65,
                "effective_confidence": 60,
                "uncertainty_pct": 18,
                "trade_quality_score": 74.0,
                "downside_penalty": 9.0,
                "churn_penalty": 5.0,
                "adverse_regime_score": 24.0,
                "adverse_regime_label": "caution",
                "action": "BUY",
                "future_return_pct": -1.0,
                "outcome_bucket": "loss",
            },
            {
                "symbol": "CCC",
                "total_score": 7,
                "breakout_score": 4,
                "sentiment_score": 2,
                "exit_risk_score": 0,
                "sector_score": 1,
                "catalyst_score": 1,
                "confidence": 80,
                "effective_confidence": 75,
                "uncertainty_pct": 10,
                "trade_quality_score": 92.0,
                "downside_penalty": 3.0,
                "churn_penalty": 1.0,
                "adverse_regime_score": 14.0,
                "adverse_regime_label": "normal",
                "action": "WATCH",
                "future_return_pct": 8.0,
                "outcome_bucket": "win",
            },
            {
                "symbol": "DDD",
                "total_score": 7,
                "breakout_score": 1,
                "sentiment_score": -2,
                "exit_risk_score": 3,
                "sector_score": 0,
                "catalyst_score": 0,
                "confidence": 55,
                "effective_confidence": 44,
                "uncertainty_pct": 28,
                "trade_quality_score": 51.0,
                "downside_penalty": 12.0,
                "churn_penalty": 8.0,
                "adverse_regime_score": 36.0,
                "adverse_regime_label": "elevated",
                "action": "WATCH",
                "future_return_pct": -4.0,
                "outcome_bucket": "loss",
            },
            {
                "symbol": "EEE",
                "total_score": 6,
                "breakout_score": 5,
                "sentiment_score": 2,
                "exit_risk_score": 0,
                "sector_score": 1,
                "catalyst_score": 1,
                "confidence": 84,
                "effective_confidence": 78,
                "uncertainty_pct": 9,
                "trade_quality_score": 95.0,
                "downside_penalty": 2.0,
                "churn_penalty": 1.0,
                "adverse_regime_score": 12.0,
                "adverse_regime_label": "normal",
                "action": "BUY",
                "future_return_pct": 12.0,
                "outcome_bucket": "win",
            },
        ]
    )

    families = build_default_model_families(top_n=2, baseline_min_score=7)
    summary, selections = compare_model_families(candidates, families, baseline_name="baseline_total")

    assert list(summary["model"]) == ["baseline_total", "tactical_overlay", "enhanced_rank"]
    baseline = summary[summary["model"] == "baseline_total"].iloc[0]
    enhanced = summary[summary["model"] == "enhanced_rank"].iloc[0]

    assert list(selections["baseline_total"]["symbol"]) == ["AAA", "BBB"]
    assert list(selections["enhanced_rank"]["symbol"]) == ["AAA", "CCC"]
    assert baseline["selected_count"] == 2
    assert baseline["avg_trade_quality_score"] == 81.0
    assert baseline["avg_downside_penalty"] == 6.5
    assert baseline["avg_churn_penalty"] == 3.5
    assert baseline["avg_adverse_regime_score"] == 20.0
    assert baseline["top_adverse_regime_label"] == "caution"
    assert baseline["hit_rate_pct"] == 50.0
    assert baseline["loss_rate_pct"] == 50.0
    assert baseline["restraint_count"] == 0
    assert baseline["buy_avg_future_return_pct"] == 2.0
    assert enhanced["overlap_with_baseline"] == 1
    assert enhanced["model_only_count"] == 1
    assert enhanced["baseline_only_count"] == 1
    assert enhanced["avg_future_return_pct"] > baseline["avg_future_return_pct"]
    assert enhanced["hit_rate_pct"] == 100.0
    assert enhanced["win_rate_pct"] == 100.0
    assert enhanced["restraint_count"] == 1
    assert enhanced["restraint_rate_pct"] == 50.0
    assert enhanced["buy_avg_future_return_pct"] == 5.0
    assert enhanced["restraint_avg_future_return_pct"] == 8.0
    assert enhanced["avoided_baseline_bad_outcome_count"] == 1
    assert enhanced["missed_baseline_good_outcome_count"] == 0


def test_render_model_comparison_report_lists_unique_picks_and_discipline_lines():
    candidates = pd.DataFrame(
        [
            {
                "symbol": "AAA",
                "total_score": 9,
                "breakout_score": 4,
                "sentiment_score": 0,
                "exit_risk_score": 0,
                "sector_score": 1,
                "catalyst_score": 0,
                "confidence": 72,
                "effective_confidence": 68,
                "uncertainty_pct": 12,
                "trade_quality_score": 88.0,
                "downside_penalty": 4.0,
                "churn_penalty": 2.0,
                "adverse_regime_score": 16.0,
                "adverse_regime_label": "normal",
                "action": "BUY",
                "future_return_pct": 5.0,
                "outcome_bucket": "win",
            },
            {
                "symbol": "BBB",
                "total_score": 8,
                "breakout_score": 5,
                "sentiment_score": 0,
                "exit_risk_score": 2,
                "sector_score": 0,
                "catalyst_score": 0,
                "confidence": 65,
                "effective_confidence": 60,
                "uncertainty_pct": 18,
                "trade_quality_score": 74.0,
                "downside_penalty": 9.0,
                "churn_penalty": 5.0,
                "adverse_regime_score": 24.0,
                "adverse_regime_label": "caution",
                "action": "BUY",
                "future_return_pct": -1.0,
                "outcome_bucket": "loss",
            },
            {
                "symbol": "CCC",
                "total_score": 7,
                "breakout_score": 4,
                "sentiment_score": 2,
                "exit_risk_score": 0,
                "sector_score": 1,
                "catalyst_score": 1,
                "confidence": 80,
                "effective_confidence": 75,
                "uncertainty_pct": 10,
                "trade_quality_score": 92.0,
                "downside_penalty": 3.0,
                "churn_penalty": 1.0,
                "adverse_regime_score": 14.0,
                "adverse_regime_label": "normal",
                "action": "WATCH",
                "future_return_pct": 8.0,
                "outcome_bucket": "win",
            },
        ]
    )
    families = build_default_model_families(top_n=2, baseline_min_score=7)
    summary, selections = compare_model_families(candidates, families, baseline_name="baseline_total")

    report = render_model_comparison_report(summary, selections, baseline_name="baseline_total")

    assert "Wave 4 Model Comparison" in report
    assert "baseline_total: picked 2" in report
    assert "enhanced_rank: picked 2" in report
    assert "avg tq" in report
    assert "eff conf" in report
    assert "avg downside/churn proxy" in report
    assert "avg stress" in report
    assert "restraint 1 (50.0%)" in report
    assert "overlap vs baseline_total" in report
    assert "avoided baseline bad outcomes 1" in report
    assert "discipline: buy avg return +5.00% | restrained avg return +8.00%" in report
    assert "picks: AAA, CCC" in report
    assert "risk: AAA | BUY | tq 88.0 | conf 68% u 12% | down 4.0 churn 2.0 | stress normal/16" in report
    assert "Review slices:" in report
    assert "Regime split (adverse_regime_label):" in report
    assert "normal (2 cands): baseline_total 1 [AAA] +5.00%/100.0%; tactical_overlay 1 [AAA] +5.00%/100.0%; enhanced_rank 2 [AAA, CCC] +6.50%/100.0%" in report


def test_render_model_comparison_report_adds_time_review_slices_when_dates_exist():
    candidates = pd.DataFrame(
        [
            {
                "symbol": "AAA",
                "total_score": 9,
                "breakout_score": 1,
                "sentiment_score": 0,
                "exit_risk_score": 0,
                "sector_score": 0,
                "catalyst_score": 0,
                "market_regime": "confirmed_uptrend",
                "entry_date": "2025-01-02",
                "future_return_pct": 2.0,
                "outcome_bucket": "win",
                "action": "BUY",
            },
            {
                "symbol": "BBB",
                "total_score": 8,
                "breakout_score": 1,
                "sentiment_score": 0,
                "exit_risk_score": 0,
                "sector_score": 0,
                "catalyst_score": 0,
                "market_regime": "correction",
                "entry_date": "2025-01-03",
                "future_return_pct": -3.0,
                "outcome_bucket": "loss",
                "action": "BUY",
            },
            {
                "symbol": "CCC",
                "total_score": 7,
                "breakout_score": 4,
                "sentiment_score": 0,
                "exit_risk_score": 0,
                "sector_score": 0,
                "catalyst_score": 0,
                "market_regime": "confirmed_uptrend",
                "entry_date": "2025-02-10",
                "future_return_pct": 6.0,
                "outcome_bucket": "win",
                "action": "BUY",
            },
            {
                "symbol": "DDD",
                "total_score": 6,
                "breakout_score": 5,
                "sentiment_score": 0,
                "exit_risk_score": 0,
                "sector_score": 0,
                "catalyst_score": 0,
                "market_regime": "correction",
                "entry_date": "2025-02-11",
                "future_return_pct": 8.0,
                "outcome_bucket": "win",
                "action": "BUY",
            },
        ]
    )

    families = build_default_model_families(top_n=2, baseline_min_score=6)
    summary, selections = compare_model_families(candidates, families, baseline_name="baseline_total")
    report = render_model_comparison_report(summary, selections, baseline_name="baseline_total")

    assert [section["title"] for section in summary.attrs["review_slices"]] == [
        "Regime split (market_regime)",
        "Time split (entry_date)",
    ]
    assert "Time split (entry_date):" in report
    assert "early 2025-01-02..2025-01-03 (2 cands):" in report
    assert "late 2025-02-10..2025-02-11 (2 cands):" in report


def test_render_model_comparison_report_keeps_no_buy_and_abstain_visible():
    candidates = pd.DataFrame(
        [
            {
                "symbol": "AAA",
                "total_score": 9,
                "breakout_score": 1,
                "sentiment_score": -1,
                "exit_risk_score": 3,
                "sector_score": 0,
                "catalyst_score": 0,
                "confidence": 40,
                "effective_confidence": 32,
                "uncertainty_pct": 38,
                "trade_quality_score": 61.0,
                "downside_penalty": 10.0,
                "churn_penalty": 6.0,
                "adverse_regime_score": 44.0,
                "adverse_regime_label": "elevated",
                "action": "NO_BUY",
                "abstain": True,
                "future_return_pct": -6.0,
                "outcome_bucket": "loss",
            },
            {
                "symbol": "BBB",
                "total_score": 8,
                "breakout_score": 2,
                "sentiment_score": 1,
                "exit_risk_score": 0,
                "sector_score": 1,
                "catalyst_score": 0,
                "confidence": 78,
                "effective_confidence": 74,
                "uncertainty_pct": 8,
                "trade_quality_score": 84.0,
                "downside_penalty": 3.0,
                "churn_penalty": 1.0,
                "adverse_regime_score": 12.0,
                "adverse_regime_label": "normal",
                "action": "BUY",
                "abstain": False,
                "future_return_pct": 4.0,
                "outcome_bucket": "win",
            },
        ]
    )

    families = build_default_model_families(top_n=1, baseline_min_score=7)
    summary, selections = compare_model_families(candidates, families, baseline_name="baseline_total")

    assert list(selections["baseline_total"]["symbol"]) == ["AAA"]
    baseline = summary[summary["model"] == "baseline_total"].iloc[0]
    assert baseline["restraint_count"] == 1
    assert baseline["abstain_count"] == 1
    assert baseline["restraint_bad_outcome_count"] == 1
    assert baseline["veto_preserved_bad_outcome_count"] == 1

    report = render_model_comparison_report(summary, selections, baseline_name="baseline_total")

    assert "baseline_total: picked 1" in report
    assert "no-buy 1" in report
    assert "restraint 1 (100.0%)" in report
    assert "abstain 1" in report
    assert "discipline: restrained avg return -6.00% | restraint bad-outcome proxy 1 | veto-preserved bad outcomes 1" in report
    assert "risk: AAA | NO_BUY | tq 61.0 | conf 32% u 38% | down 10.0 churn 6.0 | stress elevated/44 | ABSTAIN" in report


def test_compare_model_families_keeps_score_based_selection_unchanged():
    candidates = pd.DataFrame(
        [
            {
                "symbol": "AAA",
                "total_score": 9,
                "breakout_score": 1,
                "sentiment_score": -1,
                "exit_risk_score": 3,
                "sector_score": 0,
                "catalyst_score": 0,
                "confidence": 40,
                "effective_confidence": 32,
                "uncertainty_pct": 38,
                "trade_quality_score": 61.0,
                "downside_penalty": 10.0,
                "churn_penalty": 6.0,
                "action": "NO_BUY",
                "abstain": True,
                "future_return_pct": -8.0,
                "outcome_bucket": "loss",
            },
            {
                "symbol": "BBB",
                "total_score": 8,
                "breakout_score": 2,
                "sentiment_score": 1,
                "exit_risk_score": 0,
                "sector_score": 1,
                "catalyst_score": 0,
                "confidence": 78,
                "effective_confidence": 74,
                "uncertainty_pct": 8,
                "trade_quality_score": 84.0,
                "downside_penalty": 3.0,
                "churn_penalty": 1.0,
                "action": "BUY",
                "abstain": False,
                "future_return_pct": 4.0,
                "outcome_bucket": "win",
            },
            {
                "symbol": "CCC",
                "total_score": 7,
                "breakout_score": 5,
                "sentiment_score": 2,
                "exit_risk_score": 0,
                "sector_score": 1,
                "catalyst_score": 1,
                "confidence": 88,
                "effective_confidence": 84,
                "uncertainty_pct": 6,
                "trade_quality_score": 95.0,
                "downside_penalty": 2.0,
                "churn_penalty": 1.0,
                "action": "BUY",
                "abstain": False,
                "future_return_pct": 12.0,
                "outcome_bucket": "win",
            },
        ]
    )

    families = build_default_model_families(top_n=2, baseline_min_score=7)
    _, selections = compare_model_families(candidates, families, baseline_name="baseline_total")

    assert list(selections["baseline_total"]["symbol"]) == ["AAA", "BBB"]
    assert list(selections["enhanced_rank"]["symbol"]) == ["CCC", "BBB"]


def test_compare_model_families_skips_review_slices_without_context_columns():
    candidates = pd.DataFrame(
        [
            {
                "symbol": "AAA",
                "total_score": 8,
                "breakout_score": 3,
                "sentiment_score": 1,
                "exit_risk_score": 0,
                "sector_score": 0,
                "catalyst_score": 0,
                "future_return_pct": 4.0,
                "outcome_bucket": "win",
                "action": "BUY",
            },
            {
                "symbol": "BBB",
                "total_score": 7,
                "breakout_score": 2,
                "sentiment_score": 0,
                "exit_risk_score": 0,
                "sector_score": 0,
                "catalyst_score": 0,
                "future_return_pct": -1.0,
                "outcome_bucket": "loss",
                "action": "BUY",
            },
        ]
    )

    families = build_default_model_families(top_n=2, baseline_min_score=6)
    summary, selections = compare_model_families(candidates, families, baseline_name="baseline_total")
    report = render_model_comparison_report(summary, selections, baseline_name="baseline_total")

    assert summary.attrs["review_slices"] == []
    assert "Review slices:" not in report


def test_advisor_compare_model_families_reuses_scan_output():
    advisor = TradingAdvisor()
    advisor.scan_for_opportunities = MagicMock(
        return_value=pd.DataFrame(
            [
                {
                    "symbol": "AAA",
                    "total_score": 8,
                    "breakout_score": 3,
                    "sentiment_score": 1,
                    "exit_risk_score": 1,
                    "sector_score": 1,
                    "catalyst_score": 0,
                    "rank_score": 10.0,
                    "confidence": 78,
                    "action": "BUY",
                    "adverse_regime_label": "normal",
                },
                {
                    "symbol": "BBB",
                    "total_score": 7,
                    "breakout_score": 5,
                    "sentiment_score": 2,
                    "exit_risk_score": 0,
                    "sector_score": 1,
                    "catalyst_score": 1,
                    "rank_score": 12.0,
                    "confidence": 83,
                    "action": "WATCH",
                    "adverse_regime_label": "caution",
                },
            ]
        )
    )

    result = advisor.compare_model_families(quick=True, min_score=6, top_n=2)

    assert list(result["summary"]["model"]) == ["baseline_total", "tactical_overlay", "enhanced_rank"]
    assert result["review_slices"][0]["title"] == "Regime split (adverse_regime_label)"
    assert "enhanced_rank" in result["report"]
    assert "Review slices:" in result["report"]
    assert "BBB" in result["report"]


def test_model_comparison_calibration_changes_overlay_weights_and_default_thresholds():
    frame = pd.DataFrame(
        [
            {
                "symbol": "NVDA",
                "total_score": 8,
                "breakout_score": 4,
                "sentiment_score": 1,
                "exit_risk_score": 1,
                "sector_score": 1,
                "catalyst_score": 0,
            }
        ]
    )
    calibration = ModelComparisonCalibration(
        breakout_weight=1.0,
        sentiment_weight=0.25,
        sector_weight=0.5,
        catalyst_weight=0.0,
        exit_risk_weight=1.0,
        baseline_min_score=8.5,
    )

    scored = attach_model_family_scores(frame, calibration=calibration)
    families = build_default_model_families(top_n=3, calibration=calibration)

    assert scored.loc[0, "tactical_score"] == 11.0
    assert scored.loc[0, "enhanced_score"] == 11.75
    assert score_enhanced_rank(8, 4, 1, 1, sector_score=1, catalyst_score=0, calibration=calibration) == 11.75
    assert families[0].min_score == 8.5
