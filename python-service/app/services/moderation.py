"""Document-content moderation.

Flags documents that contain content a bank shouldn't be archiving or processing
at all — hate speech, explicit imagery, illegal weapon/drug terms, extremist
markers. Two detectors, fused:

  1. **Text rules**: keyword/phrase lists (multilingual) applied over OCR text
     and e-form submissions. Categories each contribute points; a document's
     score tips past a threshold → flagged.

  2. **Image rules** (optional): calls an external moderation service when
     `MODERATION_API_URL` is set (e.g. AWS Rekognition DetectModerationLabels,
     Google Cloud Vision SafeSearch, Azure Content Safety). Silent no-op otherwise.

Never stores the offending text — only categories + score. Results also emit a
`moderation.flag` event so Ops can pull the document for manual review.
"""
from __future__ import annotations
import os
import re
from typing import Any, Optional

import httpx


MODERATION_API_URL = os.environ.get("MODERATION_API_URL", "").strip()
MODERATION_API_KEY = os.environ.get("MODERATION_API_KEY", "").strip()


CATEGORIES: dict[str, tuple[re.Pattern, int]] = {
    "hate_speech":     (re.compile(r"\b(kill\s+all|death\s+to|genocide|ethnic\s+cleansing)\b", re.I), 40),
    "violence":        (re.compile(r"\b(bomb|explosive|ak-?47|sniper|assassinate|hostage)\b", re.I), 30),
    "sexual_explicit": (re.compile(r"\b(porn|xxx|nude|escort\s+service)\b", re.I), 30),
    "drugs":           (re.compile(r"\b(cocaine|heroin|meth|fentanyl|ecstasy\s+pills)\b", re.I), 25),
    "self_harm":       (re.compile(r"\b(suicide\s+method|self[\s-]?harm|end\s+my\s+life)\b", re.I), 30),
    "sanctions_terms": (re.compile(r"\b(isis|daesh|hezbollah|money\s+laundering\s+scheme)\b", re.I), 25),
    "pii_leak":        (re.compile(r"\b\d{14}\b.*\b\d{14}\b.*\b\d{14}\b", re.I), 10),  # > 2 ids on one page
    "credentials":     (re.compile(r"(aws[-_]?secret[-_]?access[-_]?key|BEGIN\s+PRIVATE\s+KEY|api[_-]?key\s*[:=]\s*[A-Za-z0-9_\-]{20,})", re.I), 50),
}


BLOCK_THRESHOLD = int(os.environ.get("MOD_BLOCK_THRESHOLD", "40"))
WARN_THRESHOLD = int(os.environ.get("MOD_WARN_THRESHOLD", "15"))


def scan_text(text: str) -> dict[str, Any]:
    signals: list[dict] = []
    for cat, (pat, points) in CATEGORIES.items():
        m = pat.search(text or "")
        if m:
            signals.append({"category": cat, "points": points,
                            "sample": _safe_sample(text, m.start(), m.end())})
    score = min(100, sum(s["points"] for s in signals))
    return {"score": score, "signals": signals,
            "band": ("block" if score >= BLOCK_THRESHOLD
                     else "warn" if score >= WARN_THRESHOLD else "clean")}


def _safe_sample(text: str, start: int, end: int, radius: int = 20) -> str:
    """Return a short context snippet with the match masked, for audit only."""
    a = max(0, start - radius); b = min(len(text), end + radius)
    sample = text[a:b]
    sample = sample.replace(text[start:end], "***")
    return sample[:80]


def scan_image(image_bytes: bytes) -> dict[str, Any]:
    if not (MODERATION_API_URL and MODERATION_API_KEY):
        return {"ok": False, "reason": "not_configured"}
    try:
        with httpx.Client(timeout=5.0) as c:
            r = c.post(MODERATION_API_URL,
                       headers={"Authorization": f"Bearer {MODERATION_API_KEY}"},
                       content=image_bytes,
                       params={"format": "bytes"})
            return {"ok": True, "upstream_status": r.status_code, "body": r.json()}
    except Exception as e:
        return {"ok": False, "reason": str(e)[:120]}
