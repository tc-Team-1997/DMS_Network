# Contract — OCR Confidence Threshold Tuning (Learn Wizard UI)

> **Per-doctype OCR confidence threshold control in Document Types admin page (Learn Wizard).** Dual-range slider for autofill_floor + high_confidence. Closes bob-compliance-summary §72 and bidding §31.

## Header

| Field | Value |
| --- | --- |
| Feature | `ocr-confidence-tuning` |
| Spec ID | `bidding §31`, `bob-compliance-summary §72` |
| Owner | _assigned by team lead_ |
| Status | `shipped` |
| Risk class | `low` (UX polish on existing data; no schema change, no new security surface) |
| Contract published | `2026-05-09` |
| Last updated | `2026-05-09` |
| Related ADR | _n/a — configuration UI only_ |

---

## 1. Problem & user story

**Problem:** Document officers cannot fine-tune OCR confidence thresholds for document types. A threshold of 0.5 may be too permissive for contracts (extract `amount_due` with 45% confidence → incorrect charge), but too strict for invoices (extract `invoice_number` at 40% confidence → usually correct). Tenants need per-doctype control.

**Why now:** Compliance requirement (bob-compliance-summary §72 — "auditable OCR confidence settings per doctype"). Bidding §31 ("admin UI for threshold tuning"). Allows tenants to reduce false positives (auto-fill errors) without manual review overhead.

**Personas affected:**
- `Doc Admin` — opens Document Types > select doctype > Thresholds tab. Adjusts sliders for autofill_floor (gold) + high_confidence (green). Sees live preview of sample document with new thresholds.
- `Maker` — benefits from tuned thresholds: fewer "Review extraction" warnings when autofill is correct.
- `Auditor` — reviews audit_log entries showing which tenant changed thresholds when + old vs. new values.

**Out of scope:**
- Machine learning model retraining. Thresholds only control decision boundary, not model accuracy.
- Per-field thresholds. Doctype-level only (future work).
- Temporal thresholds (e.g., "strict on Tuesdays"). Static thresholds only.
- Auto-tuning based on feedback. Manual admin control only.

---

## 2. Acceptance criteria

- **AC-1** — Given a Document Type with `autofill_floor=0.4` and `high_confidence=0.7`, when the Doc Admin opens the Thresholds tab, two horizontal range sliders are visible: gold slider (autofill_floor, 0–1 scale, ticks every 0.1) and green slider (high_confidence, 0–1 scale). Current values shown as numbers.
- **AC-2** — Given a sample document (selected via `tested_with_sample_id` column), when Doc Admin adjusts the autofill_floor slider to 0.5, the preview pane re-renders the sample's extraction with only fields >= 0.5 confidence showing "auto-filled", others showing "review required". Update debounced 500ms, no server call until "Save" clicked.
- **AC-3** — Given sliders adjusted but not saved, the "Reset to defaults" button restores sliders to 0.4 (autofill_floor) and 0.7 (high_confidence). "Save" button persists via `PATCH /spa/api/document-types/{id} { autofill_floor, high_confidence }`.
- **AC-4** — Given a successful save, audit_log entry is written: action `DOCTYPE_THRESHOLDS_UPDATED`, details `{ old_autofill_floor, new_autofill_floor, old_high_confidence, new_high_confidence, changed_by }`.
- **AC-5** — Range sliders are accessible: keyboard-only navigation (Tab to focus, arrow keys adjust ±0.05 per keystroke or ±0.01 per shift+arrow). ARIA labels: `<input aria-valuetext="autofill floor 40%">`.
- **AC-6** — Sliders render cleanly in RTL mode (Arabic locale): sliders flip left-right, numeric labels positioned correctly.

---

## 3. End-to-end workflow

