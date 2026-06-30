from __future__ import annotations

from datetime import date

from pydantic import Field

from zordms_ai.schemas.base import ExtractionBase


class GenericDocument(ExtractionBase):
    """Fallback schema for any classified doc_type without a bespoke schema.

    Captures the common header metadata most business documents share plus a
    free-form `fields` map, so a document still yields useful metadata instead
    of a hard "no extraction schema" error. The extractor sets doc_type to the
    real classified type and flags the result for review (generic extraction is
    lower-trust than a typed schema).
    """

    doc_type: str = "GENERIC"
    title: str | None = Field(default=None, max_length=200)
    ref_no: str | None = Field(default=None, max_length=80, description="Document / reference number")
    document_date: date | None = None
    issuer: str | None = Field(default=None, max_length=160)
    subject: str | None = Field(default=None, max_length=300)
    summary: str | None = Field(default=None, max_length=2000)
    # Catch-all for anything else the model reads off the page.
    fields: dict[str, str] = Field(default_factory=dict)
