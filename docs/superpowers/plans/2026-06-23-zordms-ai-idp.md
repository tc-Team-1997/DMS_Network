# AI / IDP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the ZorDMS AI/IDP service (`services/ai`) — a Python 3.11 FastAPI two-stage Intelligent Document Processing pipeline (Granite 3.2 Vision 2B classifier → Qwen2.5-VL 7B extractor served by vLLM) that classifies Bank of Bhutan document types, extracts Pydantic-validated constrained-JSON metadata, routes by confidence band into a human-review queue, and hands a typed catalog payload off to Core DMS — fully air-gap-deployable on NVIDIA L40S GPUs.

**Architecture:** A single FastAPI app (app factory `create_app`) backed by SQLAlchemy 2.0 with a `DATABASE_URL` dialect switch (`postgresql+psycopg://` ⇄ `oracle+oracledb://`). Inference goes through one OpenAI-compatible vLLM HTTP client wrapper (`/v1/chat/completions`) with token-level constrained-JSON decoding; in tests this client is mocked so no GPU or network is required — tests assert on prompt construction and parsing of a canned model response. Document types live in a data-driven registry with regex/keyword classification signals and an MRZ/ID pre-screen that proposes a type before the VLM runs. A pure-function confidence router maps the classifier score to an action + review-queue + SLA. Constrained-output is validated by Pydantic v2 models per Bhutan doc type. Tesseract (pytesseract) is a fallback OCR engine only; preprocessing (pdf2image/Pillow) is mocked in tests.

**Tech Stack:** Python 3.11, FastAPI, Uvicorn, Pydantic v2, SQLAlchemy 2.0 + Alembic, `httpx` (vLLM OpenAI-compatible client), `pytest` + `pytest-asyncio` + `respx` (HTTP mocking), `pytesseract`/`pdf2image`/`Pillow` (mocked in tests), `uv` + `pyproject.toml`. React 18 + Vite + TypeScript for the AI Engine + Human-Review screens in `apps/web`.

## Global Constraints

- **Service path & stack** — all Python code lives under `services/ai/`; Python 3.11, FastAPI, Pydantic **v2**, SQLAlchemy **2.0**, packaged with `pyproject.toml` + `uv`. Tests with `pytest`.
- **DB switch** — persistence uses SQLAlchemy with `DATABASE_URL`: PostgreSQL `postgresql+psycopg://…` ⇄ Oracle 19c `oracle+oracledb://…`. No dialect-specific SQL in models; tests run against `sqlite+pysqlite:///:memory:`.
- **No GPU, no network in tests** — the vLLM HTTP client is **always mocked** in tests (via `respx` or a fake transport). Tests assert prompt construction + parsing of a canned model response. Preprocessing (pdf2image/Pillow) and pytesseract are mocked too.
- **Constrained JSON** — every model output is validated by a Pydantic v2 model; field types, mandatory checks, regex, ISO-8601 dates, and ENUMs are enforced; `review_flag = true` whenever `confidence < 0.85` (IDP §3.2.1).
- **Inference stack** — production = vLLM (OpenAI-compatible `/v1/...`) on NVIDIA L40S, air-gapped (offline HuggingFace bundle, offline Harbor registry, RKE2, NFS PVC). A CPU/degraded mode must be selectable via env for pre-GPU validation (IDP §7.1, arch §10).
- **Performance targets (IDP §7.3)** — Classifier P95 ≤ 700 ms/page; Extractor P95 ≤ 5 s/page; end-to-end IDP P95 ≤ 8 s/page; batch ≥ 600 pages/hr; classifier accuracy (CID) ≥ 95%; extractor field accuracy ≥ 90%; human-review rate ≤ 8%. These are SLOs the code must not contradict (e.g. request timeouts derive from them).
- **Models** — Stage-1 = Granite 3.2 Vision 2B (INT4/AWQ via vLLM); Stage-2 = Qwen2.5-VL 7B (Q4/GPTQ via vLLM). Model **names** are config-driven (`CLASSIFIER_MODEL`, `EXTRACTOR_MODEL`) so CPU-degraded substitutes can be swapped without code change.
- **Conventional commits**; commit after every passing step. End every commit message with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

```
services/ai/
  pyproject.toml                     # uv project, deps, pytest + ruff config
  README.md                          # service overview + run/deploy notes
  Dockerfile                         # air-gapped image (vLLM + FastAPI), CPU-degraded build arg
  alembic.ini                        # Alembic config (DATABASE_URL driven)
  .env.example                       # DATABASE_URL, VLLM_BASE_URL, model names, INFERENCE_MODE
  src/zordms_ai/
    __init__.py
    settings.py                      # pydantic-settings: DATABASE_URL, vLLM, models, mode
    app.py                           # create_app() factory + /health
    db.py                            # SQLAlchemy engine/session factory (DATABASE_URL switch)
    schemas/
      __init__.py
      base.py                       # SystemMetadata + common validators (ISO date, confidence)
      cid.py                        # BTCid4G constrained-output model (IDP §3.2.1)
      passport.py                   # BTPassport model (IDP §3.2.2)
      loan.py                       # BOBLoanApplication model (IDP §3.2.3)
      registry.py                   # doc_type code -> Pydantic model map
    classify/
      __init__.py
      doctype_registry.py           # DocTypeSignal registry + signal data (IDP §6.2/§6.3)
      prescreen.py                  # MRZ/ID-regex pre-screen -> proposed type + signals
      classifier.py                 # Stage-1: build prompt + call vLLM -> ClassifyResult
    extract/
      __init__.py
      extractor.py                  # Stage-2: build prompt + call vLLM -> typed object
    routing/
      __init__.py
      confidence.py                 # pure confidence-band router (IDP §6.4)
    inference/
      __init__.py
      vllm_client.py                # OpenAI-compatible vLLM wrapper (constrained decoding)
    review/
      __init__.py
      models.py                     # ReviewItem SQLAlchemy model
      service.py                    # list/claim/resolve queue logic
    pipeline/
      __init__.py
      preprocess.py                 # pdf2image/Pillow -> page PNG bytes (mocked in tests)
      orchestrator.py               # preprocess->classify->route->extract + catalog hand-off
    ocr/
      __init__.py
      tesseract.py                  # pytesseract fallback OCR (mocked in tests)
    api/
      __init__.py
      idp.py                        # /idp/classify, /idp/extract, /idp/process
      review.py                     # /idp/review/* endpoints
      ocr.py                        # /ocr fallback endpoint
    migrations/
      env.py                        # Alembic env (imports Base.metadata)
      versions/
        0001_review_queue.py        # review_items table migration
  tests/
    conftest.py                      # fixtures: app client, in-memory DB, fake vLLM
    test_health.py
    test_schema_cid.py
    test_schema_passport.py
    test_schema_loan.py
    test_doctype_registry.py
    test_prescreen.py
    test_vllm_client.py
    test_classifier.py
    test_confidence.py
    test_extractor.py
    test_review_service.py
    test_orchestrator.py
    test_api_idp.py
    test_api_review.py
    test_ocr.py

apps/web/src/
  api/aiClient.ts                    # typed fetch wrappers for /idp/* + /idp/review/*
  pages/AiEngine.tsx                 # AI Engine screen (upload -> classify/extract result)
  pages/ReviewQueue.tsx             # Human-Review queue (confidence bands, claim/resolve)
  components/ConfidenceBadge.tsx     # confidence-band pill
  pages/AiEngine.test.tsx
  pages/ReviewQueue.test.tsx
```

---

## Task 1: `services/ai` scaffold — FastAPI app factory + `/health` + settings + pytest

**Files:**
- Create: `services/ai/pyproject.toml`, `services/ai/.env.example`, `services/ai/src/zordms_ai/__init__.py`, `services/ai/src/zordms_ai/settings.py`, `services/ai/src/zordms_ai/app.py`
- Test: `services/ai/tests/__init__.py`, `services/ai/tests/conftest.py`, `services/ai/tests/test_health.py`

**Interfaces:**
- Produces:
  - `Settings` (pydantic-settings) with fields: `database_url: str`, `vllm_base_url: str`, `vllm_api_key: str`, `classifier_model: str`, `extractor_model: str`, `inference_mode: Literal["gpu","cpu_degraded"]`, `request_timeout_s: float`, `review_low_conf_threshold: float = 0.85`.
  - `get_settings() -> Settings` (cached).
  - `create_app(settings: Settings | None = None) -> FastAPI` — pure factory; mounts `GET /health` → `{"status":"ok","service":"ai-idp","mode":<inference_mode>}`.
  - pytest fixture `client` (a `TestClient`) in `conftest.py`.

- [ ] **Step 1: Create `services/ai/pyproject.toml`**

```toml
[project]
name = "zordms-ai"
version = "0.1.0"
description = "ZorDMS AI / IDP service (two-stage VLM document processing)"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.111",
    "uvicorn[standard]>=0.30",
    "pydantic>=2.7",
    "pydantic-settings>=2.3",
    "sqlalchemy>=2.0",
    "alembic>=1.13",
    "httpx>=0.27",
    "python-multipart>=0.0.9",
    "psycopg[binary]>=3.1",
    "oracledb>=2.2",
    "pytesseract>=0.3.10",
    "pdf2image>=1.17",
    "pillow>=10.3",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.2",
    "pytest-asyncio>=0.23",
    "respx>=0.21",
    "ruff>=0.5",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/zordms_ai"]

[tool.pytest.ini_options]
pythonpath = ["src"]
testpaths = ["tests"]
asyncio_mode = "auto"

[tool.ruff]
line-length = 100
src = ["src", "tests"]
```

- [ ] **Step 2: Create `services/ai/.env.example`**

```bash
# SQLAlchemy DATABASE_URL switch (one of):
DATABASE_URL=postgresql+psycopg://zordms:zordms@localhost:5432/zordms
# DATABASE_URL=oracle+oracledb://zordms:zordms@localhost:1521/?service_name=ORCLPDB1

# vLLM OpenAI-compatible endpoint
VLLM_BASE_URL=http://vllm:8000/v1
VLLM_API_KEY=EMPTY
CLASSIFIER_MODEL=granite-3.2-vision-2b
EXTRACTOR_MODEL=qwen2.5-vl-7b

# gpu | cpu_degraded  (cpu_degraded validates the pipeline before GPU nodes land)
INFERENCE_MODE=gpu
REQUEST_TIMEOUT_S=8.0
REVIEW_LOW_CONF_THRESHOLD=0.85
```

- [ ] **Step 3: Write the failing test**

`services/ai/tests/__init__.py`: (empty file)

`services/ai/tests/conftest.py`:
```python
import pytest
from fastapi.testclient import TestClient

from zordms_ai.app import create_app
from zordms_ai.settings import Settings


@pytest.fixture
def settings() -> Settings:
    return Settings(
        database_url="sqlite+pysqlite:///:memory:",
        vllm_base_url="http://vllm.test/v1",
        vllm_api_key="EMPTY",
        classifier_model="granite-3.2-vision-2b",
        extractor_model="qwen2.5-vl-7b",
        inference_mode="cpu_degraded",
    )


@pytest.fixture
def client(settings: Settings) -> TestClient:
    return TestClient(create_app(settings))
```

`services/ai/tests/test_health.py`:
```python
def test_health_returns_ok(client):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["service"] == "ai-idp"
    assert body["mode"] == "cpu_degraded"
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd services/ai && uv run pytest tests/test_health.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'zordms_ai'`.

- [ ] **Step 5: Write `settings.py`**

`services/ai/src/zordms_ai/__init__.py`: (empty file)

`services/ai/src/zordms_ai/settings.py`:
```python
from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite+pysqlite:///:memory:"
    vllm_base_url: str = "http://vllm:8000/v1"
    vllm_api_key: str = "EMPTY"
    classifier_model: str = "granite-3.2-vision-2b"
    extractor_model: str = "qwen2.5-vl-7b"
    inference_mode: Literal["gpu", "cpu_degraded"] = "gpu"
    request_timeout_s: float = 8.0
    review_low_conf_threshold: float = 0.85


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 6: Write `app.py`**

`services/ai/src/zordms_ai/app.py`:
```python
from fastapi import FastAPI

from zordms_ai.settings import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="ZorDMS AI / IDP", version="0.1.0")
    app.state.settings = settings

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "ai-idp", "mode": settings.inference_mode}

    return app
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd services/ai && uv run pytest tests/test_health.py -v`
Expected: PASS (1 test).

- [ ] **Step 8: Commit**

```bash
git add services/ai/pyproject.toml services/ai/.env.example services/ai/src/zordms_ai/__init__.py services/ai/src/zordms_ai/settings.py services/ai/src/zordms_ai/app.py services/ai/tests/__init__.py services/ai/tests/conftest.py services/ai/tests/test_health.py
git commit -m "feat(ai): scaffold FastAPI app factory, settings, health, pytest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Constrained-output schemas — base + system metadata + shared validators

**Files:**
- Create: `services/ai/src/zordms_ai/schemas/__init__.py`, `services/ai/src/zordms_ai/schemas/base.py`
- Test: `services/ai/tests/test_schema_base.py`

**Interfaces:**
- Produces:
  - `Sex` (str Enum: `M`, `F`, `O`), `SourceChannel` (str Enum: `SCAN`, `UPLOAD`, `EMAIL`, `BaNCS_FEED`).
  - `iso_date(value) -> date` validator helper (accepts ISO-8601 string or `date`; raises `ValueError` otherwise).
  - `ExtractionBase(BaseModel)` — base for all extractor outputs: `doc_type: str`, `confidence: float` (0.0–1.0), `review_flag: bool` (computed `True` when `confidence < 0.85`). Uses `model_validator(mode="after")` to set `review_flag`.
  - `SystemMetadata(BaseModel)` (IDP §3.3): `doc_id: UUID`, `file_hash_sha256: str`, `ingest_timestamp: datetime`, `source_channel: SourceChannel`, `ingest_user_id: str`, `raw_file_path: str`, `page_count: int`, `file_size_bytes: int`, `ocr_engine: str`, `processing_ms: int`, `retention_years: int`, `destruction_date: date`.

- [ ] **Step 1: Write the failing test**

`services/ai/tests/test_schema_base.py`:
```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/ai && uv run pytest tests/test_schema_base.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'zordms_ai.schemas'`.

- [ ] **Step 3: Write the schemas**

`services/ai/src/zordms_ai/schemas/__init__.py`: (empty file)