```
[Doc Admin on Document Types page]
              │
              ├─ clicks doctype row to expand details
              │
              ├─ tabs appear: Fields | Samples | Thresholds
              │
              ├─ clicks "Thresholds" tab
              │
              ▼
[Thresholds tab renders]
              │
              ├─ two dual-handle range sliders visible:
              │  ├─ autofill_floor (gold): "Extract confidently, auto-fill forms"
              │  ├─ high_confidence (green): "Show user extraction, request review if below"
              │
              ├─ current values displayed: "autofill: 0.40", "confidence: 0.70"
              │
              ├─ "Reset to defaults" button (restores 0.4 / 0.7)
              │
              ├─ "Save" button (disabled until change detected)
              │
              ├─ sample preview pane below sliders
              │   (if tested_with_sample_id set, shows that sample's OCR + extraction)
              │
              ▼
[Admin adjusts autofill_floor slider to 0.50]
              │
              ├─ slider moves, numeric label updates "autofill: 0.50"
              │
              ├─ Save button enabled
              │
              ├─ preview pane updates (debounced 500ms):
              │   shows sample extraction with fields:
              │   - "cif_number": 0.95 confidence → green checkmark, "auto-filled"
              │   - "amount_due": 0.35 confidence → red icon, "confidence 35% (below 50%)"
              │   - "invoice_date": 0.72 confidence → yellow icon, "review required (below 70%)"
              │
              ▼
[Admin clicks "Save" button]
              │
              ├─ button disabled, spinner shown
              │
              ├─ POST /spa/api/document-types/{id} { autofill_floor: 0.5, high_confidence: 0.7 }
              │
              ├─ Node proxies to Python PATCH /api/v1/document-types/{id}
              │
              ▼
[Python endpoint]
              │
              ├─ validates 0 <= autofill_floor <= 1, 0 <= high_confidence <= 1
              │
              ├─ validates autofill_floor <= high_confidence (rule: low threshold ≤ high threshold)
              │
              ├─ updates document_type_schemas row
              │
              ├─ writes audit_log { action: DOCTYPE_THRESHOLDS_UPDATED, details: {...} }
              │
              ├─ returns 200 { id, autofill_floor, high_confidence, updated_at }
              │
              ▼
[SPA renders success toast: "Thresholds saved"]
              │
              ├─ numeric labels update
              │
              ├─ preview re-renders with new thresholds
              │
              ├─ Save button re-disabled
```

---

## 4. API contract — Python (`/api/v1/document-types/*`)

Owner: `python-engineer`. File: `python-service/app/routers/document_types.py` (extend existing).

| Method | Path | Auth | Idempotent | Purpose |
| --- | --- | --- | --- | --- |
| `PATCH` | `/api/v1/document-types/{id}` | `require_api_key` + JWT(role≥doc_admin) | Y | Update doctype (extend: add autofill_floor, high_confidence, tested_with_sample_id) |

### Request / response shapes (extend existing)

```jsonc
// PATCH /api/v1/document-types/{id} — request (partial update)
{
  "autofill_floor": 0.5,
  "high_confidence": 0.7,
  "tested_with_sample_id": 42
}

// PATCH /api/v1/document-types/{id} — 200
{
  "id": 10,
  "name": "Invoice",
  "description": "...",
  "fields": [...],
  "autofill_floor": 0.5,
  "high_confidence": 0.7,
  "tested_with_sample_id": 42,
  "updated_at": "2026-05-09T15:30:00Z"
}

// PATCH — 400 (validation)
{
  "error": "validation_failed",
  "details": {
    "autofill_floor": "must be >= 0 and <= 1",
    "high_confidence": "must be >= autofill_floor"
  }
}
```

---

## 5. API contract — Node SPA mirror (`/spa/api/document-types/*`)

Owner: `node-engineer`. File: `routes/spa-api/document-types.js` (extend existing).

| Method | Path | Session auth | RBAC perm | Notes |
| --- | --- | --- | --- | --- |
| `PATCH` | `/spa/api/document-types/{id}` | required | `doctype:write` | Proxies PATCH; injects API key server-side |

**Divergence from Python shape:** None.

---

## 6. SPA module

Owner: `spa-engineer`. Folder: `apps/web/src/modules/document-types/` (extend existing).

### 6.1 Files
- `DocumentTypesPage.tsx` — existing, add "Thresholds" tab
- `ThresholdsTab.tsx` — new component with range sliders
- `components/ConfidenceRangeSlider.tsx` — reusable dual-handle slider
- `components/ExtractionPreview.tsx` — sample extraction preview with confidence colors
- `api.ts` — extend with zod for new fields
- `schemas.ts` — extend schemas

### 6.2 Schemas (extend existing)

```ts
import { z } from "zod";

// Existing DocumentType extended:
export const DocumentType = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string().nullable(),
  fields: z.array(FieldDef),
  autofill_floor: z.number().min(0).max(1).default(0.4),
  high_confidence: z.number().min(0).max(1).default(0.7),
  tested_with_sample_id: z.number().int().nullable().optional(),
  active: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const ThresholdUpdate = z.object({
  autofill_floor: z.number().min(0).max(1),
  high_confidence: z.number().min(0).max(1),
  tested_with_sample_id: z.number().int().nullable().optional(),
}).refine(
  (data) => data.autofill_floor <= data.high_confidence,
  { message: "autofill_floor must be <= high_confidence", path: ["autofill_floor"] }
);
export type ThresholdUpdate = z.infer<typeof ThresholdUpdate>;
```

