"""Seed demo documents for local/demo runs."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from datetime import datetime, timedelta
from app.db import Base, engine, SessionLocal
from app.models import Document, OcrResult, WorkflowStep
import json

Base.metadata.create_all(bind=engine)
db = SessionLocal()

SAMPLES = [
    ("Passport_AHI_2022.pdf", "passport", "EGY-2024-00847291", "Cairo West", "2032-01-09", 0.97),
    ("NatID_AHK_2023.pdf", "national_id", "EGY-2024-00847292", "Giza", "2033-03-05", 0.94),
    ("Passport_SMK_2021.pdf", "passport", "EGY-2024-00847293", "Alexandria", "2026-03-15", 0.89),
    ("Passport_NKR_2019.pdf", "passport", "EGY-2024-00847294", "Cairo East", "2024-12-02", 0.91),
    ("UtilityBill_MFA_2024.pdf", "utility_bill", "EGY-2024-00847291", "Cairo West", "2026-07-22", 0.86),
    ("LoanApp_AHM_2024.pdf", "loan_application", "EGY-2024-00847295", "Cairo West", None, 0.93),
]

now = datetime.utcnow()
for i, (name, doc_type, cid, branch, expiry, conf) in enumerate(SAMPLES):
    exists = db.query(Document).filter(Document.original_name == name).first()
    if exists:
        continue
    d = Document(
        filename=f"storage/documents/seed_{i}.bin",
        original_name=name,
        mime_type="application/pdf",
        size_bytes=1024 * (100 + i * 30),
        sha256=f"seed{i:02d}" + "0" * 58,
        doc_type=doc_type,
        customer_cid=cid,
        branch=branch,
        expiry_date=expiry,
        uploaded_by="seed",
        status="indexed" if conf >= 0.9 else "review",
        created_at=now - timedelta(days=i),
    )
    db.add(d)
    db.flush()
    db.add(OcrResult(
        document_id=d.id,
        text=f"{doc_type.upper()} for {cid} issued at {branch}",
        confidence=conf,
        fields_json=json.dumps({"cid": cid, "branch": branch}),
        engine="tesseract",
    ))
    db.add(WorkflowStep(
        document_id=d.id, stage="capture", actor="seed", action="submit",
        comment="Seeded document",
    ))

db.commit()
print(f"Seeded {db.query(Document).count()} documents total.")
db.close()
