from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from zordms_ai.auth import require_auth
from zordms_ai.translate.translator import SUPPORTED, translate

# §5.8 Translation — Dzongkha ↔ English (auth required).
translate_router = APIRouter(prefix="/idp", dependencies=[Depends(require_auth)])


class TranslateRequest(BaseModel):
    text: str = Field(..., examples=["Kingdom of Bhutan"])
    target: str = Field("en", description="Target language code (en | dzo).")
    source: Optional[str] = Field(None, description="Optional source language code.")


@translate_router.post("/translate")
async def translate_endpoint(body: TranslateRequest, request: Request) -> dict:
    if body.target.lower() not in SUPPORTED:
        raise HTTPException(status_code=400, detail=f"unsupported target language: {body.target}")
    return await translate(body.text, body.target, body.source, settings=request.app.state.settings)
