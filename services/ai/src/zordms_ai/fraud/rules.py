"""Rule-based AML / fraud screening (§5.5).

This is deterministic first-line detection — the rules real AML programs run
before any ML layer: CTR threshold, structuring (amounts just under threshold),
round-amount, watchlist/sanctions name match, high-risk geography, and velocity.
No model required, so it runs offline and is fully tested. ML anomaly scoring is
a future enhancement that would layer on top of these flags.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

# Default CTR reporting threshold (overridable per deployment).
DEFAULT_CTR_THRESHOLD = 1_000_000.0
# Structuring window: an amount in [structuring_ratio * threshold, threshold).
STRUCTURING_RATIO = 0.9

HIGH_RISK_COUNTRIES = {"KP", "IR", "MM", "SY"}  # illustrative FATF high-risk set

# Severity → numeric weight for the aggregate risk score.
_WEIGHT = {"low": 0.15, "medium": 0.35, "high": 0.6, "critical": 1.0}


@dataclass
class Flag:
    rule: str
    severity: str  # low | medium | high | critical
    message: str


def _num(v: Any) -> Optional[float]:
    try:
        return float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def _norm(name: str) -> str:
    return " ".join(str(name).lower().split())


def screen(
    record: dict[str, Any],
    *,
    ctr_threshold: float = DEFAULT_CTR_THRESHOLD,
    watchlist: Optional[list[str]] = None,
) -> dict[str, Any]:
    """Screen a transaction/party record; return risk flags + score + band."""
    flags: list[Flag] = []
    amount = _num(record.get("amount"))
    wl = {_norm(n) for n in (watchlist or [])}

    # 1. CTR threshold — large cash transactions must be reported.
    if amount is not None and amount >= ctr_threshold:
        flags.append(Flag("ctr_threshold", "high", f"amount {amount:.0f} ≥ CTR threshold {ctr_threshold:.0f}"))

    # 2. Structuring — amount deliberately just under the threshold.
    if amount is not None and ctr_threshold * STRUCTURING_RATIO <= amount < ctr_threshold:
        flags.append(Flag("possible_structuring", "high", f"amount {amount:.0f} sits just under the CTR threshold"))

    # 3. Round-amount — large, suspiciously round figures.
    if amount is not None and amount >= 500_000 and amount % 100_000 == 0:
        flags.append(Flag("round_amount", "low", f"large round amount {amount:.0f}"))

    # 4. Watchlist / sanctions / PEP name match.
    for key in ("subject", "counterparty", "name", "beneficiary"):
        val = record.get(key)
        if val and _norm(val) in wl:
            flags.append(Flag("watchlist_hit", "critical", f"{key} '{val}' matches the screening watchlist"))

    # 5. High-risk geography.
    country = str(record.get("country", "")).upper().strip()
    if country in HIGH_RISK_COUNTRIES:
        flags.append(Flag("high_risk_country", "high", f"counterparty country '{country}' is high-risk"))

    # 6. Velocity — many transactions in the window.
    count = _num(record.get("transaction_count"))
    if count is not None and count >= 10:
        flags.append(Flag("high_velocity", "medium", f"{int(count)} transactions in the period"))

    # Aggregate score (capped at 1.0) + band.
    score = min(1.0, round(sum(_WEIGHT.get(f.severity, 0.0) for f in flags), 3))
    if any(f.severity == "critical" for f in flags):
        band = "critical"
    elif score >= 0.6:
        band = "high"
    elif score >= 0.3:
        band = "medium"
    elif score > 0:
        band = "low"
    else:
        band = "clear"

    return {
        "flagged": bool(flags),
        "risk_score": score,
        "risk_band": band,
        "flags": [f.__dict__ for f in flags],
    }
