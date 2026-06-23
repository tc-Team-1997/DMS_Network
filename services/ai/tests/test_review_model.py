from datetime import datetime

from sqlalchemy import select

from zordms_ai.db import Base, make_engine, make_session_factory
from zordms_ai.review.models import ReviewItem


def test_review_item_persists_and_reads_back():
    engine = make_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = make_session_factory(engine)
    with Session() as s:
        s.add(
            ReviewItem(
                doc_id="doc-1",
                doc_type="BT_CID_4G",
                confidence=0.6,
                band="0.50-0.69",
                sla_hours=24,
                sla_deadline=datetime(2026, 6, 24, 10, 0, 0),
                status="PENDING",
                payload_json="{}",
                created_at=datetime(2026, 6, 23, 10, 0, 0),
            )
        )
        s.commit()
        item = s.scalars(select(ReviewItem).where(ReviewItem.doc_id == "doc-1")).one()
        assert item.status == "PENDING"
        assert item.sla_hours == 24
