from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Document
from ..services.auth import require, Principal
from ..services.encryption import (
    backend, get_or_create_dek, rotate_dek,
    encrypt_file, decrypt_file,
)

router = APIRouter(prefix="/api/v1/encryption", tags=["encryption"])


@router.get("/backend")
def info(p: Principal = Depends(require("admin"))):
    return {"backend": backend()}


class CidBody(BaseModel):
    customer_cid: str


@router.post("/dek")
def provision(body: CidBody, db: Session = Depends(get_db),
              p: Principal = Depends(require("admin"))):
    row = get_or_create_dek(db, body.customer_cid)
    return {"customer_cid": row.customer_cid, "kms_key_id": row.kms_key_id,
            "created_at": row.created_at.isoformat() if row.created_at else None}


@router.post("/rotate")
def rotate(body: CidBody, db: Session = Depends(get_db),
           p: Principal = Depends(require("admin"))):
    return rotate_dek(db, body.customer_cid)


@router.post("/documents/{doc_id}/encrypt")
def encrypt_doc(doc_id: int, db: Session = Depends(get_db),
                p: Principal = Depends(require("admin"))):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    if not doc.customer_cid:
        raise HTTPException(400, "Document has no customer_cid — cannot bind DEK")
    out = doc.filename + ".enc"
    encrypt_file(db, doc.filename, out, doc.customer_cid)
    return {"document_id": doc.id, "encrypted_path": out}


@router.post("/documents/{doc_id}/decrypt")
def decrypt_doc(doc_id: int, db: Session = Depends(get_db),
                p: Principal = Depends(require("admin"))):
    doc = db.get(Document, doc_id)
    if not doc or not doc.customer_cid:
        raise HTTPException(404, "Document not found")
    enc = doc.filename + ".enc"
    out = doc.filename + ".dec"
    decrypt_file(db, enc, out, doc.customer_cid)
    return {"document_id": doc.id, "decrypted_path": out}
