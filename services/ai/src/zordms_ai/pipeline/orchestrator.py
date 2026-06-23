from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime

from pydantic import BaseModel

from zordms_ai.classify.classifier import ClassifyResult
from zordms_ai.extract.extractor import ExtractResult
from zordms_ai.pipeline.preprocess import b64_png, to_page_images
from zordms_ai.review.service import enqueue
from zordms_ai.routing.confidence import RouteDecision, route_by_confidence


class CatalogHandoff(BaseModel):
    doc_id: str
    doc_type: str
    confidence: float
    catalog_assignment: str
    review_required: bool
    metadata: dict | None = None


@dataclass
class IdpOutcome:
    decision: RouteDecision
    classify: ClassifyResult
    extract: ExtractResult | None
    handoff: CatalogHandoff
    review_item_id: int | None


class Orchestrator:
    def __init__(self, classifier, extractor, session_factory) -> None:
        self._classifier = classifier
        self._extractor = extractor
        self._sf = session_factory

    async def process(
        self,
        *,
        doc_id: str,
        raw: bytes,
        content_type: str,
        ocr_text: str = "",
        now: datetime,
    ) -> IdpOutcome:
        first_page = to_page_images(raw, content_type)[0]
        image_b64 = b64_png(first_page)

        classify = await self._classifier.classify(image_b64=image_b64, ocr_text=ocr_text)
        decision = route_by_confidence(classify.confidence)

        extract: ExtractResult | None = None
        metadata: dict | None = None
        review_required = decision.review_required

        if decision.proceed_to_extract:
            extract = await self._extractor.extract(classify.doc_type, image_b64)
            if extract.valid and extract.data is not None:
                metadata = extract.data.model_dump(mode="json")
                review_required = review_required or extract.review_flag
            else:
                metadata = None
                review_required = True

        handoff = CatalogHandoff(
            doc_id=doc_id,
            doc_type=classify.doc_type,
            confidence=classify.confidence,
            catalog_assignment=decision.catalog_assignment,
            review_required=review_required,
            metadata=metadata,
        )

        review_item_id: int | None = None
        if review_required:
            payload = json.dumps(metadata if metadata is not None else (extract.partial if extract else {}))
            with self._sf() as session:
                item = enqueue(
                    session,
                    doc_id=doc_id,
                    doc_type=classify.doc_type,
                    confidence=classify.confidence,
                    decision=decision,
                    payload_json=payload,
                    now=now,
                )
                review_item_id = item.id

        return IdpOutcome(
            decision=decision,
            classify=classify,
            extract=extract,
            handoff=handoff,
            review_item_id=review_item_id,
        )
