"""SAML 2.0 SSO via python3-saml.

IdP-initiated and SP-initiated flows. On successful ACS POST, we map IdP attributes
to a JWT (tenant/branch/roles) so the rest of the app keeps using the existing
JWT auth flow unchanged.

Required env (Settings JSON is built dynamically from these to keep ops simple):
    SAML_SP_ENTITY_ID         e.g. https://dms.nbe.local/saml/metadata
    SAML_SP_ACS_URL           e.g. https://dms.nbe.local/saml/acs
    SAML_IDP_ENTITY_ID        from IdP
    SAML_IDP_SSO_URL          from IdP
    SAML_IDP_X509_CERT        PEM body, no headers, single line OK
    SAML_ATTR_USERNAME        attribute name for sub      (default uid)
    SAML_ATTR_TENANT          attribute name for tenant   (default tenant)
    SAML_ATTR_BRANCH          attribute name for branch   (default branch)
    SAML_ATTR_ROLES           attribute name for roles    (default roles)

Active Directory / Azure AD: use ClaimTypes.Name + groups → roles mapping.
"""
from __future__ import annotations
import os
from typing import Any
from fastapi import Request


def _settings() -> dict[str, Any]:
    cert = os.environ.get("SAML_IDP_X509_CERT", "").strip()
    return {
        "strict": True,
        "debug": os.environ.get("SAML_DEBUG", "false").lower() == "true",
        "sp": {
            "entityId": os.environ.get("SAML_SP_ENTITY_ID", "http://localhost:8000/saml/metadata"),
            "assertionConsumerService": {
                "url": os.environ.get("SAML_SP_ACS_URL", "http://localhost:8000/saml/acs"),
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
            },
            "NameIDFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
        },
        "idp": {
            "entityId": os.environ.get("SAML_IDP_ENTITY_ID", ""),
            "singleSignOnService": {
                "url": os.environ.get("SAML_IDP_SSO_URL", ""),
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
            },
            "x509cert": cert,
        },
    }


async def _request_dict(request: Request, post_data: dict | None = None) -> dict:
    return {
        "https": "on" if request.url.scheme == "https" else "off",
        "http_host": request.url.netloc,
        "server_port": str(request.url.port or (443 if request.url.scheme == "https" else 80)),
        "script_name": request.url.path,
        "get_data": dict(request.query_params),
        "post_data": post_data or {},
    }


def attrs_to_principal_payload(attrs: dict) -> dict:
    def _first(name: str, default=None):
        v = attrs.get(name)
        if isinstance(v, list) and v:
            return v[0]
        return v if v is not None else default

    roles = attrs.get(os.environ.get("SAML_ATTR_ROLES", "roles"), [])
    if isinstance(roles, str):
        roles = [r.strip() for r in roles.split(",") if r.strip()]

    return {
        "sub": _first(os.environ.get("SAML_ATTR_USERNAME", "uid"), "saml-user"),
        "tenant": _first(os.environ.get("SAML_ATTR_TENANT", "tenant"), "default"),
        "branch": _first(os.environ.get("SAML_ATTR_BRANCH", "branch"), None),
        "roles": roles or ["viewer"],
    }


def is_configured() -> bool:
    s = _settings()
    return bool(s["idp"]["entityId"] and s["idp"]["singleSignOnService"]["url"] and s["idp"]["x509cert"])


async def build_login_url(request: Request) -> str:
    from onelogin.saml2.auth import OneLogin_Saml2_Auth
    auth = OneLogin_Saml2_Auth(await _request_dict(request), _settings())
    return auth.login()


async def build_metadata() -> tuple[str, list[str]]:
    from onelogin.saml2.settings import OneLogin_Saml2_Settings
    s = OneLogin_Saml2_Settings(_settings(), sp_validation_only=True)
    return s.get_sp_metadata().decode("utf-8"), s.validate_metadata(s.get_sp_metadata())


async def process_acs(request: Request, form: dict) -> dict:
    from onelogin.saml2.auth import OneLogin_Saml2_Auth
    auth = OneLogin_Saml2_Auth(await _request_dict(request, form), _settings())
    auth.process_response()
    errors = auth.get_errors()
    if errors:
        raise RuntimeError(f"SAML errors: {errors} reason={auth.get_last_error_reason()}")
    if not auth.is_authenticated():
        raise RuntimeError("SAML response not authenticated")
    return attrs_to_principal_payload(auth.get_attributes())
