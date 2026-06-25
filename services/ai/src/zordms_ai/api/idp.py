from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile

from zordms_ai.auth import require_auth
from zordms_ai.classify.field_inference import InferFieldsResult
from zordms_ai.pipeline.preprocess import b64_png, to_page_images
from zordms_ai.seeds import seed_review_queue

# Every route under this router requires a valid Bearer JWT (F-01).
idp_router = APIRouter(prefix="/idp", dependencies=[Depends(require_auth)])


@idp_router.post("/classify")
async def classify_endpoint(
    request: Request,
    file: UploadFile = File(...),
    ocr_text: str = Form(""),
) -> dict:
    raw = await file.read()
    image_b64 = b64_png(to_page_images(raw, file.content_type or "image/png")[0])
    result = await request.app.state.classifier.classify(image_b64=image_b64, ocr_text=ocr_text)
    return result.model_dump()


@idp_router.post("/extract")
async def extract_endpoint(
    request: Request,
    file: UploadFile = File(...),
    doc_type: str = Form(...),
) -> dict:
    raw = await file.read()
    image_b64 = b64_png(to_page_images(raw, file.content_type or "image/png")[0])
    res = await request.app.state.extractor.extract(doc_type, image_b64)
    return {
        "doc_type": res.doc_type,
        "valid": res.valid,
        "review_flag": res.review_flag,
        "data": res.data.model_dump(mode="json") if res.data else None,
        "partial": res.partial,
        "errors": res.errors,
    }


@idp_router.post("/infer-fields")
async def infer_fields_endpoint(
    request: Request,
    file: UploadFile = File(...),
    doc_type_hint: str = Form(""),
) -> dict:
    """Propose a METADATA FIELD SCHEMA from a SAMPLE document.

    An admin uploads a representative document (image or PDF) and the vision
    model proposes the fields to capture for that doc type. The response always
    has HTTP 200; if the backend is unavailable it returns an empty ``fields``
    list with ``degraded: true`` and a human ``note`` rather than a 500.

    Response shape::

        {
          "doc_type_hint": str | null,
          "fields": [
            {"name": str, "label": str, "type": "string|date|number|enum",
             "mandatory": bool, "sample_value": str},
            ...
          ],
          "degraded": bool,
          "note": str | null
        }
    """
    hint = doc_type_hint.strip() or None
    raw = await file.read()
    try:
        image_b64 = b64_png(
            to_page_images(raw, file.content_type or "image/png")[0]
        )
    except Exception:  # preprocess/backend deps unavailable — degrade, don't 500
        return InferFieldsResult(
            doc_type_hint=hint,
            fields=[],
            degraded=True,
            note="Could not read the sample document. Upload a valid image or PDF.",
        ).model_dump()

    result = await request.app.state.field_inferer.infer(
        image_b64=image_b64, doc_type_hint=hint
    )
    return result.model_dump()


@idp_router.post("/seed")
def seed_endpoint(request: Request) -> dict:
    """(Dev) Re-run the review-queue seed; no-op if data already present.

    Returns ``{"inserted": N}`` where N is the number of rows added (0 = already seeded).
    Requires a valid Bearer JWT like all other /idp/* routes.
    """
    n = seed_review_queue(request.app.state.session_factory)
    return {"inserted": n, "status": "ok"}


@idp_router.post("/process")
async def process_endpoint(
    request: Request,
    file: UploadFile = File(...),
    doc_id: str = Form(...),
    ocr_text: str = Form(""),
) -> dict:
    raw = await file.read()
    outcome = await request.app.state.orchestrator.process(
        doc_id=doc_id,
        raw=raw,
        content_type=file.content_type or "image/png",
        ocr_text=ocr_text,
        now=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    return {
        "handoff": outcome.handoff.model_dump(),
        "decision": {
            "band": outcome.decision.band,
            "action": outcome.decision.action.value,
            "proceed_to_extract": outcome.decision.proceed_to_extract,
            "review_required": outcome.decision.review_required,
            "sla_hours": outcome.decision.sla_hours,
            "catalog_assignment": outcome.decision.catalog_assignment,
        },
        "review_item_id": outcome.review_item_id,
    }
