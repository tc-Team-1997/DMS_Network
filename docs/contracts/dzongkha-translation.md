# Contract — Dzongkha Translation Service (NLLB-200 offline)

> **Local Dzongkha ↔ English translation of document content using Meta's NLLB-200-distilled-600M model.** Fully offline, no external APIs. Replaces Amazon Translate. Closes Bhutan F#14.

## Header

| Field | Value |
| --- | --- |
| Feature | `dzongkha-translation` |
| Spec ID | `BHU-14` |
| Owner | _assigned by team lead_ |
| Status | `draft` |
| Risk class | `medium` (new ML model dependency, but fully offline; no internet required) |
| Contract published | `2026-05-09` |
| Last updated | `2026-05-09` |
| Related ADR | _n/a — offline ML is standard engineering_ |

---

## 1. Problem & user story

**Problem:** Bhutan's national language is Dzongkha; many customers and documents are in Dzongkha only. Document officers (Makers / Checkers) are often bilingual but not trilingual (Arabic-English-Dzongkha). Translation between Dzongkha ↔ English required for onboarding, KYC review, and audit compliance.

**Why now:** Bhutan DMS mandate (F#14 — "Support Dzongkha document translation by Q2 2026") + cost reduction (Amazon Translate charges per API call; NLLB model is open-source, free, and runs on CPU).

**Personas affected:**
- `Maker` — uploads Dzongkha-language business license, wants to see English extraction to fill form fields
- `Checker` — reviews Dzongkha document + auto-translation, compares to English summary
- `Doc Admin` — configures supported language pairs per tenant
- `Auditor` — reviews translation logs to ensure accuracy (audit trail)

**Out of scope:**
- Liveness translation (e.g., real-time chat). Translations are async, cached, reused.
- Fine-tuning NLLB model per tenant. Using base model only.
- Glossary injection (e.g., bank-specific Dzongkha terms). Future work.
- Quality assurance / back-translation. Manual review is users' responsibility.

---

## 2. Acceptance criteria

- **AC-1** — Given a document with `ocr_text` in Dzongkha, when a Viewer requests `POST /spa/api/translate/document/{id} { target_lang: "en" }`, then the SPA receives a 200 with `{ original_text_preview: "...", translated_text: "...", translated_at: ISO-8601, confidence_estimate: 0..1 }` within 5s p99.
- **AC-2** — Given a translation request for the same `(source_text_sha256, source_lang, target_lang)` triple, when a second user requests it within 7 days, the service returns the cached translation (cache hit) in ≤ 50ms p99 instead of re-running the model.
- **AC-3** — Given NLLB model cold-load on first request, the service loads the model into memory (≤ 30s), then caches it for the process lifetime. Subsequent requests reuse the in-memory model.
- **AC-4** — Given a document's OCR text is > 5000 characters, the service chunks the text into 2000-char overlapping windows, translates each chunk independently, and concatenates the results. Chunk boundaries respect sentence breaks (no mid-sentence splits).
- **AC-5** — Given `FF_DZONGKHA_TRANSLATION=off`, the translate endpoints return 501 "Not Implemented"; the SPA hides translate buttons. When flag is on, buttons appear and calls succeed.
- **AC-6** — Every translation request logs to `audit_log` with action `DOCUMENT_TRANSLATED`, details: `{ doc_id, source_lang, target_lang, text_length, model_version, cache_hit }`. No source/target text is logged (privacy).
- **AC-7** — Supported language pairs are configurable per tenant via `tenant_settings.supported_languages = ["en-dz", "dz-en", "en-ar", "ar-en"]`. Router rejects pairs not in the list with 400 "Language pair not supported for this tenant".

---

## 3. End-to-end workflow

```
[User on Viewer page opens document with dzongkha_ocr_text]
              │
              ├─ SPA fetches document metadata
              │
              ├─ detects language from OCR metadata (dzongkha_lang: true)
              │
              ├─ renders "Translate to English" button
              │
              ▼
[User clicks button]
              │
              ├─ SPA disables button, shows "Translating…" spinner
              │
              ├─ calls POST /spa/api/translate/document/{id} { target_lang: "en" }
              │
              ├─ Node proxies POST /api/v1/translate/document/{id}
              │
              ├─ injects X-API-Key server-side
              │
              ▼
[Python routers/translate.py]
              │
              ├─ validates tenant + doc access (session role ≥ viewer)
              │
              ├─ retrieves document + ocr_text from DB
              │
              ├─ detects source_lang from metadata (or infers from text)
              │
              ├─ calls await translate_service.translate_text(ocr_text, source_lang, target_lang)
              │
              ▼
[TranslationService (singleton)]
              │
              ├─ computes SHA256(ocr_text) + source_lang + target_lang
              │
              ├─ checks cache: SELECT FROM translations WHERE sha256=? AND source_lang=? AND target_lang=?
              │
              ├─ if hit: return { translated_text, confidence_estimate: 0.95 (cached), cached_at, cache_hit: true }
              │
              └─ if miss:
                  │
                  ├─ loads model: transformers.pipeline("translation_dz_to_en", model="facebook/nllb-200-distilled-600M")
                  │
                  ├─ chunks text (2000 char windows, sentence-aware overlap)
                  │
                  ├─ runs forward pass on each chunk: model(chunk)
                  │
                  ├─ concatenates outputs
                  │
                  ├─ estimates confidence from model logits (mean exp(logits))
                  │
                  ├─ writes to translations table { doc_id, sha256, source_lang, target_lang, translated_text, confidence_estimate, model_version }
                  │
                  └─ returns { translated_text, confidence_estimate, cache_hit: false }
              │
              ▼
[Response 200]
              │
              ├─ JSON: { original_text_preview: "...", translated_text: "...", translated_at, confidence_estimate, cache_hit }
              │
              ├─ audit_log written: action=DOCUMENT_TRANSLATED, details={ doc_id, source_lang, target_lang, text_length, cache_hit }
              │
              ▼
[SPA renders side-by-side: original (left) + translation (right)]
              │
              ├─ if confidence_estimate < 0.7: show yellow warning "Low confidence — review carefully"
              │
              ├─ user can copy translation or save as annotation
              │
              └─ button re-enabled for new requests
```

State machine (per document):

```
captured ─▶ ocr_done (no translation yet)
              │
              ├─ user clicks Translate
              │
              ▼
            translating ─▶ cached (if cache hit)
              │
              ├─ model inference
              │
              ▼
            translated ─▶ (cache stored, available for 7 days)
```

---

## 4. API contract — Python (`/api/v1/translate/*`)

Owner: `python-engineer`. Files: `python-service/app/routers/translate.py` + `python-service/app/services/translate.py`.

| Method | Path | Auth | Idempotent | Purpose |
| --- | --- | --- | --- | --- |
| `POST` | `/api/v1/translate/document/{id}` | `require_api_key` + JWT(role≥viewer) | Y | Translate document's OCR text to target language |
| `POST` | `/api/v1/translate` | `require_api_key` + JWT(role≥viewer) | Y | Translate arbitrary text (no document context) |
| `GET` | `/api/v1/translate/languages` | `require_api_key` | Y | List supported language pairs for tenant |
| `DELETE` | `/api/v1/translate/{translation_id}` | `require_api_key` + JWT(role≥doc_admin) | Y | Remove a translation from cache (DSAR / privacy request) |

### Request / response shapes

```jsonc
// POST /api/v1/translate/document/{id} — request
{
  "target_lang": "en"
}

// POST /api/v1/translate/document/{id} — 200
{
  "doc_id": 42,
  "source_lang": "dz",
  "target_lang": "en",
  "original_text_preview": "འདི་ནི་ནང་པའི་ལྷ་རྩེར་གྲུབ་པའི་ཕ་རོལ་ཕྱིན་པའི་སྡེ་སྲིད་དུ་གླེང་སེང་གི་ཚིག་གི་རིས་དང་གླེང་སེང་གི་ཕ་རོལ་ཕྱིན་པ་ཞེས་བྱ་བའི...",
  "translated_text": "This is a text explaining the doctrine of the Far Side perfection in the context of the inner school of the palace of heaven...",
  "translated_at": "2026-05-09T12:34:56Z",
  "confidence_estimate": 0.82,
  "cache_hit": false,
  "model_version": "facebook/nllb-200-distilled-600M"
}

// POST /api/v1/translate — request
{
  "text": "ཚོང་ཆེན་གི་ཐོག་མ...",
  "source_lang": "dz",
  "target_lang": "en"
}

// POST /api/v1/translate — 200
{
  "original_text": "ཚོང་ཆེན་གི་ཐོག་མ...",
  "translated_text": "The beginning of commerce...",
  "source_lang": "dz",
  "target_lang": "en",
  "confidence_estimate": 0.79,
  "cache_hit": true,
  "cached_at": "2026-05-08T10:00:00Z"
}

// GET /api/v1/translate/languages — 200
{
  "supported_pairs": [
    { "source": "en", "target": "dz" },
    { "source": "dz", "target": "en" },
    { "source": "en", "target": "ar" },
    { "source": "ar", "target": "en" }
  ]
}

// DELETE /api/v1/translate/{translation_id} — 200
{ "deleted": true }

// 4xx / 5xx error envelope
{
  "error": "language_pair_not_supported | invalid_text_length | model_load_failure | cache_miss_on_retry",
  "message": "human readable"
}
```

---

## 5. API contract — Node SPA mirror (`/spa/api/translate/*`)

Owner: `node-engineer`. File: `routes/spa-api/translate.js`, mounted from `server.js`.

| Method | Path | Session auth | RBAC perm | Notes |
| --- | --- | --- | --- | --- |
| `POST` | `/spa/api/translate/document/{id}` | required | `translate:read` | Proxies translate; scope to user's branch |
| `POST` | `/spa/api/translate` | required | `translate:read` | Proxies translate |
| `GET` | `/spa/api/translate/languages` | required | none | Proxies language list |
| `DELETE` | `/spa/api/translate/{translation_id}` | required | `translate:delete` | Proxies delete (DSAR) |

**Divergence from Python shape:** None. All responses pass through unchanged.

---

## 6. SPA module

Owner: `spa-engineer`. Folder: `apps/web/src/modules/translate/`.

### 6.1 Files
- `TranslateModal.tsx` — side-by-side viewer; original (left, read-only) vs. translation (right)
- `api.ts` — fetch wrappers + zod validation
- `schemas.ts` — zod types
- `components/LanguageSelector.tsx` — dropdown for target language
- `components/ConfidenceBadge.tsx` — visual indicator of translation confidence
- `hooks/useTranslation.ts` — hook to manage translation state per document

### 6.2 Schemas

```ts
import { z } from "zod";

export const TranslationResult = z.object({
  doc_id: z.number().int(),
  source_lang: z.string().length(2),
  target_lang: z.string().length(2),
  original_text_preview: z.string(),
  translated_text: z.string(),
  translated_at: z.string().datetime(),
  confidence_estimate: z.number().min(0).max(1),
  cache_hit: z.boolean(),
  model_version: z.string().optional(),
});
export type TranslationResult = z.infer<typeof TranslationResult>;

export const LanguagePair = z.object({
  source: z.string().length(2),
  target: z.string().length(2),
});
export type LanguagePair = z.infer<typeof LanguagePair>;

export const SupportedLanguages = z.object({
  supported_pairs: z.array(LanguagePair),
});
export type SupportedLanguages = z.infer<typeof SupportedLanguages>;
```

### 6.3 UI flow

**AC-1 / Document Translate Button:**
1. Viewer page opens document. If OCR detected as Dzongkha, show "Translate to English" button below OCR preview.
2. User clicks → TranslateModal opens with `original_text_preview` shown on left (read-only, monospace font).
3. Loading spinner on right with "Translating…".
4. Response arrives: right pane shows `translated_text`.
5. If `confidence_estimate < 0.7`: yellow banner at top: "Low confidence translation. Please review carefully."
6. If `cache_hit=true`: small indicator "(cached)" in footer.
7. Copy button on right pane copies translated text to clipboard.
8. Close button or "Done" dismisses modal.

**Language Selector (future):**
When multiple language pairs are supported, dropdown above modal lets user pick target language. Default = English for Dzongkha documents.

**Confidence Badge:**
Color-coded: green (>= 0.8), yellow (0.6–0.79), red (< 0.6). Hover shows "Confidence: 82%".

### 6.4 Test IDs (for Playwright)

Canonical IDs shipped in `apps/web/src/modules/translate/` (updated 2026-05-09):

| Test ID | Component | Notes |
|---|---|---|
| `translate-button` | `TranslateButton` | The trigger pill button |
| `translate-target-select` | `TranslateButton` | `<select>` for target language |
| `translate-loading` | `TranslateButton` | Spinner or "Loading..." text shown while request in-flight |
| `side-by-side-original` | `SideBySideView` | Left pane `<section>` |
| `side-by-side-translated` | `SideBySideView` | Right pane `<section>` |
| `side-by-side-toggle` | `SideBySideView` | "Single pane" close button |
| `translate-copy-button` | `SideBySideView` | Copy translated text to clipboard |
| `translate-confidence-badge` | `ConfidenceBadge` | Color-coded confidence indicator |
| `translate-inline-{key}` | `TranslateInline` | Per-field "Translate this" link (key = field identifier) |
| `translate-original-toggle-{key}` | `TranslateInline` | "show original" revert link (key = field identifier) |

Previous IDs from the initial draft (`translate-button-dzongkha`, `translate-modal`, `translate-original-text`, `translate-translated-text`, `translate-loading-spinner`, `translate-close-button`, `translate-low-confidence-warning`) are **superseded** by the table above.

---

## 7. Data model

Owner: `db-migrator`. Files: `db/schema.sql` (Node SQLite), `python-service/app/models.py` + Alembic revision.

### Node SQLite (db/schema.sql)

```sql
-- Translation cache
CREATE TABLE IF NOT EXISTS translations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  doc_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  source_lang TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  sha256_source TEXT NOT NULL,
  original_text_length INTEGER NOT NULL DEFAULT 0,
  translated_text TEXT NOT NULL,
  confidence_estimate REAL NOT NULL DEFAULT 0.0,
  model_version TEXT NOT NULL DEFAULT 'facebook/nllb-200-distilled-600M',
  created_at TEXT DEFAULT (datetime('now')),
  created_by TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_translations_tenant_sha256 
  ON translations(tenant_id, sha256_source, source_lang, target_lang);
CREATE INDEX IF NOT EXISTS idx_translations_doc_id 
  ON translations(doc_id);
CREATE INDEX IF NOT EXISTS idx_translations_created_at 
  ON translations(created_at);
```

### Python SQLAlchemy (python-service/app/models.py)

```python
from sqlalchemy import Column, Integer, String, DateTime, Text, Float, ForeignKey, UniqueConstraint
from sqlalchemy.orm import declarative_base, relationship
from datetime import datetime

Base = declarative_base()

class Translation(Base):
    __tablename__ = "translations"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    doc_id = Column(Integer, ForeignKey("documents.id", ondelete="SET NULL"))
    source_lang = Column(String(2), nullable=False)
    target_lang = Column(String(2), nullable=False)
    sha256_source = Column(String(64), nullable=False, index=True)
    original_text_length = Column(Integer, nullable=False, default=0)
    translated_text = Column(Text, nullable=False)
    confidence_estimate = Column(Float, nullable=False, default=0.0)
    model_version = Column(String(128), nullable=False, default="facebook/nllb-200-distilled-600M")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    created_by = Column(String(128))
    deleted_at = Column(DateTime)
    __table_args__ = (UniqueConstraint("tenant_id", "sha256_source", "source_lang", "target_lang"),)

    document = relationship("Document", backref="translations")
```

**Tenant boundary:** Every query filters by `tenant_id` (Commandment #1).

**Cache TTL policy (service layer, not DB):** Rows marked as "cached" for 7 days (168 hours); after that, service can delete them if storage is needed. Rows are soft-deleted (`deleted_at` set) when users request erasure (DSAR).

**Seed:** `db/seed.js` adds 2–3 pre-computed translation rows for demo doctypes (e.g., "National ID" in Dzongkha → English).

---

## 8. Security & compliance

| Concern | Decision |
| --- | --- |
| RBAC | `translate:read` allows both routes. `translate:delete` (DSAR) requires `doc_admin` role. Default deny. |
| ABAC (OPA) | No OPA rules needed (translation is not high-risk). Users can translate any document they can view. |
| Audit | Every translate request logs to `audit_log`: action = `DOCUMENT_TRANSLATED`, details = `{ doc_id, source_lang, target_lang, text_length, cache_hit, model_version }`. No source or target text logged. User SID included. |
| Encryption at rest | `translations.translated_text` is encrypted by storage layer (AES-256). `sha256_source` is hashed, not reversible. |
| Encryption in transit | TLS 1.3 on all hops. Model weights not transmitted (loaded from local disk / HuggingFace cache in /tmp). |
| PII / DSAR | Columns containing PII: none directly. `translated_text` may contain PII if source OCR did (cannot be redacted after translation). Erasure path: `DELETE FROM translations WHERE id = ?` on user request + audit entry `TRANSLATION_DELETED`. |
| Retention | Cache rows auto-clean every 7 days (cron job in `python-service/app/services/tasks.py`). Rows older than 7 days hard-deleted. audit_log entries retained per tenant policy (7y default). |
| Input validation | source_lang, target_lang validated against `tenant_settings.supported_languages` enum. Text length capped at 500KB (reject if larger with 413). Chunk overlap not user-controlled. |
| OWASP top 10 | Injection (no user text in prompts or SQL), XSS (translated text escaped by SPA), CSRF (session token), SSRF (n/a — no external URLs), broken auth (JWT enforced), insecure deserialisation (only JSON), XXE (no XML), broken access control (RBAC), security logging (no PII), dependencies (transformers lib pinned, scanned weekly). |
| Rate limit | No per-user rate limit (model is CPU-bound, not quota-scarce). If > 100 concurrent translate requests, queue them (FastAPI background tasks with queue size limit). |
| Threat model delta | **New surface:** Transformers library (dependency on PyTorch). **Attacks:** Adversarial input to model (mitigated: input text validated, chunked, benign). Poisoned model weights (mitigated: model pinned from HuggingFace + hash check). **Residual risk:** Low confidence translations could mislead users; mitigation is UX warning + user responsibility. |

---

## 9. Performance & observability

### 9.1 Budget

| Layer | Budget |
| --- | --- |
| API p99 latency | `< 5 seconds` (model inference on CPU; cold-load ≤ 30s first call, then cached) |
| DB query cost | Cache lookups are indexed by (tenant_id, sha256_source, lang_pair); every cache hit ≤ 10ms |
| SPA bundle delta | `< 8 KB gzipped` (TranslateModal, LanguageSelector, ConfidenceBadge) |
| Payload size | `< 50 KB` per response (source + translated text, capped at 500KB input → ~600KB output) |
| Memory delta | NLLB model ~1.2 GB in memory (singleton, shared across tenants). PyTorch + transformers ~800 MB. Total: ~2 GB per Python process. |

### 9.2 Observability contract

Each handler ships:

- **Trace** — span `translate.<method>` with attributes `tenant_id`, `doc_id` (if applicable), `source_lang`, `target_lang`, `cache_hit`, `latency_ms`
- **Metric (counter)** — `translate_requests_total{lang_pair, cache_hit="yes|no", status="ok|error"}` (Prometheus)
- **Metric (histogram)** — `translate_duration_seconds{lang_pair}` (buckets: 100ms, 500ms, 1s, 2s, 5s)
- **Metric (gauge)** — `translate_model_loaded` (1 if model in memory, 0 if not)
- **Log** — structured line: `{ts, tenant_id, doc_id, source_lang, target_lang, cache_hit, duration_ms, status}`
- **Audit log row** — for every request (read)

Add Grafana dashboard row: "Translation Service" with panels:
- Model load time (first request).
- `translate_duration_seconds` p50/p95/p99 per language pair.
- Cache hit rate over 24h window.
- `translate_requests_total` by lang_pair and status.
- Memory usage (NLLB model footprint).

---

## 10. Accessibility & i18n

- **WCAG 2.1 AA** — TranslateModal has keyboard nav (Tab between close button, copy button); visible focus rings. Screen reader label on translated text: `<div role="region" aria-label="Translated text">{translatedText}</div>`.
- **Screen reader** — All buttons have aria-labels: `<button aria-label="Copy translated text to clipboard">` + Confidence badge: `<span aria-label="Confidence 82 percent">`.
- **Reduced motion** — No fade-in/fade-out on modal. If `prefers-reduced-motion`, spinner replaced with static "Loading…" text.
- **i18n** — All UI strings via `t()`: `t('translate.button_label')`, `t('translate.low_confidence_warning')`, `t('translate.language_en')`, `t('translate.language_dz')`. Keys in `apps/web/src/i18n/{en,dz}.json`.
- **RTL** — Modal layout uses logical properties (`margin-inline`, `text-align: start`). Left/right panes reverse in RTL mode. Copy button positioned with `inline-end`.
- **Color contrast** — Confidence badge colors meet 3:1 minimum. Modal text on background ≥ 4.5:1.

---

## 11. Error states & edge cases

| Case | Trigger | UX |
| --- | --- | --- |
| Language pair not supported | Tenant only supports en↔ar, user selects dz↔en | Dropdown disables unsupported pairs; if already selected, error: "This language pair is not supported for your tenant." |
| Empty OCR text | Document has no OCR (upload not processed yet) | "This document has not been scanned yet. Please wait for OCR to complete, then try again." |
| Text too long | OCR text > 500KB | Modal shows: "Text is too long to translate (>500 KB). Try translating a shorter section." |
| Model load failure | Transformers library missing or model download fails | 500 error with detail: "Translation service temporarily unavailable. Try again later." Logs stack trace (no PII). |
| Network timeout | T24 call timeout (shouldn't happen here, but for completeness) | N/A — no external network calls. Internal only. |
| Low confidence | Model returns confidence < 0.6 | Yellow warning banner: "Low confidence translation. Accuracy below expected threshold — review carefully." |
| Concurrent requests | Same user clicks Translate twice rapidly | Second request deduplicated server-side (idempotency key from source SHA + lang pair). Returns cached result of first request. |
| Cache expired | Row older than 7 days queried | Service re-runs inference (cache miss), overwrites old row. |
| DSAR delete failure | User requests translation erasure, but table locked | Soft-delete with `deleted_at` set; hard-delete deferred. Row remains in cache but marked as deleted (queries filter `WHERE deleted_at IS NULL`). |
| Offline (no internet) | Service worker detects offline | SPA error boundary: "You're offline. Translation unavailable." |
| Slow model inference | Model takes > 5s due to CPU contention | After 5s, show "This is taking longer than expected. Still working…" + Cancel button (stops model inference if possible). |

---

## 12. Rollout & rollback

- **Feature flag** — `FF_DZONGKHA_TRANSLATION` (env var or settings table). Default `off` for ≥ 1 release (May 2026). When `off`, translate buttons hidden, API returns 501.
- **Stages** — (1) internal demo, (2) 10% canary tenant, (3) 100%. Promote on green: p99 latency < 5s, error rate < 0.5%, model memory usage stable.
- **Kill switch** — flip `FF_DZONGKHA_TRANSLATION=off` → buttons hidden, API disabled. No data loss. Cache rows remain but unused.
- **Migration safety** — additive only: `translations` table is new. If rollback needed, table remains harmless.
- **Rollback steps** — (1) flip flag off, (2) revert deploy, (3) verify no 5xx errors in logs, (4) if model memory bloated, restart Python service pods (GC won't free HuggingFace cache automatically).

---

## 13. Test plan

| Layer | File | Owner | Coverage requirement |
| --- | --- | --- | --- |
| Unit (Python) | `python-service/tests/test_translate_service.py` | `python-engineer` | Cache hit/miss, chunking (sentence boundaries), confidence estimation, model loading |
| Unit (Node) | `routes/spa-api/__tests__/translate.test.js` | `node-engineer` | RBAC, API key injection, language pair validation |
| Integration (Python) | `python-service/tests/test_translate_api.py` | `python-engineer` | End-to-end: POST document → model inference → cache write → cache hit on second call |
| Zod schema | `apps/web/src/modules/translate/schemas.ts` | `spa-engineer` | Round-trip parse of all response types |
| E2E happy | `apps/web/e2e/translate.spec.ts` | `qa-engineer` | AC-1: open document, click Translate, see translated text within 5s; AC-2: second request uses cache |
| E2E errors | `apps/web/e2e/translate.errors.spec.ts` | `qa-engineer` | Empty OCR, text too long, unsupported language pair, low confidence warning |
| A11y | `apps/web/e2e/a11y.spec.ts` extended | `qa-engineer` | axe-core scan on TranslateModal, no AA violations, keyboard nav works, screen reader labels present |
| Load (smoke) | `loadtest/k6.js` extended | `qa-engineer` | 30 concurrent translation requests, p99 < 5s, no OOM or timeouts |

---

## 14. Telemetry & success metrics

- **Adoption** — 60% of documents with Dzongkha OCR get translated within week 1 (event: `translate.initiated`).
- **Latency** — p99 < 5s for model inference after cold-load; cache hits ≤ 50ms p99. Cold-load ≤ 30s.
- **Error rate** — `< 0.5%` 5xx errors. `< 2%` validation 4xx (unsupported pairs, text too long).
- **Cache efficiency** — 60%+ hit rate within 7-day window (indicates reuse across users/documents).
- **Business KPI** — 85%+ confidence translations (>= 0.8) accepted by users without manual correction. Low confidence (<0.6) translations reviewed before approval (audit trail).

---

## 15. Definition of Done

- [ ] All 15 sections above filled
- [ ] `cd python-service && pytest -q python-service/tests/test_translate_service.py` green (cache, chunking, confidence, model load)
- [ ] `cd python-service && pytest -q python-service/tests/test_translate_api.py` green (routes, model inference, caching)
- [ ] `cd apps/web && npm run typecheck` green (Zod schemas, API responses)
- [ ] `cd apps/web && npx playwright test e2e/translate.spec.ts` green against live `./start.sh` (AC-1: translate button, modal render, translated text; AC-2: cache hit on second request)
- [ ] `cd apps/web && npx playwright test e2e/translate.errors.spec.ts` green (empty OCR, long text, unsupported pair, low confidence warning)
- [ ] `npx playwright test e2e/a11y.spec.ts` green (no new AA violations, keyboard nav, screen reader)
- [ ] audit_log entries land for every translate request (manual smoke: translate a document, check DOCUMENT_TRANSLATED in logs with no source/target text)
- [ ] Metrics visible in local Grafana (`translate_requests_total`, `translate_duration_seconds`, `translate_model_loaded`)
- [ ] Feature flag `FF_DZONGKHA_TRANSLATION` default = `off` and verified
- [ ] `docs/README.md` changelog entry: `2026-05-DD — dzongkha-translation — offline NLLB-200 en↔dz translation with 7-day cache and confidence scoring`
- [ ] Transformers library added to `python-service/requirements.txt` with pinned version; dependency review completed