`services/ai/src/zordms_ai/schemas/base.py`:
```python
from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

REVIEW_THRESHOLD = 0.85


class Sex(str, Enum):
    M = "M"
    F = "F"
    O = "O"


class SourceChannel(str, Enum):
    SCAN = "SCAN"
    UPLOAD = "UPLOAD"
    EMAIL = "EMAIL"
    BaNCS_FEED = "BaNCS_FEED"


def iso_date(value: str | date) -> date:
    """Parse an ISO-8601 date string (or pass through a date). Raises ValueError."""
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        return date.fromisoformat(value)  # raises ValueError on bad format
    raise ValueError(f"not an ISO-8601 date: {value!r}")


class ExtractionBase(BaseModel):
    doc_type: str
    confidence: float = Field(ge=0.0, le=1.0)
    review_flag: bool = False

    @model_validator(mode="after")
    def _set_review_flag(self) -> "ExtractionBase":
        object.__setattr__(self, "review_flag", self.confidence < REVIEW_THRESHOLD)
        return self


class SystemMetadata(BaseModel):
    doc_id: UUID
    file_hash_sha256: str = Field(pattern=r"^[0-9a-fA-F]{64}$")
    ingest_timestamp: datetime
    source_channel: SourceChannel
    ingest_user_id: str
    raw_file_path: str
    page_count: int = Field(ge=1)
    file_size_bytes: int = Field(ge=0)
    ocr_engine: str
    processing_ms: int = Field(ge=0)
    retention_years: int = Field(ge=0)
    destruction_date: date
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/ai && uv run pytest tests/test_schema_base.py -v`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add services/ai/src/zordms_ai/schemas/__init__.py services/ai/src/zordms_ai/schemas/base.py services/ai/tests/test_schema_base.py
git commit -m "feat(ai): base extraction schema + system metadata + ISO-date validator

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: BT_CID_4G constrained-output schema + validation rules

**Files:**
- Create: `services/ai/src/zordms_ai/schemas/cid.py`
- Test: `services/ai/tests/test_schema_cid.py`

**Interfaces:**
- Consumes: `ExtractionBase`, `Sex`, `iso_date` from `schemas.base`.
- Produces:
  - `Dzongkhag` (str Enum of the 20 Bhutan districts).
  - `BTCid4G(ExtractionBase)` with fields per IDP §3.2.1: `doc_type` fixed to `"BT_CID_4G"`, `cid_no` (`^[0-9]{11}$`), `full_name` (non-empty), `dob` (date, age 0–120), `sex` (Sex | None), `issue_date` (date ≤ today), `expiry_date` (date > issue_date), `dzongkhag` (Dzongkhag), `village` (str ≤ 100 | None), `mrz_line1` (str | None), `mrz_line2` (str | None). Cross-field validator enforces `expiry_date > issue_date` and `issue_date <= today`.

- [ ] **Step 1: Write the failing test**

`services/ai/tests/test_schema_cid.py`:
```python
from datetime import date

import pytest
from pydantic import ValidationError

from zordms_ai.schemas.cid import BTCid4G


def _valid() -> dict:
    return {
        "doc_type": "BT_CID_4G",
        "cid_no": "10112345678",
        "full_name": "Sonam Wangchuk",
        "dob": "1990-04-12",
        "sex": "M",
        "issue_date": "2025-01-01",
        "expiry_date": "2035-01-01",
        "dzongkhag": "Thimphu",
        "confidence": 0.95,
    }


def test_accepts_valid_cid():
    cid = BTCid4G(**_valid())
    assert cid.cid_no == "10112345678"
    assert cid.dob == date(1990, 4, 12)
    assert cid.review_flag is False


def test_rejects_cid_with_wrong_digit_count():
    bad = _valid() | {"cid_no": "123"}
    with pytest.raises(ValidationError):
        BTCid4G(**bad)


def test_rejects_expiry_before_issue():
    bad = _valid() | {"issue_date": "2030-01-01", "expiry_date": "2029-01-01"}
    with pytest.raises(ValidationError):
        BTCid4G(**bad)


def test_rejects_unknown_dzongkhag():
    bad = _valid() | {"dzongkhag": "Atlantis"}
    with pytest.raises(ValidationError):
        BTCid4G(**bad)


def test_rejects_future_issue_date():
    bad = _valid() | {"issue_date": "2999-01-01", "expiry_date": "3000-01-01"}
    with pytest.raises(ValidationError):
        BTCid4G(**bad)


def test_low_confidence_sets_review_flag():
    cid = BTCid4G(**(_valid() | {"confidence": 0.7}))
    assert cid.review_flag is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/ai && uv run pytest tests/test_schema_cid.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'zordms_ai.schemas.cid'`.

- [ ] **Step 3: Write `cid.py`**

`services/ai/src/zordms_ai/schemas/cid.py`:
```python
from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Literal

from pydantic import Field, field_validator, model_validator

from zordms_ai.schemas.base import ExtractionBase, Sex


class Dzongkhag(str, Enum):
    Bumthang = "Bumthang"
    Chukha = "Chukha"
    Dagana = "Dagana"
    Gasa = "Gasa"
    Haa = "Haa"
    Lhuntse = "Lhuntse"
    Mongar = "Mongar"
    Paro = "Paro"
    PemaGatshel = "Pema Gatshel"
    Punakha = "Punakha"
    SamdrupJongkhar = "Samdrup Jongkhar"
    Samtse = "Samtse"
    Sarpang = "Sarpang"
    Thimphu = "Thimphu"
    Trashigang = "Trashigang"
    TrashiYangtse = "Trashi Yangtse"
    Trongsa = "Trongsa"
    Tsirang = "Tsirang"
    WangduePhodrang = "Wangdue Phodrang"
    Zhemgang = "Zhemgang"


class BTCid4G(ExtractionBase):
    doc_type: Literal["BT_CID_4G"] = "BT_CID_4G"
    cid_no: str = Field(pattern=r"^[0-9]{11}$")
    full_name: str = Field(min_length=1)
    dob: date
    sex: Sex | None = None
    issue_date: date
    expiry_date: date
    dzongkhag: Dzongkhag
    village: str | None = Field(default=None, max_length=100)
    mrz_line1: str | None = None
    mrz_line2: str | None = None

    @field_validator("dob")
    @classmethod
    def _dob_age_band(cls, v: date) -> date:
        age = (date.today() - v).days / 365.25
        if not (0 <= age <= 120):
            raise ValueError("dob age out of range 0-120")
        return v

    @model_validator(mode="after")
    def _date_rules(self) -> "BTCid4G":
        if self.issue_date > date.today():
            raise ValueError("issue_date must be <= today")
        if self.expiry_date <= self.issue_date:
            raise ValueError("expiry_date must be after issue_date")
        return self
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/ai && uv run pytest tests/test_schema_cid.py -v`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add services/ai/src/zordms_ai/schemas/cid.py services/ai/tests/test_schema_cid.py
git commit -m "feat(ai): BT_CID_4G constrained-output schema with validation rules

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: BT_PASSPORT + BOB_LOAN_APPLICATION schemas + registry

**Files:**
- Create: `services/ai/src/zordms_ai/schemas/passport.py`, `services/ai/src/zordms_ai/schemas/loan.py`, `services/ai/src/zordms_ai/schemas/registry.py`
- Test: `services/ai/tests/test_schema_passport.py`, `services/ai/tests/test_schema_loan.py`

**Interfaces:**
- Consumes: `ExtractionBase`, `Sex` from `schemas.base`.
- Produces:
  - `BTPassport(ExtractionBase)` (IDP §3.2.2): `doc_type` Literal `"BT_PASSPORT"`, `passport_no` (`^[A-Z][0-9]{7}$`), `surname` (non-empty), `given_names` (non-empty), `nationality` (str, default `"BTN"`), `dob` (date), `sex` (Sex | None), `place_of_birth` (str | None), `issue_date` (date), `expiry_date` (date), `mrz_line1` (str | None — `P<BTN` prefix when present), `mrz_line2` (str | None).
  - `LoanType` (str Enum: `HOME`, `AUTO`, `AGRI`, `BUSINESS`, `PERSONAL`).
  - `BOBLoanApplication(ExtractionBase)` (IDP §3.2.3): `doc_type` Literal `"BOB_LOAN_APPLICATION"`, `application_no` (non-empty), `applicant_cid` (`^[0-9]{11}$`), `applicant_name` (non-empty), `loan_type` (LoanType), `loan_amount` (float ≥ 0), `branch_code` (non-empty), `submission_date` (date), `officer_id` (str | None).
  - `DOC_SCHEMAS: dict[str, type[ExtractionBase]]` mapping `"BT_CID_4G" -> BTCid4G`, `"BT_PASSPORT" -> BTPassport`, `"BOB_LOAN_APPLICATION" -> BOBLoanApplication`.
  - `schema_for(doc_type: str) -> type[ExtractionBase]` (raises `KeyError` for unknown).

- [ ] **Step 1: Write the failing tests**

`services/ai/tests/test_schema_passport.py`:
```python
import pytest
from pydantic import ValidationError

from zordms_ai.schemas.passport import BTPassport


def _valid() -> dict:
    return {
        "doc_type": "BT_PASSPORT",
        "passport_no": "A1234567",
        "surname": "Dorji",
        "given_names": "Karma",
        "nationality": "BTN",
        "dob": "1985-09-01",
        "issue_date": "2024-01-01",
        "expiry_date": "2034-01-01",
        "mrz_line1": "P<BTNDORJI<<KARMA<<<<<<<<<<<<<<<<<<<<<<<<<<<",
        "confidence": 0.93,
    }


def test_accepts_valid_passport():
    p = BTPassport(**_valid())
    assert p.passport_no == "A1234567"
    assert p.review_flag is False


def test_rejects_bad_passport_no():
    with pytest.raises(ValidationError):
        BTPassport(**(_valid() | {"passport_no": "1234567A"}))


def test_defaults_nationality_btn():
    data = _valid()
    del data["nationality"]
    assert BTPassport(**data).nationality == "BTN"
```

`services/ai/tests/test_schema_loan.py`:
```python
import pytest
from pydantic import ValidationError

from zordms_ai.schemas.loan import BOBLoanApplication
from zordms_ai.schemas.registry import DOC_SCHEMAS, schema_for


def _valid() -> dict:
    return {
        "doc_type": "BOB_LOAN_APPLICATION",
        "application_no": "LN2026001",
        "applicant_cid": "10112345678",
        "applicant_name": "Tashi Pem",
        "loan_type": "HOME",
        "loan_amount": 2500000.0,
        "branch_code": "THI001",
        "submission_date": "2026-06-01",
        "confidence": 0.90,
    }


def test_accepts_valid_loan():
    loan = BOBLoanApplication(**_valid())
    assert loan.loan_type.value == "HOME"


def test_rejects_unknown_loan_type():
    with pytest.raises(ValidationError):
        BOBLoanApplication(**(_valid() | {"loan_type": "BOAT"}))


def test_registry_resolves_all_three_types():
    assert set(DOC_SCHEMAS) == {"BT_CID_4G", "BT_PASSPORT", "BOB_LOAN_APPLICATION"}
    assert schema_for("BOB_LOAN_APPLICATION") is BOBLoanApplication


def test_registry_raises_on_unknown():
    with pytest.raises(KeyError):
        schema_for("MARTIAN_VISA")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/ai && uv run pytest tests/test_schema_passport.py tests/test_schema_loan.py -v`
Expected: FAIL — modules `passport`, `loan`, `registry` not found.

- [ ] **Step 3: Write `passport.py`**

```python
from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import Field

from zordms_ai.schemas.base import ExtractionBase, Sex


class BTPassport(ExtractionBase):
    doc_type: Literal["BT_PASSPORT"] = "BT_PASSPORT"
    passport_no: str = Field(pattern=r"^[A-Z][0-9]{7}$")
    surname: str = Field(min_length=1)
    given_names: str = Field(min_length=1)
    nationality: str = "BTN"
    dob: date
    sex: Sex | None = None
    place_of_birth: str | None = None
    issue_date: date
    expiry_date: date
    mrz_line1: str | None = None
    mrz_line2: str | None = None
```

- [ ] **Step 4: Write `loan.py`**

```python
from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Literal

from pydantic import Field

from zordms_ai.schemas.base import ExtractionBase


class LoanType(str, Enum):
    HOME = "HOME"
    AUTO = "AUTO"
    AGRI = "AGRI"
    BUSINESS = "BUSINESS"
    PERSONAL = "PERSONAL"


class BOBLoanApplication(ExtractionBase):
    doc_type: Literal["BOB_LOAN_APPLICATION"] = "BOB_LOAN_APPLICATION"
    application_no: str = Field(min_length=1)
    applicant_cid: str = Field(pattern=r"^[0-9]{11}$")
    applicant_name: str = Field(min_length=1)
    loan_type: LoanType
    loan_amount: float = Field(ge=0)
    branch_code: str = Field(min_length=1)
    submission_date: date
    officer_id: str | None = None
```

- [ ] **Step 5: Write `registry.py`**

```python
from __future__ import annotations

from zordms_ai.schemas.base import ExtractionBase
from zordms_ai.schemas.cid import BTCid4G
from zordms_ai.schemas.loan import BOBLoanApplication
from zordms_ai.schemas.passport import BTPassport

DOC_SCHEMAS: dict[str, type[ExtractionBase]] = {
    "BT_CID_4G": BTCid4G,
    "BT_PASSPORT": BTPassport,
    "BOB_LOAN_APPLICATION": BOBLoanApplication,
}


def schema_for(doc_type: str) -> type[ExtractionBase]:
    return DOC_SCHEMAS[doc_type]
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd services/ai && uv run pytest tests/test_schema_passport.py tests/test_schema_loan.py -v`
Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add services/ai/src/zordms_ai/schemas/passport.py services/ai/src/zordms_ai/schemas/loan.py services/ai/src/zordms_ai/schemas/registry.py services/ai/tests/test_schema_passport.py services/ai/tests/test_schema_loan.py
git commit -m "feat(ai): passport + loan schemas and doc-type schema registry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Document-type registry + classification signals (IDP §6.2)

**Files:**
- Create: `services/ai/src/zordms_ai/classify/__init__.py`, `services/ai/src/zordms_ai/classify/doctype_registry.py`
- Test: `services/ai/tests/test_doctype_registry.py`

**Interfaces:**
- Produces:
  - `SignalType` (IntEnum, IDP §6.3 priority): `MRZ=1`, `ID_REGEX=2`, `LOGO=3`, `HEADER=4`, `LAYOUT=5`, `LANGUAGE=6`, `FALLBACK=7`.
  - `DocTypeEntry` (dataclass): `code: str`, `description: str`, `jurisdiction: str`, `issuer: str`, `regex_signals: list[tuple[SignalType, re.Pattern]]`, `keyword_signals: list[tuple[SignalType, str]]`.
  - `DOCTYPE_REGISTRY: dict[str, DocTypeEntry]` covering at minimum: `BT_CID_4G`, `BT_CITIZENSHIP`, `BT_PASSPORT`, `FOREIGN_PASSPORT`, `IN_PAN`, `IN_AADHAAR`, `BOB_ACCOUNT_FORM`, `BOB_LOAN_APPLICATION`, `BOB_INVOICE`, `PURCHASE_ORDER`, `SAR_REPORT`, `CTR`, `EMPLOYMENT_CONTRACT`, `BOARD_RESOLUTION`, `RMA_INSPECTION`, `RAA_AUDIT_REPORT`, `GENERAL_LETTER`, `UNKNOWN`.
  - `all_doc_type_codes() -> list[str]` (registry keys, used to constrain the classifier prompt).

- [ ] **Step 1: Write the failing test**

