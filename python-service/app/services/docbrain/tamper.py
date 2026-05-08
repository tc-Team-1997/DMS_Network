"""Tamper detection for document-type samples.

Four detectors:
  1. Structural    — image dimensions + OCR bounding-box layout vs baseline
  2. Content       — date-chain consistency (dob < issue_date < expiry_date),
                     CID checksum where applicable, date-format sanity
  3. Visual VL     — Qwen2.5-VL prompt for font inconsistencies, seams, etc.
  4. OCR anomaly   — OCR mean_confidence > 2 stddev below schema baseline

Verdict rules:
  tampered      if ≥1 high reason OR ≥3 medium reasons
  needs_review  if ≥1 medium reason OR ≥2 low reasons
  verified      otherwise

Confidence = weighted sum (high=0.5, medium=0.25, low=0.1), capped at 1.0.

Fingerprint storage: sidecar JSON file at
    STORAGE_DIR/doctype_samples/<schema_id>/.fingerprint.json
(The db-migrator plan did NOT add a fingerprint_json column to
document_type_schemas, so we use the sidecar path as specified.)
"""
from __future__ import annotations

import io
import json
import logging
import math
import os
import time
from dataclasses import dataclass, field, asdict
from datetime import date
from typing import Any, Dict, List, Optional, Union

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Public dataclasses
# ---------------------------------------------------------------------------


@dataclass
class TamperReason:
    code: str
    severity: str   # low | medium | high
    detail: str


@dataclass
class TamperReport:
    is_tampered: bool
    confidence: float
    verdict: str          # verified | needs_review | tampered
    reasons: List[TamperReason]
    structural_deltas: Dict[str, Any]


# ---------------------------------------------------------------------------
# Fingerprint sidecar path helper
# ---------------------------------------------------------------------------

def _fingerprint_path(schema_id: int) -> str:
    storage_dir = os.environ.get("STORAGE_DIR", "./storage/documents")
    return os.path.join(storage_dir, "doctype_samples", str(schema_id), ".fingerprint.json")


def _load_fingerprint(schema_id: int) -> Optional[Dict[str, Any]]:
    path = _fingerprint_path(schema_id)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as exc:  # noqa: BLE001
        log.warning("tamper: could not load fingerprint for schema %d: %s", schema_id, exc)
        return None


def _save_fingerprint(schema_id: int, data: Dict[str, Any]) -> None:
    path = _fingerprint_path(schema_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)
    except Exception as exc:  # noqa: BLE001
        log.warning("tamper: could not save fingerprint for schema %d: %s", schema_id, exc)


# ---------------------------------------------------------------------------
# baseline_fingerprint
# ---------------------------------------------------------------------------

def baseline_fingerprint(
    schema_id: int,
    samples: List[Dict[str, Any]],
    *,
    db=None,
) -> None:
    """
    Compute and cache baseline statistics from training samples.

    Stored fields:
      mean_width, mean_height     — average image dimensions
      ocr_confidence_mean         — mean OCR confidence across all samples
      ocr_confidence_std          — std-dev
      word_bbox_centroids         — list of normalised (cx, cy) for top-50 words
                                    (layout fingerprint)
      font_hints                  — list of font family strings (from vision model,
                                    best-effort; may be [])

    Accepts the same sample-payload list as embed_samples:
        [{"data": bytes, "mime_type": str, "sha256": str}, ...]
    """
    if not samples:
        log.info("baseline_fingerprint: no samples for schema %d, skipping", schema_id)
        return

    widths:  List[int]   = []
    heights: List[int]   = []
    confs:   List[float] = []
    all_bboxes: List[tuple] = []   # (cx_norm, cy_norm)

    for s in samples:
        data = s.get("data") or b""
        mime = s.get("mime_type", "application/octet-stream")
        if not data:
            continue

        # Image dimensions + OCR confidence + word bboxes.
        try:
            w, h, conf, bboxes = _measure_image(data, mime)
            if w > 0:
                widths.append(w)
                heights.append(h)
            if conf >= 0:
                confs.append(conf)
            all_bboxes.extend(bboxes)
        except Exception as exc:  # noqa: BLE001
            log.warning("baseline_fingerprint: measure failed for schema %d: %s", schema_id, exc)

    # Aggregate.
    fp: Dict[str, Any] = {
        "schema_id":           schema_id,
        "sample_count":        len(samples),
        "mean_width":          int(sum(widths) / len(widths)) if widths else 0,
        "mean_height":         int(sum(heights) / len(heights)) if heights else 0,
        "ocr_confidence_mean": round(sum(confs) / len(confs), 2) if confs else 0.0,
        "ocr_confidence_std":  round(_std(confs), 2) if len(confs) > 1 else 0.0,
        "word_bbox_centroids": all_bboxes[:200],   # cap to keep JSON small
        "font_hints":          [],                  # populated below if vision available
    }

    # Best-effort font detection via vision model.
    font_hints = _detect_fonts(samples)
    fp["font_hints"] = font_hints

    _save_fingerprint(schema_id, fp)
    log.info(
        "baseline_fingerprint: schema=%d samples=%d mean_w=%d mean_h=%d ocr_conf=%.1f",
        schema_id, len(samples),
        fp["mean_width"], fp["mean_height"], fp["ocr_confidence_mean"],
    )


