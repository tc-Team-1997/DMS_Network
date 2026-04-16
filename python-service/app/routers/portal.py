"""Customer self-service portal.

Flow:
  1. POST /portal/request-otp       { customer_cid, email }       → email OTP (stub prints it)
  2. POST /portal/verify-otp        { customer_cid, code }        → returns opaque token
  3. Subsequent calls pass `X-Portal-Token: <token>` header. Token expires in 1h.
"""
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Document, PortalSession, EFormSubmission
from ..services.storage import save_bytes
from ..services.phash import compute_phash
from ..services.events import emit


router = APIRouter(prefix="/portal", tags=["portal"])

OTP_TTL_MIN = 10
TOKEN_TTL_MIN = 60


class OtpRequest(BaseModel):
    customer_cid: str
    email: str


class OtpVerify(BaseModel):
    customer_cid: str
    code: str


@router.post("/request-otp")
def request_otp(body: OtpRequest, db: Session = Depends(get_db)):
    code = f"{secrets.randbelow(1_000_000):06d}"
    sess = PortalSession(
        customer_cid=body.customer_cid,
        email=body.email,
        otp_code=code,
        otp_expires_at=datetime.utcnow() + timedelta(minutes=OTP_TTL_MIN),
    )
    db.add(sess)
    db.commit()
    # In prod: send via SMTP / SMS. Here we log + emit so test/demo can retrieve it.
    emit("portal.otp_issued", customer_cid=body.customer_cid, email=body.email, code=code)
    print(f"[portal] OTP for {body.email}: {code}")
    return {"sent": True, "expires_in_sec": OTP_TTL_MIN * 60}


@router.post("/verify-otp")
def verify_otp(body: OtpVerify, db: Session = Depends(get_db)):
    now = datetime.utcnow()
    sess = (
        db.query(PortalSession)
        .filter(PortalSession.customer_cid == body.customer_cid,
                PortalSession.otp_code == body.code,
                PortalSession.otp_expires_at >= now,
                PortalSession.verified_at == None)  # noqa: E711
        .order_by(PortalSession.id.desc())
        .first()
    )
    if not sess:
        raise HTTPException(401, "Invalid or expired code")
    sess.token = secrets.token_urlsafe(32)
    sess.verified_at = now
    db.commit()
    return {"token": sess.token, "expires_in_sec": TOKEN_TTL_MIN * 60,
            "customer_cid": sess.customer_cid}


def _session(db: Session, x_portal_token: str) -> PortalSession:
    if not x_portal_token:
        raise HTTPException(401, "Missing X-Portal-Token")
    sess = db.query(PortalSession).filter(PortalSession.token == x_portal_token).first()
    if not sess or not sess.verified_at:
        raise HTTPException(401, "Invalid token")
    if sess.verified_at + timedelta(minutes=TOKEN_TTL_MIN) < datetime.utcnow():
        raise HTTPException(401, "Token expired")
    return sess


@router.get("/documents")
def my_documents(x_portal_token: str = Header(default=""),
                 db: Session = Depends(get_db)):
    s = _session(db, x_portal_token)
    docs = (
        db.query(Document)
        .filter(Document.customer_cid == s.customer_cid)
        .order_by(Document.id.desc()).limit(50).all()
    )
    return [{"id": d.id, "original_name": d.original_name, "doc_type": d.doc_type,
             "status": d.status, "expiry_date": d.expiry_date,
             "created_at": d.created_at.isoformat() if d.created_at else None} for d in docs]


@router.post("/documents")
async def portal_upload(
    file: UploadFile = File(...),
    doc_type: Optional[str] = Form(None),
    expiry_date: Optional[str] = Form(None),
    x_portal_token: str = Header(default=""),
    db: Session = Depends(get_db),
):
    s = _session(db, x_portal_token)
    data = await file.read()
    stored_path, digest, size = save_bytes(data, file.filename or "upload.bin")
    phash = compute_phash(stored_path)
    doc = Document(
        filename=stored_path, original_name=file.filename or "upload.bin",
        mime_type=file.content_type, size_bytes=size,
        sha256=digest, phash=phash,
        doc_type=doc_type, customer_cid=s.customer_cid,
        expiry_date=expiry_date, uploaded_by=f"portal:{s.email}",
        status="captured", tenant="default",
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    emit("portal.document_uploaded", id=doc.id, customer_cid=s.customer_cid)
    return {"id": doc.id, "status": doc.status, "original_name": doc.original_name}


@router.get("/status/{doc_id}")
def portal_status(doc_id: int, x_portal_token: str = Header(default=""),
                  db: Session = Depends(get_db)):
    s = _session(db, x_portal_token)
    doc = db.get(Document, doc_id)
    if not doc or doc.customer_cid != s.customer_cid:
        raise HTTPException(404, "Not found")
    return {"id": doc.id, "status": doc.status, "expiry_date": doc.expiry_date}
