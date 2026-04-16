import io
import os
import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///./storage/test.db")

from app.main import app  # noqa: E402

H = {"X-API-Key": "test-key"}
client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_auth_required():
    r = client.get("/api/v1/documents")
    assert r.status_code == 401


def test_upload_and_list():
    files = {"file": ("hello.txt", io.BytesIO(b"hello world"), "text/plain")}
    data = {"doc_type": "test", "customer_cid": "CID-TEST", "uploaded_by": "pytest"}
    r = client.post("/api/v1/documents", headers=H, files=files, data=data)
    assert r.status_code == 200
    doc_id = r.json()["id"]

    r = client.get(f"/api/v1/documents/{doc_id}", headers=H)
    assert r.json()["customer_cid"] == "CID-TEST"

    r = client.get("/api/v1/documents", headers=H)
    assert any(d["id"] == doc_id for d in r.json())


def test_workflow_flow():
    files = {"file": ("wf.txt", io.BytesIO(b"wf"), "text/plain")}
    r = client.post("/api/v1/documents", headers=H, files=files, data={"uploaded_by": "t"})
    doc_id = r.json()["id"]

    r = client.post(f"/api/v1/workflow/{doc_id}/actions", headers=H,
                    json={"stage": "maker", "action": "approve", "actor": "t"})
    assert r.status_code == 200

    r = client.get(f"/api/v1/workflow/{doc_id}/history", headers=H)
    assert len(r.json()) >= 1


def test_duplicate_exact_sha256():
    body = b"duplicate content for test"
    r1 = client.post("/api/v1/documents", headers=H,
                     files={"file": ("a.bin", io.BytesIO(body), "application/octet-stream")},
                     data={"uploaded_by": "t"})
    r2 = client.post("/api/v1/documents", headers=H,
                     files={"file": ("b.bin", io.BytesIO(body), "application/octet-stream")},
                     data={"uploaded_by": "t"})
    d1, d2 = r1.json()["id"], r2.json()["id"]
    assert r1.json()["sha256"] == r2.json()["sha256"]

    r = client.post(f"/api/v1/duplicates/{d2}/scan", headers=H)
    matches = r.json()
    assert any(m["match_type"] == "exact_hash" and m["similarity"] == 1.0 for m in matches)


def test_integration_call_mock():
    r = client.post("/api/v1/integrations/call", headers=H,
                    json={"system": "cbs", "endpoint": "/customers/verify",
                          "payload": {"cid": "CID-TEST"}})
    assert r.status_code == 200
    body = r.json()["body"]
    # Mock fallback kicks in since no real CBS is reachable
    assert body.get("mock") is True or "kyc_status" in body


def test_dashboard_kpis():
    r = client.get("/api/v1/dashboard/kpis", headers=H)
    assert r.status_code == 200
    assert "total_documents" in r.json()
