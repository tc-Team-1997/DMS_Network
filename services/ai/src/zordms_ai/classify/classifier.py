from __future__ import annotations

from pydantic import BaseModel, Field

from zordms_ai.classify.doctype_registry import all_doc_type_codes
from zordms_ai.classify.prescreen import prescreen
from zordms_ai.inference.vllm_client import VLLMClient

CLASSIFY_JSON_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "doc_type": {"type": "string", "enum": all_doc_type_codes()},
        "confidence": {"type": "number", "minimum": 0.0, "maximum": 1.0},
        "signals": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["doc_type", "confidence", "signals"],
    "additionalProperties": False,
}

_SYSTEM = (
    "You are a document-type classifier for Bank of Bhutan. "
    "Identify the document type from the image and output strict JSON."
)


class ClassifyResult(BaseModel):
    doc_type: str
    confidence: float = Field(ge=0.0, le=1.0)
    signals: list[str] = Field(default_factory=list)


def build_classify_prompt(prescreen_hint: str | None) -> str:
    codes = ", ".join(all_doc_type_codes())
    lines = [
        "Classify this document into exactly one of the allowed type codes.",
        f"Allowed type codes: {codes}.",
        "Return doc_type, a confidence in [0,1], and a list of signals you used.",
    ]
    if prescreen_hint:
        lines.append(
            f"A deterministic pre-screen proposed '{prescreen_hint}'. "
            "Confirm or override it based on the image."
        )
    return "\n".join(lines)


class Classifier:
    def __init__(self, client: VLLMClient, model: str) -> None:
        self._client = client
        self._model = model

    async def classify(self, image_b64: str, ocr_text: str = "") -> ClassifyResult:
        pre = prescreen(ocr_text)
        prompt = build_classify_prompt(pre.proposed_type)
        raw = await self._client.chat_json(
            model=self._model,
            system=_SYSTEM,
            user_text=prompt,
            image_b64=image_b64,
            json_schema=CLASSIFY_JSON_SCHEMA,
        )
        result = ClassifyResult.model_validate(raw)
        pre_signals = [f"{s.signal_type.name}:{s.matched}" for s in pre.signals]
        merged = list(dict.fromkeys([*pre_signals, *result.signals]))
        return result.model_copy(update={"signals": merged})
