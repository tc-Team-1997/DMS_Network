from fastapi import APIRouter, Request, HTTPException, Form
from fastapi.responses import RedirectResponse, Response, JSONResponse

from ..services.auth import issue_token
from ..services import saml as saml_svc

router = APIRouter(prefix="/saml", tags=["saml"])


@router.get("/metadata")
async def metadata():
    if not saml_svc.is_configured():
        raise HTTPException(503, "SAML not configured")
    xml, errors = await saml_svc.build_metadata()
    if errors:
        raise HTTPException(500, f"Metadata invalid: {errors}")
    return Response(content=xml, media_type="application/xml")


@router.get("/login")
async def login(request: Request):
    if not saml_svc.is_configured():
        raise HTTPException(503, "SAML not configured")
    return RedirectResponse(await saml_svc.build_login_url(request))


@router.post("/acs")
async def acs(request: Request):
    form = dict(await request.form())
    try:
        principal = await saml_svc.process_acs(request, form)
    except Exception as e:
        raise HTTPException(401, str(e))
    token = issue_token(principal["sub"], principal["tenant"],
                        principal.get("branch"), principal.get("roles", []))
    # Redirect to UI with token in fragment so it never hits server logs.
    return RedirectResponse(url=f"/?token={token}", status_code=303)
