from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel


class DocumentOut(BaseModel):
    id: int
    filename: str
    original_name: str
    mime_type: Optional[str]
    size_bytes: Optional[int]
    sha256: Optional[str]
    phash: Optional[str]
    doc_type: Optional[str]
    customer_cid: Optional[str]
    branch: Optional[str]
    tenant: Optional[str] = "default"
    status: str
    issue_date: Optional[str]
    expiry_date: Optional[str]
    uploaded_by: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class DocumentUpdate(BaseModel):
    doc_type: Optional[str] = None
    customer_cid: Optional[str] = None
    branch: Optional[str] = None
    issue_date: Optional[str] = None
    expiry_date: Optional[str] = None
    status: Optional[str] = None


class OcrOut(BaseModel):
    document_id: int
    text: str
    confidence: float
    fields: dict

    class Config:
        from_attributes = True


class WorkflowActionIn(BaseModel):
    stage: str
    action: str  # approve | reject | escalate | submit
    actor: str
    comment: Optional[str] = None


class WorkflowStepOut(BaseModel):
    id: int
    stage: str
    actor: str
    action: str
    comment: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class DuplicateOut(BaseModel):
    doc_a: int
    doc_b: int
    similarity: float
    match_type: str

    class Config:
        from_attributes = True


class IntegrationCallIn(BaseModel):
    system: str  # cbs | los | aml | ifrs9
    endpoint: str
    method: str = "POST"
    payload: dict = {}
