from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.auth import require, Principal
from ..services.workflow_designer import compile_prompt, save, list_designs

router = APIRouter(prefix="/api/v1/workflow-designer", tags=["workflow-designer"])


class PromptIn(BaseModel):
    prompt: str
    name: str | None = None
    save: bool = False


@router.post("/compile")
def compile(body: PromptIn, db: Session = Depends(get_db),
            p: Principal = Depends(require("admin"))):
    r = compile_prompt(body.prompt)
    if body.save and r["valid"]:
        wid = save(db, p.tenant,
                   body.name or r["spec"]["name"],
                   body.prompt, r["spec"], p.sub)
        r["saved_id"] = wid
    return r


@router.get("")
def designs(db: Session = Depends(get_db),
            p: Principal = Depends(require("view"))):
    return list_designs(db, p.tenant)
