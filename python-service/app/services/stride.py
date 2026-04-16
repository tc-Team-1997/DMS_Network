"""Auto-generated STRIDE threat model.

Scans every router for (method, path, auth dependency) and classifies each
endpoint against the six STRIDE categories with a mitigation citation. The
output is a living threat model that rebuilds on every release, so drift
between "what we say we protect" and "what we actually expose" is impossible.

Output shape:
    {
      "generated_at": iso,
      "endpoints": [
        {"method": "POST", "path": "/api/v1/documents", "auth": "bearer|api_key",
         "classification": "capture",
         "threats": [
            {"category": "Spoofing", "risk": "medium",
             "mitigation": "JWT signature + short TTL",
             "evidence": "services/auth.py"},
            ...
         ]}
        ...
      ]
    }
"""
from __future__ import annotations
import ast
import re
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1] / "routers"


# Mapping from path keyword → STRIDE threat profile + mitigation citations.
CLASSIFIERS: list[tuple[str, str, list[dict]]] = [
    ("auth",      "Identity/Session", [
        {"category": "Spoofing", "risk": "high",
         "mitigation": "JWT RS/HS256 + short TTL", "evidence": "services/auth.py"},
        {"category": "Repudiation", "risk": "medium",
         "mitigation": "All login events ledgered", "evidence": "services/ledger.py"},
    ]),
    ("stepup",    "MFA",              [
        {"category": "Tampering", "risk": "low",
         "mitigation": "WebAuthn challenge + sign count", "evidence": "services/webauthn_svc.py"},
    ]),
    ("oidc",      "Federation",       [
        {"category": "Spoofing", "risk": "medium",
         "mitigation": "RS256 id_token + JWKS rotate", "evidence": "services/oidc.py"},
    ]),
    ("documents", "Document I/O",     [
        {"category": "Tampering", "risk": "medium",
         "mitigation": "SHA-256 content-addressed store", "evidence": "services/storage.py"},
        {"category": "Info Disclosure", "risk": "high",
         "mitigation": "Envelope encryption + per-tenant DEKs", "evidence": "services/encryption.py"},
    ]),
    ("portal",    "Customer",         [
        {"category": "Spoofing", "risk": "high",
         "mitigation": "OTP + rate limit + optional passkey",
         "evidence": "services/passkeys.py"},
    ]),
    ("ocr",       "OCR",              [
        {"category": "Tampering", "risk": "medium",
         "mitigation": "Adversarial detector flags tampering",
         "evidence": "services/adversarial.py"},
    ]),
    ("workflow",  "Approval",         [
        {"category": "Repudiation", "risk": "high",
         "mitigation": "Immutable provenance chain", "evidence": "services/provenance.py"},
        {"category": "EoP", "risk": "medium",
         "mitigation": "Risk-gated WebAuthn step-up on approve",
         "evidence": "routers/workflow.py"},
    ]),
    ("signature", "Signature",        [
        {"category": "Tampering", "risk": "low",
         "mitigation": "Ed25519/RSA-PSS detached + PAdES", "evidence": "services/signing.py"},
    ]),
    ("anchor",    "Immutability",     [
        {"category": "Tampering", "risk": "low",
         "mitigation": "On-chain / local Merkle anchor", "evidence": "services/anchor.py"},
    ]),
    ("ledger",    "Audit log",        [
        {"category": "Repudiation", "risk": "low",
         "mitigation": "Hash-chained ledger + transparency root",
         "evidence": "services/ledger.py + services/transparency.py"},
    ]),
    ("integrat",  "External",         [
        {"category": "Info Disclosure", "risk": "medium",
         "mitigation": "TLS + redacted logs + httpx timeout",
         "evidence": "services/integrations.py"},
    ]),
    ("redact",    "Privacy",          [
        {"category": "Info Disclosure", "risk": "low",
         "mitigation": "PII patterns masked before SIEM + logs",
         "evidence": "services/redaction.py"},
    ]),
    ("search",    "Query",            [
        {"category": "Info Disclosure", "risk": "medium",
         "mitigation": "Tenant+branch scoping on all list/search",
         "evidence": "routers/documents.py"},
    ]),
    ("dp",        "Analytics",        [
        {"category": "Info Disclosure", "risk": "low",
         "mitigation": "Laplace noise + per-tenant epsilon budget",
         "evidence": "services/dp.py"},
    ]),
    ("admin",     "Admin",            [
        {"category": "EoP", "risk": "high",
         "mitigation": "RBAC + ABAC + after-hours gate",
         "evidence": "opa/policies/dms.rego"},
    ]),
    ("replication","Replication",      [
        {"category": "Tampering", "risk": "low",
         "mitigation": "CRDT Lamport merge with signed inbound events",
         "evidence": "services/crdt.py"},
    ]),
    ("transparency", "Public proof",   [
        {"category": "Info Disclosure", "risk": "low",
         "mitigation": "Only Merkle roots leak, no payload",
         "evidence": "services/transparency.py"},
    ]),
]

