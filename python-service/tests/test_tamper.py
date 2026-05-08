"""
Tests for python-service/app/services/docbrain/tamper.py

All I/O, Ollama, Tesseract and PIL calls are stubbed.
No real daemon or file system writes required in CI.
"""
from __future__ import annotations

import io
import json
import os
import struct
import tempfile
from dataclasses import asdict
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock, patch, PropertyMock

import pytest

os.environ.setdefault("API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///./storage/test_tamper.db")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_fingerprint(
    schema_id: int,
    mean_w: int = 800,
    mean_h: int = 600,
    ocr_mean: float = 85.0,
    ocr_std: float = 3.0,
    centroids: Optional[list] = None,
) -> Dict[str, Any]:
    return {
        "schema_id":           schema_id,
        "sample_count":        3,
        "mean_width":          mean_w,
        "mean_height":         mean_h,
        "ocr_confidence_mean": ocr_mean,
        "ocr_confidence_std":  ocr_std,
        "word_bbox_centroids": centroids or [(0.1, 0.1), (0.5, 0.5)],
        "font_hints":          ["Arial"],
    }


# ---------------------------------------------------------------------------
# Tests: check_tamper — verified path
# ---------------------------------------------------------------------------

class TestCheckTamperClean:

    def test_clean_doc_returns_verified(self, tmp_path, monkeypatch):
        """A document with no anomalies → verdict=verified, is_tampered=False."""
        import app.services.docbrain.tamper as tm

        # Write a baseline fingerprint.
        fp = _make_fingerprint(1)
        fp_path = os.path.join(str(tmp_path), "doctype_samples", "1", ".fingerprint.json")
        os.makedirs(os.path.dirname(fp_path), exist_ok=True)
        with open(fp_path, "w") as fh:
            json.dump(fp, fh)

        monkeypatch.setattr(tm, "_fingerprint_path", lambda sid: fp_path)
        # Stub all four detectors to return empty reasons.
        monkeypatch.setattr(tm, "_detector_structural",   lambda d, m, b: ([], {}))
        monkeypatch.setattr(tm, "_detector_content",      lambda d, m: [])
        monkeypatch.setattr(tm, "_detector_visual_vl",    lambda d, m: [])
        monkeypatch.setattr(tm, "_detector_ocr_anomaly",  lambda d, m, b: [])

        report = tm.check_tamper(b"fake", "image/png", 1)

        assert report.verdict == "verified"
        assert report.is_tampered is False
        assert report.confidence == 0.0
        assert report.reasons == []

    def test_report_has_required_fields(self, tmp_path, monkeypatch):
        import app.services.docbrain.tamper as tm

        monkeypatch.setattr(tm, "_load_fingerprint",      lambda sid: None)
        monkeypatch.setattr(tm, "_detector_structural",   lambda d, m, b: ([], {}))
        monkeypatch.setattr(tm, "_detector_content",      lambda d, m: [])
        monkeypatch.setattr(tm, "_detector_visual_vl",    lambda d, m: [])
        monkeypatch.setattr(tm, "_detector_ocr_anomaly",  lambda d, m, b: [])

        report = tm.check_tamper(b"data", "image/png", 99)

        assert hasattr(report, "is_tampered")
        assert hasattr(report, "confidence")
        assert hasattr(report, "verdict")
        assert hasattr(report, "reasons")
        assert hasattr(report, "structural_deltas")


# ---------------------------------------------------------------------------
# Tests: check_tamper — tampered path
# ---------------------------------------------------------------------------

