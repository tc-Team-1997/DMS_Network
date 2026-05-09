"""DocBrain Chat v2 — conversation management + streaming chat endpoints.

Endpoints
---------
GET  /api/v1/docbrain/conversations            list / FTS search
POST /api/v1/docbrain/conversations            create
GET  /api/v1/docbrain/conversations/:id        fetch thread (messages)
POST /api/v1/docbrain/conversations/:id/messages   send (SSE stream)
PATCH /api/v1/docbrain/messages/:id            edit-and-resend
POST /api/v1/docbrain/messages/:id/regenerate  regenerate last assistant reply
POST /api/v1/docbrain/conversations/:id/pin    toggle pin
POST /api/v1/docbrain/conversations/:id/folder set / clear folder

LLM is resolved via CC6 provider registry (OllamaLlm default).
No direct OpenAI / Anthropic / Bedrock imports.

Guardrails
----------
- Every LLM call has a 1-retry, 5-second backoff policy (via rag.py).
- Structured log: {conversation_id, op, latency_ms, model, has_evidence}.
- Token budget stub: logged but not enforced (Wave C; roadmap to enforce).
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any, Dict, Iterator, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_db
from ..security import require_api_key
from ..services.docbrain import rag_answer_stream
from ..services.docbrain.conversations import (
    create_conversation,
    create_message,
    edit_message,
    get_conversation,
    list_conversations,
    pin_conversation,
    set_folder,
    soft_delete_message,
)
from ..services.docbrain.llm import CHAT_MODEL

log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/docbrain",
    tags=["docbrain-v2"],
    dependencies=[Depends(require_api_key)],
)

# ---------------------------------------------------------------------------
# Token budget stub — roadmap to enforce per-tenant monthly limit.
# ---------------------------------------------------------------------------

def _check_token_budget(tenant_id: str, estimated_tokens: int) -> None:
    """Stub: log the estimated token spend; enforcement deferred to Wave D."""
    log.info(
        '{"op":"token_budget_check","tenant_id":%s,"estimated_tokens":%s,"enforced":false}',
        json.dumps(tenant_id),
        estimated_tokens,
    )


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class CreateConversationRequest(BaseModel):
    title: str = Field(default="New chat", max_length=300)
    persona: Optional[str] = Field(default=None, max_length=64)
    folder: Optional[str] = Field(default=None, max_length=128)
    model_used: Optional[str] = Field(default=None, max_length=128)


class ConversationResponse(BaseModel):
    id: int
    tenant_id: str
    user_id: int
    title: str
    persona: Optional[str]
    folder: Optional[str]
    pinned: bool
    model_used: Optional[str]
    last_message: Optional[str]
    created_at: str
    updated_at: str
    last_message_at: Optional[str]
    message_count: int = 0


class MessageResponse(BaseModel):
    id: int
    conversation_id: int
    role: str
    content: str
    citations: List[Dict[str, Any]]
    has_evidence: Optional[bool]
    needs_verification: bool
    edited_at: Optional[str]
    created_at: str


class ConversationDetailResponse(BaseModel):
    conversation: ConversationResponse
    messages: List[MessageResponse]


class SendMessageRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)
    document_id: Optional[int] = None
    tenant_id: Optional[str] = None


class ChatTurn(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str


class EditMessageRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=4000)


class PinRequest(BaseModel):
    pinned: bool


class FolderRequest(BaseModel):
    folder: Optional[str] = Field(default=None, max_length=128)


# ---------------------------------------------------------------------------
# Helper: user_id from API key (stub for v2 — uses tenant_id as the signal)
# ---------------------------------------------------------------------------

def _user_id_from_request(request) -> int:
    """Extract a stable user_id from the request.

    In production this comes from the JWT claims injected by the Node proxy
    (X-User-Id header). For dev / direct API calls we default to 1.
    """
    raw = request.headers.get("x-user-id", "1")
    try:
        return int(raw)
    except (ValueError, TypeError):
        return 1


def _tenant_id_from_request(request) -> str:
    return request.headers.get("x-tenant-id", "nbe")


# ---------------------------------------------------------------------------
# Helper: dict → response models
# ---------------------------------------------------------------------------

def _conv_to_response(conv: Dict[str, Any], message_count: int = 0) -> ConversationResponse:
    return ConversationResponse(
        id=conv["id"],
        tenant_id=conv["tenant_id"],
        user_id=conv["user_id"],
        title=conv["title"],
        persona=conv["persona"],
        folder=conv["folder"],
        pinned=conv["pinned"],
        model_used=conv["model_used"],
        last_message=conv["last_message"],
        created_at=conv["created_at"],
        updated_at=conv["updated_at"],
        last_message_at=conv["last_message_at"],
        message_count=message_count,
    )


def _msg_to_response(msg: Dict[str, Any]) -> MessageResponse:
    return MessageResponse(
        id=msg["id"],
        conversation_id=msg["conversation_id"],
        role=msg["role"],
        content=msg["content"],
        citations=msg["citations"],
        has_evidence=msg["has_evidence"],
        needs_verification=msg["needs_verification"],
        edited_at=msg["edited_at"],
        created_at=msg["created_at"],
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/conversations", response_model=List[ConversationResponse])
def list_convos(
    request,
    q: Optional[str] = Query(default=None, max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """List conversations for the current user, optionally filtered by FTS query."""
    tenant_id = _tenant_id_from_request(request)
    user_id   = _user_id_from_request(request)
    convos = list_conversations(db, tenant_id, user_id, q=q, limit=limit)

    # Attach message counts in one query for sidebar display.
    if convos:
        ids = [c["id"] for c in convos]
        placeholders = ", ".join(f":id{i}" for i in range(len(ids)))
        counts_rows = db.execute(
            text(
                f"SELECT conversation_id, COUNT(*) FROM docbrain_messages "
                f"WHERE conversation_id IN ({placeholders}) AND deleted_at IS NULL "
                f"GROUP BY conversation_id"
            ),
            {f"id{i}": ids[i] for i in range(len(ids))},
        ).fetchall()
        count_map = {r[0]: r[1] for r in counts_rows}
    else:
        count_map = {}

    return [_conv_to_response(c, count_map.get(c["id"], 0)) for c in convos]


@router.post("/conversations", response_model=ConversationResponse, status_code=201)
def create_convo(
    request,
    body: CreateConversationRequest,
    db: Session = Depends(get_db),
):
    tenant_id = _tenant_id_from_request(request)
    user_id   = _user_id_from_request(request)
    conv = create_conversation(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        title=body.title,
        persona=body.persona,
        folder=body.folder,
        model_used=body.model_used or CHAT_MODEL,
    )
    return _conv_to_response(conv)


@router.get("/conversations/{conversation_id}", response_model=ConversationDetailResponse)
def get_convo(
    conversation_id: int,
    request,
    db: Session = Depends(get_db),
):
    tenant_id = _tenant_id_from_request(request)
    user_id   = _user_id_from_request(request)
    result = get_conversation(db, conversation_id, tenant_id, user_id)
    if result is None:
        raise HTTPException(status_code=404, detail="conversation not found")
    conv, messages = result
    return ConversationDetailResponse(
        conversation=_conv_to_response(conv, len(messages)),
        messages=[_msg_to_response(m) for m in messages],
    )


@router.post("/conversations/{conversation_id}/messages")
def send_message(
    conversation_id: int,
    request,
    body: SendMessageRequest,
    db: Session = Depends(get_db),
):
    """Stream a chat turn as SSE. Persists both the user message and the
    assembled assistant reply once the stream completes.

    SSE frame types (same contract as /docbrain/chat/stream):
      citations   — retrieved passages
      no_evidence — no passages; stream terminates
      token       — one text delta
      done        — {has_evidence, needs_verification}
      error       — {message}

    Structured log per guardrail: {conversation_id, op, latency_ms, model, has_evidence}.
    """
    tenant_id = _tenant_id_from_request(request)
    user_id   = _user_id_from_request(request)

    # Verify ownership.
    result = get_conversation(db, conversation_id, tenant_id, user_id)
    if result is None:
        raise HTTPException(status_code=404, detail="conversation not found")
    conv, prior_messages = result

    # Persist the user message immediately so it's recoverable even if the
    # stream is aborted.
    create_message(db, conversation_id, "user", body.question)

    # Build history for multi-turn context (last 6 messages ≈ 3 turns).
    history = [
        {"role": m["role"], "content": m["content"]}
        for m in prior_messages[-6:]
    ]

    # Token budget stub.
    estimated = sum(len(m["content"]) for m in prior_messages) // 4
    _check_token_budget(tenant_id, estimated)

    start = time.monotonic()
    model = conv.get("model_used") or CHAT_MODEL

    def event_gen() -> Iterator[str]:
        collected_tokens: list[str] = []
        final_citations: list[dict] = []
        has_evidence_flag: Optional[bool] = None
        needs_verif_flag = False

        try:
            for evt in rag_answer_stream(
                body.question,
                tenant_id=tenant_id,
                document_id=body.document_id,
                history=history,
            ):
                if evt.get("type") == "citations":
                    final_citations = evt.get("items", [])
                elif evt.get("type") == "token":
                    collected_tokens.append(evt.get("text", ""))
                elif evt.get("type") == "no_evidence":
                    has_evidence_flag = False
                elif evt.get("type") == "done":
                    has_evidence_flag = evt.get("has_evidence", True)
                    needs_verif_flag = bool(evt.get("needs_verification", False))

                yield f"data: {json.dumps(evt, ensure_ascii=False)}\n\n"

        except Exception as exc:  # noqa: BLE001
            log.exception("docbrain_v2 send_message stream error: %s", exc)
            yield f"data: {json.dumps({'type':'error','message':str(exc)[:200]})}\n\n"

        finally:
            # Persist the assembled assistant reply.
            answer = "".join(collected_tokens)
            if answer or has_evidence_flag is False:
                try:
                    create_message(
                        db,
                        conversation_id,
                        "assistant",
                        answer,
                        citations=final_citations,
                        has_evidence=has_evidence_flag,
                        needs_verification=needs_verif_flag,
                    )
                except Exception as exc2:  # noqa: BLE001
                    log.error("Failed to persist assistant message: %s", exc2)

            latency_ms = int((time.monotonic() - start) * 1000)
            log.info(
                '{"op":"docbrain_send","conversation_id":%s,"latency_ms":%s,'
                '"model":%s,"has_evidence":%s}',
                conversation_id, latency_ms,
                json.dumps(model), json.dumps(has_evidence_flag),
            )

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering": "no",
            "Connection":       "keep-alive",
        },
    )


@router.patch("/messages/{message_id}", response_model=MessageResponse)
def edit_msg(
    message_id: int,
    request,
    body: EditMessageRequest,
    conversation_id: int = Query(...),
    db: Session = Depends(get_db),
):
    """Inline-replace user message content and soft-delete the tail.

    Soft-deleted rows are retained for audit (deleted_at IS NOT NULL).
    The SPA immediately triggers a new send after patching.
    """
    tenant_id = _tenant_id_from_request(request)
    user_id   = _user_id_from_request(request)

    # Ownership check via conversation.
    if get_conversation(db, conversation_id, tenant_id, user_id) is None:
        raise HTTPException(status_code=403, detail="not authorised")

    updated = edit_message(db, message_id, conversation_id, body.content)
    if updated is None:
        raise HTTPException(status_code=404, detail="message not found")
    return _msg_to_response(updated)


@router.post("/messages/{message_id}/regenerate")
def regenerate_msg(
    message_id: int,
    request,
    conversation_id: int = Query(...),
    db: Session = Depends(get_db),
):
    """Soft-delete the current assistant reply and stream a new one using the
    same preceding context and the same model as the conversation.

    SSE event shape is identical to POST /conversations/:id/messages.
    """
    tenant_id = _tenant_id_from_request(request)
    user_id   = _user_id_from_request(request)

    result = get_conversation(db, conversation_id, tenant_id, user_id)
    if result is None:
        raise HTTPException(status_code=403, detail="not authorised")
    conv, messages = result

    # Find the message to regenerate (must be 'assistant').
    target = next((m for m in messages if m["id"] == message_id), None)
    if target is None or target["role"] != "assistant":
        raise HTTPException(status_code=404, detail="assistant message not found")

    # Soft-delete the current assistant reply.
    soft_delete_message(db, message_id)

    # Rebuild history up to (but not including) the target message.
    history_msgs = [m for m in messages if m["id"] < message_id]
    # The last user message is the question to re-ask.
    user_turns = [m for m in history_msgs if m["role"] == "user"]
    if not user_turns:
        raise HTTPException(status_code=400, detail="no preceding user message to regenerate from")
    question = user_turns[-1]["content"]
    history = [{"role": m["role"], "content": m["content"]} for m in history_msgs[:-1][-6:]]

    model = conv.get("model_used") or CHAT_MODEL
    start = time.monotonic()

    def event_gen() -> Iterator[str]:
        collected: list[str] = []
        final_citations: list[dict] = []
        has_evidence_flag: Optional[bool] = None
        needs_verif_flag = False

        try:
            for evt in rag_answer_stream(
                question,
                tenant_id=tenant_id,
                history=history,
            ):
                if evt.get("type") == "citations":
                    final_citations = evt.get("items", [])
                elif evt.get("type") == "token":
                    collected.append(evt.get("text", ""))
                elif evt.get("type") == "no_evidence":
                    has_evidence_flag = False
                elif evt.get("type") == "done":
                    has_evidence_flag = evt.get("has_evidence", True)
                    needs_verif_flag = bool(evt.get("needs_verification", False))

                yield f"data: {json.dumps(evt, ensure_ascii=False)}\n\n"

        except Exception as exc:  # noqa: BLE001
            log.exception("docbrain_v2 regenerate stream error: %s", exc)
            yield f"data: {json.dumps({'type':'error','message':str(exc)[:200]})}\n\n"

        finally:
            answer = "".join(collected)
            if answer or has_evidence_flag is False:
                try:
                    create_message(
                        db,
                        conversation_id,
                        "assistant",
                        answer,
                        citations=final_citations,
                        has_evidence=has_evidence_flag,
                        needs_verification=needs_verif_flag,
                    )
                except Exception as exc2:  # noqa: BLE001
                    log.error("Failed to persist regenerated assistant message: %s", exc2)

            latency_ms = int((time.monotonic() - start) * 1000)
            log.info(
                '{"op":"docbrain_regenerate","conversation_id":%s,"latency_ms":%s,'
                '"model":%s,"has_evidence":%s}',
                conversation_id, latency_ms,
                json.dumps(model), json.dumps(has_evidence_flag),
            )

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering": "no",
            "Connection":       "keep-alive",
        },
    )


@router.post("/conversations/{conversation_id}/pin", response_model=ConversationResponse)
def pin_convo(
    conversation_id: int,
    request,
    body: PinRequest,
    db: Session = Depends(get_db),
):
    tenant_id = _tenant_id_from_request(request)
    user_id   = _user_id_from_request(request)
    ok = pin_conversation(db, conversation_id, user_id, body.pinned)
    if not ok:
        raise HTTPException(status_code=404, detail="conversation not found")
    result = get_conversation(db, conversation_id, tenant_id, user_id)
    if result is None:
        raise HTTPException(status_code=404, detail="conversation not found")
    conv, msgs = result
    return _conv_to_response(conv, len(msgs))


@router.post("/conversations/{conversation_id}/folder", response_model=ConversationResponse)
def folder_convo(
    conversation_id: int,
    request,
    body: FolderRequest,
    db: Session = Depends(get_db),
):
    tenant_id = _tenant_id_from_request(request)
    user_id   = _user_id_from_request(request)
    ok = set_folder(db, conversation_id, tenant_id, user_id, body.folder)
    if not ok:
        raise HTTPException(status_code=404, detail="conversation not found")
    result = get_conversation(db, conversation_id, tenant_id, user_id)
    if result is None:
        raise HTTPException(status_code=404, detail="conversation not found")
    conv, msgs = result
    return _conv_to_response(conv, len(msgs))
