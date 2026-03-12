"""Compact live decision-review helpers for operator-facing alert output."""

from __future__ import annotations

from collections import Counter
from statistics import median
from textwrap import shorten
from typing import Iterable, Mapping


def _clean_text(value: object, *, width: int = 84) -> str:
    text = " ".join(str(value or "").strip().split())
    if not text:
        return ""
    return shorten(text, width=width, placeholder="...")


def _safe_float(value: object) -> float | None:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if numeric != numeric:
        return None
    return numeric


def _action(record: Mapping[str, object]) -> str:
    return str(record.get("action", "NO_BUY") or "NO_BUY").strip().upper()


def _stress_label(record: Mapping[str, object]) -> str:
    return str(record.get("adverse_regime_label", "") or "").strip()


def _is_risky_buy(record: Mapping[str, object]) -> bool:
    if _action(record) != "BUY":
        return False
    if bool(record.get("abstain", False)):
        return True

    uncertainty_pct = _safe_float(record.get("uncertainty_pct")) or 0.0
    if uncertainty_pct >= 25.0:
        return True

    return _stress_label(record).lower() not in {"", "normal"}


def _veto_tags(record: Mapping[str, object]) -> list[str]:
    tags = []
    for key, label in (
        ("credit_veto", "credit"),
        ("sentiment_veto", "sentiment"),
        ("exit_risk_veto", "exit-risk"),
        ("market_regime_blocked", "market-gate"),
        ("falling_knife", "falling-knife"),
        ("market_inactive", "inactive"),
    ):
        if bool(record.get(key, False)):
            tags.append(label)

    reason = _clean_text(record.get("reason")).lower()
    if "veto" in reason and "reason-veto" not in tags:
        tags.append("reason-veto")
    if "gate" in reason and "market-gate" not in tags:
        tags.append("market-gate")
    if "no new positions" in reason and "market-gate" not in tags:
        tags.append("market-gate")
    return tags


def _format_detail(
    record: Mapping[str, object],
    *,
    include_abstain_reasons: bool = False,
    include_veto: bool = False,
    include_reason: bool = False,
) -> str:
    symbol = str(record.get("symbol", "") or "").strip()
    if not symbol:
        return ""

    parts = [f"{symbol} {_action(record)}"]

    trade_quality = _safe_float(record.get("trade_quality_score"))
    if trade_quality is not None:
        parts.append(f"tq {trade_quality:.1f}")

    confidence = _safe_float(record.get("effective_confidence", record.get("confidence")))
    uncertainty_pct = _safe_float(record.get("uncertainty_pct"))
    if confidence is not None or uncertainty_pct is not None:
        conf_bits = []
        if confidence is not None:
            conf_bits.append(f"conf {confidence:.0f}%")
        if uncertainty_pct is not None:
            conf_bits.append(f"u {uncertainty_pct:.0f}%")
        parts.append(" ".join(conf_bits))

    downside_penalty = _safe_float(record.get("downside_penalty"))
    churn_penalty = _safe_float(record.get("churn_penalty"))
    if downside_penalty is not None or churn_penalty is not None:
        parts.append(f"down/churn {(downside_penalty or 0.0):.1f}/{(churn_penalty or 0.0):.1f}")

    stress_label = _stress_label(record)
    stress_score = _safe_float(record.get("adverse_regime_score"))
    if stress_label or stress_score is not None:
        parts.append(f"stress {(stress_label or 'normal')}({(stress_score or 0.0):.0f})")

    if bool(record.get("abstain", False)):
        parts.append("ABSTAIN")
        if include_abstain_reasons:
            abstain_reasons = record.get("abstain_reasons") or []
            if isinstance(abstain_reasons, str):
                abstain_reasons = [abstain_reasons]
            reason_text = " | ".join(
                _clean_text(reason, width=48)
                for reason in list(abstain_reasons)[:2]
                if _clean_text(reason, width=48)
            )
            if reason_text:
                parts.append(f"reasons {reason_text}")

    if include_veto:
        tags = _veto_tags(record)
        if tags:
            parts.append(f"veto {'/'.join(tags)}")

    if include_reason:
        reason = _clean_text(record.get("reason"))
        if reason:
            parts.append(f"reason {reason}")

    return " | ".join(parts)


def _format_group(
    label: str,
    records: list[Mapping[str, object]],
    *,
    detail_limit: int,
    include_abstain_reasons: bool = False,
    include_veto: bool = False,
    include_reason: bool = False,
) -> str:
    shown = [
        _format_detail(
            record,
            include_abstain_reasons=include_abstain_reasons,
            include_veto=include_veto,
            include_reason=include_reason,
        )
        for record in records[:detail_limit]
    ]
    shown = [detail for detail in shown if detail]
    if not shown:
        return ""

    suffix = f" (+{len(records) - detail_limit} more)" if len(records) > detail_limit else ""
    return f"{label}: {'; '.join(shown)}{suffix}"


def render_decision_review(
    records: Iterable[Mapping[str, object]],
    *,
    detail_limit: int = 2,
) -> list[str]:
    """Render a compact decision-review block for live alert output."""
    material = [record for record in records if str(record.get("symbol", "") or "").strip()]
    if not material:
        return []

    action_counts = Counter(_action(record) for record in material)
    buys = [record for record in material if _action(record) == "BUY"]
    clean_buys = [record for record in buys if not _is_risky_buy(record)]
    risky_buys = [record for record in buys if _is_risky_buy(record)]
    abstains = [record for record in material if bool(record.get("abstain", False))]
    vetoes = [record for record in material if _veto_tags(record)]

    buy_trade_quality = [
        trade_quality
        for trade_quality in (_safe_float(record.get("trade_quality_score")) for record in buys)
        if trade_quality is not None
    ]
    restraint_floor = median(buy_trade_quality) if buy_trade_quality else None
    higher_tq_restraint = []
    if restraint_floor is not None:
        higher_tq_restraint = [
            record
            for record in material
            if _action(record) != "BUY"
            and (_safe_float(record.get("trade_quality_score")) or float("-inf")) >= restraint_floor
        ]

    lines = [
        (
            "Decision review: "
            f"BUY {action_counts.get('BUY', 0)} | "
            f"WATCH {action_counts.get('WATCH', 0)} | "
            f"NO_BUY {action_counts.get('NO_BUY', 0)}"
        )
    ]
    balance = (
        f"Tuning balance: clean BUY {len(clean_buys)} | "
        f"risky BUY proxy {len(risky_buys)} | "
        f"abstain {len(abstains)} | veto {len(vetoes)}"
    )
    if restraint_floor is None:
        balance += " | higher-tq restraint proxy n/a"
    else:
        balance += f" | higher-tq restraint proxy {len(higher_tq_restraint)} (>= median BUY tq {restraint_floor:.1f})"
    lines.append(balance)

    review_groups = []
    if not higher_tq_restraint and not vetoes:
        review_groups.append(_format_group("Good buys", clean_buys, detail_limit=detail_limit))
    review_groups.extend(
        [
            _format_group("Risky buys", risky_buys, detail_limit=detail_limit),
            _format_group("Higher-tq restraint", higher_tq_restraint, detail_limit=detail_limit, include_reason=True),
            _format_group("Abstains", abstains, detail_limit=detail_limit, include_abstain_reasons=True, include_reason=True),
            _format_group("Vetoes", vetoes, detail_limit=detail_limit, include_veto=True, include_reason=True),
        ]
    )
    for line in review_groups:
        if line:
            lines.append(line)

    return lines
