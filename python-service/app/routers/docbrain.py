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
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import text as sqltext
from sqlalchemy.orm import Session

from ..db import get_db
from ..security import require_api_key
from ..services.docbrain import (
    classify_document, extract_entities, ocr_document, rag_answer,
    rag_answer_stream, upsert_document, DOC_CLASSES,
)
from ..services.docbrain.extract import ExtractedField
from ..services.docbrain.lc_rag import USE_LANGCHAIN, rag_answer_stream_langchain
from ..services.docbrain.agent import agent_stream
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


class PreviewRequest(BaseModel):
    """Pre-upload preview. No document_id — nothing is persisted or indexed."""
    bytes_b64: Optional[str] = None
    mime_type: Optional[str] = None
    text:      Optional[str] = None


class PreviewResponse(BaseModel):
    classification: Dict[str, Any]
    extraction:    Dict[str, Any]
    ocr: Dict[str, Any]
    prefill: Dict[str, str]     # high-confidence fields the SPA should auto-fill
    summary: str = ""           # short plain-text AI summary of the document


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
    needs_verification: bool = False


class ChatTurn(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str


class ChatStreamRequest(BaseModel):
    question: str = Field(..., min_length=1)
    document_id: Optional[int] = None
    tenant_id: Optional[str] = None
    history: List[ChatTurn] = Field(default_factory=list)


# ---------- helpers --------------------------------------------------------

def _extraction_to_dict(result) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for key in (
        "customer_cid", "customer_name", "doc_number", "dob",
        "issue_date", "expiry_date", "issuing_authority", "address",
    ):
        f: ExtractedField = getattr(result, key)
        out[key] = {"value": f.value, "confidence": f.confidence}
    # Include extra schema-specific fields when present.
    extra = getattr(result, "extra_fields", None) or {}
    for key, ef in extra.items():
        out[key] = {"value": getattr(ef, "value", None), "confidence": getattr(ef, "confidence", 0.0)}
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
            "backend": ocr_res.backend,
        }
    else:
        full_text = (req.text or "").strip()
        ocr_summary = {
            "pages": 1,
            "mean_confidence": 100.0,
            "languages": ["eng"],
            "backend": "passthrough",
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


@router.post("/preview", response_model=PreviewResponse)
def preview(req: PreviewRequest):
    """
    Pre-upload preview. OCR (if bytes) → classify → extract. No sidecar
    write, no vector upsert. Used by the Capture page so the user sees the
    AI's best guess *before* committing the upload.
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
            "backend": ocr_res.backend,
        }
    else:
        full_text = (req.text or "").strip()
        ocr_summary = {
            "pages": 1, "mean_confidence": 100.0, "languages": ["eng"],
            "backend": "passthrough",
        }

    classification = classify_document(full_text)
    extraction     = extract_entities(full_text)

    # as_prefill() on the ExtractionResult returns only fields with
    # confidence >= 0.7 — this is the canonical "safe to auto-fill" view.
    prefill = extraction.as_prefill()

    # Include doc_type in the prefill when classification is confident.
    if classification.doc_class and classification.doc_class != "Unknown":
        prefill = dict(prefill)
        prefill.setdefault("doc_type", classification.doc_class)

    # Short AI summary — one or two sentences. Best-effort, empty string on LLM failure.
    from ..services.docbrain.llm import chat_text  # noqa: PLC0415
    summary = ""
    if full_text and len(full_text.strip()) >= 40:
        try:
            summary = chat_text(
                system=(
                    "You are DocBrain summarising a banking/KYC document for an operator. "
                    "In one or two sentences (max 40 words), state the document type, who it is about, "
                    "and the single most actionable fact (issue/expiry date, balance, or customer name). "
                    "No preamble. No disclaimers. No markdown."
                ),
                user=full_text[:4000],
                temperature=0.0,
            ).strip()
        except Exception:  # noqa: BLE001
            summary = ""

    return PreviewResponse(
        classification=asdict(classification),
        extraction=_extraction_to_dict(extraction),
        ocr=ocr_summary,
        prefill=prefill,
        summary=summary,
    )


@router.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    ans = rag_answer(req.question, document_id=req.document_id)
    return ChatResponse(
        answer=ans.answer,
        citations=[asdict(c) for c in ans.citations],
        has_evidence=ans.has_evidence,
        needs_verification=ans.needs_verification,
    )


@router.post("/chat/stream")
def chat_stream(req: ChatStreamRequest):
    """
    Server-sent events. Each frame is a single JSON object on one line,
    prefixed with `data: ` per the SSE spec. Frame types:
      - `citations`   — the retrieved passages the answer will ground on
      - `no_evidence` — retrieval returned nothing; stream terminates
      - `token`       — one delta of the answer text
      - `done`        — final event with evidence flag
    The `X-Accel-Buffering: no` header disables proxy buffering so tokens
    reach the browser as they're produced.
    """
    # Pick implementation: env-flag picks LangChain path, default is the
    # existing custom generator. Same SSE event shape either way.
    stream_impl = rag_answer_stream_langchain if USE_LANGCHAIN else rag_answer_stream

    def event_gen():
        try:
            for evt in stream_impl(
                req.question,
                tenant_id=req.tenant_id,
                document_id=req.document_id,
                history=[h.model_dump() for h in req.history],
            ):
                yield f"data: {json.dumps(evt, ensure_ascii=False)}\n\n"
        except Exception as exc:  # noqa: BLE001
            log.exception("chat_stream failed: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)[:200]})}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("/document/{document_id}")
def get_analysis(document_id: int, db: Session = Depends(get_db)):
    rec = _load_analysis(db, document_id)
    if not rec:
        raise HTTPException(status_code=404, detail="not analysed yet")
    return rec


# ---------- agent (tool-using) ---------------------------------------------

class AgentStreamRequest(BaseModel):
    question: str = Field(..., min_length=1)
    history: List[ChatTurn] = Field(default_factory=list)


@router.post("/agent/stream")
def agent_stream_endpoint(req: AgentStreamRequest):
    """Server-sent events for the tool-using agent. Frame types:
      `tool_call`  {name, arguments}
      `tool_result`{name, result}
      `token`      {text}
      `done`       {iterations, used_tools}
      `error`      {message}
    """
    def event_gen():
        try:
            for evt in agent_stream(
                req.question,
                history=[h.model_dump() for h in req.history],
            ):
                yield f"data: {json.dumps(evt, ensure_ascii=False, default=str)}\n\n"
        except Exception as exc:  # noqa: BLE001
            log.exception("agent_stream failed: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)[:200]})}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
