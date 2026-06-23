"""FastAPI auth dependency — verifies HS256 Bearer JWT issued by the gateway.

Every protected route must declare its router with ``dependencies=[Depends(require_auth)]``.
The ``/health`` endpoint is intentionally left open so orchestration infrastructure
can probe liveness without a token.

The JWT_SECRET is read from ``Settings.jwt_secret`` which is set via the
``JWT_SECRET`` environment variable (must match the gateway's ``JWT_SECRET``).
"""
from __future__ import annotations

from typing import Optional

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

# Use auto_error=False so we can return 401 instead of 422 when the header is absent
_bearer = HTTPBearer(auto_error=False)


def require_auth(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> dict:
    """Verify the Bearer JWT and return the decoded payload.

    Returns HTTP 401 when:
    - The Authorization header is absent or not a Bearer token.
    - The token signature is invalid.
    - The token has expired.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = credentials.credentials
    secret: str = request.app.state.settings.jwt_secret
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return payload
