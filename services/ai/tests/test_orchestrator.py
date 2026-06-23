from datetime import datetime

import pytest

from zordms_ai.classify.classifier import ClassifyResult
from zordms_ai.db import Base, make_engine, make_session_factory
from zordms_ai.extract.extractor import ExtractResult
from zordms_ai.pipeline.orchestrator import Orchestrator
from zordms_ai.review.service import list_pending
from zordms_ai.schemas.cid import BTCid4G

NOW = datetime(2026, 6, 23, 10, 0, 0)


def _session_factory():
    engine = make_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    return make_session_factory(engine)


class FakeClassifier:
    def __init__(self, result):
        self.result = result

    async def classify(self, image_b64, ocr_text=""):
        return self.result


class FakeExtractor:
    def __init__(self, result):
        self.result = result

    async def extract(self, doc_type, image_b64):
        return self.result


_VALID_CID = BTCid4G(
    doc_type="BT_CID_4G", cid_no="10112345678", full_name="Sonam",
    dob="1990-04-12", sex="M", issue_date="2025-01-01", expiry_date="2035-01-01",
    dzongkhag="Thimphu", confidence=0.95,
)


@pytest.mark.asyncio
async def test_happy_path_high_confidence(monkeypatch):
    monkeypatch.setattr(
        "zordms_ai.pipeline.orchestrator.to_page_images", lambda raw, ct: [b"PNG"]
    )
    orch = Orchestrator(
        FakeClassifier(ClassifyResult(doc_type="BT_CID_4G", confidence=0.95, signals=[])),
        FakeExtractor(ExtractResult("BT_CID_4G", _VALID_CID, None, True, [], False)),
        _session_factory(),
    )
    out = await orch.process(doc_id="d1", raw=b"x", content_type="image/png", now=NOW)
    assert out.handoff.doc_type == "BT_CID_4G"
    assert out.handoff.catalog_assignment == "full"
    assert out.handoff.review_required is False
    assert out.handoff.metadata["cid_no"] == "10112345678"
    assert out.review_item_id is None


@pytest.mark.asyncio
async def test_low_confidence_holds_and_enqueues_review(monkeypatch):
    monkeypatch.setattr(
        "zordms_ai.pipeline.orchestrator.to_page_images", lambda raw, ct: [b"PNG"]
    )
    sf = _session_factory()
    orch = Orchestrator(
        FakeClassifier(ClassifyResult(doc_type="BT_CID_4G", confidence=0.60, signals=[])),
        FakeExtractor(ExtractResult("BT_CID_4G", _VALID_CID, None, True, [], False)),
        sf,
    )
    out = await orch.process(doc_id="d2", raw=b"x", content_type="image/png", now=NOW)
    assert out.decision.proceed_to_extract is False
    assert out.extract is None
    assert out.handoff.metadata is None
    assert out.handoff.catalog_assignment == "pending"
    assert out.review_item_id is not None
    with sf() as s:
        assert [i.doc_id for i in list_pending(s)] == ["d2"]
