import pytest

from zordms_ai.classify.classifier import (
    CLASSIFY_JSON_SCHEMA,
    Classifier,
    build_classify_prompt,
)


class FakeClient:
    def __init__(self, response: dict):
        self.response = response
        self.calls: list[dict] = []

    async def chat_json(self, **kwargs):
        self.calls.append(kwargs)
        return self.response


def test_prompt_lists_allowed_codes_and_hint():
    prompt = build_classify_prompt(prescreen_hint="BT_PASSPORT")
    assert "BT_PASSPORT" in prompt
    assert "BT_CID_4G" in prompt
    assert "pre-screen" in prompt.lower()


def test_schema_constrains_doc_type_to_enum():
    enum = CLASSIFY_JSON_SCHEMA["properties"]["doc_type"]["enum"]
    assert "BT_CID_4G" in enum and "UNKNOWN" in enum


@pytest.mark.asyncio
async def test_classify_parses_response_and_merges_prescreen_signals():
    fake = FakeClient({"doc_type": "BT_PASSPORT", "confidence": 0.96, "signals": ["maroon cover"]})
    clf = Classifier(fake, model="granite-3.2-vision-2b")
    result = await clf.classify(image_b64="QUJD", ocr_text="P<BTNDORJI<<KARMA")
    assert result.doc_type == "BT_PASSPORT"
    assert result.confidence == 0.96
    # pre-screen MRZ signal merged in alongside the model's own signal
    assert any("MRZ" in s or "P<BTN" in s for s in result.signals)
    # the client was called with the constrained schema
    assert fake.calls[0]["json_schema"] is CLASSIFY_JSON_SCHEMA
    assert fake.calls[0]["model"] == "granite-3.2-vision-2b"