class TestCheckTamperBadDates:

    def test_bad_date_chain_returns_tampered(self, monkeypatch):
        """When content detector fires a HIGH reason, verdict must be 'tampered'."""
        import app.services.docbrain.tamper as tm
        from app.services.docbrain.tamper import TamperReason

        bad_reason = TamperReason(
            code="DATE_CHAIN_VIOLATION",
            severity="high",
            detail="dob (2025-01-01) is not before issue_date (2020-01-01)",
        )

        monkeypatch.setattr(tm, "_load_fingerprint",      lambda sid: None)
        monkeypatch.setattr(tm, "_detector_structural",   lambda d, m, b: ([], {}))
        monkeypatch.setattr(tm, "_detector_content",      lambda d, m: [bad_reason])
        monkeypatch.setattr(tm, "_detector_visual_vl",    lambda d, m: [])
        monkeypatch.setattr(tm, "_detector_ocr_anomaly",  lambda d, m, b: [])

        report = tm.check_tamper(b"data", "image/png", 1)

        assert report.verdict == "tampered"
        assert report.is_tampered is True
        assert report.confidence >= 0.5

    def test_three_medium_reasons_returns_tampered(self, monkeypatch):
        """≥3 medium reasons → tampered."""
        import app.services.docbrain.tamper as tm
        from app.services.docbrain.tamper import TamperReason

        med = TamperReason(code="VISUAL_ANOMALY", severity="medium", detail="test")
        reasons = [med, med, med]

        monkeypatch.setattr(tm, "_load_fingerprint",      lambda sid: None)
        monkeypatch.setattr(tm, "_detector_structural",   lambda d, m, b: ([], {}))
        monkeypatch.setattr(tm, "_detector_content",      lambda d, m: reasons)
        monkeypatch.setattr(tm, "_detector_visual_vl",    lambda d, m: [])
        monkeypatch.setattr(tm, "_detector_ocr_anomaly",  lambda d, m, b: [])

        report = tm.check_tamper(b"data", "image/png", 1)

        assert report.verdict == "tampered"
        assert report.is_tampered is True

    def test_one_medium_reason_returns_needs_review(self, monkeypatch):
        """Exactly 1 medium reason → needs_review."""
        import app.services.docbrain.tamper as tm
        from app.services.docbrain.tamper import TamperReason

        med = TamperReason(code="DIMENSION_MISMATCH", severity="medium", detail="test")

        monkeypatch.setattr(tm, "_load_fingerprint",      lambda sid: None)
        monkeypatch.setattr(tm, "_detector_structural",   lambda d, m, b: ([med], {}))
        monkeypatch.setattr(tm, "_detector_content",      lambda d, m: [])
        monkeypatch.setattr(tm, "_detector_visual_vl",    lambda d, m: [])
        monkeypatch.setattr(tm, "_detector_ocr_anomaly",  lambda d, m, b: [])

        report = tm.check_tamper(b"data", "image/png", 1)

        assert report.verdict == "needs_review"
        assert report.is_tampered is False

    def test_two_low_reasons_returns_needs_review(self, monkeypatch):
        """2 low reasons → needs_review."""
        import app.services.docbrain.tamper as tm
        from app.services.docbrain.tamper import TamperReason

        low = TamperReason(code="OCR_CONFIDENCE_ANOMALY", severity="low", detail="test")

        monkeypatch.setattr(tm, "_load_fingerprint",      lambda sid: None)
        monkeypatch.setattr(tm, "_detector_structural",   lambda d, m, b: ([], {}))
        monkeypatch.setattr(tm, "_detector_content",      lambda d, m: [])
        monkeypatch.setattr(tm, "_detector_visual_vl",    lambda d, m: [])
        monkeypatch.setattr(tm, "_detector_ocr_anomaly",  lambda d, m, b: [low, low])

        report = tm.check_tamper(b"data", "image/png", 1)

        assert report.verdict == "needs_review"


# ---------------------------------------------------------------------------
# Tests: confidence calculation
# ---------------------------------------------------------------------------

class TestConfidenceCalc:

    def test_high_reason_gives_0_5_confidence(self, monkeypatch):
        import app.services.docbrain.tamper as tm
        from app.services.docbrain.tamper import TamperReason

        high = TamperReason(code="X", severity="high", detail="")

        monkeypatch.setattr(tm, "_load_fingerprint",      lambda sid: None)
        monkeypatch.setattr(tm, "_detector_structural",   lambda d, m, b: ([high], {}))
        monkeypatch.setattr(tm, "_detector_content",      lambda d, m: [])
        monkeypatch.setattr(tm, "_detector_visual_vl",    lambda d, m: [])
        monkeypatch.setattr(tm, "_detector_ocr_anomaly",  lambda d, m, b: [])

        report = tm.check_tamper(b"data", "image/png", 1)
        assert report.confidence == pytest.approx(0.5, abs=0.01)

    def test_confidence_capped_at_1_0(self, monkeypatch):
        import app.services.docbrain.tamper as tm
        from app.services.docbrain.tamper import TamperReason

        high = TamperReason(code="X", severity="high", detail="")
        many_medium = [TamperReason(code="M", severity="medium", detail="") for _ in range(10)]

        monkeypatch.setattr(tm, "_load_fingerprint",      lambda sid: None)
        monkeypatch.setattr(tm, "_detector_structural",   lambda d, m, b: ([high], {}))
        monkeypatch.setattr(tm, "_detector_content",      lambda d, m: many_medium)
        monkeypatch.setattr(tm, "_detector_visual_vl",    lambda d, m: [])
        monkeypatch.setattr(tm, "_detector_ocr_anomaly",  lambda d, m, b: [])

        report = tm.check_tamper(b"data", "image/png", 1)
        assert report.confidence <= 1.0


# ---------------------------------------------------------------------------
# Tests: _detector_content (date-chain logic)
# ---------------------------------------------------------------------------

