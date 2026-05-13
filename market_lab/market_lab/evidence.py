from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from .models import CheckResult, EvidenceSnapshot, OptionalEvidence, PriceFacts, SentimentSnapshot


def _fact_summary(facts: PriceFacts | None) -> dict[str, Any]:
    if facts is None:
        return {"status": "missing"}
    return {
        "status": "available",
        "symbol": facts.symbol,
        "price": facts.price,
        "timestamp": facts.timestamp.isoformat(),
        "source": facts.source,
        "provider_mode": facts.provider_mode,
        "price_basis": facts.price_basis,
        "volume": facts.volume,
    }


def _missing_context(optional: OptionalEvidence, sentiment: SentimentSnapshot | None) -> list[str]:
    missing: list[str] = []
    for label, status in [
        ("history", optional.history_status),
        ("fundamentals", optional.fundamentals_status),
        ("news", optional.news_status),
        ("sentiment", optional.sentiment_status),
    ]:
        if status != "available":
            missing.append(label)
    if sentiment:
        missing.extend(item for item in sentiment.missing_sources if item not in missing)
    return missing


def build_evidence_snapshot(
    *,
    symbol: str,
    price_facts: PriceFacts | None,
    spy_facts: PriceFacts | None,
    checks: list[CheckResult],
    optional_evidence: OptionalEvidence,
    sentiment_snapshot: SentimentSnapshot | None = None,
) -> EvidenceSnapshot:
    blockers = [item.code for item in checks if item.severity == "blocker"]
    warnings = [item.code for item in checks if item.severity == "warning"]
    news_summary = None
    sentiment_summary = None
    if sentiment_snapshot:
        news_sources = [item for item in sentiment_snapshot.sources if item.source == "yahoo_finance_news"]
        social_sources = [item for item in sentiment_snapshot.sources if item.source in {"stocktwits", "reddit"}]
        news_summary = {
            "status": news_sources[0].status if news_sources else "missing",
            "sources": [item.model_dump(mode="json") for item in news_sources],
        }
        sentiment_summary = {
            "status": sentiment_snapshot.status,
            "sources": [item.model_dump(mode="json") for item in social_sources],
            "notes": sentiment_snapshot.notes,
        }
    return EvidenceSnapshot(
        symbol=symbol,
        generated_at=datetime.now(UTC),
        price_summary=_fact_summary(price_facts),
        benchmark_summary=_fact_summary(spy_facts),
        momentum_summary={"status": "missing", "reason": "momentum adapter is deterministic but not yet enriched"},
        fundamentals_summary={"status": optional_evidence.fundamentals_status},
        news_summary=news_summary or {"status": optional_evidence.news_status},
        sentiment_summary=sentiment_summary or {"status": optional_evidence.sentiment_status},
        risk_flags=blockers + warnings,
        missing_context=_missing_context(optional_evidence, sentiment_snapshot),
        check_summary=[item.model_dump(mode="json") for item in checks],
    )