### 6.3 UI flow

**ThresholdsTab Component:**
1. Tab opened → renders two horizontal range sliders stacked vertically.
2. **Gold slider (autofill_floor):** Label "Confidence floor for auto-fill (0–100%)", numeric display "0.40 (40%)", track colored gold with filled portion.
3. **Green slider (high_confidence):** Label "Confidence threshold for review (0–100%)", numeric display "0.70 (70%)", track colored green.
4. Both sliders have tick marks every 0.1 (0, 0.1, 0.2, ..., 1.0) + numeric label at each tick.
5. Sliders move independently but autofill_floor cannot exceed high_confidence (UI constraint: if user drags autofill_floor above high_confidence, it snaps back; or reorder them).
6. Below sliders: "Reset to defaults" button + "Save" button (disabled until change).
7. **Extraction Preview section:**
   - Dropdown: "Sample to preview" → list of uploaded samples (if any) or "No samples uploaded".
   - If sample selected (via `tested_with_sample_id`): render sample image thumbnail + extracted fields table.
   - Extraction table columns: Field Name | Extracted Value | Confidence | Status.
   - Status color-coded: green "auto-fill" (>= autofill_floor), yellow "review" (>= high_confidence but < autofill_floor), red "skip" (< high_confidence).
8. **Save flow:** On click, disable Save button, show spinner. POST PATCH. On success, show green toast "Thresholds saved". On error, show red toast with error details. Re-enable Save.

### 6.4 Test IDs (for Playwright)

`doctype-thresholds-tab`, `autofill-floor-slider`, `confidence-high-slider`, `autofill-floor-label`, `confidence-high-label`, `thresholds-reset-button`, `thresholds-save-button`, `extraction-preview-sample-select`, `extraction-preview-table`, `extraction-field-status-{field_name}`.

---

## 7. Data model

Owner: `db-migrator`. Files: `db/schema.sql` (Node SQLite), `python-service/app/models.py` + Alembic revision.

### Node SQLite (db/schema.sql) — extend existing `document_type_schemas`

```sql
-- Columns added to document_type_schemas (if not already present):
ALTER TABLE document_type_schemas ADD COLUMN IF NOT EXISTS autofill_floor REAL DEFAULT 0.4;
ALTER TABLE document_type_schemas ADD COLUMN IF NOT EXISTS high_confidence REAL DEFAULT 0.7;
ALTER TABLE document_type_schemas ADD COLUMN IF NOT EXISTS tested_with_sample_id INTEGER REFERENCES document_type_samples(id) ON DELETE SET NULL;
```

### Python SQLAlchemy (python-service/app/models.py) — extend existing DocumentTypeSchema

```python
from sqlalchemy import Column, Integer, Float, ForeignKey

# Extend DocumentTypeSchema model (assumed existing):
class DocumentTypeSchema(Base):
    __tablename__ = "document_type_schemas"
    # ... existing columns ...
    autofill_floor = Column(Float, nullable=False, default=0.4)
    high_confidence = Column(Float, nullable=False, default=0.7)
    tested_with_sample_id = Column(Integer, ForeignKey("document_type_samples.id", ondelete="SET NULL"))
```

**Tenant boundary:** Every query filters by `tenant_id` (inherited from existing DocumentTypeSchema).

**Defaults:** autofill_floor=0.4, high_confidence=0.7 (tuned for balanced precision/recall across doc types).

**Seed:** `db/seed.js` initializes default thresholds on existing doctypes (Invoice, National ID, etc.).

---

## 8. Security & compliance

| Concern | Decision |
| --- | --- |
| RBAC | `doctype:write` required to update thresholds. Only `doc_admin` role allowed. Default deny. |
| ABAC (OPA) | Tenant isolation: cannot update doctypes outside tenant. OPA rule: `doctype.write.allowed[tenant][doctype_id]`. |
| Audit | Every threshold change writes to `audit_log`: action `DOCTYPE_THRESHOLDS_UPDATED`, details `{ doctype_id, old_autofill_floor, new_autofill_floor, old_high_confidence, new_high_confidence, changed_by, changed_at }`. User SID included. |
| Encryption at rest | Thresholds are floats, not sensitive. No encryption needed. |
| Encryption in transit | TLS 1.3 on all hops. |
| PII / DSAR | N/a — thresholds contain no PII. |
| Retention | Thresholds persist until next admin change. audit_log entries retained per tenant policy (7y default). |
| Input validation | autofill_floor and high_confidence must be in [0, 1]. autofill_floor must be <= high_confidence (Zod refine). tested_with_sample_id must reference an existing sample in same doctype. |
| OWASP top 10 | Injection (no user strings in thresholds), XSS (floats rendered as text), CSRF (session token), SSRF (n/a), broken auth (JWT + RBAC), insecure deserialisation (n/a), XXE (n/a), broken access control (RBAC enforced), security logging (threshold values are not PII, logged safely), dependency vulns (standard). |
| Rate limit | No per-endpoint rate limit needed (threshold changes are infrequent). Admin UI is not high-traffic. |
| Threat model delta | **New surface:** None. Extends existing doctype admin surface with two new fields. No new external dependencies or network calls. |

