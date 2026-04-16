"""Voice biometrics for phone-channel approvals.

Pipeline:
  - Accept WAV / PCM 16-bit audio uploads.
  - Extract a 40-dim MFCC-like summary (mean + std across frames).
  - Enrollment: average N samples into a per-user centroid.
  - Verification: cosine distance to centroid; threshold configurable.

Uses `librosa` + `soundfile` when available — they give real MFCCs. The module
degrades to a spectral-centroid + zero-crossing-rate fingerprint if librosa is
missing, so the API keeps working (with lower accuracy) in slim containers.

For production-grade banking auth, swap this with a speaker-verification service
(Nuance Gatekeeper, Pindrop) via the same router contract.
"""
from __future__ import annotations
import io
import json
import math
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from ..models import VoiceEnrollment


EMB_DIM = 40
DEFAULT_THRESHOLD = 0.78  # cosine similarity — higher = stricter match


def _extract_mfcc(wav_bytes: bytes) -> list[float]:
    try:
        import numpy as np
        import soundfile as sf
        import librosa
        y, sr = sf.read(io.BytesIO(wav_bytes))
        if y.ndim > 1:
            y = y.mean(axis=1)
        if sr != 16000:
            y = librosa.resample(y.astype("float32"), orig_sr=sr, target_sr=16000)
            sr = 16000
        mfcc = librosa.feature.mfcc(y=y.astype("float32"), sr=sr, n_mfcc=20)
        mean = mfcc.mean(axis=1)
        std = mfcc.std(axis=1)
        vec = np.concatenate([mean, std]).tolist()
        n = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / n for v in vec]
    except Exception:
        return _fallback_fingerprint(wav_bytes)


def _fallback_fingerprint(wav_bytes: bytes) -> list[float]:
    """Low-dep: hash spectral + zero-crossing-rate of raw PCM into 40 floats."""
    import struct
    # Skip WAV header if present.
    if wav_bytes[:4] == b"RIFF" and b"data" in wav_bytes[:200]:
        idx = wav_bytes.index(b"data") + 8
        pcm = wav_bytes[idx:]
    else:
        pcm = wav_bytes
    n = min(len(pcm) // 2, 16000 * 10)  # up to 10s
    if n < 1600:
        return [0.0] * EMB_DIM
    samples = struct.unpack("<" + "h" * n, pcm[: n * 2])

    # Simple spectral buckets using sliding-window DFT on chunks of 512.
    import math, cmath
    buckets = [0.0] * EMB_DIM
    counts = [0] * EMB_DIM
    step = 256
    for start in range(0, n - 512, step):
        frame = samples[start:start + 512]
        # DC-remove
        m = sum(frame) / len(frame)
        frame = [s - m for s in frame]
        zcr = sum(1 for i in range(1, len(frame)) if (frame[i - 1] >= 0) != (frame[i] >= 0))
        # coarse energy in 20 bands via strided partial DFT magnitudes
        for b in range(20):
            k = (b + 1) * 4
            re = im = 0.0
            for i, s in enumerate(frame):
                theta = -2 * math.pi * k * i / 512
                re += s * math.cos(theta)
                im += s * math.sin(theta)
            mag = math.sqrt(re * re + im * im)
            buckets[b] += mag
            buckets[20 + b] += zcr
            counts[b] += 1
            counts[20 + b] += 1
    vec = [b / (c or 1) for b, c in zip(buckets, counts)]
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def _cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def enroll(db: Session, user_sub: str, customer_cid: str | None, wav_bytes: bytes) -> dict:
    vec = _extract_mfcc(wav_bytes)
    row = (db.query(VoiceEnrollment)
           .filter(VoiceEnrollment.user_sub == user_sub).first())
    if row:
        old = json.loads(row.embedding or "[]")
        if len(old) == len(vec):
            n = row.samples or 1
            new = [(v * (n) + nv) / (n + 1) for v, nv in zip(old, vec)]
            # renormalize
            norm = math.sqrt(sum(x * x for x in new)) or 1.0
            new = [x / norm for x in new]
            row.embedding = json.dumps(new)
            row.samples = n + 1
        row.updated_at = datetime.utcnow()
        row.customer_cid = customer_cid or row.customer_cid
    else:
        row = VoiceEnrollment(user_sub=user_sub, customer_cid=customer_cid,
                              embedding=json.dumps(vec), samples=1,
                              updated_at=datetime.utcnow())
        db.add(row)
    db.commit()
    db.refresh(row)
    return {"user_sub": user_sub, "samples": row.samples,
            "embedding_dim": len(vec)}


def verify(db: Session, user_sub: str, wav_bytes: bytes,
           threshold: float = DEFAULT_THRESHOLD) -> dict:
    row = (db.query(VoiceEnrollment)
           .filter(VoiceEnrollment.user_sub == user_sub).first())
    if not row:
        return {"ok": False, "reason": "not_enrolled"}
    target = _extract_mfcc(wav_bytes)
    centroid = json.loads(row.embedding or "[]")
    if len(target) != len(centroid):
        return {"ok": False, "reason": "embedding_dim_mismatch"}
    sim = _cosine(centroid, target)
    return {"ok": True, "similarity": round(sim, 4),
            "threshold": threshold, "match": sim >= threshold}
