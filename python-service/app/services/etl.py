"""ETL for BI / Power BI.

Two outputs:
1. **Flat extracts** (Parquet + CSV) written to ETL_OUTPUT_DIR — Power BI picks them up
   via folder connector or via OneDrive/SharePoint sync.
2. **Semantic SQL views** created on the metadata DB — Power BI DirectQuery can hit these.

Star schema:
    fact_documents (id, ts_day, tenant, branch, doc_type, status, ocr_confidence, expiry_day, is_expiring_30d)
    fact_workflow_steps (id, ts_day, document_id, stage, action, actor)
    dim_tenant, dim_branch, dim_doc_type (derived on read).

Run standalone:
    python scripts/etl_run.py
or wire into the scheduler.
"""
from __future__ import annotations
import os
import csv
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import engine, SessionLocal
from ..models import Document, WorkflowStep, OcrResult


OUTPUT_DIR = Path(os.environ.get("ETL_OUTPUT_DIR", "./storage/etl"))


def _ensure_output() -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    return OUTPUT_DIR


def export_documents_csv(db: Session) -> Path:
    path = _ensure_output() / "fact_documents.csv"
    today = datetime.utcnow().date()
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([
            "id", "tenant", "branch", "doc_type", "customer_cid", "status",
            "uploaded_by", "created_at", "created_day",
            "expiry_date", "is_expiring_30d", "is_expired",
            "ocr_confidence",
        ])
        rows = db.query(Document, OcrResult).outerjoin(
            OcrResult, OcrResult.document_id == Document.id
        ).all()
        for doc, ocr in rows:
            exp_soon = exp_past = ""
            if doc.expiry_date:
                try:
                    exp = datetime.strptime(doc.expiry_date, "%Y-%m-%d").date()
                    exp_soon = "1" if 0 <= (exp - today).days <= 30 else "0"
                    exp_past = "1" if (exp - today).days < 0 else "0"
                except Exception:
                    pass
            w.writerow([
                doc.id, doc.tenant or "default", doc.branch or "", doc.doc_type or "",
                doc.customer_cid or "", doc.status,
                doc.uploaded_by or "",
                doc.created_at.isoformat() if doc.created_at else "",
                doc.created_at.date().isoformat() if doc.created_at else "",
                doc.expiry_date or "", exp_soon, exp_past,
                f"{ocr.confidence:.4f}" if ocr and ocr.confidence is not None else "",
            ])
    return path


def export_workflow_csv(db: Session) -> Path:
    path = _ensure_output() / "fact_workflow_steps.csv"
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "document_id", "stage", "actor", "action", "created_at", "created_day"])
        for s in db.query(WorkflowStep).all():
            w.writerow([
                s.id, s.document_id, s.stage or "", s.actor or "", s.action or "",
                s.created_at.isoformat() if s.created_at else "",
                s.created_at.date().isoformat() if s.created_at else "",
            ])
    return path


def export_parquet_if_available(db: Session) -> list[Path]:
    try:
        import pandas as pd
    except Exception:
        return []
    out = []
    for name, query in [
        ("fact_documents", "SELECT * FROM vw_fact_documents"),
        ("fact_workflow_steps", "SELECT * FROM vw_fact_workflow_steps"),
    ]:
        try:
            df = pd.read_sql_query(query, engine)
            p = _ensure_output() / f"{name}.parquet"
            df.to_parquet(p, index=False)
            out.append(p)
        except Exception:
            continue
    return out


VIEWS_SQL = {
    "vw_fact_documents": """
        SELECT
            d.id,
            d.tenant,
            d.branch,
            d.doc_type,
            d.customer_cid,
            d.status,
            d.uploaded_by,
            d.created_at,
            d.expiry_date,
            o.confidence AS ocr_confidence,
            CASE WHEN d.expiry_date IS NOT NULL
                 AND date(d.expiry_date) BETWEEN date('now') AND date('now','+30 day')
                 THEN 1 ELSE 0 END AS is_expiring_30d,
            CASE WHEN d.expiry_date IS NOT NULL
                 AND date(d.expiry_date) < date('now')
                 THEN 1 ELSE 0 END AS is_expired
        FROM documents d
        LEFT JOIN ocr_results o ON o.document_id = d.id
    """,
    "vw_fact_workflow_steps": """
        SELECT id, document_id, stage, actor, action, created_at
        FROM workflow_steps
    """,
    "vw_dim_branch": "SELECT DISTINCT branch AS branch FROM documents WHERE branch IS NOT NULL",
    "vw_dim_doc_type": "SELECT DISTINCT doc_type AS doc_type FROM documents WHERE doc_type IS NOT NULL",
}


def create_semantic_views() -> None:
    """Create/replace BI-friendly views on the metadata DB (SQLite & Postgres compatible)."""
    with engine.begin() as conn:
        for name, body in VIEWS_SQL.items():
            conn.execute(text(f"DROP VIEW IF EXISTS {name}"))
            conn.execute(text(f"CREATE VIEW {name} AS {body}"))


def run_all() -> dict:
    create_semantic_views()
    db = SessionLocal()
    try:
        csvs = [export_documents_csv(db), export_workflow_csv(db)]
        parquets = export_parquet_if_available(db)
    finally:
        db.close()
    return {
        "views": list(VIEWS_SQL.keys()),
        "csv": [str(p) for p in csvs],
        "parquet": [str(p) for p in parquets],
        "finished_at": datetime.utcnow().isoformat() + "Z",
    }