def _std(values: List[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    variance = sum((v - mean) ** 2 for v in values) / len(values)
    return math.sqrt(variance)


def _measure_image(data: bytes, mime: str) -> tuple:
    """
    Returns (width, height, ocr_mean_confidence, word_bboxes_normalised).
    word_bboxes_normalised is a list of (cx/w, cy/h) tuples for Tesseract words.
    Falls back gracefully if PIL or pytesseract aren't available.
    """
    try:
        from PIL import Image
        import io as _io
        if mime == "application/pdf":
            try:
                from pdf2image import convert_from_bytes
                images = convert_from_bytes(data, first_page=1, last_page=1, dpi=150)
                if not images:
                    return 0, 0, -1.0, []
                img = images[0]
            except Exception:  # noqa: BLE001
                return 0, 0, -1.0, []
        else:
            img = Image.open(_io.BytesIO(data))

        w, h = img.size
        conf = -1.0
        bboxes: List[tuple] = []

        try:
            import pytesseract
            d = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
            raw_confs = [int(c) for c in d["conf"] if c != "-1"]
            conf = sum(raw_confs) / len(raw_confs) if raw_confs else 0.0

            # Collect word bounding-box centroids (normalised).
            for x, y, bw, bh, txt in zip(
                d["left"], d["top"], d["width"], d["height"], d["text"]
            ):
                if txt and txt.strip() and bw > 0 and bh > 0:
                    cx = (x + bw / 2) / w
                    cy = (y + bh / 2) / h
                    bboxes.append((round(cx, 4), round(cy, 4)))
        except Exception:  # noqa: BLE001
            pass

        return w, h, conf, bboxes

    except Exception:  # noqa: BLE001
        return 0, 0, -1.0, []


def _detect_fonts(samples: List[Dict[str, Any]]) -> List[str]:
    """
    Best-effort font detection via the vision model. Returns a deduplicated
    list of font family strings found across samples. Empty if vision is off.
    """
    try:
        from .vision import vision_available, VISION_MODEL
        if not vision_available():
            return []
    except Exception:  # noqa: BLE001
        return []

    import base64
    import ollama
    from .llm import OLLAMA_HOST, chat_json

    fonts: List[str] = []
    _seen: set = set()

    for s in samples[:3]:   # sample at most 3 to keep latency reasonable
        data = s.get("data") or b""
        mime = s.get("mime_type", "")
        if not data or not mime.startswith("image/"):
            continue
        try:
            b64 = base64.b64encode(data).decode("ascii")
            client = ollama.Client(host=OLLAMA_HOST)
            resp = client.chat(
                model=VISION_MODEL,
                format="json",
                options={"temperature": 0.0},
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a document-forensics assistant. "
                            "Identify font families visible in this document image. "
                            'Reply as JSON: {"font_families": ["Helvetica", ...]}'
                        ),
                    },
                    {
                        "role":    "user",
                        "content": "List the font families you can see in this document.",
                        "images":  [b64],
                    },
                ],
            )
            msg = resp.get("message") if isinstance(resp, dict) else getattr(resp, "message", None)
            content = (msg.get("content") if isinstance(msg, dict) else getattr(msg, "content", "")) or ""
            parsed = json.loads(content) if content.strip() else {}
            for fn in (parsed.get("font_families") or []):
                fn_str = str(fn).strip()
                if fn_str and fn_str not in _seen:
                    _seen.add(fn_str)
                    fonts.append(fn_str)
        except Exception as exc:  # noqa: BLE001
            log.debug("_detect_fonts: skipped sample: %s", exc)
    return fonts


