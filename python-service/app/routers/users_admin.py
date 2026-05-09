"""Users Admin router — Wave B Users v2.

Exposes WebAuthn credential listing and deletion for the Node-side admin UI.
Node's GET /admin/users/:id/factors and DELETE /admin/users/:id/factors/:fid
call these endpoints via pyCall when the factor kind is 'webauthn'.

Routes:
  GET    /api/v1/users-admin/{user_sub}/webauthn-credentials
  DELETE /api/v1/users-admin/{user_sub}/webauthn-credentials/{credential_id}
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from ..db import get_db
from ..models import WebAuthnCredential
from ..security import require_api_key

router = APIRouter(
    prefix="/api/v1/users-admin",
    tags=["users-admin"],
    dependencies=[Depends(require_api_key)],
)


class WebAuthnCredentialOut(BaseModel):
    id: int
    user_sub: str
    credential_id: str
    transports: Optional[str]
    sign_count: int
    friendly_name: Optional[str]
    created_at: Optional[datetime]
    last_used_at: Optional[datetime]

    class Config:
        from_attributes = True


@router.get(
    "/{user_sub}/webauthn-credentials",
    response_model=list[WebAuthnCredentialOut],
)
def list_webauthn_credentials(
    user_sub: str,
    db: Session = Depends(get_db),
) -> list[WebAuthnCredentialOut]:
    """List all WebAuthn step-up credentials for a user (by username/sub)."""
    creds = (
        db.query(WebAuthnCredential)
        .filter(WebAuthnCredential.user_sub == user_sub)
        .order_by(WebAuthnCredential.created_at.desc())
        .all()
    )
    return [WebAuthnCredentialOut.model_validate(c) for c in creds]


@router.delete(
    "/{user_sub}/webauthn-credentials/{credential_id}",
    status_code=status.HTTP_200_OK,
)
def delete_webauthn_credential(
    user_sub: str,
    credential_id: str,
    db: Session = Depends(get_db),
) -> dict:
    """Revoke a specific WebAuthn credential for a user."""
    cred = (
        db.query(WebAuthnCredential)
        .filter(
            WebAuthnCredential.user_sub == user_sub,
            WebAuthnCredential.id == _try_int(credential_id),
        )
        .first()
    )
    if cred is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="credential_not_found",
        )
    db.delete(cred)
    db.commit()
    return {"ok": True, "deleted_id": credential_id}


def _try_int(value: str) -> int:
    """Convert string to int, raising 400 on failure."""
    try:
        return int(value)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="credential_id must be an integer",
        )