---

## 9. Performance & observability

### 9.1 Budget

| Layer | Budget |
| --- | --- |
| API p99 latency | `< 250 ms` (simple PATCH, no heavy computation) |
| DB query cost | UPDATE document_type_schemas is indexed on tenant_id + id. Single row update. |
| SPA bundle delta | `< 6 KB gzipped` (ThresholdsTab, ConfidenceRangeSlider, ExtractionPreview) |
| Payload size | `< 1 KB` per request (just 2–3 floats + sample_id) |
| Memory delta | Negligible; sliders are HTML inputs. |

### 9.2 Observability contract

- **Trace** — span `doctype.patch` with attributes `tenant_id`, `doctype_id`, `changed_fields`, `latency_ms`
- **Metric (counter)** — `doctype_threshold_updates_total{tenant}` (Prometheus)
- **Metric (histogram)** — `doctype_patch_duration_seconds`
- **Log** — structured line: `{ts, tenant_id, doctype_id, action: "DOCTYPE_THRESHOLDS_UPDATED", old/new thresholds, latency_ms}`
- **Audit log row** — for every threshold change

Add Grafana dashboard row (or extend "Document Types" row): "Threshold Changes" with panels:
- Histogram of threshold values across all doctypes (to detect drift from defaults).
- Audit log heatmap: which doctypes changed most frequently.
- Distribution of autofill_floor and high_confidence values per tenant.

---

## 10. Accessibility & i18n

- **WCAG 2.1 AA** — Range sliders keyboard-navigable (Tab, arrow keys adjust ±0.05). Visual focus ring on slider thumb. ARIA labels: `<input type="range" aria-label="Autofill floor confidence" aria-valuetext="40 percent" aria-valuenow="0.4">`. Numeric display beside slider for non-visual users.
- **Screen reader** — Labels announce: "Autofill floor confidence, 40 percent, adjustable with arrow keys." Extraction preview table has column headers; each row announces field name, confidence, and status.
- **Reduced motion** — No animations on slider drag. Preview table updates instantly (no fade-in). Reset button has no hover effect beyond color change.
- **i18n** — All strings via `t()`: `t('doctype.thresholds_tab')`, `t('doctype.autofill_floor_label')`, `t('doctype.high_confidence_label')`, `t('doctype.reset_button')`, `t('doctype.save_button')`. Keys in `apps/web/src/i18n/{en,dz}.json`.
- **RTL** — Sliders use logical properties (`margin-inline`, `padding-inline`). Numeric labels positioned relative to logical start/end. Extraction table text direction respects `dir` attribute.
- **Color contrast** — Gold slider track (RGB 217, 119, 6) on white ≥ 3:1. Green track (RGB 34, 197, 94) on white ≥ 3:1. Table status cells: green text ≥ 4.5:1, yellow ≥ 4.5:1, red ≥ 4.5:1.

---

## 11. Error states & edge cases

| Case | Trigger | UX |
| --- | --- | --- |
| Validation — autofill > confidence | User drags autofill_floor above high_confidence | Slider snaps back to high_confidence value. Toast: "Autofill floor cannot exceed confidence high." |
| Validation — out of range | Direct input (e.g., URL manipulation) sends value > 1 | Server rejects 400 "validation_failed". Client form shows inline error: "Value must be between 0 and 1." |
| Sample not found | tested_with_sample_id references deleted sample | Preview pane shows "Sample not available." Admin can select a different sample or leave blank. |
| No samples uploaded | Doctype has no samples | Preview pane shows: "No samples uploaded. Upload samples to preview extraction." [Upload button]. |
| Network error | Patch request fails | Toast (red): "Failed to save thresholds. [Retry]". Form remains dirty (unsaved). |
| Concurrent edit | Two admins edit same doctype simultaneously | Last write wins (no conflict detection). Both receive 200. Audit log shows both changes. Consider warning if > 1 change in 5 min (future: optimistic locking). |
| Reset while unsaved | User clicks "Reset" before saving | Toast: "Changes discarded. Sliders reset to defaults." Sliders return to 0.4 / 0.7. |
| Browser tab closed unsaved | User navigates away with unsaved changes | Browser's `beforeunload` warns: "You have unsaved changes. Are you sure?" |

