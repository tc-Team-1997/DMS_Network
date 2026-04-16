from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.auth import require, Principal
from ..services.retention_nl import compile_rule
from ..services.retention import upsert_policy, place_hold

router = APIRouter(prefix="/api/v1/retention-nl", tags=["retention-nl"])


class PromptIn(BaseModel):
    text: str
    apply: bool = False
    document_id: int | None = None  # for legal_hold


@router.post("/compile")
def compile_and_maybe_apply(body: PromptIn, db: Session = Depends(get_db),
                            p: Principal = Depends(require("admin"))):
    r = compile_rule(body.text)
    if body.apply and r.get("valid"):
        if r["kind"] == "retention_policy":
            pol = upsert_policy(db, r["doc_type"], r["retention_days"],
                                r.get("action", "purge"), p.tenant)
            r["applied_policy_id"] = pol.id
        elif r["kind"] == "legal_hold":
            if not body.document_id:
                raise HTTPException(400, "legal_hold requires document_id")
            hold = place_hold(db, body.document_id,
                              r.get("reason", "NL rule"),
                              r.get("case_ref", "manual"), p.sub)
            r["applied_hold_id"] = hold.id
    return r