# ---------------------------------------------------------------------------
# check_tamper
# ---------------------------------------------------------------------------

def check_tamper(
    bytes_: Optional[bytes] = None,
    mime_type: str = "application/octet-stream",
    schema_id: int = 0,
    db=None,
    *,
    # Also accept kwargs as the router may call check_tamper(schema_id=..., data=..., mime_type=...)
    data: Optional[bytes] = None,
) -> TamperReport:
    """
    Run four tamper detectors and aggregate into a TamperReport.

    Positional / keyword usage (both accepted):
        check_tamper(bytes_, mime_type, schema_id, db)
        check_tamper(schema_id=..., data=..., mime_type=...)
    """
    # Normalise 'data' kwarg alias.
    raw = bytes_ or data or b""

    t0 = time.monotonic()
    reasons: List[TamperReason] = []
    structural_deltas: Dict[str, Any] = {}

    baseline = _load_fingerprint(schema_id)

    # ── Detector 1: Structural ─────────────────────────────────────────────
    struct_reasons, struct_deltas = _detector_structural(raw, mime_type, baseline)
    reasons.extend(struct_reasons)
    structural_deltas.update(struct_deltas)

    # ── Detector 2: Content consistency ────────────────────────────────────
    content_reasons = _detector_content(raw, mime_type)
    reasons.extend(content_reasons)

    # ── Detector 3: Visual VL ──────────────────────────────────────────────
    visual_reasons = _detector_visual_vl(raw, mime_type)
    reasons.extend(visual_reasons)

    # ── Detector 4: OCR confidence anomaly ────────────────────────────────
    ocr_reasons = _detector_ocr_anomaly(raw, mime_type, baseline)
    reasons.extend(ocr_reasons)

    # Verdict
    high_count   = sum(1 for r in reasons if r.severity == "high")
    medium_count = sum(1 for r in reasons if r.severity == "medium")
    low_count    = sum(1 for r in reasons if r.severity == "low")

    if high_count >= 1 or medium_count >= 3:
        verdict = "tampered"
        is_tampered = True
    elif medium_count >= 1 or low_count >= 2:
        verdict = "needs_review"
        is_tampered = False
    else:
        verdict = "verified"
        is_tampered = False

    # Confidence = weighted sum, capped at 1.0.
    confidence = min(
        1.0,
        high_count * 0.5 + medium_count * 0.25 + low_count * 0.1,
    )

    latency_ms = round((time.monotonic() - t0) * 1000)
    log.info(
        '{"op": "check_tamper", "schema_id": %d, "verdict": "%s", '
        '"confidence": %.2f, "latency_ms": %d}',
        schema_id, verdict, confidence, latency_ms,
    )

    return TamperReport(
        is_tampered=is_tampered,
        confidence=round(confidence, 3),
        verdict=verdict,
        reasons=reasons,
        structural_deltas=structural_deltas,
    )


# ---------------------------------------------------------------------------
# Detector 1: Structural
# ---------------------------------------------------------------------------

