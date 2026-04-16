"""Face match for identity verification.

Compares the photo in a KYC document (passport/national ID) against a live selfie.
Uses `face_recognition` (dlib-based) when available; falls back to a clear error so
the caller can disable the feature at runtime.

For production consider InsightFace (better African-language-script demographics) or
a commercial service (AWS Rekognition, Azure Face). The API surface here is stable.
"""
from __future__ import annotations
import io
from pathlib import Path
from typing import Optional

DEFAULT_THRESHOLD = 0.6  # face_recognition's default — lower = stricter


def _lib_available() -> bool:
    try:
        import face_recognition  # noqa: F401
        return True
    except Exception:
        return False


def _encode(image_path_or_bytes) -> Optional[list]:
    import face_recognition
    import numpy as np
    if isinstance(image_path_or_bytes, (str, Path)):
        img = face_recognition.load_image_file(str(image_path_or_bytes))
    else:
        from PIL import Image
        img = np.array(Image.open(io.BytesIO(image_path_or_bytes)))
    encs = face_recognition.face_encodings(img)
    return encs[0].tolist() if encs else None


def compare(doc_image_path: str, selfie_bytes: bytes, threshold: float = DEFAULT_THRESHOLD) -> dict:
    if not _lib_available():
        return {"ok": False, "reason": "face_recognition not installed"}
    try:
        import face_recognition
        import numpy as np
        doc_enc = _encode(doc_image_path)
        selfie_enc = _encode(selfie_bytes)
        if not doc_enc:
            return {"ok": False, "reason": "no face in document photo"}
        if not selfie_enc:
            return {"ok": False, "reason": "no face in selfie"}
        distance = float(face_recognition.face_distance([np.array(doc_enc)], np.array(selfie_enc))[0])
        return {
            "ok": True,
            "distance": round(distance, 4),
            "threshold": threshold,
            "match": distance <= threshold,
            "confidence": round(max(0.0, 1.0 - distance), 4),
        }
    except Exception as e:
        return {"ok": False, "reason": f"face compare error: {e}"}