`services/ai/tests/test_doctype_registry.py`:
```python
import re

from zordms_ai.classify.doctype_registry import (
    DOCTYPE_REGISTRY,
    SignalType,
    all_doc_type_codes,
)


def test_registry_covers_core_bob_types():
    for code in ["BT_CID_4G", "BT_PASSPORT", "BOB_LOAN_APPLICATION", "IN_PAN", "UNKNOWN"]:
        assert code in DOCTYPE_REGISTRY


def test_passport_has_mrz_signal_with_highest_priority():
    entry = DOCTYPE_REGISTRY["BT_PASSPORT"]
    mrz = [p for (t, p) in entry.regex_signals if t == SignalType.MRZ]
    assert mrz, "expected an MRZ signal"
    assert mrz[0].search("P<BTNDORJI<<KARMA")


def test_pan_has_id_regex_signal():
    entry = DOCTYPE_REGISTRY["IN_PAN"]
    rx = [p for (t, p) in entry.regex_signals if t == SignalType.ID_REGEX]
    assert rx[0].search("ABCDE1234F")
    assert not rx[0].search("abcde1234f")


def test_signal_priority_ordering():
    assert SignalType.MRZ < SignalType.ID_REGEX < SignalType.HEADER < SignalType.FALLBACK


def test_all_codes_returns_registry_keys():
    assert set(all_doc_type_codes()) == set(DOCTYPE_REGISTRY)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/ai && uv run pytest tests/test_doctype_registry.py -v`
Expected: FAIL — `zordms_ai.classify` not found.

- [ ] **Step 3: Write the registry**

`services/ai/src/zordms_ai/classify/__init__.py`: (empty file)

`services/ai/src/zordms_ai/classify/doctype_registry.py`:
```python
from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import IntEnum


class SignalType(IntEnum):
    MRZ = 1
    ID_REGEX = 2
    LOGO = 3
    HEADER = 4
    LAYOUT = 5
    LANGUAGE = 6
    FALLBACK = 7


@dataclass(frozen=True)
class DocTypeEntry:
    code: str
    description: str
    jurisdiction: str
    issuer: str
    regex_signals: list[tuple[SignalType, re.Pattern]] = field(default_factory=list)
    keyword_signals: list[tuple[SignalType, str]] = field(default_factory=list)


def _rx(pattern: str) -> re.Pattern:
    return re.compile(pattern)


DOCTYPE_REGISTRY: dict[str, DocTypeEntry] = {
    "BT_CID_4G": DocTypeEntry(
        "BT_CID_4G", "Bhutan CID Card (4G, 2025+)", "BT", "DCRC",
        regex_signals=[(SignalType.ID_REGEX, _rx(r"\b[0-9]{11}\b"))],
        keyword_signals=[(SignalType.HEADER, "Kingdom of Bhutan"), (SignalType.LANGUAGE, "Citizenship Identity")],
    ),
    "BT_CITIZENSHIP": DocTypeEntry(
        "BT_CITIZENSHIP", "Bhutan Citizenship Certificate", "BT", "DCRC",
        keyword_signals=[(SignalType.HEADER, "Citizenship Certificate")],
    ),
    "BT_PASSPORT": DocTypeEntry(
        "BT_PASSPORT", "Bhutan Passport (biometric)", "BT", "DoI / MoFA",
        regex_signals=[(SignalType.MRZ, _rx(r"P<BTN"))],
        keyword_signals=[(SignalType.HEADER, "Passport")],
    ),
    "FOREIGN_PASSPORT": DocTypeEntry(
        "FOREIGN_PASSPORT", "Non-Bhutan passport", "INT", "Foreign state",
        regex_signals=[(SignalType.MRZ, _rx(r"P<(?!BTN)[A-Z]{3}"))],
    ),
    "IN_PAN": DocTypeEntry(
        "IN_PAN", "Indian PAN Card", "IN", "CBDT / NSDL",
        regex_signals=[(SignalType.ID_REGEX, _rx(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b"))],
        keyword_signals=[(SignalType.HEADER, "Income Tax Department")],
    ),
    "IN_AADHAAR": DocTypeEntry(
        "IN_AADHAAR", "Indian Aadhaar Card", "IN", "UIDAI",
        regex_signals=[(SignalType.ID_REGEX, _rx(r"\b[0-9]{4} [0-9]{4} [0-9]{4}\b"))],
        keyword_signals=[(SignalType.HEADER, "Unique Identification")],
    ),
    "BOB_ACCOUNT_FORM": DocTypeEntry(
        "BOB_ACCOUNT_FORM", "BoB Account Opening Form", "BT", "Bank of Bhutan",
        keyword_signals=[(SignalType.HEADER, "Account Opening Form")],
    ),
    "BOB_LOAN_APPLICATION": DocTypeEntry(
        "BOB_LOAN_APPLICATION", "BoB Loan Application", "BT", "Bank of Bhutan",
        keyword_signals=[(SignalType.HEADER, "Loan Application")],
    ),
    "BOB_INVOICE": DocTypeEntry(
        "BOB_INVOICE", "BoB-related Invoice", "BT", "Vendor",
        regex_signals=[(SignalType.ID_REGEX, _rx(r"\bTPN[:\s]*[0-9]{9}\b"))],
        keyword_signals=[(SignalType.HEADER, "TAX INVOICE")],
    ),
    "PURCHASE_ORDER": DocTypeEntry(
        "PURCHASE_ORDER", "Bank Purchase Order", "BT", "Bank of Bhutan",
        keyword_signals=[(SignalType.HEADER, "Purchase Order No.")],
    ),
    "SAR_REPORT": DocTypeEntry(
        "SAR_REPORT", "Suspicious Activity Report", "BT", "FIU / FID",
        keyword_signals=[(SignalType.HEADER, "Suspicious Activity")],
    ),
    "CTR": DocTypeEntry(
        "CTR", "Cash Transaction Report", "BT", "RMA / FIU",
        keyword_signals=[(SignalType.HEADER, "Cash Transaction")],
    ),
    "EMPLOYMENT_CONTRACT": DocTypeEntry(
        "EMPLOYMENT_CONTRACT", "Staff Employment Contract", "BT", "Bank of Bhutan HR",
        keyword_signals=[(SignalType.HEADER, "Employment Contract")],
    ),
    "BOARD_RESOLUTION": DocTypeEntry(
        "BOARD_RESOLUTION", "Board Resolution", "BT", "BoB Board Sec.",
        keyword_signals=[(SignalType.HEADER, "Board Resolution No.")],
    ),
    "RMA_INSPECTION": DocTypeEntry(
        "RMA_INSPECTION", "RMA Inspection Report", "BT", "RMA",
        keyword_signals=[(SignalType.HEADER, "Inspection Report")],
    ),
    "RAA_AUDIT_REPORT": DocTypeEntry(
        "RAA_AUDIT_REPORT", "RAA Audit Report", "BT", "RAA",
        keyword_signals=[(SignalType.HEADER, "Audit Report")],
    ),
    "GENERAL_LETTER": DocTypeEntry(
        "GENERAL_LETTER", "General Correspondence", "ANY", "Various",
        keyword_signals=[(SignalType.FALLBACK, "letter")],
    ),
    "UNKNOWN": DocTypeEntry(
        "UNKNOWN", "Unclassified / Unreadable", "ANY", "-",
    ),
}


def all_doc_type_codes() -> list[str]:
    return list(DOCTYPE_REGISTRY)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/ai && uv run pytest tests/test_doctype_registry.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add services/ai/src/zordms_ai/classify/__init__.py services/ai/src/zordms_ai/classify/doctype_registry.py services/ai/tests/test_doctype_registry.py
git commit -m "feat(ai): doc-type registry with prioritized classification signals

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Pre-screen — MRZ/ID-regex type proposal before the VLM (IDP §6.3)

**Files:**
- Create: `services/ai/src/zordms_ai/classify/prescreen.py`
- Test: `services/ai/tests/test_prescreen.py`

**Interfaces:**
- Consumes: `DOCTYPE_REGISTRY`, `SignalType` from `doctype_registry`.
- Produces:
  - `PrescreenSignal` (dataclass): `doc_type: str`, `signal_type: SignalType`, `matched: str`.
  - `PrescreenResult` (dataclass): `proposed_type: str | None`, `signals: list[PrescreenSignal]` (sorted by `signal_type` ascending → highest priority first). `proposed_type` is the doc_type of the best (lowest-numbered) signal, or `None` if no signal matched.
  - `prescreen(text: str) -> PrescreenResult` — scans OCR/MRZ text against every registry entry's `regex_signals` and `keyword_signals`, collecting matches; proposes the doc_type whose strongest signal has the lowest priority number.

- [ ] **Step 1: Write the failing test**

`services/ai/tests/test_prescreen.py`:
```python
from zordms_ai.classify.doctype_registry import SignalType
from zordms_ai.classify.prescreen import prescreen


def test_detects_bhutan_passport_via_mrz():
    res = prescreen("P<BTNDORJI<<KARMA<<<<<<<<<<<<<<<<<<<<<<<<<<<")
    assert res.proposed_type == "BT_PASSPORT"
    assert res.signals[0].signal_type == SignalType.MRZ


def test_detects_cid_via_11_digit_id():
    res = prescreen("Kingdom of Bhutan  CID 10112345678")
    # both an 11-digit ID-regex and a 'Kingdom of Bhutan' header point to BT_CID_4G
    assert res.proposed_type == "BT_CID_4G"


def test_detects_pan_via_regex():
    res = prescreen("Permanent Account Number ABCDE1234F Income Tax Department")
    assert res.proposed_type == "IN_PAN"


def test_no_match_returns_none():
    res = prescreen("just some unrelated prose with no identifiers")
    assert res.proposed_type is None
    assert res.signals == []


def test_signals_sorted_by_priority():
    res = prescreen("P<BTN... Passport 10112345678")
    priorities = [s.signal_type for s in res.signals]
    assert priorities == sorted(priorities)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/ai && uv run pytest tests/test_prescreen.py -v`
Expected: FAIL — `zordms_ai.classify.prescreen` not found.

- [ ] **Step 3: Write `prescreen.py`**

```python
from __future__ import annotations

from dataclasses import dataclass

from zordms_ai.classify.doctype_registry import DOCTYPE_REGISTRY, SignalType


@dataclass(frozen=True)
class PrescreenSignal:
    doc_type: str
    signal_type: SignalType
    matched: str


@dataclass(frozen=True)
class PrescreenResult:
    proposed_type: str | None
    signals: list[PrescreenSignal]


def prescreen(text: str) -> PrescreenResult:
    signals: list[PrescreenSignal] = []
    lowered = text.lower()
    for code, entry in DOCTYPE_REGISTRY.items():
        for sig_type, pattern in entry.regex_signals:
            m = pattern.search(text)
            if m:
                signals.append(PrescreenSignal(code, sig_type, m.group(0)))
        for sig_type, keyword in entry.keyword_signals:
            if keyword.lower() in lowered:
                signals.append(PrescreenSignal(code, sig_type, keyword))

    signals.sort(key=lambda s: int(s.signal_type))
    proposed = signals[0].doc_type if signals else None
    return PrescreenResult(proposed_type=proposed, signals=signals)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/ai && uv run pytest tests/test_prescreen.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add services/ai/src/zordms_ai/classify/prescreen.py services/ai/tests/test_prescreen.py
git commit -m "feat(ai): MRZ/ID-regex pre-screen proposing doc-type before VLM

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: vLLM client wrapper (OpenAI-compatible, constrained decoding) — mocked in tests

**Files:**
- Create: `services/ai/src/zordms_ai/inference/__init__.py`, `services/ai/src/zordms_ai/inference/vllm_client.py`
- Test: `services/ai/tests/test_vllm_client.py`

**Interfaces:**
- Consumes: `Settings`.
- Produces:
  - `VLLMClient(base_url, api_key, timeout_s, http_client: httpx.AsyncClient | None = None)`.
  - `async chat_json(self, *, model: str, system: str, user_text: str, image_b64: str | None, json_schema: dict) -> dict` — POSTs `{base_url}/chat/completions` with messages (text + optional image_url data-URI), and `response_format={"type":"json_schema","json_schema":{"name":..., "schema": json_schema}}` plus `temperature=0`, `extra_body={"guided_json": json_schema}` (vLLM constrained decoding). Returns the parsed JSON object from `choices[0].message.content`.
  - `build_messages(system, user_text, image_b64) -> list[dict]` (pure helper, asserted directly in tests).

- [ ] **Step 1: Write the failing test (mock HTTP with respx)**

`services/ai/tests/test_vllm_client.py`:
```python
import json

import httpx
import pytest
import respx

from zordms_ai.inference.vllm_client import VLLMClient, build_messages


def test_build_messages_includes_image_data_uri():
    msgs = build_messages("sys", "classify this", image_b64="QUJD")
    assert msgs[0]["role"] == "system"
    user = msgs[1]
    assert user["role"] == "user"
    # multimodal content: text part + image_url part
    kinds = {part["type"] for part in user["content"]}
    assert kinds == {"text", "image_url"}
    img = next(p for p in user["content"] if p["type"] == "image_url")
    assert img["image_url"]["url"].startswith("data:image/png;base64,QUJD")


def test_build_messages_text_only_when_no_image():
    msgs = build_messages("sys", "hello", image_b64=None)
    assert msgs[1]["content"] == "hello"


@pytest.mark.asyncio
@respx.mock
async def test_chat_json_sends_guided_json_and_parses_content():
    schema = {"type": "object", "properties": {"doc_type": {"type": "string"}}}
    route = respx.post("http://vllm.test/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"content": json.dumps({"doc_type": "BT_CID_4G"})}}
                ]
            },
        )
    )
    client = VLLMClient("http://vllm.test/v1", "EMPTY", timeout_s=8.0)
    out = await client.chat_json(
        model="granite-3.2-vision-2b",
        system="You classify documents.",
        user_text="What type is this?",
        image_b64="QUJD",
        json_schema=schema,
    )
    assert out == {"doc_type": "BT_CID_4G"}
    sent = json.loads(route.calls[0].request.content)
    assert sent["model"] == "granite-3.2-vision-2b"
    assert sent["temperature"] == 0
    assert sent["extra_body"]["guided_json"] == schema
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/ai && uv run pytest tests/test_vllm_client.py -v`
Expected: FAIL — `zordms_ai.inference.vllm_client` not found.

- [ ] **Step 3: Write `vllm_client.py`**

`services/ai/src/zordms_ai/inference/__init__.py`: (empty file)