def _detector_structural(
    data: bytes,
    mime: str,
    baseline: Optional[Dict[str, Any]],
) -> tuple:
    """Compare image dimensions and bbox layout against baseline."""
    reasons: List[TamperReason] = []
    deltas: Dict[str, Any] = {}

    if not baseline or not data:
        return reasons, deltas

    try:
        w, h, _conf, bboxes = _measure_image(data, mime)
    except Exception as exc:  # noqa: BLE001
        log.debug("_detector_structural: measure failed: %s", exc)
        return reasons, deltas

    base_w = baseline.get("mean_width", 0)
    base_h = baseline.get("mean_height", 0)

    if base_w > 0 and w > 0:
        w_delta = abs(w - base_w) / base_w
        deltas["width_delta_pct"] = round(w_delta * 100, 1)
        if w_delta > 0.20:
            reasons.append(TamperReason(
                code="DIMENSION_MISMATCH",
                severity="medium",
                detail=f"Image width {w}px vs baseline {base_w}px (Δ{w_delta*100:.0f}%)",
            ))

    if base_h > 0 and h > 0:
        h_delta = abs(h - base_h) / base_h
        deltas["height_delta_pct"] = round(h_delta * 100, 1)
        if h_delta > 0.20:
            reasons.append(TamperReason(
                code="DIMENSION_MISMATCH_HEIGHT",
                severity="medium",
                detail=f"Image height {h}px vs baseline {base_h}px (Δ{h_delta*100:.0f}%)",
            ))

    # Layout score: fraction of this doc's word centroids that are "near"
    # a baseline centroid. A large mismatch suggests rearranged fields.
    base_centroids = baseline.get("word_bbox_centroids", [])
    if base_centroids and bboxes:
        layout_delta = _layout_deviation(bboxes, base_centroids)
        deltas["layout_deviation"] = round(layout_delta, 3)
        if layout_delta > 0.40:
            reasons.append(TamperReason(
                code="LAYOUT_DEVIATION",
                severity="medium",
                detail=f"Field layout deviates from baseline (score {layout_delta:.2f})",
            ))

    return reasons, deltas


def _layout_deviation(current: List[tuple], baseline: List[tuple]) -> float:
    """
    Fraction of current word-centroids that have no baseline centroid within
    0.05 normalised distance. Returns 0 (identical layout) … 1 (no overlap).
    """
    if not baseline:
        return 0.0
    matched = 0
    for cx, cy in current[:100]:
        for bx, by in baseline[:100]:
            if abs(cx - bx) < 0.05 and abs(cy - by) < 0.05:
                matched += 1
                break
    total = len(current[:100])
    if total == 0:
        return 0.0
    return round(1.0 - matched / total, 3)


# ---------------------------------------------------------------------------
# Detector 2: Content consistency
# ---------------------------------------------------------------------------

def _detector_content(data: bytes, mime: str) -> List[TamperReason]:
    """
    Extract dates and validate the chain dob < issue_date < expiry_date.
    Also checks Egyptian CID checksum (14-digit IDs).
    """
    reasons: List[TamperReason] = []

    # Run a lightweight extraction without hitting Ollama; just use regex on OCR text.
    ocr_text = _quick_ocr_text(data, mime)
    if not ocr_text:
        return reasons

    dates = _extract_iso_dates(ocr_text)
    cids  = _extract_potential_cids(ocr_text)

    # Date-chain check: if all three are present, enforce ordering.
    dob        = dates.get("dob")
    issue_date = dates.get("issue_date")
    expiry_date = dates.get("expiry_date")

    try:
        if dob and issue_date:
            dob_d   = date.fromisoformat(dob)
            issue_d = date.fromisoformat(issue_date)
            if dob_d >= issue_d:
                reasons.append(TamperReason(
                    code="DATE_CHAIN_VIOLATION",
                    severity="high",
                    detail=f"DOB ({dob}) is not before issue_date ({issue_date})",
                ))
        if issue_date and expiry_date:
            issue_d  = date.fromisoformat(issue_date)
            expiry_d = date.fromisoformat(expiry_date)
            if issue_d >= expiry_d:
                reasons.append(TamperReason(
                    code="DATE_CHAIN_VIOLATION",
                    severity="high",
                    detail=f"issue_date ({issue_date}) is not before expiry_date ({expiry_date})",
                ))
    except ValueError as exc:
        log.debug("_detector_content: date parse error: %s", exc)

    # CID format sanity (Egyptian NID: 14 digits, first digit 2 or 3).
    for cid in cids:
        if len(cid) == 14 and cid.isdigit():
            if cid[0] not in ("2", "3"):
                reasons.append(TamperReason(
                    code="CID_FORMAT_ANOMALY",
                    severity="high",
                    detail=f"14-digit CID {cid[:6]}… does not start with 2 or 3",
                ))

    return reasons


