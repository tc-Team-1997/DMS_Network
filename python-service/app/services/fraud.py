"""Fraud scoring: rule-based velocity + IsolationForest anomaly detection.

Signals combined into a 0..100 risk score with per-signal attribution:
  - velocity_cid:    same CID submitted > N docs in last W hours
  - velocity_uploader: same uploader pushed > M docs in last H hours
  - duplicate:       SHA-256 or near-image match exists
  - expiry_past:     document is already expired
  - ocr_low:         OCR confidence under 0.8
  - missing_fields:  key metadata missing (e.g. expiry on KYC doc)
  - anomaly:         IsolationForest on (size_bytes, ocr_confidence, hour-of-day)

IsolationForest is optional — absent scikit-learn we still return rule-based score.
"""
from __future__ import annotations
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import Document, OcrResult, DuplicateMatch


VELOCITY_CID_LIMIT = 3           # more than 3 docs for one CID in a day = suspicious
VELOCITY_CID_WINDOW_H = 24
VELOCITY_UPLOADER_LIMIT = 50     # more than 50 docs per uploader / hour = bulk dump
VELOCITY_UPLOADER_WINDOW_H = 1
KYC_DOC_TYPES = {"passport", "national_id", "driving_license"}


def _velocity_cid(db: Session, doc: Document) -> int:
    if not doc.customer_cid:
        return 0
    since = datetime.utcnow() - timedelta(hours=VELOCITY_CID_WINDOW_H)
    n = db.query(func.count(Document.id)).filter(
        Document.customer_cid == doc.customer_cid,
        Document.created_at >= since,
    ).scalar() or 0
    return max(0, n - VELOCITY_CID_LIMIT)


def _velocity_uploader(db: Session, doc: Document) -> int:
    if not doc.uploaded_by:
        return 0
    since = datetime.utcnow() - timedelta(hours=VELOCITY_UPLOADER_WINDOW_H)
    n = db.query(func.count(Document.id)).filter(
        Document.uploaded_by == doc.uploaded_by,
        Document.created_at >= since,
    ).scalar() or 0
    return max(0, n - VELOCITY_UPLOADER_LIMIT)


def _has_duplicate(db: Session, doc: Document) -> bool:
    return db.query(DuplicateMatch).filter(
        (DuplicateMatch.doc_a == doc.id) | (DuplicateMatch.doc_b == doc.id)
    ).first() is not None


def _anomaly_score(db: Session, doc: Document) -> float:
    try:
        from sklearn.ensemble import IsolationForest
        import numpy as np
    except Exception:
        return 0.0

    # Build feature matrix from up to 500 recent docs.
    rows = (
        db.query(Document.size_bytes, OcrResult.confidence, Document.created_at)
        .outerjoin(OcrResult, OcrResult.document_id == Document.id)
        .order_by(Document.id.desc()).limit(500).all()
    )
    if len(rows) < 20:
        return 0.0

    X = np.array([
        [r[0] or 0, float(r[1] or 0.0), (r[2].hour if r[2] else 0)]
        for r in rows
    ])
    target = np.array([[
        doc.size_bytes or 0,
        float(doc.ocr.confidence) if doc.ocr and doc.ocr.confidence is not None else 0.0,
        doc.created_at.hour if doc.created_at else 0,
    ]])
    try:
        model = IsolationForest(contamination=0.05, random_state=42).fit(X)
        score = -float(model.score_samples(target)[0])  # higher = more anomalous
        # Normalize roughly into 0..1.
        return max(0.0, min(1.0, score))
    except Exception:
        return 0.0


def score(db: Session, doc: Document) -> dict[str, Any]:
    signals: list[tuple[str, int, str]] = []  # (name, points, reason)

    vc = _velocity_cid(db, doc)
    if vc > 0:
        signals.append(("velocity_cid", min(25, 10 + vc * 5), f"{vc} docs over CID limit in {VELOCITY_CID_WINDOW_H}h"))

    vu = _velocity_uploader(db, doc)
    if vu > 0:
        signals.append(("velocity_uploader", min(20, 5 + vu // 10), f"uploader exceeded bulk threshold"))

    if _has_duplicate(db, doc):
        signals.append(("duplicate", 30, "SHA-256 / near-image duplicate exists"))

    if doc.expiry_date:
        try:
            exp = datetime.strptime(doc.expiry_date, "%Y-%m-%d").date()
            if exp < datetime.utcnow().date():
                signals.append(("expiry_past", 15, f"document already expired ({doc.expiry_date})"))
        except Exception:
            pass

    if doc.ocr and doc.ocr.confidence is not None and doc.ocr.confidence < 0.8:
        signals.append(("ocr_low", 10, f"OCR confidence {doc.ocr.confidence:.2f}"))

    if doc.doc_type in KYC_DOC_TYPES and not doc.expiry_date:
        signals.append(("missing_fields", 10, "KYC document without expiry_date"))

    anomaly = _anomaly_score(db, doc)
    if anomaly > 0.4:
        signals.append(("anomaly", int(round(anomaly * 20)),
                        f"IsolationForest outlier score {anomaly:.2f}"))

    total = min(100, sum(pts for _, pts, _ in signals))
    band = "low" if total < 30 else "medium" if total < 60 else "high" if total < 85 else "critical"

    return {
        "document_id": doc.id,
        "score": total,
        "band": band,
        "signals": [{"name": n, "points": p, "reason": r} for n, p, r in signals],
    }
