from typing import Optional
from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Document, WorkflowStep
from ..services.auth import require, Principal
from ..services.anchor import anchor_signed_bundle, verify_anchor, anchor_chain_head

router = APIRouter(prefix="/api/v1/anchor", tags=["anchor"])


@router.post("/{doc_id}")
def anchor(doc_id: int, db: Session = Depends(get_db), p: Principal = Depends(require("sign"))):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    result = anchor_signed_bundle(doc.filename, doc.id, p.sub)
    db.add(WorkflowStep(
        document_id=doc.id, stage="anchor", actor=p.sub,
        action="anchored", comment=f"digest={result['digest'][:16]}…",
    ))
    db.commit()
    return {"document_id": doc.id, **result}


@router.get("/{doc_id}/verify")
def verify(doc_id: int, db: Session = Depends(get_db), p: Principal = Depends(require("view"))):
    doc = db.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    return verify_anchor(doc.filename)


@router.post("/chain")
def anchor_chain(
    head_hash: Optional[str] = Body(None, embed=True),
    signer: Optional[str] = Body(None, embed=True),
    p: Principal = Depends(require("sign")),
):
    """Anchor the current audit-log chain head into the local tamper-evident chain.

    Called by Node's POST /spa/api/audit/anchor after the SPA requests an OTS
    anchor. The caller passes the current head_hash from the browser verifier
    (or the server recomputes it). Returns the anchor record including
    block_hash and timestamp so the UI can display last-anchor info.
    """
    actor = signer or p.sub
    return anchor_chain_head(head_hash=head_hash, signer=actor)
