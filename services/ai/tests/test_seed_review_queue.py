"""Tests for the review-queue seed module.

Verifies:
* seed inserts the expected rows (count, statuses, bands, doc types)
* seed is idempotent — calling it twice inserts nothing the second time
* /idp/seed endpoint returns correct JSON and is auth-protected
* seeded data appears on /idp/review/pending
"""
from __future__ import annotations

from tests.conftest import TEST_JWT_SECRET, make_token
from zordms_ai.app import create_app
from zordms_ai.db import Base, make_engine, make_session_factory
from zordms_ai.review.models import ReviewItem
from zordms_ai.seeds.review_queue import _SEED_DOC_IDS, _SEED_ROWS, seed_review_queue
from zordms_ai.settings import Settings


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_fresh_session_factory():
    engine = make_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    return make_session_factory(engine)


def _auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(TEST_JWT_SECRET)}"}


def _make_settings() -> Settings:
    return Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret=TEST_JWT_SECRET,
    )


# ---------------------------------------------------------------------------
# Unit-level tests (no FastAPI)
# ---------------------------------------------------------------------------

def test_seed_inserts_expected_count():
    sf = _make_fresh_session_factory()
    inserted = seed_review_queue(sf)
    assert inserted == len(_SEED_ROWS), (
        f"Expected {len(_SEED_ROWS)} rows, got {inserted}"
    )


def test_seed_is_idempotent():
    sf = _make_fresh_session_factory()
    first = seed_review_queue(sf)
    second = seed_review_queue(sf)
    assert first == len(_SEED_ROWS)
    assert second == 0, "second call must be a no-op"


def test_seed_doc_ids_match_sentinel_set():
    actual_ids = {row["doc_id"] for row in _SEED_ROWS}
    assert actual_ids == _SEED_DOC_IDS, "sentinel set must match seed rows"


def test_seed_covers_all_statuses():
    statuses = {row["status"] for row in _SEED_ROWS}
    assert statuses == {"PENDING", "CLAIMED", "RESOLVED"}


def test_seed_covers_all_bands():
    bands = {row["band"] for row in _SEED_ROWS}
    assert bands == {"<0.50", "0.50-0.69", "0.70-0.84", "0.85-0.91"}


def test_seed_covers_all_doc_types():
    doc_types = {row["doc_type"] for row in _SEED_ROWS}
    assert doc_types == {"BT_CID_4G", "BT_PASSPORT", "BOB_LOAN_APPLICATION"}


def test_seed_resolved_rows_have_resolved_at():
    for row in _SEED_ROWS:
        if row["status"] == "RESOLVED":
            assert row.get("resolved_at") is not None, (
                f"RESOLVED row {row['doc_id']} missing resolved_at"
            )


def test_seed_claimed_rows_have_claimed_by():
    for row in _SEED_ROWS:
        if row["status"] == "CLAIMED":
            assert row.get("claimed_by") is not None, (
                f"CLAIMED row {row['doc_id']} missing claimed_by"
            )


def test_seed_rows_are_db_readable():
    """Verify seeded rows can be queried back from the DB."""
    from sqlalchemy import select

    sf = _make_fresh_session_factory()
    seed_review_queue(sf)
    with sf() as session:
        rows = list(session.scalars(select(ReviewItem)))
    assert len(rows) == len(_SEED_ROWS)
    doc_ids = {r.doc_id for r in rows}
    assert doc_ids == _SEED_DOC_IDS


# ---------------------------------------------------------------------------
# API-level tests (via FastAPI TestClient)
# ---------------------------------------------------------------------------

def test_seed_endpoint_requires_auth():
    from fastapi.testclient import TestClient

    app = create_app(_make_settings())
    client = TestClient(app)
    res = client.post("/idp/seed")
    assert res.status_code == 401


def test_seed_endpoint_returns_inserted_zero_when_already_seeded():
    """App startup auto-seeds; calling /idp/seed again returns inserted=0."""
    from fastapi.testclient import TestClient

    app = create_app(_make_settings())
    client = TestClient(app)
    res = client.post("/idp/seed", headers=_auth_headers())
    assert res.status_code == 200
    body = res.json()
    assert body["inserted"] == 0
    assert body["status"] == "ok"


def test_pending_endpoint_returns_seeded_pending_items():
    """After startup seeding, /idp/review/pending returns the PENDING rows."""
    from fastapi.testclient import TestClient

    app = create_app(_make_settings())
    client = TestClient(app)
    res = client.get("/idp/review/pending", headers=_auth_headers())
    assert res.status_code == 200
    items = res.json()
    pending_count = sum(1 for r in _SEED_ROWS if r["status"] == "PENDING")
    assert len(items) == pending_count

    # All returned items must be PENDING
    for item in items:
        assert item["status"] == "PENDING"

    # Items must include our known PENDING doc_ids
    returned_ids = {i["doc_id"] for i in items}
    expected_pending_ids = {r["doc_id"] for r in _SEED_ROWS if r["status"] == "PENDING"}
    assert returned_ids == expected_pending_ids


def test_pending_items_ordered_by_sla_deadline():
    """Seeded PENDING items come back ordered: tightest SLA deadline first, None last."""
    from fastapi.testclient import TestClient

    app = create_app(_make_settings())
    client = TestClient(app)
    res = client.get("/idp/review/pending", headers=_auth_headers())
    items = res.json()

    # Split into items-with-deadline and items-without
    with_deadline = [i for i in items if i["sla_deadline"] is not None]
    without_deadline = [i for i in items if i["sla_deadline"] is None]

    # All deadline items must come before no-deadline items
    if with_deadline and without_deadline:
        last_with = items.index(with_deadline[-1])
        first_without = items.index(without_deadline[0])
        assert last_with < first_without, (
            "Items with SLA deadlines must sort before items without"
        )
