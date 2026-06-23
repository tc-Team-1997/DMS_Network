from datetime import datetime

from fastapi.testclient import TestClient

from zordms_ai.app import create_app
from zordms_ai.review.service import enqueue
from zordms_ai.routing.confidence import route_by_confidence
from zordms_ai.settings import Settings


def _client_with_item():
    app = create_app(Settings(database_url="sqlite+pysqlite:///:memory:"))
    with app.state.session_factory() as s:
        item = enqueue(
            s, doc_id="d1", doc_type="BT_CID_4G", confidence=0.60,
            decision=route_by_confidence(0.60), payload_json="{}",
            now=datetime(2026, 6, 23, 10, 0, 0),
        )
        item_id = item.id
    return TestClient(app), item_id


def test_list_pending():
    client, _ = _client_with_item()
    res = client.get("/idp/review/pending")
    assert res.status_code == 200
    rows = res.json()
    assert rows[0]["doc_id"] == "d1"
    assert rows[0]["sla_hours"] == 24


def test_claim_then_resolve():
    client, item_id = _client_with_item()
    c = client.post(f"/idp/review/{item_id}/claim", data={"user_id": "STAFF9"})
    assert c.status_code == 200
    assert c.json()["status"] == "CLAIMED"
    r = client.post(f"/idp/review/{item_id}/resolve", data={"resolution": "APPROVED"})
    assert r.status_code == 200
    assert r.json()["status"] == "RESOLVED"


def test_double_claim_conflict():
    client, item_id = _client_with_item()
    client.post(f"/idp/review/{item_id}/claim", data={"user_id": "A"})
    again = client.post(f"/idp/review/{item_id}/claim", data={"user_id": "B"})
    assert again.status_code == 409
