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


def classify_document(ocr_text: str, *, max_chars: int = 4000) -> ClassificationResult:
    """
    One-shot classification. We trim very long OCR text to keep latency
    predictable on dev-grade hardware; the head of the doc is usually
    sufficient for class (titles, issuing authority, etc. appear early).
    """
    if not ocr_text or len(ocr_text.strip()) < 20:
        return ClassificationResult(
            doc_class="Unknown", confidence=0.0,
            reasoning="OCR text too short for reliable classification.",
        )

    snippet = ocr_text.strip()[:max_chars]
    reply = chat_json(SYSTEM_PROMPT, snippet, temperature=0.0)

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