---

## 12. Rollout & rollback

- **Feature flag** — `FF_OCR_CONFIDENCE_TUNING` (env var or settings table). Default `on` (low-risk UX feature). When `off`, Thresholds tab hidden from UI; PATCH endpoint still works for automation.
- **Stages** — No staged rollout needed (low-risk). Ship to all tenants in one release.
- **Kill switch** — flip flag `off` → tab hidden. Existing threshold values persist in DB (no data loss).
- **Migration safety** — purely additive: 3 new columns on existing table. No schema destruction.
- **Rollback steps** — (1) flip flag off, (2) revert deploy, (3) revert DB migration if needed (`ALTER TABLE document_type_schemas DROP COLUMN IF EXISTS ...`). Old code ignores new columns gracefully.

---

## 13. Test plan

| Layer | File | Owner | Coverage requirement |
| --- | --- | --- | --- |
| Unit (Zod) | `apps/web/src/modules/document-types/schemas.ts` | `spa-engineer` | ThresholdUpdate refine: autofill_floor <= high_confidence |
| Unit (Python) | `python-service/tests/test_doctype_api.py` (extend) | `python-engineer` | PATCH with new threshold fields, validation (range 0–1, floor <= high) |
| Integration (Node) | `routes/spa-api/__tests__/document-types.test.js` (extend) | `node-engineer` | RBAC check (only doc_admin), proxy to Python |
| E2E happy | `apps/web/e2e/doctype-thresholds.spec.ts` (extend if exists) | `qa-engineer` | AC-1: open Thresholds tab, see sliders. AC-2: adjust autofill_floor, see preview update. AC-3: reset to defaults, click save, verify audit log. |
| E2E errors | `apps/web/e2e/doctype-thresholds.errors.spec.ts` | `qa-engineer` | Validation errors (autofill > confidence, out of range), network failure, no samples |
| A11y | `apps/web/e2e/a11y.spec.ts` extended | `qa-engineer` | axe-core scan on Thresholds tab (focus on range sliders), keyboard nav, no violations |
| Visual | `apps/web/e2e/visual.spec.ts` extended (optional) | `qa-engineer` | Sliders render correctly at different confidence values (screenshot diffs) |

---

## 14. Telemetry & success metrics

- **Adoption** — 50% of doc_admin users adjust thresholds in first 2 weeks (event: `doctype.threshold_changed`).
- **Latency** — PATCH latency p99 < 250 ms (server-side); slider update latency p99 < 100 ms (client-side debounce).
- **Error rate** — < 0.5% PATCH errors (validation or server issues).
- **Impact on extraction quality** — Track before/after: documents requiring manual extraction review (confidence between autofill_floor and high_confidence) should decrease by 20% on average after tenants tune thresholds to their data distribution.

---

## 15. Definition of Done

- [ ] All 15 sections above filled
- [ ] `cd apps/web && npm run typecheck` green (Zod schemas, ThresholdUpdate refine)
- [ ] `cd python-service && pytest -q python-service/tests/test_doctype_api.py` green (PATCH with thresholds, validation)
- [ ] `cd apps/web && npm run test -- routes/spa-api/__tests__/document-types.test.js` green (RBAC, proxy)
- [ ] `cd apps/web && npx playwright test e2e/doctype-thresholds.spec.ts` green against live `./start.sh` (AC-1: open tab, AC-2: adjust + preview, AC-3: save + audit log)
- [ ] `cd apps/web && npx playwright test e2e/doctype-thresholds.errors.spec.ts` green (validation, network errors, no samples)
- [ ] `npx playwright test e2e/a11y.spec.ts` green (range sliders pass axe-core, no AA violations)
- [ ] audit_log entries land for every threshold change (manual smoke: adjust thresholds, verify DOCTYPE_THRESHOLDS_UPDATED in logs with old/new values)
- [ ] Metrics visible in local Grafana (doctype_threshold_updates_total, doctype_patch_duration_seconds)
- [ ] DB migration (Alembic for Python, manual SQL for Node) applied and reversible
- [ ] `docs/README.md` changelog entry: `2026-05-DD — ocr-confidence-tuning — per-doctype threshold sliders in Learn Wizard with live extraction preview and audit trail`
