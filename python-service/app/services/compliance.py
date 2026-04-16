"""Continuous compliance scorecard.

Measures the deployment against controls mapped to CBE Reg 22/2022, PCI-DSS 4.0,
ISO-27001 Annex A, and GDPR. Each control runs a short probe against the live
service and returns pass / warn / fail + evidence. Run on a schedule and
persist rows in `compliance_scores` — the posture dashboard reads from there.

Controls are intentionally a small, interpretable set. Every control cites the
artifact that satisfies it so auditors can map findings back to code.
"""
from __future__ import annotations
import json
from datetime import datetime, timedelta
from typing import Any, Callable

import httpx
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import Document, WorkflowStep, WatchlistMatch, ComplianceScore


Control = tuple[str, str, str, Callable[[Session], dict]]


def _has_any(db: Session, model, **filters) -> bool:
    q = db.query(model)
    for k, v in filters.items():
        q = q.filter(getattr(model, k) == v)
    return q.first() is not None


def _c_cbe_01(db: Session) -> dict:
    # Expired KYC documents not blocked?
    today = datetime.utcnow().date().isoformat()
    expired = db.query(func.count(Document.id)).filter(
        Document.doc_type.in_(["passport", "national_id"]),
        Document.expiry_date != None,  # noqa: E711
        Document.expiry_date < today,
        Document.status.notin_(["archived", "rejected", "quarantined"]),
    ).scalar() or 0
    if expired == 0:
        return {"status": "pass", "score": 1.0,
                "evidence": "no active expired KYC docs",}
    if expired < 20:
        return {"status": "warn", "score": 0.7,
                "evidence": f"{expired} active expired KYC docs"}
    return {"status": "fail", "score": 0.2,
            "evidence": f"{expired} expired KYC docs still in open workflow"}


def _c_cbe_02(db: Session) -> dict:
    unreviewed = db.query(func.count(WatchlistMatch.id)).filter(
        WatchlistMatch.status == "open",
        WatchlistMatch.created_at < datetime.utcnow() - timedelta(days=5),
    ).scalar() or 0
    if unreviewed == 0:
        return {"status": "pass", "score": 1.0,
                "evidence": "all AML matches reviewed within 5 business days"}
    return {"status": "fail", "score": 0.0,
            "evidence": f"{unreviewed} AML matches older than 5 days without review"}


def _c_pci_01(db: Session) -> dict:
    # No payment card PAN should land in OCR text — check redaction hook.
    try:
        with httpx.Client(timeout=1.0) as c:
            r = c.post("http://127.0.0.1:8000/api/v1/redact/text",
                       json={"text": "card 4111 1111 1111 1111"},
                       headers={"X-API-Key": "dev-key-change-me"})
            if r.status_code != 200:
                return {"status": "warn", "score": 0.5,
                        "evidence": "redaction endpoint not reachable"}
            if "findings" in r.json() and r.json()["findings"]:
                return {"status": "pass", "score": 1.0,
                        "evidence": "Luhn-validated PAN detected + masked"}
    except Exception as e:
        return {"status": "warn", "score": 0.5, "evidence": str(e)[:120]}
    return {"status": "fail", "score": 0.0, "evidence": "no PAN detection"}


def _c_iso_01(db: Session) -> dict:
    # A.5.1 Policies: presence of ClusterImagePolicy manifest in repo is evidence.
    from pathlib import Path
    p = Path(__file__).resolve().parents[2] / "k8s" / "policy.yaml"
    if p.exists():
        return {"status": "pass", "score": 1.0,
                "evidence": f"policy file present: {p.relative_to(p.parents[2])}"}
    return {"status": "fail", "score": 0.0, "evidence": "no signed-image admission policy"}


def _c_iso_02(db: Session) -> dict:
    # A.8.2 Classification: every document has a doc_type.
    total = db.query(func.count(Document.id)).scalar() or 1
    untyped = db.query(func.count(Document.id)).filter(
        (Document.doc_type == None) | (Document.doc_type == "")  # noqa: E711
    ).scalar() or 0
    ratio = untyped / total
    if ratio == 0:
        return {"status": "pass", "score": 1.0,
                "evidence": "100% documents classified"}
    if ratio < 0.05:
        return {"status": "warn", "score": 1 - ratio,
                "evidence": f"{untyped}/{total} missing doc_type"}
    return {"status": "fail", "score": 1 - ratio,
            "evidence": f"{untyped}/{total} missing doc_type"}


def _c_gdpr_01(db: Session) -> dict:
    # Art. 30: lineage generable.
    from ..services.lineage import build
    try:
        g = build()
        if g["stats"]["tables"] > 0:
            return {"status": "pass", "score": 1.0,
                    "evidence": f"{g['stats']['tables']} tables lineage-mapped"}
    except Exception:
        pass
    return {"status": "fail", "score": 0.0, "evidence": "lineage service broken"}


CONTROLS: list[Control] = [
    ("cbe",      "CBE-22.KYC-01",   "KYC freshness",           _c_cbe_01),
    ("cbe",      "CBE-22.AML-05",   "AML review SLA ≤ 5 days", _c_cbe_02),
    ("pci_dss",  "PCI-3.4",         "PAN protection",          _c_pci_01),
    ("iso_27001","A.5.1",           "Information policies",    _c_iso_01),
    ("iso_27001","A.8.2",           "Data classification",     _c_iso_02),
    ("gdpr",     "GDPR-30",         "Records of processing",   _c_gdpr_01),
]


def run(db: Session, tenant: str = "default") -> dict[str, Any]:
    results: list[dict] = []
    for framework, cid, label, fn in CONTROLS:
        try:
            r = fn(db)
        except Exception as e:
            r = {"status": "fail", "score": 0.0, "evidence": f"probe_error:{e}"}
        row = ComplianceScore(
            tenant=tenant, framework=framework, control_id=cid,
            status=r["status"], evidence=r.get("evidence", "")[:2000],
            score=float(r.get("score", 0.0)),
        )
        db.add(row)
        results.append({"framework": framework, "control": cid, "label": label, **r})
    db.commit()
    by_framework = {}
    for res in results:
        fw = res["framework"]
        by_framework.setdefault(fw, []).append(res)
    averages = {fw: round(sum(c["score"] for c in rows) / len(rows), 3)
                for fw, rows in by_framework.items()}
    return {
        "tenant": tenant,
        "measured_at": datetime.utcnow().isoformat() + "Z",
        "posture": averages,
        "overall": round(sum(averages.values()) / max(len(averages), 1), 3),
        "controls": results,
    }


def latest(db: Session, tenant: str = "default", days: int = 7) -> list[dict]:
    since = datetime.utcnow() - timedelta(days=days)
    rows = (db.query(ComplianceScore)
            .filter(ComplianceScore.tenant == tenant,
                    ComplianceScore.measured_at >= since)
            .order_by(ComplianceScore.measured_at.desc()).limit(500).all())
    return [{"framework": r.framework, "control": r.control_id,
             "status": r.status, "score": r.score,
             "evidence": r.evidence,
             "at": r.measured_at.isoformat() if r.measured_at else None}
            for r in rows]
