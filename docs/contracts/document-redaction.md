# Contract — document-redaction

> PDF redaction tool in the Viewer page — users can draw black rectangles over PII regions, save a redacted version that PERMANENTLY destroys the underlying text. Closes Bhutan annotation/redaction requirements.
>
> Paired with [ENGINEERING_PRINCIPLES.md](../ENGINEERING_PRINCIPLES.md). The Ten Commandments apply.

## Header

| Field | Value |
| --- | --- |
| Feature | `document-redaction` |
| Spec ID | `BHU-46` (document annotation and redaction) |
| Owner | `spa-engineer` + `python-engineer` |
| Status | `draft` |
| Risk class | `high` (PII handling, irreversibility, tamper detection) |
| Contract published | `2026-05-09` |
| Last updated | `2026-05-09` |
| Related ADR | `docs/adr/0012-pdf-text-destruction-redaction.md` |

---

## 1. Problem & user story

**As a** branch officer managing sensitive customer documents, **I want to** redact PII from a document before sharing it, **so that** I can safely forward the document while protecting customer privacy.

Today, there is no redaction tool. Officers manually re-type or screenshot sensitive fields, leading to OCR errors and lost metadata.

This slice adds:
- SPA Viewer page with "Redact" toolbar mode that lets users draw rectangles over sensitive regions
- Preview shows rectangles filled black (visual feedback)
- "Save redacted copy" creates a NEW document version (original untouched)
- Backend uses `pikepdf` or `pdf-lib` to PHYSICALLY remove text in regions (not just visual overlay)
- New document links to original via `parent_id` and is marked `redacted=true`
- Access control: users without `view_unredacted` permission see redacted version by default
- Comprehensive audit: redaction_log table tracks every region, redactor, reason
- Security: verify redaction removes text (test with `pdftotext` post-redaction)

**Personas affected:**
- `Checker` / `Maker` — primary redactors
- `Viewer` — sees redacted version by default
- `Auditor` — reviews redaction_log

**Out of scope:**
- Bulk redaction. Single document at a time.
- Redaction of images embedded in PDF (text-only v1).
- Undo redaction. Redaction is permanent; original remains.
- Auto-detect PII and suggest regions. Manual selection only.

---

## 2. Acceptance criteria

- **AC-1** — Given the Viewer page for a document, when a user with `document:redact` permission clicks "Redact", then the page switches to redaction mode with a rectangle-draw toolbar and a canvas overlay on the PDF.
- **AC-2** — Given redaction mode active, when a user drags a rectangle over a region (e.g., customer name on page 1), then the rectangle appears in real-time with a black fill and a delete-box icon.
- **AC-3** — Given 3 rectangles drawn, when the user clicks "Save redacted copy", then a POST request is sent with `regions: [{page, x, y, w, h, reason}]` and a new document is created with content where the specified regions have text PHYSICALLY REMOVED (not just visually overlaid).
- **AC-4** — Given the new redacted document is created, when `pdftotext` is run on it, then the redacted regions do NOT contain the original text (text destruction verified).
- **AC-5** — Given a user without `view_unredacted` permission views a document with a redacted version, then the redacted version is served by default and the original is not accessible.
- **AC-6** — Given a redaction operation completes, when an audit check runs, then a `redaction_log` row is created with: `document_id, redacted_version_id, redacted_by, regions JSON, reason, created_at`.

---

## 3. End-to-end workflow

