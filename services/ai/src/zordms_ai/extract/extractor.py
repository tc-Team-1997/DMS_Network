from __future__ import annotations

from dataclasses import dataclass, field

from pydantic import ValidationError

from zordms_ai.inference.vllm_client import VLLMClient
from zordms_ai.schemas.base import ExtractionBase
from zordms_ai.schemas.generic import GenericDocument
from zordms_ai.schemas.registry import schema_for

_SYSTEM = (
    "You extract structured metadata from a Bank of Bhutan document image. "
    "Output strict JSON matching the provided schema; do not invent fields."
)


@dataclass
class ExtractResult:
    doc_type: str
    data: ExtractionBase | None
    partial: dict | None
    valid: bool
    errors: list[str] = field(default_factory=list)
    review_flag: bool = False


def build_extract_prompt(doc_type: str) -> str:
    return (
        f"Extract all metadata fields for a document of type {doc_type}. "
        "Populate every required field from the image. "
        "Set confidence to your certainty in [0,1]."
    )


class Extractor:
    def __init__(self, client: VLLMClient, model: str) -> None:
        self._client = client
        self._model = model

    async def extract(self, doc_type: str, image_b64: str) -> ExtractResult:
        # Resolve a schema for the doc_type. UNKNOWN (unclassified) is a
        # deliberate no-extract guard — F-06. Any other classified-but-unmodeled
        # type falls back to the GenericDocument schema so it still yields header
        # metadata instead of a hard error (flagged for review).
        generic = False
        try:
            model_cls = schema_for(doc_type)
        except KeyError:
            if doc_type == "UNKNOWN":
                return ExtractResult(
                    doc_type=doc_type,
                    data=None,
                    partial=None,
                    valid=False,
                    errors=[f"no extraction schema for doc_type={doc_type!r}"],
                    review_flag=True,
                )
            model_cls = GenericDocument
            generic = True
        json_schema = model_cls.model_json_schema()
        raw = await self._client.chat_json(
            model=self._model,
            system=_SYSTEM,
            user_text=build_extract_prompt(doc_type),
            image_b64=image_b64,
            json_schema=json_schema,
        )
        try:
            data = model_cls.model_validate(raw)
        except ValidationError as exc:
            return ExtractResult(
                doc_type=doc_type,
                data=None,
                partial=raw,
                valid=False,
                errors=[e["msg"] for e in exc.errors()],
                review_flag=True,
            )
        if generic:
            # Reflect the real classified type on the payload and always flag
            # generic extractions for review (lower trust than a typed schema).
            data.doc_type = doc_type
        return ExtractResult(
            doc_type=doc_type,
            data=data,
            partial=None,
            valid=True,
            errors=[],
            review_flag=True if generic else data.review_flag,
        )
