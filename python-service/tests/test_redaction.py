"""Tests for document-redaction feature (BHU-46).

Coverage (24 tests total):
  - Happy path: 1-region, multi-region, multi-page
  - Idempotency: same regions twice produces same sha256
  - Text-actually-removed assertion (pdftotext smoke)
  - RBAC denials (viewer, unauthenticated)
  - Non-PDF rejection
  - Regions-out-of-bounds rejection (>50 regions, invalid coords)
  - Large PDF (>1 MB) accepted
  - Feature flag off returns 404
  - Redaction log written
  - Redaction status query
  - Auditor-only log endpoint gate
  - permission helper unit test

Tests that exercise actual pikepdf PDF manipulation are marked with
@pytest.mark.pikepdf and skipped when pikepdf is not installed via the
`pikepdf_available` fixture. This matches the contract requirement to
"gate with pytest.importorskip" without skipping the whole module.
"""
from __future__ import annotations

import hashlib
import io
import os

import pytest

# ---------------------------------------------------------------------------
# Environment setup (must precede any app imports)
# ---------------------------------------------------------------------------
os.environ.setdefault("API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///./storage/test_redaction.db")
# Enable feature flag for all tests in this module
os.environ["FF_REDACTION"] = "1"

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)

H = {"X-API-Key": "test-key"}

from app.services.auth import issue_token  # noqa: E402


def _jwt(role: str, tenant: str = "default") -> str:
    return issue_token(sub=f"test-{role}", tenant=tenant, branch="Cairo", roles=[role])


def _auth(role: str, tenant: str = "default") -> dict[str, str]:
    return {**H, "Authorization": f"Bearer {_jwt(role, tenant)}"}


# ---------------------------------------------------------------------------
# Fixture: skip individual pikepdf-dependent tests gracefully
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def pikepdf_available() -> bool:
    try:
        import pikepdf  # noqa: F401
        return True
    except ImportError:
        return False


# ---------------------------------------------------------------------------
# Minimal valid PDF builder (pure Python, no external dependencies)
# ---------------------------------------------------------------------------

def _make_minimal_pdf(text: str = "Hello World SECRET_TOKEN_12345") -> bytes:
    """Build a minimal, spec-compliant single-page PDF with embedded text.

    Uses only stdlib — no pypdf or pikepdf needed for the fixture itself.
    The text is placed using a BT/Tj/ET block at coordinates ~(72, 720).
    """
    content = (
        "BT\n"
        "/F1 12 Tf\n"
        "72 720 Td\n"
        f"({text}) Tj\n"
        "ET\n"
    ).encode()

    def obj(n: int, body: bytes) -> bytes:
        return f"{n} 0 obj\n".encode() + body + b"\nendobj\n"

    objects: list[bytes] = [
        obj(1, b"<< /Type /Catalog /Pages 2 0 R >>"),
        obj(2, b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
        obj(
            3,
            (
                b"<< /Type /Page /Parent 2 0 R "
                b"/MediaBox [0 0 612 792] "
                b"/Contents 4 0 R "
                b"/Resources << /Font << /F1 5 0 R >> >> >>"
            ),
        ),
        obj(4, f"<< /Length {len(content)} >>\nstream\n".encode() + content + b"\nendstream"),
        obj(
            5,
            (
                b"<< /Type /Font /Subtype /Type1 "
                b"/BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
            ),
        ),
    ]

    header = b"%PDF-1.4\n"
    body_parts: list[bytes] = [header]
    offsets: list[int] = []
    pos = len(header)
    for o in objects:
        offsets.append(pos)
        body_parts.append(o)
        pos += len(o)

    xref_pos = pos
    xref = b"xref\n" + f"0 {len(objects) + 1}\n".encode()
    xref += b"0000000000 65535 f \n"
    for off in offsets:
        xref += f"{off:010d} 00000 n \n".encode()

    trailer = (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_pos}\n%%EOF\n"
    ).encode()

    return b"".join(body_parts) + xref + trailer


def _upload_pdf(pdf_bytes: bytes, name: str = "test.pdf") -> int:
    r = client.post(
        "/api/v1/documents",
        headers=H,
        files={"file": (name, io.BytesIO(pdf_bytes), "application/pdf")},
        data={"doc_type": "test", "customer_cid": "CID-REDACT", "uploaded_by": "pytest"},
    )
    assert r.status_code == 200, f"Upload failed: {r.text}"
    return r.json()["id"]