```
[User on Viewer page with document open]
    │ document_id=42 (original)
    ▼
[Clicks "Redact" button]
    │ page switches to redaction-mode UI
    │ PDF canvas renders with transparent overlay
    ▼
[Draws rectangles on sensitive regions]
    │ page=0, x=100, y=200, w=200, h=20 (customer name)
    │ page=1, x=50, y=150, w=150, h=30 (account number)
    │ real-time preview: black rectangles visible
    ▼
[Clicks "Save redacted copy"]
    │ POST /api/v1/documents/42/redact
    │ payload: { regions: [{page, x, y, w, h, reason}], reason: "pii" }
    ▼
[Python backend processes]
    │ fetch original PDF from STORAGE_DIR
    │ load with pikepdf
    │ for each region:
    │   extract text in bounding box
    │   delete (xref, content stream modification)
    │ save redacted PDF to STORAGE_DIR/<new_sha256>.pdf
    │ insert documents row: { parent_id=42, version=v1.1, redacted=true, ... }
    │ write redaction_log
    ▼
[Return 201 response]
    │ { "redacted_document_id": 43, "parent_id": 42, "version": "v1.1", "regions_redacted": 2 }
    ▼
[SPA shows success toast]
    │ "Redacted copy saved. Original document is preserved."
    │ nav updates: original still listed, redacted version shown as "Redacted (v1.1)"
    ▼
[When viewer without unredacted permission accesses]
    │ default fetch: document 43 (redacted)
    │ UI shows "Redacted version" badge
    │ original (42) not accessible to this user
```

State machine:

```
[original] ──▶ [viewing] ──▶ [redaction_mode] ──▶ [saving] ──▶ [success]
                                                      │
                                                      ▼
                                                   [error]

[redacted_version]
    │ marks original as [has_redactions]
    │ links via parent_id
```

---

## 4. API contract — Python (`/api/v1/*`)

Owner: `python-engineer`. File: `python-service/app/routers/redaction.py` (new).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/v1/documents/{id}/redact` | `require_api_key` + JWT(role≥`checker`) | Create redacted copy |
| `GET` | `/api/v1/documents/{id}/redaction-status` | `require_api_key` + JWT(role≥`viewer`) | Query redaction history (parent, version chain) |
| `GET` | `/api/v1/redaction-log` | `require_api_key` + JWT(role=`auditor`) | List all redactions (audit) |

### Request / response shapes

```jsonc
// POST /api/v1/documents/{id}/redact — request
{
  "regions": [
    { "page": 0, "x": 100, "y": 200, "w": 200, "h": 20, "reason": "pii" },
    { "page": 1, "x": 50, "y": 150, "w": 150, "h": 30, "reason": "financial-secret" }
  ],
  "reason": "pii",
  "preserve_metadata": false
}

// POST /api/v1/documents/{id}/redact — 201 Created
{
  "redacted_document_id": 43,
  "parent_id": 42,
  "version": "v1.1",
  "regions_redacted": 2,
  "sha256_original": "abc...",
  "sha256_redacted": "def...",
  "redacted_by": "ahmed.m",
  "created_at": "2026-05-09T10:30:00Z"
}

// GET /api/v1/documents/{id}/redaction-status — 200
{
  "document_id": 42,
  "is_original": true,
  "has_redactions": true,
  "redacted_versions": [
    { "document_id": 43, "redacted_at": "2026-05-09T10:30:00Z", "redacted_by": "ahmed.m", "region_count": 2 }
  ],
  "parent_id": null
}

