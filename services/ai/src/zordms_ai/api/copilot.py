"""POST /idp/copilot/ask — RAG-powered chat copilot endpoint.

Request body (JSON):
  {
    "question": "Which documents are expiring this month?",
    "history":  [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]
  }

Response (JSON):
  {
    "answer":   "...",
    "citations": [{"doc_id": "...", "title": "...", "snippet": "..."}],
    "intent":   "search" | "summarize" | "navigate" | "qa",
    "model":    "grounded-extractive-fallback" | "anthropic/..." | "openai/..."
  }

Auth: Bearer JWT required (same as all /idp/* routes).
"""
from __future__ import annotations

import os
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from zordms_ai.auth import require_auth
from zordms_ai.copilot.intent import detect_intent
from zordms_ai.copilot.llm_client import generate_answer
from zordms_ai.copilot.search_client import retrieve

copilot_router = APIRouter(
    prefix="/idp/copilot",
    dependencies=[Depends(require_auth)],
    tags=["copilot"],
)


# ─────────────────── Request / Response models ────────────────────────────────

class ChatTurn(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class AskRequest(BaseModel):
    question: Annotated[str, Field(min_length=1, max_length=4096)]
    history: list[ChatTurn] = Field(default_factory=list)


class Citation(BaseModel):
    doc_id: str
    title: str
    snippet: str


class AskResponse(BaseModel):
    answer: str
    citations: list[Citation]
    intent: str
    model: str


# ─────────────────── Endpoint ─────────────────────────────────────────────────

@copilot_router.post("/ask", response_model=AskResponse)
async def copilot_ask(body: AskRequest, request: Request) -> AskResponse:
    """RAG copilot: retrieve relevant docs, generate a grounded answer."""
    settings = request.app.state.settings

    # 1. Intent detection
    intent = detect_intent(body.question)

    # 2. Extract caller's Bearer token to pass through to the search service
    auth_header: str | None = request.headers.get("Authorization")
    auth_token: str | None = None
    if auth_header and auth_header.lower().startswith("bearer "):
        auth_token = auth_header[7:]

    # 3. Retrieve grounding context from the search service
    search_url: str = (
        getattr(settings, "search_url", None)
        or os.environ.get("SEARCH_URL", "http://localhost:4004")
    )
    search_result = await retrieve(
        body.question,
        search_url=search_url,
        auth_token=auth_token,
        limit=5,
    )

    # 4. Generate LLM answer (with graceful degradation)
    history_dicts = [{"role": t.role, "content": t.content} for t in body.history]
    answer, model_label = await generate_answer(
        question=body.question,
        history=history_dicts,
        hits=search_result.hits,
        degraded=search_result.degraded,
        settings=settings,
    )

    # 5. Build citations from retrieved hits
    citations = [
        Citation(doc_id=h.doc_id, title=h.title, snippet=h.snippet[:300])
        for h in search_result.hits
    ]

    return AskResponse(
        answer=answer,
        citations=citations,
        intent=intent,
        model=model_label,
    )
