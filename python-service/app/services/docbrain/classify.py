"""Zero-shot banking-doc classification via Llama.

The 12-class taxonomy is the shared baseline; tenants can extend it. Classes
are explicit (not "Other") because softmax confidence is only meaningful
against a closed set.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import List, Optional

from .llm import chat_json

log = logging.getLogger(__name__)

DOC_CLASSES: List[str] = [
    "Passport",
    "National ID",
    "Driving Licence",
    "Utility Bill",
    "Salary Certificate",
    "Bank Statement",
    "Loan Application",
    "Credit Card Application",
    "Contract",
    "Power of Attorney",
    "Trade Licence",
    "Compliance Filing",
]


@dataclass
class ClassificationResult:
    doc_class: str            # one of DOC_CLASSES or "Unknown"
    confidence: float         # 0..1
    reasoning: str            # short rationale for audit
    alternative: Optional[str] = None  # second-best class if close call


SYSTEM_PROMPT = """You are DocBrain, a banking document classifier.
You are given OCR text from a customer-submitted document.
Classify it into exactly one of these classes:

  {classes}

If the document clearly doesn't fit any class, use "Unknown".
Reply as a JSON object with these fields:
  "doc_class":   string (one of the classes above, or "Unknown")
  "confidence":  number between 0 and 1
  "reasoning":   one-sentence rationale citing the evidence
  "alternative": the second-best class (or null)

Be conservative. If the OCR text is garbled or too short to decide, return
"Unknown" with low confidence.
""".format(classes="\n  ".join(f"- {c}" for c in DOC_CLASSES))


def _build_bias_block(text: str) -> str:
    """
    Call nearest_schemas() and format the top-3 matches as a few-shot hint
    block to prepend to the system prompt. Returns an empty string if no
    samples are indexed or the import fails.
    """
    try:
        from .doctype_learner import nearest_schemas  # lazy; avoids circular import
        matches = nearest_schemas(text, top_k=3)
    except Exception:  # noqa: BLE001
        return ""

    if not matches:
        return ""

    lines = ["Based on stored sample embeddings, strong matches are:"]
    for m in matches:
        name = m.get("name", "Unknown")
        sim  = m.get("similarity", 0.0)
        pct  = round(sim * 100)
        lines.append(f"  - {name} ({pct}%)")
    lines.append(
        "Use these hints unless the document clearly differs from those types."
    )
    return "\n".join(lines)


def classify_document(
    ocr_text: str,
    *,
    max_chars: int = 4000,
    use_sample_bias: bool = True,
) -> ClassificationResult:
    """
    One-shot classification. We trim very long OCR text to keep latency
    predictable on dev-grade hardware; the head of the doc is usually
    sufficient for class (titles, issuing authority, etc. appear early).

    When use_sample_bias=True (default), nearest_schemas() is called before
    the LLM to inject top-3 sample-based hints into the system prompt.
    Existing callers without the kwarg continue to work unchanged.
    """
    if not ocr_text or len(ocr_text.strip()) < 20:
        return ClassificationResult(
            doc_class="Unknown", confidence=0.0,
            reasoning="OCR text too short for reliable classification.",
        )

    snippet = ocr_text.strip()[:max_chars]

    # Build the effective system prompt.
    effective_prompt = SYSTEM_PROMPT

    if use_sample_bias:
        bias_block = _build_bias_block(snippet)
        if bias_block:
            effective_prompt = SYSTEM_PROMPT + "\n\n" + bias_block

    reply = chat_json(effective_prompt, snippet, temperature=0.0)

    doc_class = str(reply.get("doc_class", "Unknown"))
    if doc_class not in DOC_CLASSES and doc_class != "Unknown":
        # Defensive: coerce anything off-taxonomy to Unknown.
        log.warning("classifier returned off-taxonomy class %r", doc_class)
        doc_class = "Unknown"

    try:
        confidence = float(reply.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))

    return ClassificationResult(
        doc_class=doc_class,
        confidence=round(confidence, 3),
        reasoning=str(reply.get("reasoning", "")).strip()[:280],
        alternative=(reply.get("alternative") or None),
    )
