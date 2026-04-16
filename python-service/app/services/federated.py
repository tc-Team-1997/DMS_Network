"""Federated learning across branches.

Implements FedAvg [McMahan et al. 2017] over a small logistic-regression model
for the per-document fraud classifier. Each branch trains locally on its own
documents (data never leaves the branch), sends the weight vector + sample count
to the central coordinator, which averages weighted by N.

Model: logistic regression over 8 features (same signals the rule engine uses):
    [velocity_cid, velocity_uploader, has_duplicate, expiry_past,
     ocr_low_conf, missing_fields, size_bytes_log, is_kyc_doc]

Why bother? Branches can't legally share documents (privacy + CBE segregation),
but they CAN share tiny weight vectors that carry signal patterns. The global
model sees the union of branch behavior without seeing any single document.

Differential privacy noise (from services/dp.py) can be added to the outgoing
weight vector at branches; toggle with env FL_DP_EPSILON=0 to disable.
"""
from __future__ import annotations
import json
import math
import os
import random
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Document, OcrResult, DuplicateMatch, WorkflowStep


N_FEATURES = 8
MODEL_DIR = Path(settings.STORAGE_DIR).parent / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)
GLOBAL_PATH = MODEL_DIR / "fraud_global.json"
FL_DP_EPSILON = float(os.environ.get("FL_DP_EPSILON", "0"))


def _sigmoid(x: float) -> float:
    if x < -500:
        return 0.0
    if x > 500:
        return 1.0
    return 1.0 / (1.0 + math.exp(-x))


def _featurize(db: Session, doc: Document) -> list[float]:
    from datetime import timedelta
    since = datetime.utcnow() - timedelta(hours=24)
    velocity_cid = db.query(func.count(Document.id)).filter(
        Document.customer_cid == doc.customer_cid,
        Document.created_at >= since,
    ).scalar() or 0 if doc.customer_cid else 0
    velocity_uploader = db.query(func.count(Document.id)).filter(
        Document.uploaded_by == doc.uploaded_by,
        Document.created_at >= since - timedelta(hours=1),
    ).scalar() or 0 if doc.uploaded_by else 0
    has_dup = 1.0 if db.query(DuplicateMatch).filter(
        (DuplicateMatch.doc_a == doc.id) | (DuplicateMatch.doc_b == doc.id)
    ).first() else 0.0
    today = datetime.utcnow().date().isoformat()
    expiry_past = 1.0 if (doc.expiry_date and doc.expiry_date < today) else 0.0
    ocr = db.query(OcrResult).filter(OcrResult.document_id == doc.id).first()
    ocr_low = 1.0 if (ocr and ocr.confidence is not None and ocr.confidence < 0.8) else 0.0
    missing = 1.0 if (doc.doc_type in ("passport", "national_id")
                      and not doc.expiry_date) else 0.0
    size_log = math.log1p(doc.size_bytes or 0) / 20.0   # rough 0..1
    is_kyc = 1.0 if doc.doc_type in ("passport", "national_id") else 0.0
    return [float(velocity_cid) / 5, float(velocity_uploader) / 50, has_dup,
            expiry_past, ocr_low, missing, size_log, is_kyc]


def _label(db: Session, doc: Document) -> int:
    """Positive = rejected by checker (proxy for real fraud)."""
    s = db.query(WorkflowStep).filter(
        WorkflowStep.document_id == doc.id,
        WorkflowStep.action == "reject",
    ).first()
    return 1 if s else 0


def local_train(db: Session, epochs: int = 20, lr: float = 0.1,
                tenant: str = "default") -> dict:
    """Train LR locally on this branch's documents. Returns (weights, n_samples)."""
    docs = db.query(Document).filter(Document.tenant == tenant).limit(5000).all()
    X, y = [], []
    for d in docs:
        X.append(_featurize(db, d))
        y.append(_label(db, d))
    n = len(X)
    if n < 10:
        return {"n_samples": n, "weights": [0.0] * (N_FEATURES + 1),
                "note": "not enough local data"}

    w = [0.0] * (N_FEATURES + 1)  # bias at w[-1]
    for _ in range(epochs):
        for xi, yi in zip(X, y):
            z = sum(wi * fi for wi, fi in zip(w[:N_FEATURES], xi)) + w[-1]
            p = _sigmoid(z)
            err = p - yi
            for i in range(N_FEATURES):
                w[i] -= lr * err * xi[i]
            w[-1] -= lr * err

    if FL_DP_EPSILON > 0:
        # Add Laplace noise to bound sensitivity before leaving the branch.
        scale = 1.0 / FL_DP_EPSILON
        w = [wi + _lap(scale) for wi in w]

    return {"n_samples": n, "weights": [round(v, 6) for v in w]}


def _lap(scale: float) -> float:
    u = random.random() - 0.5
    sign = 1 if u >= 0 else -1
    return -scale * sign * math.log(max(1 - 2 * abs(u), 1e-12))


def fedavg(updates: list[dict]) -> list[float]:
    """Weighted average of (weights, n_samples) from each branch."""
    total_n = sum(u["n_samples"] for u in updates if u.get("n_samples", 0) > 0)
    if total_n == 0:
        return [0.0] * (N_FEATURES + 1)
    agg = [0.0] * (N_FEATURES + 1)
    for u in updates:
        n = u.get("n_samples", 0)
        if n <= 0:
            continue
        w = u.get("weights", [])
        for i, v in enumerate(w):
            if i < len(agg):
                agg[i] += v * (n / total_n)
    return [round(v, 6) for v in agg]


def save_global(weights: list[float], round_no: int) -> None:
    GLOBAL_PATH.write_text(json.dumps({
        "round": round_no,
        "updated_at": datetime.utcnow().isoformat() + "Z",
        "weights": weights,
        "n_features": N_FEATURES,
    }, indent=2))


def load_global() -> dict | None:
    if not GLOBAL_PATH.exists():
        return None
    try:
        return json.loads(GLOBAL_PATH.read_text())
    except Exception:
        return None


def predict(db: Session, document_id: int) -> dict:
    glob = load_global()
    if not glob:
        return {"error": "no_global_model"}
    doc = db.get(Document, document_id)
    if not doc:
        return {"error": "not_found"}
    x = _featurize(db, doc)
    w = glob["weights"]
    z = sum(wi * fi for wi, fi in zip(w[:N_FEATURES], x)) + w[-1]
    prob = _sigmoid(z)
    return {"document_id": document_id,
            "global_round": glob.get("round"),
            "features": x,
            "fraud_prob": round(prob, 4)}
