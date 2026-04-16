from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.auth import require, Principal
from ..services.copilot import answer

router = APIRouter(prefix="/api/v1/copilot", tags=["copilot"])


class Ask(BaseModel):
    question: str
    top_k: int = 5


@router.post("/ask")
def ask(body: Ask, db: Session = Depends(get_db),
        p: Principal = Depends(require("view"))):
    branch_scope = None
    if "doc_admin" not in p.roles and "auditor" not in p.roles:
        branch_scope = p.branch
    return answer(db, body.question, p.tenant, branch_scope, body.top_k)