`services/ai/src/zordms_ai/inference/vllm_client.py`:
```python
from __future__ import annotations

import json
from typing import Any

import httpx


def build_messages(system: str, user_text: str, image_b64: str | None) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}]
    if image_b64:
        messages.append(
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_text},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{image_b64}"},
                    },
                ],
            }
        )
    else:
        messages.append({"role": "user", "content": user_text})
    return messages


class VLLMClient:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        timeout_s: float,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._timeout_s = timeout_s
        self._http = http_client

    async def chat_json(
        self,
        *,
        model: str,
        system: str,
        user_text: str,
        image_b64: str | None,
        json_schema: dict[str, Any],
    ) -> dict[str, Any]:
        payload = {
            "model": model,
            "messages": build_messages(system, user_text, image_b64),
            "temperature": 0,
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "extraction", "schema": json_schema},
            },
            "extra_body": {"guided_json": json_schema},
        }
        headers = {"Authorization": f"Bearer {self._api_key}"}
        url = f"{self._base_url}/chat/completions"

        owns_client = self._http is None
        client = self._http or httpx.AsyncClient(timeout=self._timeout_s)
        try:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        finally:
            if owns_client:
                await client.aclose()

        content = data["choices"][0]["message"]["content"]
        return json.loads(content)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/ai && uv run pytest tests/test_vllm_client.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/ai/src/zordms_ai/inference/__init__.py services/ai/src/zordms_ai/inference/vllm_client.py services/ai/tests/test_vllm_client.py
git commit -m "feat(ai): OpenAI-compatible vLLM client with guided-json constrained decoding

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Stage-1 Classifier service (IDP §6, Granite 3.2 Vision)

**Files:**
- Create: `services/ai/src/zordms_ai/classify/classifier.py`
- Test: `services/ai/tests/test_classifier.py`

**Interfaces:**
- Consumes: `VLLMClient`, `all_doc_type_codes`, `prescreen`.
- Produces:
  - `ClassifyResult` (Pydantic model): `doc_type: str`, `confidence: float` (0–1), `signals: list[str]`.
  - `CLASSIFY_JSON_SCHEMA: dict` — JSON schema constraining the classifier output to `{doc_type ∈ registry codes, confidence, signals[]}`.
  - `build_classify_prompt(prescreen_hint: str | None) -> str` — returns the user prompt, embedding the allowed doc-type codes and any pre-screen hint.
  - `Classifier(client: VLLMClient, model: str)` with `async classify(self, image_b64: str, ocr_text: str = "") -> ClassifyResult` — runs `prescreen(ocr_text)`, calls `client.chat_json(...)`, merges pre-screen signals into the result.

- [ ] **Step 1: Write the failing test (mock the client)**

`services/ai/tests/test_classifier.py`:
```python
import pytest

from zordms_ai.classify.classifier import (
    CLASSIFY_JSON_SCHEMA,
    Classifier,
    build_classify_prompt,
)


class FakeClient:
    def __init__(self, response: dict):
        self.response = response
        self.calls: list[dict] = []

    async def chat_json(self, **kwargs):
        self.calls.append(kwargs)
        return self.response


def test_prompt_lists_allowed_codes_and_hint():
    prompt = build_classify_prompt(prescreen_hint="BT_PASSPORT")
    assert "BT_PASSPORT" in prompt
    assert "BT_CID_4G" in prompt
    assert "pre-screen" in prompt.lower()


def test_schema_constrains_doc_type_to_enum():
    enum = CLASSIFY_JSON_SCHEMA["properties"]["doc_type"]["enum"]
    assert "BT_CID_4G" in enum and "UNKNOWN" in enum


@pytest.mark.asyncio
async def test_classify_parses_response_and_merges_prescreen_signals():
    fake = FakeClient({"doc_type": "BT_PASSPORT", "confidence": 0.96, "signals": ["maroon cover"]})
    clf = Classifier(fake, model="granite-3.2-vision-2b")
    result = await clf.classify(image_b64="QUJD", ocr_text="P<BTNDORJI<<KARMA")
    assert result.doc_type == "BT_PASSPORT"
    assert result.confidence == 0.96
    # pre-screen MRZ signal merged in alongside the model's own signal
    assert any("MRZ" in s or "P<BTN" in s for s in result.signals)
    # the client was called with the constrained schema
    assert fake.calls[0]["json_schema"] is CLASSIFY_JSON_SCHEMA
    assert fake.calls[0]["model"] == "granite-3.2-vision-2b"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/ai && uv run pytest tests/test_classifier.py -v`
Expected: FAIL — `zordms_ai.classify.classifier` not found.

- [ ] **Step 3: Write `classifier.py`**

```python
from __future__ import annotations

from pydantic import BaseModel, Field

from zordms_ai.classify.doctype_registry import all_doc_type_codes
from zordms_ai.classify.prescreen import prescreen
from zordms_ai.inference.vllm_client import VLLMClient

CLASSIFY_JSON_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "doc_type": {"type": "string", "enum": all_doc_type_codes()},
        "confidence": {"type": "number", "minimum": 0.0, "maximum": 1.0},
        "signals": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["doc_type", "confidence", "signals"],
    "additionalProperties": False,
}

_SYSTEM = (
    "You are a document-type classifier for Bank of Bhutan. "
    "Identify the document type from the image and output strict JSON."
)


class ClassifyResult(BaseModel):
    doc_type: str
    confidence: float = Field(ge=0.0, le=1.0)
    signals: list[str] = Field(default_factory=list)


def build_classify_prompt(prescreen_hint: str | None) -> str:
    codes = ", ".join(all_doc_type_codes())
    lines = [
        "Classify this document into exactly one of the allowed type codes.",
        f"Allowed type codes: {codes}.",
        "Return doc_type, a confidence in [0,1], and a list of signals you used.",
    ]
    if prescreen_hint:
        lines.append(
            f"A deterministic pre-screen proposed '{prescreen_hint}'. "
            "Confirm or override it based on the image."
        )
    return "\n".join(lines)


class Classifier:
    def __init__(self, client: VLLMClient, model: str) -> None:
        self._client = client
        self._model = model

    async def classify(self, image_b64: str, ocr_text: str = "") -> ClassifyResult:
        pre = prescreen(ocr_text)
        prompt = build_classify_prompt(pre.proposed_type)
        raw = await self._client.chat_json(
            model=self._model,
            system=_SYSTEM,
            user_text=prompt,
            image_b64=image_b64,
            json_schema=CLASSIFY_JSON_SCHEMA,
        )
        result = ClassifyResult.model_validate(raw)
        pre_signals = [f"{s.signal_type.name}:{s.matched}" for s in pre.signals]
        merged = list(dict.fromkeys([*pre_signals, *result.signals]))
        return result.model_copy(update={"signals": merged})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/ai && uv run pytest tests/test_classifier.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/ai/src/zordms_ai/classify/classifier.py services/ai/tests/test_classifier.py
git commit -m "feat(ai): Stage-1 classifier with constrained prompt + pre-screen merge

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Confidence router (IDP §6.4) — pure function

**Files:**
- Create: `services/ai/src/zordms_ai/routing/__init__.py`, `services/ai/src/zordms_ai/routing/confidence.py`
- Test: `services/ai/tests/test_confidence.py`

**Interfaces:**
- Produces:
  - `RouteAction` (str Enum): `AUTO_APPROVE`, `AUTO_VERIFIED`, `SUPERVISOR_REVIEW`, `HUMAN_REVIEW`, `REJECT`.
  - `RouteDecision` (dataclass): `band: str`, `action: RouteAction`, `proceed_to_extract: bool`, `review_required: bool`, `sla_hours: int | None`, `catalog_assignment: str` (one of `"full"`, `"tentative"`, `"pending"`, `"none"`), `sampled_review: bool`.
  - `route_by_confidence(confidence: float) -> RouteDecision` implementing the exact §6.4 bands:
    - `≥0.92` → AUTO_APPROVE, proceed, no review, sla None, catalog full
    - `0.85–0.91` → AUTO_VERIFIED, proceed, sampled 10% review, sla None, catalog full
    - `0.70–0.84` → SUPERVISOR_REVIEW, proceed, review, sla 48, catalog tentative
    - `0.50–0.69` → HUMAN_REVIEW, hold (no extract), review, sla 24, catalog pending
    - `<0.50` → REJECT, hold, review, sla 0 (immediate), catalog none

- [ ] **Step 1: Write the failing test**

`services/ai/tests/test_confidence.py`:
```python
import pytest

from zordms_ai.routing.confidence import RouteAction, route_by_confidence


@pytest.mark.parametrize(
    "conf,action,proceed,sla,catalog",
    [
        (0.95, RouteAction.AUTO_APPROVE, True, None, "full"),
        (0.92, RouteAction.AUTO_APPROVE, True, None, "full"),
        (0.88, RouteAction.AUTO_VERIFIED, True, None, "full"),
        (0.85, RouteAction.AUTO_VERIFIED, True, None, "full"),
        (0.80, RouteAction.SUPERVISOR_REVIEW, True, 48, "tentative"),
        (0.70, RouteAction.SUPERVISOR_REVIEW, True, 48, "tentative"),
        (0.60, RouteAction.HUMAN_REVIEW, False, 24, "pending"),
        (0.50, RouteAction.HUMAN_REVIEW, False, 24, "pending"),
        (0.40, RouteAction.REJECT, False, 0, "none"),
    ],
)
def test_bands(conf, action, proceed, sla, catalog):
    d = route_by_confidence(conf)
    assert d.action == action
    assert d.proceed_to_extract == proceed
    assert d.sla_hours == sla
    assert d.catalog_assignment == catalog


def test_auto_verified_band_is_sampled():
    assert route_by_confidence(0.88).sampled_review is True
    assert route_by_confidence(0.95).sampled_review is False


def test_review_required_flags():
    assert route_by_confidence(0.95).review_required is False
    assert route_by_confidence(0.80).review_required is True
    assert route_by_confidence(0.40).review_required is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/ai && uv run pytest tests/test_confidence.py -v`
Expected: FAIL — `zordms_ai.routing.confidence` not found.

- [ ] **Step 3: Write `confidence.py`**

`services/ai/src/zordms_ai/routing/__init__.py`: (empty file)

`services/ai/src/zordms_ai/routing/confidence.py`:
```python
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class RouteAction(str, Enum):
    AUTO_APPROVE = "AUTO_APPROVE"
    AUTO_VERIFIED = "AUTO_VERIFIED"
    SUPERVISOR_REVIEW = "SUPERVISOR_REVIEW"
    HUMAN_REVIEW = "HUMAN_REVIEW"
    REJECT = "REJECT"


@dataclass(frozen=True)
class RouteDecision:
    band: str
    action: RouteAction
    proceed_to_extract: bool
    review_required: bool
    sla_hours: int | None
    catalog_assignment: str
    sampled_review: bool


def route_by_confidence(confidence: float) -> RouteDecision:
    if confidence >= 0.92:
        return RouteDecision(">=0.92", RouteAction.AUTO_APPROVE, True, False, None, "full", False)
    if confidence >= 0.85:
        return RouteDecision("0.85-0.91", RouteAction.AUTO_VERIFIED, True, False, None, "full", True)
    if confidence >= 0.70:
        return RouteDecision("0.70-0.84", RouteAction.SUPERVISOR_REVIEW, True, True, 48, "tentative", False)
    if confidence >= 0.50:
        return RouteDecision("0.50-0.69", RouteAction.HUMAN_REVIEW, False, True, 24, "pending", False)
    return RouteDecision("<0.50", RouteAction.REJECT, False, True, 0, "none", False)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/ai && uv run pytest tests/test_confidence.py -v`
Expected: PASS (11 parametrized + 2 = 13 cases).

- [ ] **Step 5: Commit**

```bash
git add services/ai/src/zordms_ai/routing/__init__.py services/ai/src/zordms_ai/routing/confidence.py services/ai/tests/test_confidence.py
git commit -m "feat(ai): pure confidence-band router with SLA + catalog assignment

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Stage-2 Extractor service (IDP §3, Qwen2.5-VL)

**Files:**
- Create: `services/ai/src/zordms_ai/extract/__init__.py`, `services/ai/src/zordms_ai/extract/extractor.py`
- Test: `services/ai/tests/test_extractor.py`

**Interfaces:**
- Consumes: `VLLMClient`, `schema_for`, `DOC_SCHEMAS`, `ExtractionBase`.
- Produces:
  - `ExtractResult` (dataclass): `doc_type: str`, `data: ExtractionBase | None`, `partial: dict | None`, `valid: bool`, `errors: list[str]`, `review_flag: bool`.
  - `build_extract_prompt(doc_type: str) -> str`.
  - `Extractor(client: VLLMClient, model: str)` with `async extract(self, doc_type: str, image_b64: str) -> ExtractResult` — looks up the Pydantic model, derives its JSON schema via `model.model_json_schema()`, calls `client.chat_json(...)`, validates: on success `data` is set, `valid=True`; on `ValidationError` returns `partial=raw`, `valid=False`, `review_flag=True` (partial extraction per IDP §6.1 fallback).

- [ ] **Step 1: Write the failing test (mock the client with a canned response)**

`services/ai/tests/test_extractor.py`:
```python
import pytest

from zordms_ai.extract.extractor import Extractor, build_extract_prompt
from zordms_ai.schemas.cid import BTCid4G


class FakeClient:
    def __init__(self, response: dict):
        self.response = response
        self.calls: list[dict] = []

    async def chat_json(self, **kwargs):
        self.calls.append(kwargs)
        return self.response


_CANNED_CID = {
    "doc_type": "BT_CID_4G",
    "cid_no": "10112345678",
    "full_name": "Sonam Wangchuk",
    "dob": "1990-04-12",
    "sex": "M",
    "issue_date": "2025-01-01",
    "expiry_date": "2035-01-01",
    "dzongkhag": "Thimphu",
    "confidence": 0.94,
}


def test_prompt_names_doc_type():
    assert "BT_CID_4G" in build_extract_prompt("BT_CID_4G")


@pytest.mark.asyncio
async def test_extract_valid_cid_returns_typed_object():
    fake = FakeClient(_CANNED_CID)
    ex = Extractor(fake, model="qwen2.5-vl-7b")
    res = await ex.extract("BT_CID_4G", image_b64="QUJD")
    assert res.valid is True
    assert isinstance(res.data, BTCid4G)
    assert res.data.cid_no == "10112345678"
    assert res.review_flag is False
    # schema passed to the client is the model's own JSON schema
    assert fake.calls[0]["json_schema"]["properties"]["cid_no"]["pattern"] == "^[0-9]{11}$"


@pytest.mark.asyncio
async def test_extract_invalid_returns_partial_and_review_flag():
    bad = dict(_CANNED_CID, cid_no="123")  # fails 11-digit rule
    ex = Extractor(FakeClient(bad), model="qwen2.5-vl-7b")
    res = await ex.extract("BT_CID_4G", image_b64="QUJD")
    assert res.valid is False
    assert res.data is None
    assert res.partial == bad
    assert res.review_flag is True
    assert res.errors
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/ai && uv run pytest tests/test_extractor.py -v`
Expected: FAIL — `zordms_ai.extract.extractor` not found.

- [ ] **Step 3: Write `extractor.py`**

`services/ai/src/zordms_ai/extract/__init__.py`: (empty file)

`services/ai/src/zordms_ai/extract/extractor.py`:
```python
from __future__ import annotations

from dataclasses import dataclass, field

from pydantic import ValidationError

from zordms_ai.inference.vllm_client import VLLMClient
from zordms_ai.schemas.base import ExtractionBase
from zordms_ai.schemas.registry import schema_for

_SYSTEM = (
    "You extract structured metadata from a Bank of Bhutan document image. "
    "Output strict JSON matching the provided schema; do not invent fields."
)


@dataclass
class ExtractResult:
    doc_type: str
    data: ExtractionBase | None
    partial: dict | None
    valid: bool
    errors: list[str] = field(default_factory=list)
    review_flag: bool = False


def build_extract_prompt(doc_type: str) -> str:
    return (
        f"Extract all metadata fields for a document of type {doc_type}. "
        "Populate every required field from the image. "
        "Set confidence to your certainty in [0,1]."
    )


