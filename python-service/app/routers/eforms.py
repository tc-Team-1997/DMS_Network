import json
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import EForm, EFormSubmission
from ..services.auth import require, Principal
from ..services.eforms import validate, load_schema

router = APIRouter(prefix="/api/v1/eforms", tags=["eforms"])


class FormUpsert(BaseModel):
    key: str
    title: str
    schema: dict


class SubmissionIn(BaseModel):
    customer_cid: Optional[str] = None
    document_id: Optional[int] = None
    data: dict


@router.post("")
def upsert(body: FormUpsert, db: Session = Depends(get_db),
           p: Principal = Depends(require("admin"))):
    existing = db.query(EForm).filter(EForm.key == body.key, EForm.tenant == p.tenant).first()
    if existing:
        existing.title = body.title
        existing.schema_json = json.dumps(body.schema)
        existing.version = (existing.version or 1) + 1
        db.commit()
        return {"id": existing.id, "key": existing.key, "version": existing.version}
    form = EForm(
        key=body.key, title=body.title, tenant=p.tenant,
        schema_json=json.dumps(body.schema), version=1,
    )
    db.add(form)
    db.commit()
    db.refresh(form)
    return {"id": form.id, "key": form.key, "version": form.version}


@router.get("")
def list_forms(db: Session = Depends(get_db), p: Principal = Depends(require("view"))):
    forms = db.query(EForm).filter(EForm.tenant == p.tenant).all()
    return [{"id": f.id, "key": f.key, "title": f.title, "version": f.version} for f in forms]


@router.get("/{key}")
def get_form(key: str, db: Session = Depends(get_db), p: Principal = Depends(require("view"))):
    form = db.query(EForm).filter(EForm.key == key, EForm.tenant == p.tenant).first()
    if not form:
        raise HTTPException(404, "Form not found")
    return {"id": form.id, "key": form.key, "title": form.title,
            "version": form.version, "schema": load_schema(form.schema_json)}


@router.post("/{key}/submit")
def submit(key: str, body: SubmissionIn, db: Session = Depends(get_db),
           p: Principal = Depends(require("capture"))):
    form = db.query(EForm).filter(EForm.key == key, EForm.tenant == p.tenant).first()
    if not form:
        raise HTTPException(404, "Form not found")
    schema = load_schema(form.schema_json)
    ok, errors = validate(schema, body.data)
    if not ok:
        raise HTTPException(422, {"errors": errors})

    sub = EFormSubmission(
        form_id=form.id, customer_cid=body.customer_cid, document_id=body.document_id,
        submitted_by=p.sub, data_json=json.dumps(body.data), status="submitted",
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return {"id": sub.id, "form": form.key, "status": sub.status,
            "created_at": sub.created_at.isoformat()}


@router.get("/{key}/submissions")
def submissions(key: str, db: Session = Depends(get_db),
                p: Principal = Depends(require("view"))):
    form = db.query(EForm).filter(EForm.key == key, EForm.tenant == p.tenant).first()
    if not form:
        raise HTTPException(404, "Form not found")
    rows = db.query(EFormSubmission).filter(EFormSubmission.form_id == form.id).all()
    return [{
        "id": r.id, "customer_cid": r.customer_cid, "document_id": r.document_id,
        "submitted_by": r.submitted_by, "status": r.status,
        "data": json.loads(r.data_json or "{}"),
        "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in rows]
