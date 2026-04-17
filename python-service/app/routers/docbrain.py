"""
DocBrain API — the AI surface exposed to the SPA (via the Node proxy).

Endpoints:
    GET  /api/v1/docbrain/health
    POST /api/v1/docbrain/analyze            body: { document_id, ocr_text?, bytes_b64? }
    POST /api/v1/docbrain/extract            body: { text }                (capture auto-fill)
    POST /api/v1/docbrain/chat               body: { question, document_id? }
    GET  /api/v1/docbrain/document/{id}      return stored analysis for a doc

All DocBrain analysis for a document is stored in a small sidecar table
`docbrain_analyses` in the application DB so the UI can render it without
re-running the pipeline on every page load.
"""
from __future__ import annotations

import base64
import json
import logging
from dataclasses import asdict
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text as sqltext
from sqlalchemy.orm import Session

from ..db import get_db
from ..security import require_api_key
from ..services.docbrain import (
    classify_document, extract_entities, ocr_document, rag_answer,
    upsert_document, DOC_CLASSES,
)
from ..services.docbrain.extract import ExtractedField
from ..services.docbrain.llm import healthcheck as llm_healthcheck

log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/docbrain",
    tags=["docbrain"],
    dependencies=[Depends(require_api_key)],
)


# ---------- sidecar storage for analyses -----------------------------------

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS docbrain_analyses (
    document_id   INTEGER PRIMARY KEY,
    tenant_id     TEXT NOT NULL DEFAULT 'default',
    classification_json TEXT NOT NULL,
    extraction_json     TEXT NOT NULL,
    ocr_language  TEXT,
    ocr_confidence REAL,
    chunks_indexed INTEGER DEFAULT 0,
    updated_at    TEXT DEFAULT CURRENT_TIMESTAMP
);
"""


def _ensure_schema(db: Session) -> None:
    db.execute(sqltext(_SCHEMA_SQL))
    db.commit()


def _save_analysis(
    db: Session,
    document_id: int,
    classification: Dict[str, Any],
    extraction: Dict[str, Any],
    ocr_lang: Optional[str],
    ocr_conf: float,
    chunks: int,
) -> None:
    _ensure_schema(db)
    db.execute(
        sqltext(
            "INSERT INTO docbrain_analyses "
            "(document_id, classification_json, extraction_json, "
            " ocr_language, ocr_confidence, chunks_indexed, updated_at) "
            "VALUES (:id, :cls, :ext, :lang, :conf, :chunks, CURRENT_TIMESTAMP) "
            "ON CONFLICT(document_id) DO UPDATE SET "
            "  classification_json=excluded.classification_json, "
            "  extraction_json=excluded.extraction_json, "
            "  ocr_language=excluded.ocr_language, "
            "  ocr_confidence=excluded.ocr_confidence, "
            "  chunks_indexed=excluded.chunks_indexed, "
            "  updated_at=CURRENT_TIMESTAMP"
        ),
        {
            "id": document_id,
            "cls": json.dumps(classification),
            "ext": json.dumps(extraction),
            "lang": ocr_lang,
            "conf": ocr_conf,
            "chunks": chunks,
        },
    )
    db.commit()


def _load_analysis(db: Session, document_id: int) -> Optional[Dict[str, Any]]:
    _ensure_schema(db)
    row = db.execute(
        sqltext(
            "SELECT classification_json, extraction_json, ocr_language, "
            "       ocr_confidence, chunks_indexed, updated_at "
            "FROM docbrain_analyses WHERE document_id = :id"
        ),
        {"id": document_id},
    ).first()
    if row is None:
        return None
    return {
        "document_id":   document_id,
        "classification": json.loads(row[0]),
        "extraction":    json.loads(row[1]),
        "ocr_language":  row[2],
        "ocr_confidence": float(row[3] or 0.0),
        "chunks_indexed": int(row[4] or 0),
        "updated_at":    row[5],
    }


# ---------- request / response schemas -------------------------------------

class AnalyzeRequest(BaseModel):
    document_id: int
    text:        Optional[str] = None
    bytes_b64:   Optional[str] = None
    mime_type:   Optional[str] = None


class AnalyzeResponse(BaseModel):
    document_id: int
    classification: Dict[str, Any]
    extraction:    Dict[str, Any]
    ocr: Dict[str, Any]
    chunks_indexed: int


class ExtractRequest(BaseModel):
    text: str = Field(..., min_length=1)


class ExtractResponse(BaseModel):
    fields:  Dict[str, Dict[str, Any]]
    prefill: Dict[str, str]


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1)
    document_id: Optional[int] = None


class ChatResponse(BaseModel):
    answer: str
    citations: List[Dict[str, Any]]
    has_evidence: bool


# ---------- helpers --------------------------------------------------------

def _extraction_to_dict(result) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for key in (
        "customer_cid", "customer_name", "doc_number", "dob",
        "issue_date", "expiry_date", "issuing_authority", "address",
    ):
        field: ExtractedField = getattr(result, key)
        out[key] = {"value": field.value, "confidence": field.confidence}
    return out


# ---------- routes ---------------------------------------------------------

@router.get("/health")
def health():
    return llm_healthcheck() | {"classes": DOC_CLASSES}


@router.post("/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest, db: Session = Depends(get_db)):
    """
    Full pipeline: OCR (if bytes supplied) → classify → extract → embed.
    Pass either `text` (already-OCR'd) or `bytes_b64` + `mime_type`. Result
    is persisted for later retrieval via GET /document/{id}.
    """
    if not (req.text or req.bytes_b64):
        raise HTTPException(status_code=400, detail="supply text or bytes_b64")

    if req.bytes_b64:
        try:
            data = base64.b64decode(req.bytes_b64, validate=True)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=400, detail=f"bad base64: {exc}")
        mime = req.mime_type or "application/octet-stream"
        ocr_res = ocr_document(data, mime)
        full_text = ocr_res.full_text
        ocr_summary = {
            "pages": len(ocr_res.pages),
            "mean_confidence": ocr_res.mean_confidence,
            "languages": ocr_res.languages,
        }
    else:
        full_text = (req.text or "").strip()
        ocr_summary = {
            "pages": 1,
            "mean_confidence": 100.0,
            "languages": ["eng"],
        }

    classification = classify_document(full_text)
    extraction     = extract_entities(full_text)
    chunks_indexed = upsert_document(req.document_id, full_text)

    classification_dict = asdict(classification)
    extraction_dict     = _extraction_to_dict(extraction)

    _save_analysis(
        db,
        document_id=req.document_id,
        classification=classification_dict,
        extraction=extraction_dict,
        ocr_lang=",".join(ocr_summary.get("languages") or []),
        ocr_conf=float(ocr_summary.get("mean_confidence") or 0.0),
        chunks=chunks_indexed,
    )

    return AnalyzeResponse(
        document_id=req.document_id,
        classification=classification_dict,
        extraction=extraction_dict,
        ocr=ocr_summary,
        chunks_indexed=chunks_indexed,
    )


@router.post("/extract", response_model=ExtractResponse)
def extract(req: ExtractRequest):
    """Fast, no-persistence call used by the Capture auto-fill flow."""
    result = extract_entities(req.text)
    fields = _extraction_to_dict(result)
    return ExtractResponse(fields=fields, prefill=result.as_prefill())


@router.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    ans = rag_answer(req.question, document_id=req.document_id)
    return ChatResponse(
        answer=ans.answer,
        citations=[asdict(c) for c in ans.citations],
        has_evidence=ans.has_evidence,
    )


@router.get("/document/{document_id}")
def get_analysis(document_id: int, db: Session = Depends(get_db)):
    rec = _load_analysis(db, document_id)
    if not rec:
        raise HTTPException(status_code=404, detail="not analysed yet")
    return rec
