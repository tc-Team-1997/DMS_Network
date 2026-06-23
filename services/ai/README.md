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
Migrations via Alembic (`alembic upgrade head`). Tests use in-memory SQLite with `StaticPool`.

## Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Service health + mode |
| `/ocr` | POST | Tesseract fallback OCR (multipart file) |
| `/idp/classify` | POST | Stage-1 classify only (multipart file) |
| `/idp/extract` | POST | Stage-2 extract only (multipart file + doc_type) |
| `/idp/process` | POST | Full IDP pipeline (multipart file + doc_id) |
| `/idp/review/pending` | GET | List pending review items (SLA-sorted) |
| `/idp/review/{id}/claim` | POST | Claim a review item |
| `/idp/review/{id}/resolve` | POST | Resolve a review item |

## Run

```bash
# Install (dev mode)
python3.11 -m venv .venv && .venv/bin/pip install -e '.[dev]'

# Migrate DB
.venv/bin/alembic upgrade head

# Run server
.venv/bin/uvicorn zordms_ai.app:create_app --factory --reload

# Tests
.venv/bin/pytest
```

## Confidence bands (IDP §6.4)

| Confidence | Action | Review | SLA | Catalog |
|---|---|---|---|---|
| ≥0.92 | AUTO_APPROVE | No | — | full |
| 0.85–0.91 | AUTO_VERIFIED | 10% sample | — | full |
| 0.70–0.84 | SUPERVISOR_REVIEW | Yes | 48 h | tentative |
| 0.50–0.69 | HUMAN_REVIEW | Yes (hold) | 24 h | pending |
| <0.50 | REJECT | Yes | immediate | none |
