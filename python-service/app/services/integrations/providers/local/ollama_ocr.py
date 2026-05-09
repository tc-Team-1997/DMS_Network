"""OllamaOcr — delegates to the existing docbrain OCR pipeline.

Implementations must re-read tenant_config on every call.
The registry caches the provider instance, not its config.
"""
from __future__ import annotations

import logging

from ...providers_base import OcrProvider, OcrResult

log = logging.getLogger(__name__)


class OllamaOcr(OcrProvider):
    """OCR provider that delegates to services/docbrain/ocr.py.

    Uses the Tesseract + optional Qwen2.5-VL/Llava vision fallback pipeline
    already wired in the codebase. Configuration (DOCBRAIN_VISION_OCR,
    DOCBRAIN_VISION_OCR_THRESHOLD, OCR_LANGS, TESSERACT_CMD) is read from
    environment on every call through the existing pipeline.

    The 'lang' argument is currently a hint only — the underlying pipeline
    selects languages via the OCR_LANGS env var. A future iteration will
    propagate the hint into pytesseract's lang parameter.
    """

    def extract_text(
        self,
        file_bytes: bytes,
        *,
        mime_type: str,
        lang: str = "en",
    ) -> OcrResult:
        """Run OCR via the docbrain pipeline and return a base OcrResult.

        Delegates to app.services.docbrain.ocr.ocr_document() which handles
        Tesseract → vision-model fallback internally.
        """
        try:
            from app.services.docbrain.ocr import ocr_document
        except ImportError:
            log.warning("OllamaOcr: docbrain.ocr not available; returning empty result")
            return OcrResult(text="", confidence=0.0, engine="unavailable")

        try:
            result = ocr_document(file_bytes, mime_type)
        except Exception as exc:
            log.error("OllamaOcr: ocr_document failed: %s", exc)
            return OcrResult(text="", confidence=0.0, engine="error")

        # docbrain OcrResult has .full_text, .mean_confidence (0–100), .backend
        confidence = round(result.mean_confidence / 100.0, 4)
        return OcrResult(
            text=result.full_text or "",
            confidence=confidence,
            engine=result.backend,
        )