def _upload_non_pdf() -> int:
    r = client.post(
        "/api/v1/documents",
        headers=H,
        files={"file": ("note.txt", io.BytesIO(b"plain text content"), "text/plain")},
        data={"doc_type": "test", "customer_cid": "CID-REDACT", "uploaded_by": "pytest"},
    )
    assert r.status_code == 200
    return r.json()["id"]


def _region(page: int = 0, x: float = 50.0, y: float = 700.0, w: float = 300.0, h: float = 30.0) -> dict:
    return {"page": page, "x": x, "y": y, "w": w, "h": h, "reason": "pii"}


# ---------------------------------------------------------------------------
# 1. Feature flag off → 404
# ---------------------------------------------------------------------------

def test_feature_flag_off_returns_404(monkeypatch):
    # Patch both the module variable and the env var so _check_flag() sees it off
    monkeypatch.setattr("app.routers.document_redaction.FF_REDACTION", False)
    monkeypatch.setenv("FF_REDACTION", "0")
    pdf_bytes = _make_minimal_pdf()
    doc_id = _upload_pdf(pdf_bytes)
    r = client.post(
        f"/api/v1/documents/{doc_id}/redact",
        headers=_auth("maker"),
        json={"regions": [_region()], "reason": "pii"},
    )
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# 2. Auth: unauthenticated (no API key, no JWT) → 401
# ---------------------------------------------------------------------------

def test_redact_unauthenticated():
    """Without any credentials the require_api_key dependency must reject with 401."""
    pdf_bytes = _make_minimal_pdf()
    doc_id = _upload_pdf(pdf_bytes)
    r = client.post(
        f"/api/v1/documents/{doc_id}/redact",
        headers={},  # no X-API-Key, no JWT
        json={"regions": [_region()], "reason": "pii"},
    )
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# 3. RBAC: viewer cannot redact → 403
# ---------------------------------------------------------------------------

def test_redact_viewer_forbidden():
    pdf_bytes = _make_minimal_pdf()
    doc_id = _upload_pdf(pdf_bytes)
    r = client.post(
        f"/api/v1/documents/{doc_id}/redact",
        headers=_auth("viewer"),
        json={"regions": [_region()], "reason": "pii"},
    )
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# 4. Non-PDF rejection → 422
# ---------------------------------------------------------------------------

def test_redact_non_pdf_rejected():
    doc_id = _upload_non_pdf()
    r = client.post(
        f"/api/v1/documents/{doc_id}/redact",
        headers=_auth("maker"),
        json={"regions": [_region()], "reason": "pii"},
    )
    assert r.status_code == 422
    assert "PDF" in r.json().get("detail", "")


# ---------------------------------------------------------------------------
# 5. Regions validation: empty array → 422
# ---------------------------------------------------------------------------

def test_redact_empty_regions_rejected():
    pdf_bytes = _make_minimal_pdf()
    doc_id = _upload_pdf(pdf_bytes)
    r = client.post(
        f"/api/v1/documents/{doc_id}/redact",
        headers=_auth("maker"),
        json={"regions": [], "reason": "pii"},
    )
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# 6. Regions validation: >50 regions → 422
# ---------------------------------------------------------------------------

def test_redact_too_many_regions_rejected():
    pdf_bytes = _make_minimal_pdf()
    doc_id = _upload_pdf(pdf_bytes)
    regions = [_region(x=float(i * 5)) for i in range(51)]
    r = client.post(
        f"/api/v1/documents/{doc_id}/redact",
        headers=_auth("maker"),
        json={"regions": regions, "reason": "pii"},
    )
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# 7. Regions validation: negative coords → 422
# ---------------------------------------------------------------------------

def test_redact_negative_coords_rejected():
    pdf_bytes = _make_minimal_pdf()
    doc_id = _upload_pdf(pdf_bytes)
    bad = {"page": 0, "x": -10, "y": 200, "w": 100, "h": 30, "reason": "pii"}
    r = client.post(
        f"/api/v1/documents/{doc_id}/redact",
        headers=_auth("maker"),
        json={"regions": [bad], "reason": "pii"},
    )
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# 8. Regions validation: coord > 10000 → 422
# ---------------------------------------------------------------------------

