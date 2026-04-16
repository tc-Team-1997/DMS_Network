"""Multi-modal stamp search: find documents whose stamps look like a query crop.

The bank's forms carry round / rectangular inked stamps ("APPROVED", "PAID",
branch seals). Investigators often only have a photo of a single stamp and
want to find every document that bears it.

Algorithm:
  - Ingest: for each uploaded image, detect candidate stamp regions (HSV mask
    for red/blue ink blobs, morphology-filtered), compute a perceptual hash +
    dominant color + bbox, persist one row per candidate.
  - Query: accept a cropped stamp image, compute the same fingerprint,
    rank all stored fingerprints by Hamming distance on the pHash + Lab-color
    distance on the tint.

Zero ML dependency; uses Pillow + numpy which are already in base requirements.
For production recall + precision on handwritten / rotated stamps, swap the
fingerprinter with a small CLIP image encoder (512-d embeddings).
"""
from __future__ import annotations
import io
import math
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from ..models import Document, StampFingerprint


def _have_deps():
    try:
        import PIL.Image, numpy as _np, imagehash  # noqa: F401
        return True
    except Exception:
        return False


def _avg_color_hex(rgb: tuple[int, int, int]) -> str:
    return "#{:02x}{:02x}{:02x}".format(*[max(0, min(255, int(v))) for v in rgb])


def _candidate_regions(pil_img):
    """Return [(bbox, crop, phash, avg_rgb)] for each plausible stamp region."""
    import numpy as np
    from PIL import Image
    import imagehash

    img = pil_img.convert("RGB")
    arr = np.asarray(img)
    hsv = Image.fromarray(arr).convert("HSV")
    hsv_arr = np.asarray(hsv)

    h = hsv_arr[..., 0]
    s = hsv_arr[..., 1]
    v = hsv_arr[..., 2]

    # Ink mask: saturated non-black pixels. Accepts red/blue/green stamps.
    ink = ((s > 90) & (v > 60)).astype("uint8")

    # Crude connected-component labelling via cumulative flood.
    H, W = ink.shape
    visited = np.zeros_like(ink, dtype=bool)
    out: list[tuple[tuple[int, int, int, int], Any, str, tuple[int, int, int]]] = []

    # Sparse sample: walk a 32-px grid, expand where we hit ink.
    for y in range(0, H, 32):
        for x in range(0, W, 32):
            if ink[y, x] == 0 or visited[y, x]:
                continue
            # Flood-fill the connected blob (cap size to avoid entire page).
            stack = [(y, x)]
            pts: list[tuple[int, int]] = []
            while stack and len(pts) < 40000:
                cy, cx = stack.pop()
                if cy < 0 or cy >= H or cx < 0 or cx >= W:
                    continue
                if visited[cy, cx] or ink[cy, cx] == 0:
                    continue
                visited[cy, cx] = True
                pts.append((cy, cx))
                stack.extend([(cy+1, cx), (cy-1, cx), (cy, cx+1), (cy, cx-1)])
            if len(pts) < 400:
                continue
            ys = [p[0] for p in pts]; xs = [p[1] for p in pts]
            y0, y1 = max(0, min(ys) - 4), min(H, max(ys) + 5)
            x0, x1 = max(0, min(xs) - 4), min(W, max(xs) + 5)
            bw, bh = x1 - x0, y1 - y0
            if bw < 40 or bh < 40 or bw > W * 0.7 or bh > H * 0.7:
                continue
            crop = img.crop((x0, y0, x1, y1))
            ph = str(imagehash.phash(crop))
            region = arr[y0:y1, x0:x1][..., :3]
            avg = tuple(region.reshape(-1, 3).mean(axis=0).astype(int))
            out.append(((x0, y0, bw, bh), crop, ph, avg))
            if len(out) >= 5:
                return out
    return out


def ingest_document(db: Session, document_id: int) -> dict:
    if not _have_deps():
        return {"ok": False, "reason": "pillow_numpy_imagehash_required"}
    doc = db.get(Document, document_id)
    if not doc:
        return {"ok": False, "reason": "not_found"}
    path = Path(doc.filename)
    if path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}:
        return {"ok": False, "reason": "not_image"}

    from PIL import Image
    try:
        with Image.open(path) as im:
            regions = _candidate_regions(im)
    except Exception as e:
        return {"ok": False, "reason": f"open_failed:{e}"}

    # Replace existing rows for this doc.
    db.query(StampFingerprint).filter(StampFingerprint.document_id == document_id).delete()
    for (bbox, _crop, ph, avg) in regions:
        db.add(StampFingerprint(
            document_id=document_id, phash=ph,
            avg_color=_avg_color_hex(avg),
            bbox=",".join(str(v) for v in bbox),
        ))
    db.commit()
    return {"document_id": document_id, "fingerprints": len(regions)}


def _hamming(a: str, b: str) -> int:
    try:
        import imagehash
        return imagehash.hex_to_hash(a) - imagehash.hex_to_hash(b)
    except Exception:
        return 64


def search(db: Session, query_bytes: bytes, top_k: int = 10) -> list[dict]:
    if not _have_deps():
        return []
    from PIL import Image
    import imagehash
    try:
        with Image.open(io.BytesIO(query_bytes)) as im:
            q_hash = str(imagehash.phash(im.convert("RGB")))
    except Exception:
        return []

    rows = db.query(StampFingerprint).all()
    scored = []
    for r in rows:
        d = _hamming(q_hash, r.phash)
        if d <= 18:
            scored.append((d, r))
    scored.sort(key=lambda x: x[0])
    return [{"document_id": r.document_id,
             "distance": int(d),
             "bbox": r.bbox, "phash": r.phash,
             "similarity": round(1 - d / 64.0, 3)}
            for d, r in scored[:top_k]]
