import pytest

from zordms_ai.extract.extractor import Extractor, build_extract_prompt
from zordms_ai.schemas.cid import BTCid4G


class FakeClient:
    def __init__(self, response: dict):
        self.response = response
        self.calls: list[dict] = []

    async def chat_json(self, **kwargs):
        self.calls.append(kwargs)
        return self.response


_CANNED_CID = {
    "doc_type": "BT_CID_4G",
    "cid_no": "10112345678",
    "full_name": "Sonam Wangchuk",
    "dob": "1990-04-12",
    "sex": "M",
    "issue_date": "2025-01-01",
    "expiry_date": "2035-01-01",
    "dzongkhag": "Thimphu",
    "confidence": 0.94,
}


def test_prompt_names_doc_type():
    assert "BT_CID_4G" in build_extract_prompt("BT_CID_4G")


@pytest.mark.asyncio
async def test_extract_valid_cid_returns_typed_object():
    fake = FakeClient(_CANNED_CID)
    ex = Extractor(fake, model="qwen2.5-vl-7b")
    res = await ex.extract("BT_CID_4G", image_b64="QUJD")
    assert res.valid is True
    assert isinstance(res.data, BTCid4G)
    assert res.data.cid_no == "10112345678"
    assert res.review_flag is False
    # schema passed to the client is the model's own JSON schema
    assert fake.calls[0]["json_schema"]["properties"]["cid_no"]["pattern"] == "^[0-9]{11}$"


@pytest.mark.asyncio
async def test_extract_invalid_returns_partial_and_review_flag():
    bad = dict(_CANNED_CID, cid_no="123")  # fails 11-digit rule
    ex = Extractor(FakeClient(bad), model="qwen2.5-vl-7b")
    res = await ex.extract("BT_CID_4G", image_b64="QUJD")
    assert res.valid is False
    assert res.data is None
    assert res.partial == bad
    assert res.review_flag is True
    assert res.errors


@pytest.mark.asyncio
async def test_extract_unknown_doc_type_returns_review_flagged_error():
    """doc_type='UNKNOWN' has no extraction schema — must return review_flag=True, not raise (F-06)."""
    # The FakeClient will never be called because the KeyError is caught first.
    ex = Extractor(FakeClient({}), model="qwen2.5-vl-7b")
    res = await ex.extract("UNKNOWN", image_b64="QUJD")
    assert res.valid is False
    assert res.data is None
    assert res.partial is None
    assert res.review_flag is True
    assert any("no extraction schema" in e for e in res.errors)