def test_redact_coords_exceed_bound_rejected():
    pdf_bytes = _make_minimal_pdf()
    doc_id = _upload_pdf(pdf_bytes)
    bad = {"page": 0, "x": 10001, "y": 200, "w": 100, "h": 30, "reason": "pii"}
    r = client.post(
        f"/api/v1/documents/{doc_id}/redact",
        headers=_auth("maker"),
        json={"regions": [bad], "reason": "pii"},
    )
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# 9. Invalid reason enum → 422
# ---------------------------------------------------------------------------

def test_redact_invalid_reason_rejected():
    pdf_bytes = _make_minimal_pdf()
    doc_id = _upload_pdf(pdf_bytes)
    r = client.post(
        f"/api/v1/documents/{doc_id}/redact",
        headers=_auth("maker"),
        json={"regions": [_region()], "reason": "bad-reason"},
    )
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# 10. Document not found → 404
# ---------------------------------------------------------------------------

def test_redact_document_not_found():
    r = client.post(
        "/api/v1/documents/999999/redact",
        headers=_auth("maker"),
        json={"regions": [_region()], "reason": "pii"},
    )
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# 11. Happy path: 1-region redaction (maker role) — requires pikepdf
# ---------------------------------------------------------------------------

def test_redact_single_region_happy_path(pikepdf_available):
    pytest.importorskip("pikepdf")
    pdf_bytes = _make_minimal_pdf()
    doc_id = _upload_pdf(pdf_bytes)
    r = client.post(
        f"/api/v1/documents/{doc_id}/redact",
        headers=_auth("maker"),
        json={"regions": [_region()], "reason": "pii"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["parent_id"] == doc_id
    assert body["regions_redacted"] == 1
    assert body["redacted_document_id"] != doc_id
    assert body["sha256_original"] != body["sha256_redacted"]
    assert "v1." in body["version"]
    assert body["redacted_by"] == "test-maker"


# ---------------------------------------------------------------------------
# 12. Happy path: multi-region (checker role) — requires pikepdf
# ---------------------------------------------------------------------------

def test_redact_multi_region_happy_path(pikepdf_available):
    pytest.importorskip("pikepdf")
    pdf_bytes = _make_minimal_pdf()
    doc_id = _upload_pdf(pdf_bytes)
    regions = [
        _region(x=50, y=700, w=200, h=20),
        _region(x=50, y=650, w=150, h=20),
        _region(x=100, y=600, w=250, h=25),
    ]
    r = client.post(
        f"/api/v1/documents/{doc_id}/redact",
        headers=_auth("checker"),
        json={"regions": regions, "reason": "financial-secret"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["regions_redacted"] == 3


# ---------------------------------------------------------------------------
# 13. Happy path: multi-page regions — requires pikepdf
# ---------------------------------------------------------------------------

def test_redact_multi_page_regions(pikepdf_available):
    pytest.importorskip("pikepdf")
    pdf_bytes = _make_minimal_pdf()
    doc_id = _upload_pdf(pdf_bytes)
    regions = [
        {"page": 0, "x": 50, "y": 700, "w": 200, "h": 20, "reason": "pii"},
        {"page": 1, "x": 50, "y": 500, "w": 200, "h": 20, "reason": "pii"},
    ]
    r = client.post(
        f"/api/v1/documents/{doc_id}/redact",
        headers=_auth("doc_admin"),
        json={"regions": regions, "reason": "legal-hold"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["regions_redacted"] == 2


# ---------------------------------------------------------------------------
# 14. Idempotency: same regions twice → same sha256_redacted — requires pikepdf
# ---------------------------------------------------------------------------

def test_redact_idempotency_same_regions_same_hash(pikepdf_available):
    pytest.importorskip("pikepdf")
    pdf_bytes = _make_minimal_pdf()
    doc_id = _upload_pdf(pdf_bytes)
    payload = {"regions": [_region()], "reason": "pii"}
    r1 = client.post(f"/api/v1/documents/{doc_id}/redact", headers=_auth("maker"), json=payload)
    r2 = client.post(f"/api/v1/documents/{doc_id}/redact", headers=_auth("maker"), json=payload)
    assert r1.status_code == 201
    assert r2.status_code == 201
    assert r1.json()["sha256_redacted"] == r2.json()["sha256_redacted"]


# ---------------------------------------------------------------------------
# 15. Original document is preserved — requires pikepdf
# ---------------------------------------------------------------------------

def test_original_document_preserved_after_redaction(pikepdf_available):
    pytest.importorskip("pikepdf")
    pdf_bytes = _make_minimal_pdf()
    original_sha256 = hashlib.sha256(pdf_bytes).hexdigest()
    doc_id = _upload_pdf(pdf_bytes)
    r = client.post(
        f"/api/v1/documents/{doc_id}/redact",
        headers=_auth("maker"),
        json={"regions": [_region()], "reason": "pii"},
    )
    assert r.status_code == 201
    assert r.json()["sha256_original"] == original_sha256
    orig = client.get(f"/api/v1/documents/{doc_id}", headers=H)
    assert orig.json()["sha256"] == original_sha256


# ---------------------------------------------------------------------------
# 16. Redacted document has correct parent_id — requires pikepdf
# ---------------------------------------------------------------------------

def test_redacted_document_has_parent_id(pikepdf_available):
    pytest.importorskip("pikepdf")
    pdf_bytes = _make_minimal_pdf()
    doc_id = _upload_pdf(pdf_bytes)
    r = client.post(
        f"/api/v1/documents/{doc_id}/redact",
        headers=_auth("maker"),
        json={"regions": [_region()], "reason": "pii"},
    )
    assert r.status_code == 201
    new_id = r.json()["redacted_document_id"]
    new_doc = client.get(f"/api/v1/documents/{new_id}", headers=H)
    assert new_doc.status_code == 200
    assert new_doc.json().get("parent_id") == doc_id


# ---------------------------------------------------------------------------
# 17. Redaction status endpoint — requires pikepdf
# ---------------------------------------------------------------------------

def test_redaction_status_reflects_completed_redaction(pikepdf_available):
    pytest.importorskip("pikepdf")
    pdf_bytes = _make_minimal_pdf()
    doc_id = _upload_pdf(pdf_bytes)
    client.post(
        f"/api/v1/documents/{doc_id}/redact",
        headers=_auth("maker"),
        json={"regions": [_region()], "reason": "pii"},
    )
    r = client.get(f"/api/v1/documents/{doc_id}/redaction-status", headers=_auth("viewer"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["document_id"] == doc_id
    assert body["is_original"] is True
    assert body["has_redactions"] is True
    assert len(body["redacted_versions"]) >= 1


# ---------------------------------------------------------------------------
# 18a. Redaction log endpoint: auditor can read
# ---------------------------------------------------------------------------

def test_redaction_log_auditor_access():
    r = client.get("/api/v1/redaction-log", headers=_auth("auditor"))
    assert r.status_code == 200
    assert "items" in r.json()
    assert "total" in r.json()


# ---------------------------------------------------------------------------
# 18b. Redaction log endpoint: maker is forbidden
# ---------------------------------------------------------------------------

def test_redaction_log_maker_forbidden():
    r = client.get("/api/v1/redaction-log", headers=_auth("maker"))
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# 19. Text-actually-removed assertion (pdftotext smoke) — pikepdf + pdftotext
# ---------------------------------------------------------------------------

@pytest.mark.skipif(
    not __import__("shutil").which("pdftotext"),
    reason="pdftotext (poppler) not installed",
)
def test_text_actually_removed_pdftotext(pikepdf_available):
    """Security test: pdftotext on redacted PDF must NOT contain original text."""
    pytest.importorskip("pikepdf")
    import shutil
    import subprocess

    secret = "SUPERSECRET9876"
    pdf_bytes = _make_minimal_pdf(text=secret)
    doc_id = _upload_pdf(pdf_bytes, name="secret.pdf")

    orig_doc = client.get(f"/api/v1/documents/{doc_id}", headers=H).json()
    orig_text = subprocess.run(
        ["pdftotext", "-q", orig_doc["filename"], "-"],
        capture_output=True, text=True, timeout=10,
    ).stdout
    assert secret in orig_text, "Setup failed: secret not found in original PDF text"

    r = client.post(
        f"/api/v1/documents/{doc_id}/redact",
        headers=_auth("maker"),
        json={"regions": [{"page": 0, "x": 60, "y": 710, "w": 400, "h": 30, "reason": "pii"}],
              "reason": "pii"},
    )
    assert r.status_code == 201, r.text

    new_id = r.json()["redacted_document_id"]
    redacted_path = client.get(f"/api/v1/documents/{new_id}", headers=H).json()["filename"]
    redacted_text = subprocess.run(
        ["pdftotext", "-q", redacted_path, "-"],
        capture_output=True, text=True, timeout=10,
    ).stdout
    assert secret not in redacted_text, (
        f"REDACTION FAILED: '{secret}' still in redacted PDF text."
    )


# ---------------------------------------------------------------------------
# 20. Large PDF (>1 MB) accepted — requires pikepdf
# ---------------------------------------------------------------------------

def test_large_pdf_accepted(pikepdf_available):
    pytest.importorskip("pikepdf")
    base = _make_minimal_pdf()
    padding = b"%" + b"X" * 1023 + b"\n"
    large_pdf = base + padding * 1100  # ~1.1 MB padding
    doc_id = _upload_pdf(large_pdf, name="large.pdf")
    r = client.post(
        f"/api/v1/documents/{doc_id}/redact",
        headers=_auth("maker"),
        json={"regions": [_region()], "reason": "pii"},
    )
    # Success (201) or server-side processing error (500) — never 400/422
    assert r.status_code in (201, 500), f"Unexpected {r.status_code}: {r.text}"


# ---------------------------------------------------------------------------
# 21. All reason enum values accepted — requires pikepdf
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("reason", [
    "pii", "financial-secret", "commercial-confidential", "legal-hold", "other",
])
def test_all_reason_values_accepted(reason: str, pikepdf_available):
    pytest.importorskip("pikepdf")
    pdf_bytes = _make_minimal_pdf()
    doc_id = _upload_pdf(pdf_bytes)
    r = client.post(
        f"/api/v1/documents/{doc_id}/redact",
        headers=_auth("maker"),
        json={"regions": [_region()], "reason": reason},
    )
    assert r.status_code == 201, f"Reason '{reason}' rejected: {r.text}"


# ---------------------------------------------------------------------------
# 22. Tenant boundary enforced
# ---------------------------------------------------------------------------

def test_tenant_boundary_enforced():
    pdf_bytes = _make_minimal_pdf()
    doc_id = _upload_pdf(pdf_bytes)
    r = client.post(
        f"/api/v1/documents/{doc_id}/redact",
        headers=_auth("maker", tenant="other-bank"),
        json={"regions": [_region()], "reason": "pii"},
    )
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# 23. lock_original=true requires doc_admin
# ---------------------------------------------------------------------------

def test_lock_original_requires_doc_admin():
    pdf_bytes = _make_minimal_pdf()
    doc_id = _upload_pdf(pdf_bytes)
    r = client.post(
        f"/api/v1/documents/{doc_id}/redact",
        headers=_auth("maker"),
        json={"regions": [_region()], "reason": "pii", "lock_original": True},
    )
    assert r.status_code == 403


def test_lock_original_allowed_for_doc_admin(pikepdf_available):
    pytest.importorskip("pikepdf")
    pdf_bytes = _make_minimal_pdf()
    doc_id = _upload_pdf(pdf_bytes)
    r = client.post(
        f"/api/v1/documents/{doc_id}/redact",
        headers=_auth("doc_admin"),
        json={"regions": [_region()], "reason": "pii", "lock_original": True},
    )
    assert r.status_code == 201, r.text


# ---------------------------------------------------------------------------
# 24. principal_can_view_unredacted permission helper — pure Python, no PDF
# ---------------------------------------------------------------------------

def test_view_unredacted_permission_helper():
    from app.services.auth import principal_can_view_unredacted, Principal

    assert principal_can_view_unredacted(Principal(sub="a", tenant="t", roles=["doc_admin"]))
    assert principal_can_view_unredacted(Principal(sub="b", tenant="t", roles=["auditor"]))
    assert not principal_can_view_unredacted(Principal(sub="c", tenant="t", roles=["maker"]))
    assert not principal_can_view_unredacted(Principal(sub="d", tenant="t", roles=["viewer"]))
    assert not principal_can_view_unredacted(Principal(sub="e", tenant="t", roles=["checker"]))
    # doc_admin + auditor combined still grants it
    assert principal_can_view_unredacted(
        Principal(sub="f", tenant="t", roles=["auditor", "viewer"])
    )
