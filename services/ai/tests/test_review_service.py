from datetime import datetime, timedelta

import pytest

from zordms_ai.db import Base, make_engine, make_session_factory
from zordms_ai.review.service import claim, enqueue, list_pending, resolve
from zordms_ai.routing.confidence import route_by_confidence


@pytest.fixture
def session():
    engine = make_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = make_session_factory(engine)
    with Session() as s:
        yield s


NOW = datetime(2026, 6, 23, 10, 0, 0)


def test_enqueue_computes_sla_deadline(session):
    item = enqueue(
        session, doc_id="d1", doc_type="BT_CID_4G", confidence=0.60,
        decision=route_by_confidence(0.60), payload_json="{}", now=NOW,
    )
    assert item.sla_hours == 24
    assert item.sla_deadline == NOW + timedelta(hours=24)


def test_list_pending_orders_by_deadline(session):
    enqueue(session, doc_id="far", doc_type="X", confidence=0.80,
            decision=route_by_confidence(0.80), payload_json="{}", now=NOW)  # 48h
    enqueue(session, doc_id="near", doc_type="X", confidence=0.60,
            decision=route_by_confidence(0.60), payload_json="{}", now=NOW)  # 24h
    pending = list_pending(session)
    assert [p.doc_id for p in pending] == ["near", "far"]


def test_claim_then_resolve(session):
    item = enqueue(session, doc_id="d2", doc_type="X", confidence=0.60,
                   decision=route_by_confidence(0.60), payload_json="{}", now=NOW)
    claimed = claim(session, item.id, "STAFF7")
    assert claimed.status == "CLAIMED"
    assert claimed.claimed_by == "STAFF7"
    done = resolve(session, item.id, "APPROVED", now=NOW)
    assert done.status == "RESOLVED"
    assert done.resolution == "APPROVED"


def test_double_claim_raises(session):
    item = enqueue(session, doc_id="d3", doc_type="X", confidence=0.60,
                   decision=route_by_confidence(0.60), payload_json="{}", now=NOW)
    claim(session, item.id, "A")
    with pytest.raises(ValueError):
        claim(session, item.id, "B")


def test_list_pending_null_deadline_sorts_last(session):
    """Items with sla_deadline=None (AUTO_VERIFIED band) should sort after timed items (F-13)."""
    # AUTO_VERIFIED band has sla_hours=None → sla_deadline=None
    enqueue(session, doc_id="no-deadline", doc_type="X", confidence=0.88,
            decision=route_by_confidence(0.88), payload_json="{}", now=NOW)
    # HUMAN_REVIEW band has sla_hours=24 → sla_deadline=NOW+24h
    enqueue(session, doc_id="has-deadline", doc_type="X", confidence=0.60,
            decision=route_by_confidence(0.60), payload_json="{}", now=NOW)
    pending = list_pending(session)
    # The item with a concrete deadline should come first
    assert pending[0].doc_id == "has-deadline"
    assert pending[1].doc_id == "no-deadline"


def test_resolve_not_found_raises_value_error(session):
    """resolve() must raise ValueError('not found') for a missing id (verified: causes 404 via API)."""
    with pytest.raises(ValueError, match="not found"):
        resolve(session, 99999, "APPROVED", now=NOW)


def test_claim_not_found_raises_value_error(session):
    """claim() must raise ValueError('not found') for a missing id (verified: causes 404 via API)."""
    with pytest.raises(ValueError, match="not found"):
        claim(session, 99999, "STAFF1")