class Extractor:
    def __init__(self, client: VLLMClient, model: str) -> None:
        self._client = client
        self._model = model

    async def extract(self, doc_type: str, image_b64: str) -> ExtractResult:
        model_cls = schema_for(doc_type)
        json_schema = model_cls.model_json_schema()
        raw = await self._client.chat_json(
            model=self._model,
            system=_SYSTEM,
            user_text=build_extract_prompt(doc_type),
            image_b64=image_b64,
            json_schema=json_schema,
        )
        try:
            data = model_cls.model_validate(raw)
        except ValidationError as exc:
            return ExtractResult(
                doc_type=doc_type,
                data=None,
                partial=raw,
                valid=False,
                errors=[e["msg"] for e in exc.errors()],
                review_flag=True,
            )
        return ExtractResult(
            doc_type=doc_type,
            data=data,
            partial=None,
            valid=True,
            errors=[],
            review_flag=data.review_flag,
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/ai && uv run pytest tests/test_extractor.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/ai/src/zordms_ai/extract/__init__.py services/ai/src/zordms_ai/extract/extractor.py services/ai/tests/test_extractor.py
git commit -m "feat(ai): Stage-2 extractor with Pydantic validation + partial fallback

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: DB engine + Human-review queue model + migration

**Files:**
- Create: `services/ai/src/zordms_ai/db.py`, `services/ai/src/zordms_ai/review/__init__.py`, `services/ai/src/zordms_ai/review/models.py`, `services/ai/alembic.ini`, `services/ai/src/zordms_ai/migrations/env.py`, `services/ai/src/zordms_ai/migrations/versions/0001_review_queue.py`
- Test: `services/ai/tests/test_review_model.py`

**Interfaces:**
- Produces:
  - `Base` (SQLAlchemy `DeclarativeBase`).
  - `make_engine(database_url: str)` and `make_session_factory(engine)` (sessionmaker).
  - `ReviewItem(Base)` table `review_items`: `id` (int PK), `doc_id` (str, indexed), `doc_type` (str), `confidence` (float), `band` (str), `sla_hours` (int | None), `sla_deadline` (datetime | None), `status` (str: `PENDING`/`CLAIMED`/`RESOLVED`), `claimed_by` (str | None), `resolution` (str | None), `payload_json` (JSON/text), `created_at` (datetime), `resolved_at` (datetime | None).
  - Alembic migration `0001_review_queue` creating the table (works on PG/Oracle/sqlite via SQLAlchemy types).

- [ ] **Step 1: Write the failing test (create tables on in-memory sqlite)**

`services/ai/tests/test_review_model.py`:
```python
from datetime import datetime

from sqlalchemy import select

from zordms_ai.db import Base, make_engine, make_session_factory
from zordms_ai.review.models import ReviewItem


def test_review_item_persists_and_reads_back():
    engine = make_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = make_session_factory(engine)
    with Session() as s:
        s.add(
            ReviewItem(
                doc_id="doc-1",
                doc_type="BT_CID_4G",
                confidence=0.6,
                band="0.50-0.69",
                sla_hours=24,
                sla_deadline=datetime(2026, 6, 24, 10, 0, 0),
                status="PENDING",
                payload_json="{}",
                created_at=datetime(2026, 6, 23, 10, 0, 0),
            )
        )
        s.commit()
        item = s.scalars(select(ReviewItem).where(ReviewItem.doc_id == "doc-1")).one()
        assert item.status == "PENDING"
        assert item.sla_hours == 24
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/ai && uv run pytest tests/test_review_model.py -v`
Expected: FAIL — `zordms_ai.db` / `zordms_ai.review.models` not found.

- [ ] **Step 3: Write `db.py`**

```python
from __future__ import annotations

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Base(DeclarativeBase):
    pass


def make_engine(database_url: str) -> Engine:
    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    return create_engine(database_url, connect_args=connect_args, future=True)


def make_session_factory(engine: Engine) -> sessionmaker:
    return sessionmaker(bind=engine, expire_on_commit=False, future=True)
```

- [ ] **Step 4: Write `review/models.py`**

`services/ai/src/zordms_ai/review/__init__.py`: (empty file)

```python
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from zordms_ai.db import Base


class ReviewItem(Base):
    __tablename__ = "review_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    doc_id: Mapped[str] = mapped_column(String(64), index=True)
    doc_type: Mapped[str] = mapped_column(String(40))
    confidence: Mapped[float] = mapped_column(Float)
    band: Mapped[str] = mapped_column(String(20))
    sla_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sla_deadline: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="PENDING", index=True)
    claimed_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    resolution: Mapped[str | None] = mapped_column(String(40), nullable=True)
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
```

- [ ] **Step 5: Write Alembic config + env + migration**

`services/ai/alembic.ini`:
```ini
[alembic]
script_location = src/zordms_ai/migrations
sqlalchemy.url = %(DATABASE_URL)s

[loggers]
keys = root

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console

[handler_console]
class = StreamHandler
args = (sys.stderr,)
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
```

`services/ai/src/zordms_ai/migrations/env.py`:
```python
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from zordms_ai.db import Base
from zordms_ai.review import models  # noqa: F401  (register tables)

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", os.environ.get("DATABASE_URL", "sqlite+pysqlite:///./ai.db"))
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(url=config.get_main_option("sqlalchemy.url"), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.", poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

`services/ai/src/zordms_ai/migrations/versions/0001_review_queue.py`:
```python
"""review_items table

Revision ID: 0001_review_queue
Revises:
Create Date: 2026-06-23
"""
import sqlalchemy as sa
from alembic import op

revision = "0001_review_queue"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "review_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("doc_id", sa.String(64), index=True),
        sa.Column("doc_type", sa.String(40)),
        sa.Column("confidence", sa.Float()),
        sa.Column("band", sa.String(20)),
        sa.Column("sla_hours", sa.Integer(), nullable=True),
        sa.Column("sla_deadline", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(20), index=True),
        sa.Column("claimed_by", sa.String(100), nullable=True),
        sa.Column("resolution", sa.String(40), nullable=True),
        sa.Column("payload_json", sa.Text()),
        sa.Column("created_at", sa.DateTime()),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("review_items")
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd services/ai && uv run pytest tests/test_review_model.py -v`
Expected: PASS (1 test).

- [ ] **Step 7: Commit**

```bash
git add services/ai/src/zordms_ai/db.py services/ai/src/zordms_ai/review/__init__.py services/ai/src/zordms_ai/review/models.py services/ai/alembic.ini services/ai/src/zordms_ai/migrations/env.py services/ai/src/zordms_ai/migrations/versions/0001_review_queue.py services/ai/tests/test_review_model.py
git commit -m "feat(ai): SQLAlchemy engine + review-queue model + Alembic migration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Human-review queue service (list by SLA, claim, resolve)

**Files:**
- Create: `services/ai/src/zordms_ai/review/service.py`
- Test: `services/ai/tests/test_review_service.py`

**Interfaces:**
- Consumes: `ReviewItem`, a SQLAlchemy `Session`, `RouteDecision`.
- Produces:
  - `enqueue(session, *, doc_id, doc_type, confidence, decision: RouteDecision, payload_json: str, now: datetime) -> ReviewItem` — computes `sla_deadline = now + sla_hours` (None when `sla_hours` is None).
  - `list_pending(session) -> list[ReviewItem]` — status `PENDING`, ordered by `sla_deadline` ascending (NULLs last → least urgent), i.e. soonest deadline first.
  - `claim(session, item_id: int, user_id: str) -> ReviewItem` — sets `status=CLAIMED`, `claimed_by`; raises `ValueError` if already claimed/resolved.
  - `resolve(session, item_id: int, resolution: str, now: datetime) -> ReviewItem` — sets `status=RESOLVED`, `resolution`, `resolved_at`.

- [ ] **Step 1: Write the failing test**

`services/ai/tests/test_review_service.py`:
```python
from datetime import datetime, timedelta

import pytest

from zordms_ai.db import Base, make_engine, make_session_factory
from zordms_ai.review.service import claim, enqueue, list_pending, resolve
from zordms_ai.routing.confidence import route_by_confidence


@pytest.fixture
def session():
    engine = make_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = make_session_factory(engine)
    with Session() as s:
        yield s


NOW = datetime(2026, 6, 23, 10, 0, 0)


def test_enqueue_computes_sla_deadline(session):
    item = enqueue(
        session, doc_id="d1", doc_type="BT_CID_4G", confidence=0.60,
        decision=route_by_confidence(0.60), payload_json="{}", now=NOW,
    )
    assert item.sla_hours == 24
    assert item.sla_deadline == NOW + timedelta(hours=24)


def test_list_pending_orders_by_deadline(session):
    enqueue(session, doc_id="far", doc_type="X", confidence=0.80,
            decision=route_by_confidence(0.80), payload_json="{}", now=NOW)  # 48h
    enqueue(session, doc_id="near", doc_type="X", confidence=0.60,
            decision=route_by_confidence(0.60), payload_json="{}", now=NOW)  # 24h
    pending = list_pending(session)
    assert [p.doc_id for p in pending] == ["near", "far"]


def test_claim_then_resolve(session):
    item = enqueue(session, doc_id="d2", doc_type="X", confidence=0.60,
                   decision=route_by_confidence(0.60), payload_json="{}", now=NOW)
    claimed = claim(session, item.id, "STAFF7")
    assert claimed.status == "CLAIMED"
    assert claimed.claimed_by == "STAFF7"
    done = resolve(session, item.id, "APPROVED", now=NOW)
    assert done.status == "RESOLVED"
    assert done.resolution == "APPROVED"


def test_double_claim_raises(session):
    item = enqueue(session, doc_id="d3", doc_type="X", confidence=0.60,
                   decision=route_by_confidence(0.60), payload_json="{}", now=NOW)
    claim(session, item.id, "A")
    with pytest.raises(ValueError):
        claim(session, item.id, "B")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/ai && uv run pytest tests/test_review_service.py -v`
Expected: FAIL — `zordms_ai.review.service` not found.

- [ ] **Step 3: Write `service.py`**

```python
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from zordms_ai.review.models import ReviewItem
from zordms_ai.routing.confidence import RouteDecision


def enqueue(
    session: Session,
    *,
    doc_id: str,
    doc_type: str,
    confidence: float,
    decision: RouteDecision,
    payload_json: str,
    now: datetime,
) -> ReviewItem:
    deadline = now + timedelta(hours=decision.sla_hours) if decision.sla_hours is not None else None
    item = ReviewItem(
        doc_id=doc_id,
        doc_type=doc_type,
        confidence=confidence,
        band=decision.band,
        sla_hours=decision.sla_hours,
        sla_deadline=deadline,
        status="PENDING",
        payload_json=payload_json,
        created_at=now,
    )
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


def list_pending(session: Session) -> list[ReviewItem]:
    stmt = (
        select(ReviewItem)
        .where(ReviewItem.status == "PENDING")
        .order_by(ReviewItem.sla_deadline.asc().nulls_last())
    )
    return list(session.scalars(stmt))


def claim(session: Session, item_id: int, user_id: str) -> ReviewItem:
    item = session.get(ReviewItem, item_id)
    if item is None:
        raise ValueError(f"review item {item_id} not found")
    if item.status != "PENDING":
        raise ValueError(f"review item {item_id} is {item.status}, cannot claim")
    item.status = "CLAIMED"
    item.claimed_by = user_id
    session.commit()
    session.refresh(item)
    return item


def resolve(session: Session, item_id: int, resolution: str, now: datetime) -> ReviewItem:
    item = session.get(ReviewItem, item_id)
    if item is None:
        raise ValueError(f"review item {item_id} not found")
    item.status = "RESOLVED"
    item.resolution = resolution
    item.resolved_at = now
    session.commit()
    session.refresh(item)
    return item
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/ai && uv run pytest tests/test_review_service.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add services/ai/src/zordms_ai/review/service.py services/ai/tests/test_review_service.py
git commit -m "feat(ai): human-review queue service (enqueue/list-by-SLA/claim/resolve)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Preprocess helper (pdf2image/Pillow) — mocked in tests

**Files:**
- Create: `services/ai/src/zordms_ai/pipeline/__init__.py`, `services/ai/src/zordms_ai/pipeline/preprocess.py`
- Test: `services/ai/tests/test_preprocess.py`

**Interfaces:**
- Produces:
  - `to_page_images(raw: bytes, content_type: str) -> list[bytes]` — for `application/pdf` calls `pdf2image.convert_from_bytes` (300 DPI) and re-encodes each page to PNG bytes via Pillow; for `image/*` returns `[raw]` re-encoded to PNG. The pdf2image and Pillow calls are the seams mocked in tests.
  - `b64_png(png_bytes: bytes) -> str` — base64-encodes PNG bytes for the vLLM data-URI.

- [ ] **Step 1: Write the failing test (mock pdf2image + Pillow)**

`services/ai/tests/test_preprocess.py`:
```python
import base64
from unittest.mock import MagicMock, patch

from zordms_ai.pipeline.preprocess import b64_png, to_page_images


def test_b64_png_roundtrip():
    assert base64.b64decode(b64_png(b"abc")) == b"abc"


@patch("zordms_ai.pipeline.preprocess._encode_png", return_value=b"PNGBYTES")
@patch("zordms_ai.pipeline.preprocess.convert_from_bytes")
def test_pdf_produces_one_png_per_page(mock_convert, _mock_encode):
    mock_convert.return_value = [MagicMock(), MagicMock()]  # two pages
    pages = to_page_images(b"%PDF-1.7 fake", "application/pdf")
    assert pages == [b"PNGBYTES", b"PNGBYTES"]
    mock_convert.assert_called_once()
    assert mock_convert.call_args.kwargs["dpi"] == 300


@patch("zordms_ai.pipeline.preprocess._reencode_image_to_png", return_value=b"IMGPNG")
def test_image_produces_single_png(_mock_reencode):
    pages = to_page_images(b"\x89PNG fake", "image/png")
    assert pages == [b"IMGPNG"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/ai && uv run pytest tests/test_preprocess.py -v`
Expected: FAIL — `zordms_ai.pipeline.preprocess` not found.

- [ ] **Step 3: Write `preprocess.py`**

`services/ai/src/zordms_ai/pipeline/__init__.py`: (empty file)

```python
from __future__ import annotations

import base64
import io

from pdf2image import convert_from_bytes
from PIL import Image


def _encode_png(image: "Image.Image") -> bytes:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def _reencode_image_to_png(raw: bytes) -> bytes:
    image = Image.open(io.BytesIO(raw)).convert("RGB")
    return _encode_png(image)


def to_page_images(raw: bytes, content_type: str) -> list[bytes]:
    if content_type == "application/pdf":
        pages = convert_from_bytes(raw, dpi=300)
        return [_encode_png(p) for p in pages]
    return [_reencode_image_to_png(raw)]


def b64_png(png_bytes: bytes) -> str:
    return base64.b64encode(png_bytes).decode("ascii")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/ai && uv run pytest tests/test_preprocess.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/ai/src/zordms_ai/pipeline/__init__.py services/ai/src/zordms_ai/pipeline/preprocess.py services/ai/tests/test_preprocess.py
git commit -m "feat(ai): PDF/image preprocessing to 300-DPI PNG pages

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Pipeline orchestrator (preprocess → classify → route → extract → catalog payload)

**Files:**
- Create: `services/ai/src/zordms_ai/pipeline/orchestrator.py`
- Test: `services/ai/tests/test_orchestrator.py`

**Interfaces:**
- Consumes: `Classifier`, `Extractor`, `route_by_confidence`, `enqueue`, `b64_png`, `to_page_images`.
- Produces:
  - `CatalogHandoff` (Pydantic model): `doc_id: str`, `doc_type: str`, `confidence: float`, `catalog_assignment: str`, `review_required: bool`, `metadata: dict | None` (the validated extraction as a dict, or None when held) — the payload Core DMS consumes for auto-cataloging/directory mapping.
  - `IdpOutcome` (dataclass): `decision: RouteDecision`, `classify: ClassifyResult`, `extract: ExtractResult | None`, `handoff: CatalogHandoff`, `review_item_id: int | None`.
  - `Orchestrator(classifier, extractor, session_factory)` with:
    - `async process(self, *, doc_id, raw, content_type, ocr_text="", now) -> IdpOutcome` — preprocess first page → classify → route. If `decision.proceed_to_extract`: extract; build handoff with metadata. If review required (low conf or invalid extract): `enqueue` a review item and set `review_item_id`. When `not proceed_to_extract`, `extract` is None and `metadata` is None (held).

- [ ] **Step 1: Write the failing test (fakes for classifier/extractor)**

`services/ai/tests/test_orchestrator.py`:
```python
from datetime import datetime

import pytest

from zordms_ai.classify.classifier import ClassifyResult
from zordms_ai.db import Base, make_engine, make_session_factory
from zordms_ai.extract.extractor import ExtractResult
from zordms_ai.pipeline.orchestrator import Orchestrator
from zordms_ai.review.service import list_pending
from zordms_ai.schemas.cid import BTCid4G

NOW = datetime(2026, 6, 23, 10, 0, 0)


def _session_factory():
    engine = make_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    return make_session_factory(engine)


class FakeClassifier:
    def __init__(self, result):
        self.result = result

    async def classify(self, image_b64, ocr_text=""):
        return self.result


class FakeExtractor:
    def __init__(self, result):
        self.result = result

    async def extract(self, doc_type, image_b64):
        return self.result


_VALID_CID = BTCid4G(
    doc_type="BT_CID_4G", cid_no="10112345678", full_name="Sonam",
    dob="1990-04-12", sex="M", issue_date="2025-01-01", expiry_date="2035-01-01",
    dzongkhag="Thimphu", confidence=0.95,
)


@pytest.mark.asyncio
async def test_happy_path_high_confidence(monkeypatch):
    monkeypatch.setattr(
        "zordms_ai.pipeline.orchestrator.to_page_images", lambda raw, ct: [b"PNG"]
    )
    orch = Orchestrator(
        FakeClassifier(ClassifyResult(doc_type="BT_CID_4G", confidence=0.95, signals=[])),
        FakeExtractor(ExtractResult("BT_CID_4G", _VALID_CID, None, True, [], False)),
        _session_factory(),
    )
    out = await orch.process(doc_id="d1", raw=b"x", content_type="image/png", now=NOW)
    assert out.handoff.doc_type == "BT_CID_4G"
    assert out.handoff.catalog_assignment == "full"
    assert out.handoff.review_required is False
    assert out.handoff.metadata["cid_no"] == "10112345678"
    assert out.review_item_id is None


@pytest.mark.asyncio
async def test_low_confidence_holds_and_enqueues_review(monkeypatch):
    monkeypatch.setattr(
        "zordms_ai.pipeline.orchestrator.to_page_images", lambda raw, ct: [b"PNG"]
    )
    sf = _session_factory()
    orch = Orchestrator(
        FakeClassifier(ClassifyResult(doc_type="BT_CID_4G", confidence=0.60, signals=[])),
        FakeExtractor(ExtractResult("BT_CID_4G", _VALID_CID, None, True, [], False)),
        sf,
    )
    out = await orch.process(doc_id="d2", raw=b"x", content_type="image/png", now=NOW)
    assert out.decision.proceed_to_extract is False
    assert out.extract is None
    assert out.handoff.metadata is None
    assert out.handoff.catalog_assignment == "pending"
    assert out.review_item_id is not None
    with sf() as s:
        assert [i.doc_id for i in list_pending(s)] == ["d2"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/ai && uv run pytest tests/test_orchestrator.py -v`
Expected: FAIL — `zordms_ai.pipeline.orchestrator` not found.

- [ ] **Step 3: Write `orchestrator.py`**

```python
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime

from pydantic import BaseModel

from zordms_ai.classify.classifier import ClassifyResult
from zordms_ai.extract.extractor import ExtractResult
from zordms_ai.pipeline.preprocess import b64_png, to_page_images
from zordms_ai.review.service import enqueue
from zordms_ai.routing.confidence import RouteDecision, route_by_confidence


class CatalogHandoff(BaseModel):
    doc_id: str
    doc_type: str
    confidence: float
    catalog_assignment: str
    review_required: bool
    metadata: dict | None = None


@dataclass
class IdpOutcome:
    decision: RouteDecision
    classify: ClassifyResult
    extract: ExtractResult | None
    handoff: CatalogHandoff
    review_item_id: int | None


class Orchestrator:
    def __init__(self, classifier, extractor, session_factory) -> None:
        self._classifier = classifier
        self._extractor = extractor
        self._sf = session_factory

    async def process(
        self,
        *,
        doc_id: str,
        raw: bytes,
        content_type: str,
        ocr_text: str = "",
        now: datetime,
    ) -> IdpOutcome:
        first_page = to_page_images(raw, content_type)[0]
        image_b64 = b64_png(first_page)

        classify = await self._classifier.classify(image_b64=image_b64, ocr_text=ocr_text)
        decision = route_by_confidence(classify.confidence)

        extract: ExtractResult | None = None
        metadata: dict | None = None
        review_required = decision.review_required

        if decision.proceed_to_extract:
            extract = await self._extractor.extract(classify.doc_type, image_b64)
            if extract.valid and extract.data is not None:
                metadata = extract.data.model_dump(mode="json")
                review_required = review_required or extract.review_flag
            else:
                metadata = None
                review_required = True

        handoff = CatalogHandoff(
            doc_id=doc_id,
            doc_type=classify.doc_type,
            confidence=classify.confidence,
            catalog_assignment=decision.catalog_assignment,
            review_required=review_required,
            metadata=metadata,
        )

        review_item_id: int | None = None
        if review_required:
            payload = json.dumps(metadata if metadata is not None else (extract.partial if extract else {}))
            with self._sf() as session:
                item = enqueue(
                    session,
                    doc_id=doc_id,
                    doc_type=classify.doc_type,
                    confidence=classify.confidence,
                    decision=decision,
                    payload_json=payload,
                    now=now,
                )
                review_item_id = item.id

        return IdpOutcome(
            decision=decision,
            classify=classify,
            extract=extract,
            handoff=handoff,
            review_item_id=review_item_id,
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/ai && uv run pytest tests/test_orchestrator.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add services/ai/src/zordms_ai/pipeline/orchestrator.py services/ai/tests/test_orchestrator.py
git commit -m "feat(ai): IDP orchestrator (classify->route->extract->catalog hand-off)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Tesseract fallback OCR (mocked in tests) + `/ocr` endpoint

**Files:**
- Create: `services/ai/src/zordms_ai/ocr/__init__.py`, `services/ai/src/zordms_ai/ocr/tesseract.py`, `services/ai/src/zordms_ai/api/__init__.py`, `services/ai/src/zordms_ai/api/ocr.py`
- Modify: `services/ai/src/zordms_ai/app.py` (mount the OCR router)
- Test: `services/ai/tests/test_ocr.py`

**Interfaces:**
- Produces:
  - `ocr_text(png_bytes: bytes, lang: str = "eng") -> str` — opens the image via Pillow and calls `pytesseract.image_to_string`; both are the test seams.
  - `ocr_router` (FastAPI `APIRouter`): `POST /ocr` (multipart `file`) → `{ "engine": "tesseract", "text": <str> }`.
  - `create_app` now includes `app.include_router(ocr_router)`.

- [ ] **Step 1: Write the failing test (mock pytesseract + Pillow)**

`services/ai/tests/test_ocr.py`:
```python
import io
from unittest.mock import patch

from fastapi.testclient import TestClient

from zordms_ai.app import create_app
from zordms_ai.ocr.tesseract import ocr_text
from zordms_ai.settings import Settings


@patch("zordms_ai.ocr.tesseract.pytesseract.image_to_string", return_value="HELLO BoB")
@patch("zordms_ai.ocr.tesseract.Image.open")
def test_ocr_text_calls_tesseract(mock_open, _mock_str):
    assert ocr_text(b"\x89PNG", lang="eng") == "HELLO BoB"
    mock_open.assert_called_once()


@patch("zordms_ai.ocr.tesseract.pytesseract.image_to_string", return_value="SCANNED")
@patch("zordms_ai.ocr.tesseract.Image.open")
def test_ocr_endpoint_returns_text(_mock_open, _mock_str):
    app = create_app(Settings(database_url="sqlite+pysqlite:///:memory:"))
    client = TestClient(app)
    res = client.post("/ocr", files={"file": ("x.png", io.BytesIO(b"\x89PNG"), "image/png")})
    assert res.status_code == 200
    body = res.json()
    assert body["engine"] == "tesseract"
    assert body["text"] == "SCANNED"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/ai && uv run pytest tests/test_ocr.py -v`
Expected: FAIL — `zordms_ai.ocr.tesseract` / `zordms_ai.api.ocr` not found.

- [ ] **Step 3: Write `ocr/tesseract.py`**

`services/ai/src/zordms_ai/ocr/__init__.py`: (empty file)

```python
from __future__ import annotations

import io

import pytesseract
from PIL import Image


def ocr_text(png_bytes: bytes, lang: str = "eng") -> str:
    image = Image.open(io.BytesIO(png_bytes))
    return pytesseract.image_to_string(image, lang=lang)
```

- [ ] **Step 4: Write `api/ocr.py`**

`services/ai/src/zordms_ai/api/__init__.py`: (empty file)

```python
from __future__ import annotations

from fastapi import APIRouter, File, UploadFile

from zordms_ai.ocr.tesseract import ocr_text

ocr_router = APIRouter()


@ocr_router.post("/ocr")
async def ocr_endpoint(file: UploadFile = File(...)) -> dict:
    raw = await file.read()
    return {"engine": "tesseract", "text": ocr_text(raw)}
```

- [ ] **Step 5: Mount the router in `app.py`**

In `services/ai/src/zordms_ai/app.py`, add the import and the `include_router` call:
```python
from fastapi import FastAPI

from zordms_ai.api.ocr import ocr_router
from zordms_ai.settings import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="ZorDMS AI / IDP", version="0.1.0")
    app.state.settings = settings

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "ai-idp", "mode": settings.inference_mode}

    app.include_router(ocr_router)
    return app
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd services/ai && uv run pytest tests/test_ocr.py -v`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add services/ai/src/zordms_ai/ocr/__init__.py services/ai/src/zordms_ai/ocr/tesseract.py services/ai/src/zordms_ai/api/__init__.py services/ai/src/zordms_ai/api/ocr.py services/ai/src/zordms_ai/app.py services/ai/tests/test_ocr.py
git commit -m "feat(ai): Tesseract fallback OCR + /ocr endpoint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: IDP API endpoints — `/idp/classify`, `/idp/extract`, `/idp/process`

**Files:**
- Create: `services/ai/src/zordms_ai/api/idp.py`
- Modify: `services/ai/src/zordms_ai/app.py` (wire dependencies + mount `idp_router`)
- Test: `services/ai/tests/test_api_idp.py`

**Interfaces:**
- Consumes: `Classifier`, `Extractor`, `Orchestrator`, `VLLMClient`, `to_page_images`, `b64_png`.
- Produces:
  - App state wiring: `create_app` builds `app.state.vllm`, `app.state.classifier`, `app.state.extractor`, `app.state.orchestrator`, `app.state.session_factory` from settings. A `make_components(settings)` helper returns these so tests can override `app.state` with fakes.
  - `idp_router`:
    - `POST /idp/classify` (multipart `file`, optional form `ocr_text`) → `ClassifyResult` JSON.
    - `POST /idp/extract` (multipart `file`, form `doc_type`) → extract result `{doc_type, valid, review_flag, data|partial, errors}`.
    - `POST /idp/process` (multipart `file`, form `doc_id`, optional `ocr_text`) → `{handoff, decision, review_item_id}`.

- [ ] **Step 1: Write the failing test (override app.state with fakes)**

`services/ai/tests/test_api_idp.py`:
```python
import io
from datetime import datetime

from fastapi.testclient import TestClient

from zordms_ai.app import create_app
from zordms_ai.classify.classifier import ClassifyResult
from zordms_ai.extract.extractor import ExtractResult
from zordms_ai.pipeline.orchestrator import CatalogHandoff, IdpOutcome
from zordms_ai.routing.confidence import route_by_confidence
from zordms_ai.schemas.cid import BTCid4G
from zordms_ai.settings import Settings

_CID = BTCid4G(
    doc_type="BT_CID_4G", cid_no="10112345678", full_name="Sonam",
    dob="1990-04-12", sex="M", issue_date="2025-01-01", expiry_date="2035-01-01",
    dzongkhag="Thimphu", confidence=0.95,
)


class FakeClassifier:
    async def classify(self, image_b64, ocr_text=""):
        return ClassifyResult(doc_type="BT_CID_4G", confidence=0.95, signals=["ID_REGEX:10112345678"])


class FakeExtractor:
    async def extract(self, doc_type, image_b64):
        return ExtractResult(doc_type, _CID, None, True, [], False)


class FakeOrchestrator:
    async def process(self, *, doc_id, raw, content_type, ocr_text="", now):
        return IdpOutcome(
            decision=route_by_confidence(0.95),
            classify=ClassifyResult(doc_type="BT_CID_4G", confidence=0.95, signals=[]),
            extract=None,
            handoff=CatalogHandoff(
                doc_id=doc_id, doc_type="BT_CID_4G", confidence=0.95,
                catalog_assignment="full", review_required=False,
                metadata=_CID.model_dump(mode="json"),
            ),
            review_item_id=None,
        )


def _client() -> TestClient:
    app = create_app(Settings(database_url="sqlite+pysqlite:///:memory:"))
    app.state.classifier = FakeClassifier()
    app.state.extractor = FakeExtractor()
    app.state.orchestrator = FakeOrchestrator()
    return TestClient(app)


def _png():
    return ("x.png", io.BytesIO(b"\x89PNG"), "image/png")


def test_classify_endpoint():
    res = _client().post("/idp/classify", files={"file": _png()}, data={"ocr_text": "10112345678"})
    assert res.status_code == 200
    assert res.json()["doc_type"] == "BT_CID_4G"


def test_extract_endpoint():
    res = _client().post("/idp/extract", files={"file": _png()}, data={"doc_type": "BT_CID_4G"})
    assert res.status_code == 200
    body = res.json()
    assert body["valid"] is True
    assert body["data"]["cid_no"] == "10112345678"


def test_process_endpoint():
    res = _client().post("/idp/process", files={"file": _png()}, data={"doc_id": "d1"})
    assert res.status_code == 200
    body = res.json()
    assert body["handoff"]["doc_type"] == "BT_CID_4G"
    assert body["handoff"]["catalog_assignment"] == "full"
    assert body["review_item_id"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/ai && uv run pytest tests/test_api_idp.py -v`
Expected: FAIL — `zordms_ai.api.idp` not found.

- [ ] **Step 3: Write `api/idp.py`**

```python
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
```

- [ ] **Step 4: Wire components into `app.py`**

Replace `services/ai/src/zordms_ai/app.py` with:
```python
from fastapi import FastAPI

from zordms_ai.api.idp import idp_router
from zordms_ai.api.ocr import ocr_router
from zordms_ai.classify.classifier import Classifier
from zordms_ai.db import Base, make_engine, make_session_factory
from zordms_ai.extract.extractor import Extractor
from zordms_ai.inference.vllm_client import VLLMClient
from zordms_ai.pipeline.orchestrator import Orchestrator
from zordms_ai.settings import Settings, get_settings


def make_components(settings: Settings):
    engine = make_engine(settings.database_url)
    Base.metadata.create_all(engine)
    session_factory = make_session_factory(engine)
    vllm = VLLMClient(settings.vllm_base_url, settings.vllm_api_key, settings.request_timeout_s)
    classifier = Classifier(vllm, settings.classifier_model)
    extractor = Extractor(vllm, settings.extractor_model)
    orchestrator = Orchestrator(classifier, extractor, session_factory)
    return {
        "vllm": vllm,
        "session_factory": session_factory,
        "classifier": classifier,
        "extractor": extractor,
        "orchestrator": orchestrator,
    }


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="ZorDMS AI / IDP", version="0.1.0")
    app.state.settings = settings
    for key, value in make_components(settings).items():
        setattr(app.state, key, value)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "ai-idp", "mode": settings.inference_mode}

    app.include_router(ocr_router)
    app.include_router(idp_router)
    return app
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services/ai && uv run pytest tests/test_api_idp.py tests/test_health.py tests/test_ocr.py -v`
Expected: PASS (health + ocr + 3 idp tests).

- [ ] **Step 6: Commit**

```bash
git add services/ai/src/zordms_ai/api/idp.py services/ai/src/zordms_ai/app.py services/ai/tests/test_api_idp.py
git commit -m "feat(ai): /idp/classify, /idp/extract, /idp/process endpoints + DI wiring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: Review API endpoints — `/idp/review/*`

**Files:**
- Create: `services/ai/src/zordms_ai/api/review.py`
- Modify: `services/ai/src/zordms_ai/app.py` (mount `review_router`)
- Test: `services/ai/tests/test_api_review.py`

**Interfaces:**
- Consumes: `list_pending`, `claim`, `resolve`, `enqueue`, `app.state.session_factory`.
- Produces:
  - `review_router` (prefix `/idp/review`):
    - `GET /idp/review/pending` → list of pending items (id, doc_id, doc_type, confidence, band, sla_hours, sla_deadline, status).
    - `POST /idp/review/{item_id}/claim` (form `user_id`) → claimed item; 409 on conflict.
    - `POST /idp/review/{item_id}/resolve` (form `resolution`) → resolved item.

- [ ] **Step 1: Write the failing test (seed via the queue service)**

`services/ai/tests/test_api_review.py`:
```python
from datetime import datetime

from fastapi.testclient import TestClient

from zordms_ai.app import create_app
from zordms_ai.review.service import enqueue
from zordms_ai.routing.confidence import route_by_confidence
from zordms_ai.settings import Settings


def _client_with_item():
    app = create_app(Settings(database_url="sqlite+pysqlite:///:memory:"))
    with app.state.session_factory() as s:
        item = enqueue(
            s, doc_id="d1", doc_type="BT_CID_4G", confidence=0.60,
            decision=route_by_confidence(0.60), payload_json="{}",
            now=datetime(2026, 6, 23, 10, 0, 0),
        )
        item_id = item.id
    return TestClient(app), item_id


def test_list_pending():
    client, _ = _client_with_item()
    res = client.get("/idp/review/pending")
    assert res.status_code == 200
    rows = res.json()
    assert rows[0]["doc_id"] == "d1"
    assert rows[0]["sla_hours"] == 24


def test_claim_then_resolve():
    client, item_id = _client_with_item()
    c = client.post(f"/idp/review/{item_id}/claim", data={"user_id": "STAFF9"})
    assert c.status_code == 200
    assert c.json()["status"] == "CLAIMED"
    r = client.post(f"/idp/review/{item_id}/resolve", data={"resolution": "APPROVED"})
    assert r.status_code == 200
    assert r.json()["status"] == "RESOLVED"


def test_double_claim_conflict():
    client, item_id = _client_with_item()
    client.post(f"/idp/review/{item_id}/claim", data={"user_id": "A"})
    again = client.post(f"/idp/review/{item_id}/claim", data={"user_id": "B"})
    assert again.status_code == 409
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/ai && uv run pytest tests/test_api_review.py -v`
Expected: FAIL — `zordms_ai.api.review` not found.

- [ ] **Step 3: Write `api/review.py`**

```python
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Form, HTTPException, Request

from zordms_ai.review.models import ReviewItem
from zordms_ai.review.service import claim, list_pending, resolve

review_router = APIRouter(prefix="/idp/review")


def _dump(item: ReviewItem) -> dict:
    return {
        "id": item.id,
        "doc_id": item.doc_id,
        "doc_type": item.doc_type,
        "confidence": item.confidence,
        "band": item.band,
        "sla_hours": item.sla_hours,
        "sla_deadline": item.sla_deadline.isoformat() if item.sla_deadline else None,
        "status": item.status,
        "claimed_by": item.claimed_by,
        "resolution": item.resolution,
    }


@review_router.get("/pending")
def pending(request: Request) -> list[dict]:
    with request.app.state.session_factory() as session:
        return [_dump(i) for i in list_pending(session)]


@review_router.post("/{item_id}/claim")
def claim_item(request: Request, item_id: int, user_id: str = Form(...)) -> dict:
    with request.app.state.session_factory() as session:
        try:
            item = claim(session, item_id, user_id)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return _dump(item)


@review_router.post("/{item_id}/resolve")
def resolve_item(request: Request, item_id: int, resolution: str = Form(...)) -> dict:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    with request.app.state.session_factory() as session:
        item = resolve(session, item_id, resolution, now=now)
        return _dump(item)
```

- [ ] **Step 4: Mount the router in `app.py`**

In `services/ai/src/zordms_ai/app.py`, add the import and mount after `idp_router`:
```python
from zordms_ai.api.review import review_router
```
and inside `create_app`, after `app.include_router(idp_router)`:
```python
    app.include_router(review_router)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services/ai && uv run pytest tests/test_api_review.py -v`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the full Python suite**

Run: `cd services/ai && uv run pytest -v`
Expected: PASS (all tests green).

- [ ] **Step 7: Commit**

```bash
git add services/ai/src/zordms_ai/api/review.py services/ai/src/zordms_ai/app.py services/ai/tests/test_api_review.py
git commit -m "feat(ai): /idp/review pending/claim/resolve endpoints

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 18: Air-gapped deployment artifacts (Dockerfile + README + CPU-degraded mode)

**Files:**
- Create: `services/ai/Dockerfile`, `services/ai/README.md`
- Test: `services/ai/tests/test_inference_mode.py`

**Interfaces:**
- Consumes: `Settings`.
- Produces:
  - A documented air-gap deployment story (vLLM serving Granite 3.2 Vision 2B + Qwen2.5-VL 7B; offline HuggingFace model bundle; offline Harbor registry; RKE2; NVIDIA L40S; NFS PVC) and a CPU/degraded mode for pre-GPU validation.
  - `Settings.is_degraded` property (`inference_mode == "cpu_degraded"`) so callers can pick smaller substitute models / relax timeouts; tested.
  - A Dockerfile that builds the FastAPI service image (model weights mounted from the NFS PVC at runtime, never baked in — air-gap requirement).

- [ ] **Step 1: Write the failing test**

`services/ai/tests/test_inference_mode.py`:
```python
from zordms_ai.settings import Settings


def test_gpu_mode_not_degraded():
    assert Settings(inference_mode="gpu").is_degraded is False


def test_cpu_degraded_mode_flag():
    s = Settings(inference_mode="cpu_degraded")
    assert s.is_degraded is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/ai && uv run pytest tests/test_inference_mode.py -v`
Expected: FAIL — `Settings` has no attribute `is_degraded`.

- [ ] **Step 3: Add the `is_degraded` property to `settings.py`**

Add to the `Settings` class in `services/ai/src/zordms_ai/settings.py`:
```python
    @property
    def is_degraded(self) -> bool:
        return self.inference_mode == "cpu_degraded"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/ai && uv run pytest tests/test_inference_mode.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the Dockerfile**

`services/ai/Dockerfile`:
```dockerfile
# ZorDMS AI / IDP — FastAPI service image.
# Model weights are NOT baked in; they are mounted from the NFS PVC at runtime
# (air-gap requirement). vLLM runs as a separate GPU pod serving an
# OpenAI-compatible API; this image only needs the HTTP client.
FROM python:3.11-slim AS base

# Tesseract for fallback OCR + poppler for pdf2image
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN pip install --no-cache-dir uv
COPY pyproject.toml ./
COPY src ./src
RUN uv pip install --system --no-cache .

ENV INFERENCE_MODE=gpu
EXPOSE 8080
CMD ["uvicorn", "zordms_ai.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8080"]
```

- [ ] **Step 6: Write the README**

`services/ai/README.md`:
```markdown
# ZorDMS AI / IDP Service (service #7)

Two-stage Intelligent Document Processing for Bank of Bhutan, per the IDP design
(`docs/superpowers/specs/2026-06-23-zordms-idp-design.md`).

## Pipeline
`POST /idp/process` → preprocess (PDF/image → 300 DPI PNG) → **Stage 1 classify**
(Granite 3.2 Vision 2B) → **confidence router** (§6.4 bands) → **Stage 2 extract**
(Qwen2.5-VL 7B, constrained JSON, Pydantic-validated) → catalog hand-off payload for Core DMS.
Low-confidence / invalid documents are routed to the human-review queue (`/idp/review/*`)
with 24/48-hr SLAs. Tesseract is the fallback OCR engine (`/ocr`).

## Inference stack (production, air-gapped — IDP §7.1, arch §9)
- **vLLM 0.6.x** serving an OpenAI-compatible API (`VLLM_BASE_URL`).
- **NVIDIA L40S × ≥2** GPU nodes on **RKE2** Kubernetes; scaled via HPA (1–4 GPU pods).
- **Offline HuggingFace model bundle** for Granite 3.2 Vision 2B (INT4/AWQ) and
  Qwen2.5-VL 7B (Q4/GPTQ), stored on a **shared NFS PVC**; weights are never baked into
  the image (air-gap).
- **Offline Harbor registry** holds all pre-bundled container images.
- Thimphu DC + DR site, no cloud dependency; data residency + RAA/RMA audit are first-class.

## CPU / degraded mode (pre-GPU validation — arch §10, roadmap P1)
Set `INFERENCE_MODE=cpu_degraded` and point `VLLM_BASE_URL` at a CPU vLLM (or substitute
smaller models via `CLASSIFIER_MODEL` / `EXTRACTOR_MODEL`). This validates the full pipeline
before the L40S nodes land (4–6 month GPU lead time to Bhutan). `Settings.is_degraded` is
the runtime flag.

## Performance targets (IDP §7.3)
Classifier P95 ≤ 700 ms/page · Extractor P95 ≤ 5 s/page · End-to-end ≤ 8 s/page ·
≥ 600 pages/hr · CID classify ≥ 95% · field accuracy ≥ 90% · review rate ≤ 8%.

## Database
SQLAlchemy `DATABASE_URL` switch: `postgresql+psycopg://…` ⇄ `oracle+oracledb://…`.
Migrations via Alembic (`alembic upgrade head`). Tests use in-memory SQLite.

## Run
```bash
uv sync --extra dev
uv run alembic upgrade head
uv run uvicorn zordms_ai.app:create_app --factory --reload
uv run pytest
```
```

- [ ] **Step 7: Commit**

```bash
git add services/ai/Dockerfile services/ai/README.md services/ai/src/zordms_ai/settings.py services/ai/tests/test_inference_mode.py
git commit -m "feat(ai): air-gapped Dockerfile, deployment README, CPU-degraded mode flag

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 19: React — typed AI API client

**Files:**
- Create: `apps/web/src/api/aiClient.ts`
- Test: `apps/web/src/api/aiClient.test.ts`

**Interfaces:**
- Produces (TypeScript):
  - `ClassifyResult = { doc_type: string; confidence: number; signals: string[] }`.
  - `CatalogHandoff = { doc_id: string; doc_type: string; confidence: number; catalog_assignment: string; review_required: boolean; metadata: Record<string, unknown> | null }`.
  - `ReviewRow = { id: number; doc_id: string; doc_type: string; confidence: number; band: string; sla_hours: number | null; sla_deadline: string | null; status: string }`.
  - `classifyDoc(file: File, ocrText?: string): Promise<ClassifyResult>`.
  - `processDoc(file: File, docId: string): Promise<{ handoff: CatalogHandoff; decision: { band: string; action: string }; review_item_id: number | null }>`.
  - `listPending(): Promise<ReviewRow[]>`, `claimReview(id: number, userId: string): Promise<ReviewRow>`, `resolveReview(id: number, resolution: string): Promise<ReviewRow>`.
  - Base URL from `import.meta.env.VITE_AI_BASE_URL` (default `/api/ai`).

- [ ] **Step 1: Write the failing test (mock fetch)**

`apps/web/src/api/aiClient.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { classifyDoc, listPending, processDoc } from "./aiClient";

beforeEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(body: unknown, ok = true) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch);
}

describe("aiClient", () => {
  it("classifyDoc posts multipart and returns the result", async () => {
    mockFetch({ doc_type: "BT_CID_4G", confidence: 0.95, signals: [] });
    const res = await classifyDoc(new File(["x"], "x.png"), "10112345678");
    expect(res.doc_type).toBe("BT_CID_4G");
    expect((fetch as any).mock.calls[0][0]).toContain("/idp/classify");
  });

  it("processDoc returns handoff + review item id", async () => {
    mockFetch({ handoff: { doc_id: "d1", doc_type: "BT_CID_4G", confidence: 0.95, catalog_assignment: "full", review_required: false, metadata: {} }, decision: { band: ">=0.92", action: "AUTO_APPROVE" }, review_item_id: null });
    const res = await processDoc(new File(["x"], "x.png"), "d1");
    expect(res.handoff.catalog_assignment).toBe("full");
    expect(res.review_item_id).toBeNull();
  });

  it("listPending returns rows", async () => {
    mockFetch([{ id: 1, doc_id: "d1", doc_type: "BT_CID_4G", confidence: 0.6, band: "0.50-0.69", sla_hours: 24, sla_deadline: null, status: "PENDING" }]);
    const rows = await listPending();
    expect(rows[0].band).toBe("0.50-0.69");
  });

  it("throws on non-ok response", async () => {
    mockFetch({ detail: "boom" }, false);
    await expect(listPending()).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/web test aiClient`
Expected: FAIL — `./aiClient` not found.

- [ ] **Step 3: Write `aiClient.ts`**

```ts
const BASE = (import.meta.env.VITE_AI_BASE_URL as string) ?? "/api/ai";

export interface ClassifyResult { doc_type: string; confidence: number; signals: string[]; }
export interface CatalogHandoff {
  doc_id: string; doc_type: string; confidence: number;
  catalog_assignment: string; review_required: boolean;
  metadata: Record<string, unknown> | null;
}
export interface ProcessResult {
  handoff: CatalogHandoff;
  decision: { band: string; action: string };
  review_item_id: number | null;
}
export interface ReviewRow {
  id: number; doc_id: string; doc_type: string; confidence: number;
  band: string; sla_hours: number | null; sla_deadline: string | null; status: string;
}

async function asJson<T>(res: { ok: boolean; json: () => Promise<unknown> }): Promise<T> {
  if (!res.ok) throw new Error("AI service request failed");
  return (await res.json()) as T;
}

export async function classifyDoc(file: File, ocrText = ""): Promise<ClassifyResult> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("ocr_text", ocrText);
  return asJson<ClassifyResult>(await fetch(`${BASE}/idp/classify`, { method: "POST", body: fd }));
}

export async function processDoc(file: File, docId: string): Promise<ProcessResult> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("doc_id", docId);
  return asJson<ProcessResult>(await fetch(`${BASE}/idp/process`, { method: "POST", body: fd }));
}

export async function listPending(): Promise<ReviewRow[]> {
  return asJson<ReviewRow[]>(await fetch(`${BASE}/idp/review/pending`));
}

export async function claimReview(id: number, userId: string): Promise<ReviewRow> {
  const fd = new FormData();
  fd.append("user_id", userId);
  return asJson<ReviewRow>(await fetch(`${BASE}/idp/review/${id}/claim`, { method: "POST", body: fd }));
}

export async function resolveReview(id: number, resolution: string): Promise<ReviewRow> {
  const fd = new FormData();
  fd.append("resolution", resolution);
  return asJson<ReviewRow>(await fetch(`${BASE}/idp/review/${id}/resolve`, { method: "POST", body: fd }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zordms/web test aiClient`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/aiClient.ts apps/web/src/api/aiClient.test.ts
git commit -m "feat(web): typed AI/IDP API client

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 20: React — ConfidenceBadge + AI Engine screen

**Files:**
- Create: `apps/web/src/components/ConfidenceBadge.tsx`, `apps/web/src/pages/AiEngine.tsx`
- Test: `apps/web/src/pages/AiEngine.test.tsx`

**Interfaces:**
- Consumes: `processDoc`, `CatalogHandoff` from `aiClient`.
- Produces:
  - `bandFor(confidence: number): { label: string; tone: "green"|"teal"|"amber"|"orange"|"red" }` mirroring IDP §6.4 (≥0.92 green / ≥0.85 teal / ≥0.70 amber / ≥0.50 orange / else red).
  - `ConfidenceBadge({ confidence }: { confidence: number })` — a pill rendering the band label.
  - `AiEngine()` — file input + "Process" button; on submit calls `processDoc`, shows doc_type, a `ConfidenceBadge`, catalog assignment, and (if `review_required`) a "Routed to review" notice.

- [ ] **Step 1: Write the failing test**

`apps/web/src/pages/AiEngine.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { bandFor } from "../components/ConfidenceBadge";
import AiEngine from "./AiEngine";
import * as api from "../api/aiClient";

describe("bandFor", () => {
  it("maps confidence to bands", () => {
    expect(bandFor(0.95).tone).toBe("green");
    expect(bandFor(0.88).tone).toBe("teal");
    expect(bandFor(0.75).tone).toBe("amber");
    expect(bandFor(0.6).tone).toBe("orange");
    expect(bandFor(0.4).tone).toBe("red");
  });
});

describe("AiEngine", () => {
  it("processes a file and shows the result", async () => {
    vi.spyOn(api, "processDoc").mockResolvedValue({
      handoff: { doc_id: "d1", doc_type: "BT_CID_4G", confidence: 0.95, catalog_assignment: "full", review_required: false, metadata: {} },
      decision: { band: ">=0.92", action: "AUTO_APPROVE" },
      review_item_id: null,
    });
    render(<AiEngine />);
    const input = screen.getByLabelText(/document/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "cid.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: /process/i }));
    await waitFor(() => expect(screen.getByText("BT_CID_4G")).toBeInTheDocument());
    expect(screen.getByText(/auto-approve/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/web test AiEngine`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `ConfidenceBadge.tsx`**

```tsx
export type Tone = "green" | "teal" | "amber" | "orange" | "red";

export function bandFor(confidence: number): { label: string; tone: Tone } {
  if (confidence >= 0.92) return { label: "Auto-approve (≥0.92)", tone: "green" };
  if (confidence >= 0.85) return { label: "Auto-verified (0.85–0.91)", tone: "teal" };
  if (confidence >= 0.70) return { label: "Supervisor review (0.70–0.84)", tone: "amber" };
  if (confidence >= 0.50) return { label: "Human review (0.50–0.69)", tone: "orange" };
  return { label: "Rejected (<0.50)", tone: "red" };
}

const COLORS: Record<Tone, string> = {
  green: "#1a7f37", teal: "#0e7490", amber: "#b45309", orange: "#c2410c", red: "#b91c1c",
};

export default function ConfidenceBadge({ confidence }: { confidence: number }) {
  const band = bandFor(confidence);
  return (
    <span
      data-tone={band.tone}
      style={{ background: COLORS[band.tone], color: "white", borderRadius: 12, padding: "2px 10px", fontSize: 12 }}
    >
      {band.label} · {(confidence * 100).toFixed(0)}%
    </span>
  );
}
```

- [ ] **Step 4: Write `AiEngine.tsx`**

```tsx
import { useState } from "react";
import { processDoc, type ProcessResult } from "../api/aiClient";
import ConfidenceBadge from "../components/ConfidenceBadge";

export default function AiEngine() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function onProcess() {
    if (!file) return;
    setBusy(true);
    try {
      setResult(await processDoc(file, `doc-${Date.now()}`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ padding: 24 }}>
      <h1>AI Engine — Document Processing</h1>
      <label>
        Document
        <input
          type="file"
          aria-label="document"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      <button onClick={onProcess} disabled={!file || busy}>
        {busy ? "Processing…" : "Process"}
      </button>

      {result && (
        <div style={{ marginTop: 16 }}>
          <h2>{result.handoff.doc_type}</h2>
          <ConfidenceBadge confidence={result.handoff.confidence} />
          <p>Action: {result.decision.action.replace(/_/g, " ").toLowerCase()}</p>
          <p>Catalog: {result.handoff.catalog_assignment}</p>
          {result.handoff.review_required && (
            <p data-testid="review-notice">Routed to human-review queue.</p>
          )}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @zordms/web test AiEngine`
Expected: PASS (band mapping + screen test).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ConfidenceBadge.tsx apps/web/src/pages/AiEngine.tsx apps/web/src/pages/AiEngine.test.tsx
git commit -m "feat(web): AI Engine screen + confidence-band badge

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 21: React — Human-Review queue screen (claim/resolve)

**Files:**
- Create: `apps/web/src/pages/ReviewQueue.tsx`
- Test: `apps/web/src/pages/ReviewQueue.test.tsx`

**Interfaces:**
- Consumes: `listPending`, `claimReview`, `resolveReview`, `ReviewRow` from `aiClient`; `ConfidenceBadge`.
- Produces:
  - `ReviewQueue()` — on mount loads `listPending`, renders a table (doc_id, doc_type, confidence badge, band, SLA hours, status); each pending row has **Claim**; each claimed row has **Approve** / **Reject** (calls `resolveReview`). Reloads the list after each action.

- [ ] **Step 1: Write the failing test**

`apps/web/src/pages/ReviewQueue.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ReviewQueue from "./ReviewQueue";
import * as api from "../api/aiClient";

const ROW = {
  id: 1, doc_id: "d1", doc_type: "BT_CID_4G", confidence: 0.6,
  band: "0.50-0.69", sla_hours: 24, sla_deadline: null, status: "PENDING",
};

describe("ReviewQueue", () => {
  it("lists pending items and claims one", async () => {
    vi.spyOn(api, "listPending")
      .mockResolvedValueOnce([ROW])
      .mockResolvedValueOnce([{ ...ROW, status: "CLAIMED" }]);
    const claim = vi.spyOn(api, "claimReview").mockResolvedValue({ ...ROW, status: "CLAIMED" });

    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByText("d1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /claim/i }));
    await waitFor(() => expect(claim).toHaveBeenCalledWith(1, expect.any(String)));
  });

  it("resolves a claimed item", async () => {
    vi.spyOn(api, "listPending").mockResolvedValue([{ ...ROW, status: "CLAIMED", claimed_by: "me" } as any]);
    const resolve = vi.spyOn(api, "resolveReview").mockResolvedValue({ ...ROW, status: "RESOLVED" });
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByText("d1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(1, "APPROVED"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/web test ReviewQueue`
Expected: FAIL — `./ReviewQueue` not found.

- [ ] **Step 3: Write `ReviewQueue.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import { listPending, claimReview, resolveReview, type ReviewRow } from "../api/aiClient";
import ConfidenceBadge from "../components/ConfidenceBadge";

const CURRENT_USER = "me"; // wired to AuthContext in the foundation plan

export default function ReviewQueue() {
  const [rows, setRows] = useState<ReviewRow[]>([]);

  const reload = useCallback(async () => {
    setRows(await listPending());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function onClaim(id: number) {
    await claimReview(id, CURRENT_USER);
    await reload();
  }

  async function onResolve(id: number, resolution: string) {
    await resolveReview(id, resolution);
    await reload();
  }

  return (
    <section style={{ padding: 24 }}>
      <h1>Human-Review Queue</h1>
      <table>
        <thead>
          <tr>
            <th>Doc ID</th><th>Type</th><th>Confidence</th><th>Band</th><th>SLA (h)</th><th>Status</th><th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.doc_id}</td>
              <td>{r.doc_type}</td>
              <td><ConfidenceBadge confidence={r.confidence} /></td>
              <td>{r.band}</td>
              <td>{r.sla_hours ?? "—"}</td>
              <td>{r.status}</td>
              <td>
                {r.status === "PENDING" && (
                  <button onClick={() => onClaim(r.id)}>Claim</button>
                )}
                {r.status === "CLAIMED" && (
                  <>
                    <button onClick={() => onResolve(r.id, "APPROVED")}>Approve</button>
                    <button onClick={() => onResolve(r.id, "REJECTED")}>Reject</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zordms/web test ReviewQueue`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full web test suite**

Run: `pnpm --filter @zordms/web test`
Expected: PASS (aiClient + AiEngine + ReviewQueue green).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/ReviewQueue.tsx apps/web/src/pages/ReviewQueue.test.tsx
git commit -m "feat(web): human-review queue screen with claim/resolve + SLA columns

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**IDP §3–§7 + tender items 9–16, 25 → task map:**

| Spec reference | Implemented by |
|---|---|
| §3.1 Pipeline position (Stage 0–4) | Tasks 13 (preprocess), 8 (classify), 10 (extract), 14 (orchestrate + catalog hand-off), 12/17 (review = downstream of routing) |
| §3.2.1 BT_CID_4G schema + validation (regex, ISO dates, ENUMs, review_flag<0.85) | Task 3 |
| §3.2.2 BT_PASSPORT schema | Task 4 |
| §3.2.3 BOB_LOAN_APPLICATION schema | Task 4 |
| §3.3 System-level metadata | Task 2 (`SystemMetadata`) |
| §4 Auto Cataloging (catalog_assignment, alert tiers) | Task 9 (`catalog_assignment` per band) + Task 14 (`CatalogHandoff` payload for Core); alert-tier population is Core/Notify's consumption of the hand-off (arch service #2/#4) |
| §5 Auto Directory Mapping | Task 14 hand-off carries doc_type + metadata; path-template resolution lives in Core DMS (Plan 2) per arch §4 service #2 — out of this Python service's scope |
| §6.1 Two-stage model architecture + partial-extraction fallback | Tasks 8, 10 (partial + review_flag) |
| §6.2 Doc-type registry | Task 5 |
| §6.3 Classification signal priority (MRZ/ID-regex pre-screen) | Tasks 5 (signal data) + 6 (pre-screen) |
| §6.4 Confidence threshold policy (bands/action/review/SLA) | Task 9 (router) + Task 12 (SLA queue) |
| §7.1 Inference stack (vLLM OpenAI-compatible, air-gapped) | Tasks 7 (client), 18 (Dockerfile/README) |
| §7.1 CPU-degraded mode | Task 18 (`is_degraded`) |
| §7.2 End-to-end flow | Task 14 |
| §7.3 Performance targets | Global Constraints (timeouts/SLOs); README documents them (Task 18) |
| Tender 9 — OCR auto classification + metadata | Tasks 8 + 10 (+ 15 Tesseract OCR) |
| Tender 10 — unlimited metadata fields / types | Tasks 2–4 (Pydantic models, extensible registry) |
| Tender 11 — mandatory/unique/searchable metadata | Tasks 3–4 (required fields, regex, indexed fields per §3.2) |
| Tender 12 — AI classify CID + Passport | Tasks 5, 6, 8 |
| Tender 13 — extract Name/DOB/DocNo/Expiry | Tasks 3, 4, 10 |
| Tender 14 / 25 — expiry alerts | `expiry_date` fields (Tasks 3–4) populate the hand-off (Task 14) that Core/Notify use for alert tiers (§4.3); alert dispatch is Notify (out of this service) |
| Tender 15–16 — repository folders + versioning | Directory path templates + versioning are Core DMS (Plan 2); this service supplies the typed hand-off (Task 14) |
| Human-review queue (arch §12, IDP §6.4 SLAs) | Tasks 11 (model/migration), 12 (service), 17 (API), 21 (UI) |
| AI Engine + Review UI (arch §12 React) | Tasks 19–21 |
| DB switch postgres⇄oracle (arch §5) | Tasks 1, 11 (`DATABASE_URL`, SQLAlchemy types) |

**Placeholder scan:** no TBD/TODO/"add error handling" — every code step contains complete Python/TypeScript. Tesseract, pdf2image/Pillow, and the vLLM HTTP client are exercised through explicit test seams/mocks (no GPU/network).

**Type consistency:** `ClassifyResult` (Task 8) consumed unchanged by Tasks 14/16; `ExtractResult` fields (`valid`, `data`, `partial`, `review_flag`, `errors`) consistent across Tasks 10/14/16; `RouteDecision` fields consistent across Tasks 9/12/14; `CatalogHandoff` consistent across Tasks 14/16/19; `ReviewItem`/queue functions (`enqueue`/`list_pending`/`claim`/`resolve`) consistent across Tasks 11/12/14/17; web `bandFor` tones match across Tasks 20/21.

**Scope boundaries (deliberate, per arch §4):** Auto-Catalog alert-rule firing, directory path-template folder creation, and per-folder ACL inheritance live in **Core DMS (Plan 2)**; this AI/IDP service produces the typed `CatalogHandoff` they consume. Notification dispatch (email/SMS/WhatsApp) lives in **Notify**. These are noted so an implementer does not wrongly add them here.
