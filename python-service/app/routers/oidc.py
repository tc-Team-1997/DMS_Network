from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Form, Header, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import OidcClient, OidcAuthCode
from ..services import oidc as svc

router = APIRouter(tags=["oidc"])


# ---------- Discovery / JWKS ----------
@router.get("/.well-known/openid-configuration")
def discovery():
    return svc.discovery_document()


@router.get("/oidc/jwks")
def jwks():
    return svc.jwks()


# ---------- Authorization (login + consent) ----------
_LOGIN_HTML = """
<!doctype html><html><body style="font-family:sans-serif;background:#0a1628;color:#e8eef6;padding:40px">
<h2 style="color:#e8c96b">NBE DMS — Partner Sign-in</h2>
<p>Grant <b>{client}</b> access to scopes: <code>{scope}</code></p>
<form method="post" style="max-width:360px">
  <label>Username<br><input name="username" value="sara.k"/></label><br>
  <label>Password<br><input name="password" value="demo" type="password"/></label><br>
  <input type="hidden" name="state" value="{state}"/>
  <input type="hidden" name="redirect_uri" value="{redirect_uri}"/>
  <input type="hidden" name="client_id" value="{client_id}"/>
  <input type="hidden" name="scope" value="{scope}"/>
  <input type="hidden" name="nonce" value="{nonce}"/>
  <button style="margin-top:12px;background:#c9a84c;color:#0a1628;padding:10px 18px;border:none;border-radius:6px">Allow</button>
</form></body></html>
"""


@router.get("/oidc/authorize", response_class=HTMLResponse)
def authorize(client_id: str, redirect_uri: str, scope: str = "openid profile email",
              state: str = "", nonce: str = "", response_type: str = "code",
              db: Session = Depends(get_db)):
    client = db.query(OidcClient).filter(OidcClient.client_id == client_id).first()
    if not client:
        raise HTTPException(400, "Unknown client")
    if redirect_uri not in (client.redirect_uris or "").split("\n"):
        raise HTTPException(400, "Unregistered redirect_uri")
    if response_type != "code":
        raise HTTPException(400, "Only response_type=code supported")
    return HTMLResponse(_LOGIN_HTML.format(client=client.name or client_id,
                                          client_id=client_id, scope=scope,
                                          redirect_uri=redirect_uri,
                                          state=state, nonce=nonce))


@router.post("/oidc/authorize")
def authorize_post(username: str = Form(...), password: str = Form(...),
                   client_id: str = Form(...), redirect_uri: str = Form(...),
                   scope: str = Form(...), state: str = Form(""),
                   nonce: str = Form(""),
                   db: Session = Depends(get_db)):
    from ..routers.auth import DEMO_USERS
    u = DEMO_USERS.get(username)
    if not u or u["password"] != password:
        raise HTTPException(401, "Invalid credentials")
    code = svc.new_code()
    db.add(OidcAuthCode(
        code=code, client_id=client_id, user_sub=username,
        tenant=u["tenant"], scope=scope,
        redirect_uri=redirect_uri, nonce=nonce,
        expires_at=datetime.utcnow() + timedelta(minutes=2),
    ))
    db.commit()
    sep = "&" if "?" in redirect_uri else "?"
    return RedirectResponse(f"{redirect_uri}{sep}code={code}&state={state}", status_code=303)


# ---------- Token exchange ----------
@router.post("/oidc/token")
def token(
    grant_type: str = Form(...),
    code: str = Form(...),
    redirect_uri: str = Form(...),
    client_id: str = Form(...),
    client_secret: str = Form(...),
    db: Session = Depends(get_db),
):
    if grant_type != "authorization_code":
        raise HTTPException(400, "unsupported_grant_type")
    client = db.query(OidcClient).filter(OidcClient.client_id == client_id).first()
    if not client or client.client_secret != client_secret:
        raise HTTPException(401, "invalid_client")
    row = db.query(OidcAuthCode).filter(OidcAuthCode.code == code).first()
    if not row or row.used or row.client_id != client_id:
        raise HTTPException(400, "invalid_code")
    if row.redirect_uri != redirect_uri:
        raise HTTPException(400, "redirect_uri mismatch")
    if row.expires_at and row.expires_at < datetime.utcnow():
        raise HTTPException(400, "code expired")

    from ..routers.auth import DEMO_USERS
    u = DEMO_USERS.get(row.user_sub, {"branch": None, "roles": []})
    id_token = svc.make_id_token(row.user_sub, row.tenant, u.get("branch"),
                                 u.get("roles", []), client_id, row.nonce)
    access_token = svc.make_access_token(row.user_sub, row.tenant, row.scope, client_id)
    row.used = 1
    db.commit()
    return {
        "access_token": access_token,
        "token_type": "Bearer",
        "expires_in": svc.ACCESS_TOKEN_TTL_MIN * 60,
        "id_token": id_token,
        "scope": row.scope,
    }


# ---------- UserInfo ----------
@router.get("/oidc/userinfo")
def userinfo(authorization: str = Header(default="")):
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "missing_bearer")
    tok = authorization.split(" ", 1)[1]
    try:
        claims = svc.decode_access(tok)
    except Exception:
        raise HTTPException(401, "invalid_token")
    from ..routers.auth import DEMO_USERS
    u = DEMO_USERS.get(claims.get("sub"), {})
    return {
        "sub": claims.get("sub"),
        "tenant": claims.get("tenant"),
        "name": claims.get("sub"),
        "email": f"{claims.get('sub')}@nbe.local",
        "branch": u.get("branch"),
        "roles": u.get("roles", []),
    }


# ---------- Client registration (admin) ----------
@router.post("/oidc/clients")
def register_client(name: str = Form(...), redirect_uri: str = Form(...),
                    scopes: str = Form("openid profile email"),
                    db: Session = Depends(get_db)):
    import secrets
    cid = "cli_" + secrets.token_hex(6)
    csec = secrets.token_urlsafe(32)
    c = OidcClient(client_id=cid, client_secret=csec, name=name,
                   redirect_uris=redirect_uri, scopes=scopes)
    db.add(c)
    db.commit()
    return {"client_id": cid, "client_secret": csec, "redirect_uri": redirect_uri}
