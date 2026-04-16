"""Store the user's hand-drawn signature and overlay it on the PDF.

Flow:
  1. Browser sends PNG + SVG + stroke metadata to /api/v1/signatures/{id}/ink.
  2. We compute SHA-256 of the combined (png + svg) so the ink itself is
     tamper-evident once stored.
  3. PNG is saved next to the source file as `<doc>.inksig.png`.
  4. For PDFs: we call the existing `sign_detached` to produce the cryptographic
     bundle AND stamp the ink visually on the last page via pypdf.
  5. Returns metadata for the workflow to persist.
"""
from __future__ import annotations
import base64
import hashlib
import io
from datetime import datetime
from pathlib import Path
from typing import Any

from .signing import sign_detached


def _overlay_pdf(pdf_path: Path, png_bytes: bytes) -> Path | None:
    try:
        from pypdf import PdfReader, PdfWriter
        from pypdf.generic import RectangleObject
    except Exception:
        return None
    # Render an overlay page containing just the PNG at the bottom-right.
    try:
        from PIL import Image
        import io as _io
        img = Image.open(_io.BytesIO(png_bytes))
        # Scale to ~120x45 pt.
        w, h = img.size
        ratio = 120.0 / max(w, 1)
        target = (int(w * ratio), int(h * ratio))
        img.thumbnail(target)
        overlay = _io.BytesIO()
        img.save(overlay, "PDF", resolution=100.0)
        overlay.seek(0)
    except Exception:
        return None

    try:
        reader = PdfReader(str(pdf_path))
        overlay_reader = PdfReader(overlay)
        writer = PdfWriter(clone_from=reader)
        last_idx = len(writer.pages) - 1
        writer.pages[last_idx].merge_page(overlay_reader.pages[0])
        out = pdf_path.with_name(pdf_path.stem + ".inksigned.pdf")
        with open(out, "wb") as f:
            writer.write(f)
        return out
    except Exception:
        return None


def attach_ink(doc_path: str, signer: str, png_base64: str,
               svg: str = "", strokes_json: str = "") -> dict[str, Any]:
    p = Path(doc_path)
    try:
        png_bytes = base64.b64decode(png_base64)
    except Exception:
        return {"ok": False, "reason": "bad_png_base64"}

    ink_path = p.with_name(p.stem + ".inksig.png")
    ink_path.write_bytes(png_bytes)

    # Tamper-evident hash over ink + svg.
    h = hashlib.sha256(png_bytes + svg.encode("utf-8")).hexdigest()

    # Run the existing detached signer on the ORIGINAL document.
    cryptographic = sign_detached(str(p), signer, reason="ink signature")

    overlaid = None
    if p.suffix.lower() == ".pdf":
        overlaid = _overlay_pdf(p, png_bytes)

    return {
        "ok": True,
        "ink_path": str(ink_path),
        "ink_sha256": h,
        "overlaid_pdf": str(overlaid) if overlaid else None,
        "cryptographic": cryptographic,
        "signer": signer,
        "signed_at": datetime.utcnow().isoformat() + "Z",
    }
