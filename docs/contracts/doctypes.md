# Contract — doctypes (learn document types from samples)

## Header

| Field | Value |
| --- | --- |
| Feature | `doctypes` |
| Owner | `python-engineer` |
| Status | `in-progress` |
| Contract published | `2026-04-18` |
| Last updated | `2026-04-18` |

## 1. Python routes — `/api/v1/docbrain/doctypes/*`

Owner: `python-engineer`. File: `python-service/app/routers/doctypes.py`.
Service deps (docbrain-ai-engineer): `docbrain.doctype_learner.{infer_schema, embed_samples, nearest_schemas}`, `docbrain.tamper.{check_tamper, baseline_fingerprint}`.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/v1/docbrain/doctypes/infer` | `require_api_key` | Preview inferred schema from 3-10 sample bytes — no persistence |
| `POST` | `/api/v1/docbrain/doctypes/commit` | `require_api_key` | Persist schema + samples, embed, fingerprint |
| `GET`  | `/api/v1/docbrain/doctypes/{schema_id}/samples` | `require_api_key` | List samples (no ocr_text) |
| `GET`  | `/api/v1/docbrain/doctypes/{schema_id}/samples/{sample_id}` | `require_api_key` | Single sample incl. truncated ocr_text + thumbnail data-URL |
| `DELETE` | `/api/v1/docbrain/doctypes/{schema_id}/samples/{sample_id}` | `require_api_key` | Remove row, file, vector chunks, recompute fingerprint |
| `POST` | `/api/v1/docbrain/doctypes/{schema_id}/reindex` | `require_api_key` | Re-OCR all samples, re-embed, recompute fingerprint |
| `POST` | `/api/v1/docbrain/doctypes/classify-one` | `require_api_key` | OCR → nearest_schemas → extract; returns best_match + alternatives |
| `POST` | `/api/v1/docbrain/doctypes/{schema_id}/tamper-check` | `require_api_key` | Run check_tamper, return TamperReport |

### Request / response shapes

```jsonc
// POST /infer — request
{
  "samples": [
    {"bytes_b64": "...", "mime_type": "image/png", "filename": "sample1.png"}
  ]  // 3–10 items
}

// POST /infer — response 200
{
  "proposed_schema": {
    "name": "National ID",
    "description": "Egyptian national identity card",
    "fields": [{"name": "id_number", "type": "string", "required": true}],
    "confidence": 0.92
  },
  "per_sample": [
    {
      "filename": "sample1.png",
      "ocr_preview_first_400_chars": "...",
      "extracted_fields": {"id_number": "12345"}
    }
  ]
}

// POST /commit — request
{
  "name": "National ID",
  "description": "...",
  "fields": [],
  "samples": [{"bytes_b64": "...", "mime_type": "image/png", "filename": "s.png", "sha256": "abc..."}],
  "inference_status": "draft"
}

// POST /commit — response 200
{ "schema_id": 1, "samples_saved": 3, "vectors_indexed": 3 }

// GET /{schema_id}/samples — response 200
[
  {
    "id": 1, "filename": "s.png", "size": 12345,
    "mime_type": "image/png", "ocr_mean_confidence": 87.4,
    "ocr_backend": "tesseract", "uploaded_at": "2026-04-18T00:00:00"
  }
]

// GET /{schema_id}/samples/{sample_id} — response 200
{
  "id": 1, "filename": "s.png", "size": 12345,
  "mime_type": "image/png", "ocr_mean_confidence": 87.4,
  "ocr_backend": "tesseract", "uploaded_at": "2026-04-18T00:00:00",
  "ocr_text_preview": "...",   // first 2000 chars
  "thumbnail_data_url": "data:image/png;base64,..."
}

// DELETE /{schema_id}/samples/{sample_id} — response 200
{ "deleted": true }

// POST /{schema_id}/reindex — response 200
{ "samples_reindexed": 3, "new_schema_version": 2 }

// POST /classify-one — request
{ "bytes_b64": "...", "mime_type": "image/png" }

// POST /classify-one — response 200
{
  "best_match": {"schema_id": 1, "name": "National ID", "similarity": 0.95},
  "alternatives": [{"schema_id": 2, "name": "Passport", "similarity": 0.71}],
  "extraction": {"id_number": "12345"},
  "ocr": {"backend": "tesseract", "mean_confidence": 88.0}
}

// POST /{schema_id}/tamper-check — request
{ "bytes_b64": "...", "mime_type": "image/png" }
// or
{ "document_id": 42 }

// POST /{schema_id}/tamper-check — response 200
{ "tampered": false, "score": 0.02, "detail": "..." }
```

## 2. DB shape (assumed landed by db-migrator)

```sql
CREATE TABLE document_type_samples (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  schema_id           INTEGER NOT NULL REFERENCES document_type_schemas(id),
  filename            TEXT NOT NULL,
  sha256              TEXT NOT NULL,
  storage_key         TEXT NOT NULL,
  size                INTEGER NOT NULL DEFAULT 0,
  mime_type           TEXT NOT NULL DEFAULT '',
  ocr_text            TEXT,
  ocr_backend         TEXT,
  ocr_mean_confidence REAL,
  schema_version      INTEGER,
  uploaded_by         TEXT,
  uploaded_at         TEXT DEFAULT CURRENT_TIMESTAMP,
  tenant_id           TEXT NOT NULL DEFAULT 'default'
);

-- Columns added to document_type_schemas:
ALTER TABLE document_type_schemas ADD COLUMN schema_version INTEGER DEFAULT 1;
ALTER TABLE document_type_schemas ADD COLUMN inference_status TEXT DEFAULT 'manual';
ALTER TABLE document_type_schemas ADD COLUMN source_samples_count INTEGER DEFAULT 0;
ALTER TABLE document_type_schemas ADD COLUMN vector_index_version INTEGER DEFAULT 0;
```

## 3. File storage

`STORAGE_DIR/doctype_samples/<schema_id>/<sha256>.<ext>` — created on demand with `os.makedirs(..., exist_ok=True)`.

## 4. Test checklist

| Layer | File | Owner |
| --- | --- | --- |
| Pytest | `python-service/tests/test_doctypes_api.py` | `python-engineer` |

## 5. Done criteria

- [x] `cd python-service && pytest -q python-service/tests/test_doctypes_api.py` green
- [x] `python -m compileall python-service/app` clean
