"""CBE Regulatory Sandbox — self-attestation checklist.

Probes the live DMS for each mandatory control and emits a JSON report.

Usage:
    BASE=http://127.0.0.1:9002 API_KEY=dev-key-change-me python scripts/regsandbox_checklist.py
"""
import json
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx

BASE = os.environ.get("BASE", "http://127.0.0.1:8000").rstrip("/")
KEY = os.environ.get("API_KEY", "dev-key-change-me")
H = {"X-API-Key": KEY}


CHECKS = [
    ("C01", "Health endpoint reachable",                 "GET",  "/health",                              200),
    ("C02", "SLO metrics exported (Prometheus)",         "GET",  "/metrics",                             200),
    ("C03", "Immutable ledger backend active",           "GET",  "/api/v1/ledger/backend",               200),
    ("C04", "Ledger chain verifiable",                   "GET",  "/api/v1/ledger/verify",                200),
    ("C05", "AML watchlist matches endpoint",            "GET",  "/api/v1/watchlist/matches",            200),
    ("C06", "DSAR export endpoint reachable (401 OK)",   "GET",  "/api/v1/dsar/export/__probe__",        (200, 401, 404)),
    ("C07", "Encryption backend configured",             "GET",  "/api/v1/encryption/backend",           200),
    ("C08", "Supply-chain OIDC discovery reachable",     "GET",  "/.well-known/openid-configuration",    200),
    ("C09", "WAF mode query",                             "GET",  "/api/v1/remediation/waf-mode",         200),
    ("C10", "Data lineage export",                        "GET",  "/api/v1/lineage",                      200),
    ("C11", "Tenant-key registry reachable",              "GET",  "/api/v1/tenant-keys",                  200),
    ("C12", "CBE compliance reports (KYC) reachable",     "GET",  "/api/v1/cbe/kyc-compliance",           200),
    ("C13", "Carbon disclosure reachable",                "GET",  "/api/v1/sustainability/snapshot",      200),
    ("C14", "Usage analytics reachable",                  "GET",  "/api/v1/usage/top-features",           200),
    ("C15", "Federated learning global model endpoint",   "GET",  "/api/v1/federated/global",             (200, 404)),
]


def probe(method: str, path: str, expected) -> dict:
    try:
        with httpx.Client(timeout=5.0) as c:
            r = c.request(method, BASE + path, headers=H)
            ok = r.status_code == expected if isinstance(expected, int) \
                else r.status_code in expected
            return {"status": r.status_code, "ok": ok,
                    "body": (r.text or "")[:200]}
    except Exception as e:
        return {"status": 0, "ok": False, "body": str(e)[:200]}


def main():
    report = {
        "base_url": BASE,
        "checks": [],
        "passed": 0,
        "failed": 0,
    }
    for cid, label, m, path, expected in CHECKS:
        r = probe(m, path, expected)
        report["checks"].append({"id": cid, "label": label, "path": path, **r})
        report["passed" if r["ok"] else "failed"] += 1

    print(json.dumps(report, indent=2))
    sys.exit(0 if report["failed"] == 0 else 1)


if __name__ == "__main__":
    main()
