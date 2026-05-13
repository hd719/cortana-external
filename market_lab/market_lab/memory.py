from __future__ import annotations

from collections import Counter

from .models import OutcomeMemorySummary, RunRecord, TrustVerdict


def build_outcome_memory_summary(
    *,
    symbol: str,
    prior_runs: list[RunRecord],
    prior_settlements: dict[str, list[dict]],
) -> OutcomeMemorySummary:
    evidence_ready = [run for run in prior_runs if run.trust_verdict == TrustVerdict.TRUSTED]
    needs_context = [run for run in prior_runs if run.trust_verdict == TrustVerdict.UNCERTAIN]
    blocked = [run for run in prior_runs if run.trust_verdict == TrustVerdict.BLOCKED]

    settled_success = 0
    settled_count = 0
    alpha_values: list[float] = []
    missing_counter: Counter[str] = Counter()

    for run in evidence_ready:
        for settlement in prior_settlements.get(run.run_id, []):
            if settlement.get("status") != "settled":
                continue
            settled_count += 1
            if settlement.get("score") == "success":
                settled_success += 1
            alpha = settlement.get("alpha_vs_spy_pct")
            if isinstance(alpha, (int, float)):
                alpha_values.append(float(alpha))
        for reason in run.verdict_reasons:
            if "missing" in reason:
                missing_counter[reason] += 1

    success_rate = settled_success / settled_count if settled_count else None
    avg_alpha = sum(alpha_values) / len(alpha_values) if alpha_values else None
    return OutcomeMemorySummary(
        symbol=symbol,
        lookback_runs=len(prior_runs),
        evidence_ready_count=len(evidence_ready),
        needs_more_context_count=len(needs_context),
        blocked_count=len(blocked),
        settled_count=settled_count,
        evidence_ready_success_rate=success_rate,
        evidence_ready_avg_alpha_vs_spy_pct=avg_alpha,
        common_missing_context=[item for item, _count in missing_counter.most_common(5)],
        notes=[] if prior_runs else ["No prior same-symbol Market Lab runs."],
    )