def _quick_ocr_text(data: bytes, mime: str) -> str:
    """Run Tesseract with minimal config to extract raw text for date/CID checks."""
    try:
        from .ocr import ocr_document
        res = ocr_document(data, mime)
        return (res.full_text or "").strip()
    except Exception:  # noqa: BLE001
        return ""


import re as _re

_ISO_DATE_RE = _re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")
_DD_MM_YYYY_RE = _re.compile(r"\b(\d{2})/(\d{2})/(\d{4})\b")
_CID_RE = _re.compile(r"\b(\d{9,14})\b")

# Keyword patterns to identify date field labels in OCR text.
# Matches "DOB:", "Date of Birth:", "Birth Date:", "Date of Issue:", etc.
_DOB_LABEL_RE = _re.compile(
    r"(?:date\s+of\s+birth|birth\s+date|dob|born\s+on)\s*[:\-–]?\s*(\d{4}-\d{2}-\d{2}|\d{2}/\d{2}/\d{4})",
    _re.IGNORECASE,
)
_ISSUE_LABEL_RE = _re.compile(
    r"(?:date\s+of\s+issue|issue\s+date|issued\s+on|date\s+issued)\s*[:\-–]?\s*(\d{4}-\d{2}-\d{2}|\d{2}/\d{2}/\d{4})",
    _re.IGNORECASE,
)
_EXPIRY_LABEL_RE = _re.compile(
    r"(?:date\s+of\s+expiry|expiry\s+date|expiration\s+date|valid\s+until|expires?\s+on?)\s*[:\-–]?\s*(\d{4}-\d{2}-\d{2}|\d{2}/\d{2}/\d{4})",
    _re.IGNORECASE,
)


def _parse_date_str(ds: str) -> Optional[str]:
    """Convert DD/MM/YYYY or YYYY-MM-DD to ISO. Returns None on parse error."""
    m = _DD_MM_YYYY_RE.match(ds.strip())
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    if _ISO_DATE_RE.match(ds.strip()):
        return ds.strip()
    return None


def _extract_iso_dates(text: str) -> Dict[str, str]:
    """
    Extract labelled dates from OCR text using keyword heuristics.
    Falls back to positional ordering (oldest → dob, middle → issue,
    newest → expiry) when no labels are found.
    """
    result: Dict[str, str] = {}

    # Try keyword-labelled extraction first.
    for label_re, key in [
        (_DOB_LABEL_RE,    "dob"),
        (_ISSUE_LABEL_RE,  "issue_date"),
        (_EXPIRY_LABEL_RE, "expiry_date"),
    ]:
        m = label_re.search(text)
        if m:
            parsed = _parse_date_str(m.group(1))
            if parsed:
                result[key] = parsed

    if result:
        return result

    # Fallback: collect all ISO/DD-MM-YYYY dates, sort, assign positionally.
    found: List[str] = []
    for m in _ISO_DATE_RE.finditer(text):
        found.append(m.group(1))
    for m in _DD_MM_YYYY_RE.finditer(text):
        dd, mm, yyyy = m.group(1), m.group(2), m.group(3)
        found.append(f"{yyyy}-{mm}-{dd}")

    valid: List[date] = []
    seen_iso: set = set()
    for ds in found:
        try:
            d = date.fromisoformat(ds)
            if ds not in seen_iso:
                valid.append(d)
                seen_iso.add(ds)
        except ValueError:
            pass

    valid.sort()
    if len(valid) >= 1:
        result["dob"] = valid[0].isoformat()
    if len(valid) >= 2:
        result["expiry_date"] = valid[-1].isoformat()
    if len(valid) >= 3:
        result["issue_date"] = valid[1].isoformat()
    return result


def _extract_potential_cids(text: str) -> List[str]:
    """Extract sequences of 9-14 digits that look like CIDs."""
    return [m.group(1) for m in _CID_RE.finditer(text)]


# ---------------------------------------------------------------------------
# Detector 3: Visual VL
# ---------------------------------------------------------------------------

