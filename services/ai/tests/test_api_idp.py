import io
from datetime import datetime
from unittest.mock import patch

from fastapi.testclient import TestClient

from zordms_ai.app import create_app
from zordms_ai.classify.classifier import ClassifyResult
from zordms_ai.extract.extractor import ExtractResult
from zordms_ai.pipeline.orchestrator import CatalogHandoff, IdpOutcome
from zordms_ai.routing.confidence import route_by_confidence
from zordms_ai.schemas.cid import BTCid4G
from zordms_ai.settings import Settings

_CID = BTCid4G(
    doc_type="BT_CID_4G", cid_no="10112345678", full_name="Sonam",
    dob="1990-04-12", sex="M", issue_date="2025-01-01", expiry_date="2035-01-01",
    dzongkhag="Thimphu", confidence=0.95,
)


class FakeClassifier:
    async def classify(self, image_b64, ocr_text=""):
        return ClassifyResult(doc_type="BT_CID_4G", confidence=0.95, signals=["ID_REGEX:10112345678"])


class FakeExtractor:
    async def extract(self, doc_type, image_b64):
        return ExtractResult(doc_type, _CID, None, True, [], False)


class FakeOrchestrator:
    async def process(self, *, doc_id, raw, content_type, ocr_text="", now):
        return IdpOutcome(
            decision=route_by_confidence(0.95),
            classify=ClassifyResult(doc_type="BT_CID_4G", confidence=0.95, signals=[]),
            extract=None,
            handoff=CatalogHandoff(
                doc_id=doc_id, doc_type="BT_CID_4G", confidence=0.95,
                catalog_assignment="full", review_required=False,
                metadata=_CID.model_dump(mode="json"),
            ),
            review_item_id=None,
        )


def _client() -> TestClient:
    app = create_app(Settings(database_url="sqlite+pysqlite:///:memory:"))
    app.state.classifier = FakeClassifier()
    app.state.extractor = FakeExtractor()
    app.state.orchestrator = FakeOrchestrator()
    return TestClient(app)


def _png():
    return ("x.png", io.BytesIO(b"\x89PNG"), "image/png")


@patch("zordms_ai.api.idp.to_page_images", return_value=[b"FAKEPNG"])
def test_classify_endpoint(_mock_preproc):
    res = _client().post("/idp/classify", files={"file": _png()}, data={"ocr_text": "10112345678"})
    assert res.status_code == 200
    assert res.json()["doc_type"] == "BT_CID_4G"


@patch("zordms_ai.api.idp.to_page_images", return_value=[b"FAKEPNG"])
def test_extract_endpoint(_mock_preproc):
    res = _client().post("/idp/extract", files={"file": _png()}, data={"doc_type": "BT_CID_4G"})
    assert res.status_code == 200
    body = res.json()
    assert body["valid"] is True
    assert body["data"]["cid_no"] == "10112345678"


def test_process_endpoint():
    res = _client().post("/idp/process", files={"file": _png()}, data={"doc_id": "d1"})
    assert res.status_code == 200
    body = res.json()
    assert body["handoff"]["doc_type"] == "BT_CID_4G"
    assert body["handoff"]["catalog_assignment"] == "full"
    assert body["review_item_id"] is None
