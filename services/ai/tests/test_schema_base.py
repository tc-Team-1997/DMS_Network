from datetime import date, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from zordms_ai.schemas.base import (
    ExtractionBase,
    SourceChannel,
    SystemMetadata,
    iso_date,
)


def test_iso_date_parses_string():
    assert iso_date("2026-06-23") == date(2026, 6, 23)


def test_iso_date_rejects_garbage():
    with pytest.raises(ValueError):
        iso_date("23/06/2026")


def test_review_flag_true_below_085():
    out = ExtractionBase(doc_type="BT_CID_4G", confidence=0.80)
    assert out.review_flag is True


def test_review_flag_false_at_or_above_085():
    out = ExtractionBase(doc_type="BT_CID_4G", confidence=0.92)
    assert out.review_flag is False


def test_confidence_out_of_range_rejected():
    with pytest.raises(ValidationError):
        ExtractionBase(doc_type="X", confidence=1.5)


def test_system_metadata_roundtrip():
    meta = SystemMetadata(
        doc_id=uuid4(),
        file_hash_sha256="a" * 64,
        ingest_timestamp=datetime(2026, 6, 23, 10, 0, 0),
        source_channel=SourceChannel.UPLOAD,
        ingest_user_id="STAFF42",
        raw_file_path="minio://bob/raw/x.png",
        page_count=1,
        file_size_bytes=12345,
        ocr_engine="vLLM Qwen",
        processing_ms=4200,
        retention_years=7,
        destruction_date=date(2033, 6, 23),
    )
    assert meta.source_channel == SourceChannel.UPLOAD
    assert meta.page_count == 1