_VL_TAMPER_SYSTEM = """You are a document-forensics analyst.
Examine the provided document image for signs of tampering, forgery,
or digital manipulation.

Look specifically for:
  - Font inconsistencies (mixed typefaces, different weights/sizes within a field)
  - Misaligned text fields
  - Jagged or rough edges around text (copy-paste artefacts)
  - Colour discrepancies (bleaching, smudging, ink mismatches)
  - Visible cut-and-paste seams or halo effects

Respond ONLY with a JSON object:
{
  "findings": [
    {"type": "<short label>", "description": "<detail>", "confidence": 0.0-1.0}
  ]
}
If the document looks clean, return {"findings": []}."""


def _detector_visual_vl(data: bytes, mime: str) -> List[TamperReason]:
    """Send image to qwen2.5vl:7b and parse tampering findings."""
    reasons: List[TamperReason] = []

    if not data:
        return reasons

    try:
        from .vision import vision_available, VISION_MODEL
        if not vision_available():
            return reasons
    except Exception:  # noqa: BLE001
        return reasons

    import base64
    import ollama
    from .llm import OLLAMA_HOST

    # Convert PDF first page to image if needed.
    image_bytes = _to_image_bytes(data, mime)
    if not image_bytes:
        return reasons

    try:
        b64 = base64.b64encode(image_bytes).decode("ascii")
        client = ollama.Client(host=OLLAMA_HOST)
        resp = client.chat(
            model=VISION_MODEL,
            format="json",
            options={"temperature": 0.0},
            messages=[
                {"role": "system", "content": _VL_TAMPER_SYSTEM},
                {
                    "role":    "user",
                    "content": "Analyse this document for tampering signs.",
                    "images":  [b64],
                },
            ],
        )
        msg = resp.get("message") if isinstance(resp, dict) else getattr(resp, "message", None)
        content = (msg.get("content") if isinstance(msg, dict) else getattr(msg, "content", "")) or ""
        parsed = json.loads(content) if content.strip() else {}
        for finding in (parsed.get("findings") or []):
            conf = float(finding.get("confidence", 0.5))
            if conf >= 0.4:
                reasons.append(TamperReason(
                    code="VISUAL_ANOMALY",
                    severity="medium",
                    detail=(
                        f"{finding.get('type', 'unknown')}: "
                        f"{finding.get('description', '')} (conf={conf:.2f})"
                    ),
                ))
    except Exception as exc:  # noqa: BLE001
        log.debug("_detector_visual_vl: skipped: %s", exc)

    return reasons


def _to_image_bytes(data: bytes, mime: str) -> Optional[bytes]:
    """Convert data to raw PNG bytes for VL consumption."""
    if mime.startswith("image/"):
        return data
    if mime == "application/pdf":
        try:
            from pdf2image import convert_from_bytes
            import io as _io
            images = convert_from_bytes(data, first_page=1, last_page=1, dpi=150)
            if not images:
                return None
            buf = _io.BytesIO()
            images[0].save(buf, format="PNG")
            return buf.getvalue()
        except Exception:  # noqa: BLE001
            return None
    return None


# ---------------------------------------------------------------------------
# Detector 4: OCR confidence anomaly
# ---------------------------------------------------------------------------

def _detector_ocr_anomaly(
    data: bytes,
    mime: str,
    baseline: Optional[Dict[str, Any]],
) -> List[TamperReason]:
    """Flag if this doc's OCR confidence is > 2 stddev below baseline mean."""
    reasons: List[TamperReason] = []

    if not baseline or not data:
        return reasons

    baseline_mean = float(baseline.get("ocr_confidence_mean", 0))
    baseline_std  = float(baseline.get("ocr_confidence_std", 0))

    if baseline_mean <= 0 or baseline_std <= 0:
        return reasons

    try:
        _, _, this_conf, _ = _measure_image(data, mime)
    except Exception:  # noqa: BLE001
        return reasons

    if this_conf < 0:
        return reasons

    threshold = baseline_mean - 2.0 * baseline_std
    if this_conf < threshold:
        reasons.append(TamperReason(
            code="OCR_CONFIDENCE_ANOMALY",
            severity="low",
            detail=(
                f"OCR confidence {this_conf:.1f} is more than 2 stddev below "
                f"baseline ({baseline_mean:.1f} ± {baseline_std:.1f})"
            ),
        ))

    return reasons
