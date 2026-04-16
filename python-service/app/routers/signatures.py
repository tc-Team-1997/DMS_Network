from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Document, WorkflowStep
from ..security import require_api_key
from ..services.signing import sign_detached, verify_detached, stamp_pdf_visible
from ..services.pades import sign_pdf_pades
from ..services.sigink import attach_ink
from ..services.auth import current_principal, Principal

router = APIRouter(prefix="/api/v1/signatures", tags=["signatures"], dependencies=[Depends(require_api_key)])


class SignIn(BaseModel):
    signer: str
    reason: str = "Approved"
    visible: bool = False


@router.post("/{doc_id}")
def sign(doc_id: int, payload: SignIn, db: Session = Depends(get_db)):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    result = sign_detached(doc.filename, payload.signer, payload.reason)
    visible_path = None
    if payload.visible:
        visible_path = stamp_pdf_visible(doc.filename, payload.signer, payload.reason)

    db.add(WorkflowStep(
        document_id=doc.id, stage="sign", actor=payload.signer,
        action="signed", comment=payload.reason,
    ))
    doc.status = "signed"
    db.commit()

    return {
        "document_id": doc.id,
        "signature": result,
        "visible_pdf": visible_path,
    }


@router.get("/{doc_id}/verify")
def verify(doc_id: int, db: Session = Depends(get_db)):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    return verify_detached(doc.filename)


class PadesIn(BaseModel):
    signer: str
    reason: str = "Approved"
    location: str = "NBE DMS"
    tsa_url: str | None = None


@router.post("/{doc_id}/pades")
def pades(doc_id: int, payload: PadesIn, db: Session = Depends(get_db)):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    result = sign_pdf_pades(doc.filename, payload.signer, payload.reason,
                            payload.location, payload.tsa_url)
    if not result.get("ok"):
        raise HTTPException(400, result.get("reason", "PAdES sign failed"))
    db.add(WorkflowStep(
        document_id=doc.id, stage="sign", actor=payload.signer,
        action="pades_signed", comment=f"{result['profile']} / {payload.reason}",
    ))
    doc.status = "signed"
    db.commit()
    return {"document_id": doc.id, **result}


class InkIn(BaseModel):
    png_base64: str
    svg: str = ""
    strokes: list = []


@router.post("/{doc_id}/ink")
def ink_sign(doc_id: int, body: InkIn,
             db: Session = Depends(get_db),
             p: Principal = Depends(current_principal)):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    import json as _json
    r = attach_ink(doc.filename, p.sub, body.png_base64,
                   body.svg, _json.dumps(body.strokes)[:20_000])
    if not r.get("ok"):
        raise HTTPException(400, r.get("reason", "ink sign failed"))
    db.add(WorkflowStep(
        document_id=doc.id, stage="sign", actor=p.sub,
        action="ink_signed", comment=f"sha256={r['ink_sha256'][:16]}…",
    ))
    doc.status = "signed"
    db.commit()
    return {"document_id": doc.id, **r}
