"""AI-assisted dashboard narration (§SC-01).

Narrates the current dashboard metrics — what's happening, anomalies, SLA/expiry
risks — via the on-prem text model. Always returns a useful, deterministic
baseline summary; the LLM enhances it when available, and on any failure the
baseline is returned with degraded=true (no error). The completion fn is
injectable so tests run without a model.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Awaitable, Callable, Optional

from zordms_ai.inference import ollama_client

logger = logging.getLogger(__name__)

CompleteFn = Callable[..., Awaitable[str]]

# Known KPI keys → human phrasing (numeric). Unknown numeric keys are appended generically.
_KPI_LABELS = {
    "totalDocuments": "total documents",
    "pendingReview": "pending review",
    "indexedToday": "indexed today",
    "expiringSoon": "expiring within 90 days",
    "slaBreached": "SLA-breached items",
    "activeBranches": "active branches",
}


def summarize_metrics(metrics: dict[str, Any]) -> str:
    """Deterministic baseline narrative from the metrics — always useful."""
    parts: list[str] = []
    for key, label in _KPI_LABELS.items():
        if key in metrics and isinstance(metrics[key], (int, float)):
            parts.append(f"{int(metrics[key])} {label}")
    # Append any other numeric metrics not in the known set.
    for key, val in metrics.items():
        if key not in _KPI_LABELS and isinstance(val, (int, float)):
            parts.append(f"{int(val)} {key}")

    if not parts:
        return "No metrics available to summarize."

    summary = "Today: " + ", ".join(parts) + "."
    risks: list[str] = []
    if isinstance(metrics.get("pendingReview"), (int, float)) and metrics["pendingReview"] > 0:
        risks.append(f"{int(metrics['pendingReview'])} document(s) await review")
    if isinstance(metrics.get("expiringSoon"), (int, float)) and metrics["expiringSoon"] > 0:
        risks.append(f"{int(metrics['expiringSoon'])} document(s) expiring soon — schedule renewals")
    if isinstance(metrics.get("slaBreached"), (int, float)) and metrics["slaBreached"] > 0:
        risks.append(f"{int(metrics['slaBreached'])} SLA breach(es) need attention")
    if risks:
        summary += " Attention: " + "; ".join(risks) + "."
    return summary


async def _ollama_complete(prompt: str, *, system: str, settings: Any) -> str:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None,
        lambda: ollama_client.text_complete(
            prompt,
            model=getattr(settings, "ollama_text_model", "granite3.3:8b"),
            base_url=getattr(settings, "ollama_base_url", "http://localhost:11434"),
            timeout=getattr(settings, "ollama_timeout_s", 180.0),
            system=system,
        ),
    )


async def generate_insights(
    metrics: dict[str, Any],
    *,
    settings: Any,
    complete: Optional[CompleteFn] = None,
) -> dict:
    """Return {narrative, degraded}. LLM prose when available, else the baseline."""
    baseline = summarize_metrics(metrics)
    fn = complete or _ollama_complete
    system = (
        "You are a Bank of Bhutan DMS operations analyst. Given today's metrics, write 2–3 "
        "concise sentences on what's happening, any anomalies, and SLA/expiry risks. Use the "
        "actual numbers. No preamble."
    )
    prompt = f"Metrics (JSON): {json.dumps(metrics)}\nBaseline: {baseline}"
    try:
        out = (await fn(prompt, system=system, settings=settings) or "").strip()
    except Exception as exc:  # noqa: BLE001 — degrade on any model/transport error
        logger.warning("insights degraded (%s); returning baseline", exc)
        out = ""
    if not out:
        return {"narrative": baseline, "degraded": True}
    return {"narrative": out, "degraded": False}
