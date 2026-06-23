from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, File, Form, Request, UploadFile

from zordms_ai.pipeline.preprocess import b64_png, to_page_images

idp_router = APIRouter(prefix="/idp")


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