class TestDetectorContent:

    def _ocr_text(self, dob, issue, expiry):
        return f"DOB: {dob} Issue: {issue} Expiry: {expiry}"

    def test_valid_date_chain_no_reasons(self, monkeypatch):
        import app.services.docbrain.tamper as tm

        # Stub _quick_ocr_text to return text with valid dates.
        text = "1990-01-15 2020-03-01 2030-03-01"
        monkeypatch.setattr(tm, "_quick_ocr_text", lambda d, m: text)

        reasons = tm._detector_content(b"data", "image/png")
        # Should produce no DATE_CHAIN_VIOLATION if ordering is correct.
        high_reasons = [r for r in reasons if r.code == "DATE_CHAIN_VIOLATION"]
        assert len(high_reasons) == 0

    def test_dob_after_issue_date_produces_high_reason(self, monkeypatch):
        import app.services.docbrain.tamper as tm

        # DOB label: 2025-06-01, Issue Date label: 2020-01-01 — DOB > issue → violation
        text = "Date of Birth: 2025-06-01 Date of Issue: 2020-01-01 Expiry Date: 2030-01-01"
        monkeypatch.setattr(tm, "_quick_ocr_text", lambda d, m: text)

        reasons = tm._detector_content(b"data", "image/png")
        violations = [r for r in reasons if r.code == "DATE_CHAIN_VIOLATION"]
        assert len(violations) >= 1, f"Expected DATE_CHAIN_VIOLATION, got: {reasons}"
        assert violations[0].severity == "high"

    def test_issue_after_expiry_produces_high_reason(self, monkeypatch):
        import app.services.docbrain.tamper as tm

        # Valid DOB, but issue_date (2030) > expiry_date (2020) → violation
        text = "Date of Birth: 1990-01-01 Date of Issue: 2030-01-01 Expiry Date: 2020-01-01"
        monkeypatch.setattr(tm, "_quick_ocr_text", lambda d, m: text)

        reasons = tm._detector_content(b"data", "image/png")
        violations = [r for r in reasons if r.code == "DATE_CHAIN_VIOLATION"]
        assert len(violations) >= 1, f"Expected DATE_CHAIN_VIOLATION, got: {reasons}"
        assert violations[0].severity == "high"


# ---------------------------------------------------------------------------
# Tests: baseline_fingerprint
# ---------------------------------------------------------------------------

class TestBaselineFingerprint:

    def test_creates_sidecar_file(self, tmp_path, monkeypatch):
        import app.services.docbrain.tamper as tm

        fp_path = str(tmp_path / ".fingerprint.json")
        monkeypatch.setattr(tm, "_fingerprint_path", lambda sid: fp_path)
        monkeypatch.setattr(tm, "_measure_image", lambda d, m: (800, 600, 85.0, [(0.1, 0.1)]))
        monkeypatch.setattr(tm, "_detect_fonts",   lambda s: ["Arial"])

        samples = [
            {"data": b"fake", "mime_type": "image/png", "sha256": "abc"},
        ]
        tm.baseline_fingerprint(schema_id=1, samples=samples)

        assert os.path.exists(fp_path)
        with open(fp_path) as fh:
            data = json.load(fh)

        assert data["schema_id"] == 1
        assert "mean_width" in data
        assert "mean_height" in data
        assert "ocr_confidence_mean" in data
        assert "ocr_confidence_std" in data
        assert "word_bbox_centroids" in data

    def test_empty_samples_does_not_crash(self, tmp_path, monkeypatch):
        import app.services.docbrain.tamper as tm

        fp_path = str(tmp_path / ".fingerprint.json")
        monkeypatch.setattr(tm, "_fingerprint_path", lambda sid: fp_path)

        # No exception should be raised.
        tm.baseline_fingerprint(schema_id=1, samples=[])
        assert not os.path.exists(fp_path)   # nothing written for empty input


# ---------------------------------------------------------------------------
# Tests: TamperReport dataclass attrs
# ---------------------------------------------------------------------------

class TestTamperReportShape:

    def test_verdict_values_are_valid(self, monkeypatch):
        import app.services.docbrain.tamper as tm

        monkeypatch.setattr(tm, "_load_fingerprint",      lambda sid: None)
        monkeypatch.setattr(tm, "_detector_structural",   lambda d, m, b: ([], {}))
        monkeypatch.setattr(tm, "_detector_content",      lambda d, m: [])
        monkeypatch.setattr(tm, "_detector_visual_vl",    lambda d, m: [])
        monkeypatch.setattr(tm, "_detector_ocr_anomaly",  lambda d, m, b: [])

        report = tm.check_tamper(b"x", "image/png", 1)
        assert report.verdict in ("verified", "needs_review", "tampered")

    def test_data_kwarg_alias_accepted(self, monkeypatch):
        """Router calls check_tamper(schema_id=..., data=..., mime_type=...)."""
        import app.services.docbrain.tamper as tm

        monkeypatch.setattr(tm, "_load_fingerprint",      lambda sid: None)
        monkeypatch.setattr(tm, "_detector_structural",   lambda d, m, b: ([], {}))
        monkeypatch.setattr(tm, "_detector_content",      lambda d, m: [])
        monkeypatch.setattr(tm, "_detector_visual_vl",    lambda d, m: [])
        monkeypatch.setattr(tm, "_detector_ocr_anomaly",  lambda d, m, b: [])

        # Should not raise.
        report = tm.check_tamper(schema_id=1, data=b"bytes", mime_type="image/png")
        assert report.verdict == "verified"
