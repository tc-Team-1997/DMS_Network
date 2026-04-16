from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.auth import require, Principal
from ..services.tenant_keys import (
    list_tenants, rotate_tenant, get_or_create_tenant_dek, plaintext_dek,
)

router = APIRouter(prefix="/api/v1/tenant-keys", tags=["tenant-keys"])


@router.get("")
def tenants(p: Principal = Depends(require("admin"))):
    return {"tenants": list_tenants()}


class CidIn(BaseModel):
    customer_cid: str


@router.post("/provision")
def provision(body: CidIn, db: Session = Depends(get_db),
              p: Principal = Depends(require("admin"))):
    row = get_or_create_tenant_dek(db, p.tenant, body.customer_cid)
    return {"tenant": p.tenant, "customer_cid": row.customer_cid,
            "kms_key_id": row.kms_key_id}


@router.post("/rotate")
def rotate(db: Session = Depends(get_db),
           p: Principal = Depends(require("admin"))):
    return rotate_tenant(db, p.tenant)


@router.post("/dek/{customer_cid}")
def unwrap_dek(customer_cid: str, db: Session = Depends(get_db),
               p: Principal = Depends(require("admin"))):
    # Returns length only — never the key material over the wire.
    try:
        key = plaintext_dek(db, p.tenant, customer_cid)
        return {"ok": True, "bytes": len(key)}
    except Exception as e:
        return {"ok": False, "reason": str(e)[:200]}