// GET /api/v1/redaction-log?limit=50 — 200
{
  "items": [
    {
      "id": 1,
      "document_id": 42,
      "redacted_version_id": 43,
      "redacted_by": "ahmed.m",
      "regions": [{"page": 0, "x": 100, "y": 200, "w": 200, "h": 20, "reason": "pii"}],
      "reason": "pii",
      "created_at": "2026-05-09T10:30:00Z"
    }
  ],
  "total": 150
}
```

---

## 5. API contract — Node SPA mirror (`/spa/api/*`)

Owner: `node-engineer`. File: `routes/spa-api/redaction.js` (new).

| Method | Path | Session auth | RBAC perm | Notes |
| --- | --- | --- | --- | --- |
| `POST` | `/spa/api/documents/{id}/redact` | required | `documents:redact` | Proxies to Python; injects session tenant |
| `GET` | `/spa/api/documents/{id}/redaction-status` | required | `documents:read` | Proxies status query |

---

## 6. SPA module

Owner: `spa-engineer`. Folder: `apps/web/src/modules/viewer/redaction/`.

### 6.1 Files

- `RedactionToolbar.tsx` — toolbar with rectangle-draw tool, undo, clear all, save
- `RedactionCanvas.tsx` — canvas overlay on PDF for drawing rectangles
- `RedactionModal.tsx` — detail form: reason enum, per-region reason input, approve button
- `api.ts` — fetch wrapper for redact POST
- `schemas.ts` — zod schemas
- `hooks/useRedactionState.ts` — manage drawn rectangles in local state

### 6.2 Schemas

```ts
import { z } from "zod";

export const RedactionRegion = z.object({
  page: z.number().int().min(0),
  x: z.number().min(0),
  y: z.number().min(0),
  w: z.number().min(1),
  h: z.number().min(1),
  reason: z.enum(["pii", "financial-secret", "commercial-confidential", "legal-hold", "other"]),
});

export const RedactRequest = z.object({
  regions: z.array(RedactionRegion).min(1),
  reason: z.enum(["pii", "financial-secret", "commercial-confidential", "legal-hold", "other"]),
  preserve_metadata: z.boolean().default(false),
});

export const RedactResponse = z.object({
  redacted_document_id: z.number(),
  parent_id: z.number(),
  version: z.string(),
  regions_redacted: z.number(),
  redacted_by: z.string(),
  created_at: z.string().datetime(),
});
```

### 6.3 UI flow

- **AC-1**: "Redact" button in Viewer toolbar (visible if user has `documents:redact`).
- **AC-2**: Click → redaction mode. Canvas overlays PDF. Cursor changes to crosshair. User drags to draw. Rectangles appear with black fill.
- **AC-3**: RedactionModal appears; shows form with reason dropdown and per-region reason input. User clicks "Save redacted copy" → POST request.
- Response: success toast, nav updates to show new redacted version.

### 6.4 Test IDs

`viewer-page`, `viewer-redact-button`, `redaction-toolbar`, `redaction-canvas`, `redaction-region-{index}`, `redaction-region-delete-{index}`, `redaction-modal`, `redaction-reason-select`, `redaction-save-button`.

---

## 7. Data model

Owner: `db-migrator`. Files: `db/schema.sql`, `python-service/app/models.py` + Alembic revision.

### Node SQLite

```sql
-- Extend documents table
ALTER TABLE documents ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES documents(id);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS redacted BOOLEAN DEFAULT 0;

-- New redaction log
CREATE TABLE IF NOT EXISTS redaction_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id),
  redacted_version_id INTEGER NOT NULL REFERENCES documents(id),
  redacted_by TEXT NOT NULL,
  regions TEXT NOT NULL,  -- JSON array of regions
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  tenant_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_redaction_log_document_id ON redaction_log(document_id);
CREATE INDEX IF NOT EXISTS idx_redaction_log_redacted_version ON redaction_log(redacted_version_id);
CREATE INDEX IF NOT EXISTS idx_redaction_log_created_at ON redaction_log(created_at);
```

### Python SQLAlchemy

```python
class Document(Base):
    __tablename__ = "documents"
    
    # ... existing fields ...
    parent_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("documents.id"), nullable=True)
    redacted: Mapped[bool] = mapped_column(Boolean, default=False)

class RedactionLog(Base):
    __tablename__ = "redaction_log"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"))
    document_id: Mapped[int] = mapped_column(Integer, ForeignKey("documents.id"))
    redacted_version_id: Mapped[int] = mapped_column(Integer, ForeignKey("documents.id"))
    redacted_by: Mapped[str] = mapped_column(String(256))
    regions: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    reason: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
```

- **Tenant boundary**: every query filters by `tenant_id`.
- **Soft delete**: original document can be soft-deleted; redacted version preserved for audit.
- **Seed**: none (redaction is user-driven).

---

## 8. Security & compliance

| Concern | Decision |
| --- | --- |
| RBAC | Redact: `checker` / `maker` / `doc_admin` (via `documents:redact`). View redacted: all roles (default). View unredacted: `auditor` / `doc_admin` (via `view_unredacted`). |
| ABAC (OPA) | Branch scope applies; can only redact documents from own branch. |
| Audit | Every redaction writes to `redaction_log` + `audit_log` with action `DOCUMENT_REDACTED` + regions + reason. |
| Encryption at rest | Redacted PDF in STORAGE_DIR inherits AES-256. Original also retained (encrypted). |
| Encryption in transit | TLS 1.3. No HTTP. |
| PII / DSAR | Redaction is one form of PII removal. DSAR request on redacted version returns only redacted copy (original access requires elevated role). |
| Retention | Redacted version inherits retention from original. Original can be retained indefinitely for audit. |
| Input validation | Region bounds validated (x, y, w, h must be non-negative). Reason enum validated. |
| OWASP top 10 | Injection (parameterised), XSS (rectangles drawn on canvas, no user input in SVG), CSRF (session token), broken auth (role check). |
| Rate limit | Redact POST: 10/min per user (prevent spam). |
| Threat model delta | New attack surface: incomplete redaction (user draws small region, misses text). Mitigation: post-redaction verification (test with `pdftotext`); alert if text still visible. |

A `security-reviewer` run is **mandatory** for this high-risk slice.

---

## 9. Performance & observability

### 9.1 Budget

| Layer | Budget |
| --- | --- |
| Rectangle draw interaction | < 50 ms (canvas update) |
| Redaction operation (≤20MB PDF) | p99 ≤ 5s (includes pikepdf processing) |
| Redaction operation (>20MB PDF) | async, progress reported every 1s |
| Verification check (pdftotext) | ≤ 2s |
| Redaction query (list redacted versions) | p99 ≤ 250 ms |
| SPA bundle delta | < 30 KB gzipped (pdf-lib or pikepdf SDK) |

### 9.2 Observability contract

- **Trace** — span `redaction.create`, `redaction.verify` with `document_id`, `parent_id`, `region_count`, `tenant_id`.
- **Metric (counter)** — `redaction_create_total{status="ok|error|verification_failed"}`, `redaction_regions_redacted_total`, `redaction_text_destruction_verified_total`.
- **Metric (histogram)** — `redaction_create_duration_ms`, `redaction_verify_duration_ms`.
- **Log** — structured: `{level, ts, action: "redaction_create|redaction_verify", document_id, regions_count, text_destroyed, duration_ms, tenant_id}`.
- **Audit log row** — `DOCUMENT_REDACTED` + `{parent_id, redacted_version_id, regions, reason}`, `REDACTION_VERIFICATION` + `{text_destroyed, regions_verified}`.

Grafana dashboard: redaction count over time, avg region count per redaction, verification success rate.

---

## 10. Accessibility & i18n

- **WCAG 2.1 AA** — redaction canvas has keyboard alternative: numeric input fields for x/y/w/h + add button. Rectangle draw tool not keyboard-accessible (visual interaction).
- **Screen reader** — "Redact mode active. Click and drag to draw rectangles. Use text inputs below for precise coordinates."
- **Reduced motion** — no animations on region rectangles.
- **i18n** — all strings via `t()`: "Redact", "Draw rectangle", "Reason", "Save redacted copy" in `en.json` and `dz.json`.
- **RTL** — canvas and form render cleanly.
- **Color contrast** — redaction rectangles black on white; ≥ 4.5:1.

---

## 11. Error states & edge cases

| Case | Trigger | UX |
| --- | --- | --- |
| PDF too large | > 50 MB | UI shows "Large file. Redaction may take 30+ seconds." Async processing; progress spinner. |
| Redaction verification fails | pdftotext finds original text in redacted region | Alert: "Verification failed. Text not fully removed. Please contact support." Block save. |
| No regions drawn | User clicks save without drawing | Toast: "Please draw at least one rectangle." |
| Overlapping regions | User draws two overlapping rectangles | Accept (last one wins; dedup in backend). |
| Invalid reason | Form submits with empty reason | Form validation error on reason field. |
| Parent document deleted | User redacts, then original is soft-deleted | Redacted version persists; orphaned but accessible via redaction_log. |
| Concurrent redact | Two users redact same document | First succeeds, second gets 409 Conflict (lock or version check). |
| Out of disk space | Redacted PDF can't be saved | 507 Insufficient Storage; alert to ops. |

---

## 12. Rollout & rollback

- **Feature flag** — `FF_REDACTION` (env var). Default `off` for ≥ 1 release.
- **Stages** — internal demo (test docs only) → 10% canary tenant (legal/compliance heavy) → 50% → 100%.
- **Kill switch** — flip `FF_REDACTION=off` → redaction button hidden, API returns 404. No data loss (existing redactions remain for audit).
- **Migration safety** — additive only. New columns on documents + new redaction_log table. Existing data unaffected.
- **Rollback steps**:
  1. Flip `FF_REDACTION=off`.
  2. Revert deploy.
  3. Verify `redaction_create_total` counter returns to 0.
  4. Retain redaction_log data; manual cleanup not needed.

---

## 13. Test plan

| Layer | File | Owner | Coverage requirement |
| --- | --- | --- | --- |
| Unit (Python) | `python-service/tests/test_redaction_service.py` | `python-engineer` | PDF loading, region extraction, text destruction, verification |
| Unit (SPA) | `apps/web/src/modules/viewer/redaction/__tests__/state.test.ts` | `spa-engineer` | Rectangle draw state, undo, clear |
| Integration (Python) | `python-service/tests/test_redaction_integration.py` | `python-engineer` | End-to-end: upload PDF → redact → verify text destroyed |
| E2E happy | `apps/web/e2e/redaction.spec.ts` | `qa-engineer` | AC-1 through AC-6 (draw, save, verify version chain, audit log) |
| E2E errors | `apps/web/e2e/redaction.errors.spec.ts` | `qa-engineer` | Verification fail, no regions drawn, large file async |
| Verification | `python-service/tests/test_redaction_verify.py` | `python-engineer` | pdftotext post-redaction; assert no original text visible |
| A11y | `apps/web/e2e/a11y.spec.ts` extended | `qa-engineer` | Numeric input alternative, keyboard nav, screen reader |
| Load | `loadtest/k6.js` extended | `qa-engineer` | 10 concurrent redaction operations on 5MB PDF; p99 ≤ 5s |

---

## 14. Telemetry & success metrics

- **Adoption** — % of documents with at least one redacted version. Target: 10% week 1.
- **Redaction completeness** — % redactions where verification passes (text destroyed). Target: 100% (fail on any verification miss).
- **Latency** — p99 redaction time for standard (≤20MB) documents. Target: < 3s.
- **User engagement** — avg regions per redaction. Target: 2-5 (indicates thoughtful selective redaction, not whole-document burns).
- **Compliance KPI** — zero redacted documents with recoverable PII (independent audit).

---

## 15. Definition of Done

- [ ] All sections above filled (no `…` placeholders)
- [ ] `cd python-service && pytest -q python-service/tests/test_redaction*.py` green
- [ ] `cd python-service && mypy --strict app/routers/redaction.py` clean
- [ ] Post-redaction verification: run `pdftotext` on redacted PDF and confirm original text NOT present
- [ ] Rectangle draw tool interactive in SPA (draw, drag, delete, clear all)
- [ ] Redaction modal accepts reason enum and per-region reason
- [ ] New redacted document created with correct `parent_id`, `version`, `redacted=true`
- [ ] `npx playwright test e2e/redaction.spec.ts` green against `./start.sh`
- [ ] `npx playwright test e2e/redaction.errors.spec.ts` green
- [ ] `npx playwright test e2e/a11y.spec.ts` green (no new AA violations; numeric input alternative tested)
- [ ] Users without `view_unredacted` permission default to redacted version (verify via RBAC check)
- [ ] Audit log entries land for `DOCUMENT_REDACTED` + `REDACTION_VERIFICATION` (manual smoke)
- [ ] Metrics visible in Grafana (`redaction_create_total`, `redaction_verify_duration_ms`)
- [ ] Feature flag `FF_REDACTION` default = `off`; redaction button hidden when flag off
- [ ] Redaction_log table populated correctly (regions JSON, reason, redacted_by, created_at)
- [ ] Keyboard alternative for rectangle draw (numeric x/y/w/h inputs) tested
- [ ] `docs/README.md` changelog entry: `2026-MM-DD — document-redaction — draw and permanently redact PII regions in PDFs`
- [ ] ADR `docs/adr/0012-pdf-text-destruction-redaction.md` approved
- [ ] `security-reviewer` agent run completed; no high-severity findings