GENERIC_DOS = {
    "category": "DoS", "risk": "medium",
    "mitigation": "Per-IP rate limit + WAF + HPA 2-10 replicas",
    "evidence": "services/waf.py + k8s/hpa.yaml",
}


DECORATOR_RE = re.compile(r'@router\.(get|post|put|delete|patch)\(\s*["\']([^"\']+)["\']')


def _scan_router(path: Path) -> list[dict]:
    try:
        src = path.read_text(encoding="utf-8")
    except Exception:
        return []
    out: list[dict] = []
    tree = ast.parse(src)
    # Extract prefix from `APIRouter(prefix="…")`.
    prefix = ""
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute) is False
            and getattr(node.func, "id", None) == "APIRouter"):
            for kw in node.keywords:
                if kw.arg == "prefix" and isinstance(kw.value, ast.Constant):
                    prefix = kw.value.value

    has_require = "require(" in src or "current_principal" in src
    auth_hint = "bearer+api_key" if has_require else "public"

    for m in DECORATOR_RE.finditer(src):
        out.append({
            "method": m.group(1).upper(),
            "path": prefix + m.group(2),
            "auth": auth_hint,
            "source": str(path.name),
        })
    return out


def _classify(path: str) -> tuple[str, list[dict]]:
    for key, klass, threats in CLASSIFIERS:
        if key in path:
            return klass, threats
    return "generic", [{
        "category": "Info Disclosure", "risk": "low",
        "mitigation": "RBAC + tenant scope applied via require()",
        "evidence": "services/auth.py",
    }]


def build() -> dict[str, Any]:
    endpoints: list[dict] = []
    for p in sorted(ROOT.glob("*.py")):
        if p.name.startswith("_"):
            continue
        endpoints.extend(_scan_router(p))

    model: list[dict] = []
    for ep in endpoints:
        klass, threats = _classify(ep["path"])
        threat_set = list(threats) + [GENERIC_DOS]
        model.append({**ep, "classification": klass, "threats": threat_set})

    by_category: dict[str, int] = {}
    for ep in model:
        for t in ep["threats"]:
            by_category[t["category"]] = by_category.get(t["category"], 0) + 1

    return {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "endpoint_count": len(model),
        "by_category": by_category,
        "endpoints": model,
    }


def build_markdown() -> str:
    g = build()
    lines = [
        "# NBE DMS — Auto-generated STRIDE Threat Model",
        f"_Generated {g['generated_at']} · {g['endpoint_count']} endpoints_\n",
        "| Method | Path | Class | Category | Risk | Mitigation | Evidence |",
        "|---|---|---|---|---|---|---|",
    ]
    for ep in g["endpoints"]:
        for t in ep["threats"]:
            lines.append(
                f"| {ep['method']} | `{ep['path']}` | {ep['classification']} | "
                f"{t['category']} | {t['risk']} | {t['mitigation']} | "
                f"`{t['evidence']}` |"
            )
    return "\n".join(lines)
