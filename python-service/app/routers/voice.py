from typing import Optional
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.auth import current_principal, Principal
from ..services.voice import enroll, verify

router = APIRouter(prefix="/api/v1/voice", tags=["voice-biometrics"])


@router.post("/enroll")
async def enroll_voice(sample: UploadFile = File(...),
                       customer_cid: Optional[str] = Form(None),
                       db: Session = Depends(get_db),
                       p: Principal = Depends(current_principal)):
    wav = await sample.read()
    return enroll(db, p.sub, customer_cid, wav)


@router.post("/verify")
async def verify_voice(sample: UploadFile = File(...),
                       threshold: float = Form(0.78),
                       db: Session = Depends(get_db),
                       p: Principal = Depends(current_principal)):
    wav = await sample.read()
    return verify(db, p.sub, wav, threshold)
