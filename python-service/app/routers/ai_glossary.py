"""AI Engine glossary — CRUD + bootstrap surface for the editable business
vocabulary. Session auth / RBAC is enforced by the Node proxy
(`routes/spa-api/ai-glossary.js`); this router sits behind the shared
X-API-Key check.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..security import require_api_key
from ..services.docbrain import glossary as svc

log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/docbrain/glossary",
    tags=["docbrain"],
    dependencies=[Depends(require_api_key)],
)


class TermIn(BaseModel):
    term:        str = Field(..., min_length=1, max_length=200)
    definition:  str = Field(..., min_length=1)
    synonyms:    Optional[List[str]] = None
    table_hint:  Optional[str] = None
    column_hint: Optional[str] = None
    sql_template: Optional[str] = None
    category:    str = "metric"
    approved:    bool = True
    source:      str = "admin"


class TermPatch(BaseModel):
    term:         Optional[str] = None
    definition:   Optional[str] = None
    synonyms:     Optional[List[str]] = None
    table_hint:   Optional[str] = None
    column_hint:  Optional[str] = None
    sql_template: Optional[str] = None
    category:     Optional[str] = None
    approved:     Optional[bool] = None


class BootstrapRequest(BaseModel):
    tenant_id: str = "nbe"
    overwrite_auto: bool = True


@router.get("")
def list_glossary(
    tenant_id: str = "nbe",
    category:  Optional[str] = None,
    approved:  Optional[bool] = None,
    query:     Optional[str] = None,
    limit:     int = 500,
) -> Dict[str, Any]:
    terms = svc.list_terms(
        tenant_id=tenant_id,
        category=category,
        approved=approved,
        query=query,
        limit=limit,
    )
    return {
        "items": [t.to_dict() for t in terms],
        "coverage": svc.coverage_stats(tenant_id=tenant_id),
    }


@router.get("/{term_id}")
def get_one(term_id: int, tenant_id: str = "nbe") -> Dict[str, Any]:
    t = svc.get_term(term_id, tenant_id=tenant_id)
    if not t:
        raise HTTPException(status_code=404, detail="not_found")
    return t.to_dict()


@router.post("")
def create(body: TermIn, tenant_id: str = "nbe", created_by: Optional[int] = None) -> Dict[str, Any]:
    try:
        t = svc.create_term(
            term=body.term,
            definition=body.definition,
            synonyms=body.synonyms,
            table_hint=body.table_hint,
            column_hint=body.column_hint,
            sql_template=body.sql_template,
            category=body.category,
            source=body.source,
            approved=body.approved,
            tenant_id=tenant_id,
            created_by=created_by,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return t.to_dict()


@router.patch("/{term_id}")
def update(term_id: int, body: TermPatch, tenant_id: str = "nbe") -> Dict[str, Any]:
    try:
        t = svc.update_term(
            term_id,
            tenant_id=tenant_id,
            fields=body.model_dump(exclude_none=True),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not t:
        raise HTTPException(status_code=404, detail="not_found")
    return t.to_dict()


@router.delete("/{term_id}")
def delete(term_id: int, tenant_id: str = "nbe") -> Dict[str, Any]:
    ok = svc.delete_term(term_id, tenant_id=tenant_id)
    if not ok:
        raise HTTPException(status_code=404, detail="not_found")
    return {"ok": True}


@router.post("/regenerate")
def regenerate(body: BootstrapRequest) -> Dict[str, Any]:
    """Ask the LLM to re-draft the glossary from the schema. Admin-edited
    rows are preserved even when `overwrite_auto=true`."""
    return svc.bootstrap_from_llm(
        tenant_id=body.tenant_id,
        overwrite_auto=body.overwrite_auto,
    )


@router.post("/reindex")
def reindex(tenant_id: str = "nbe") -> Dict[str, Any]:
    n = svc.reindex_vectors(tenant_id=tenant_id)
    return {"indexed": n}


@router.get("/_meta/schema")
def inspect_schema() -> Dict[str, Any]:
    """Expose the introspected schema the bootstrap sees. Handy for the
    admin UI's 'preview before regenerate' experience."""
    return svc.introspect_schema()
