# ZorDMS — Build Iteration 2: Implementation Spec
### AI-Powered DMS · Bank of Bhutan Ltd. (BOBL) — prototype enhancement, dev-ready

**Prepared:** 30 Jun 2026
**Source of change-requests:** `DMS_GAP.xlsx` (19 scenarios) · **Prototype:** `bob-dms.html` (13 modules)
**Read alongside:** `ZorDMS_Implementation_Analysis.md` (the backend/API/DB blueprint). This document = the **UI/UX iteration spec**; that document = the **backend wiring**. Together they are the full build.

---

## How to use this document

Each scenario below is a **dev-ready ticket**: it states the *current state*, the *required change*, the *UI behaviour*, the *API + DB* it touches, and the *acceptance criteria* (Definition of Done). Build them in priority order. Reuse the existing foundation (gateway, DB layer, auth) per the blueprint — **do not duplicate**.

**Legend**

| Field | Values |
|---|---|
| **Type** | 🆕 New · ✨ Enhance · 🐞 Fix · 🔀 Move/restructure · 🗑️ Remove |
| **Priority** | P1 (blocking/bug) · P2 (core enhance) · P3 (nice-to-have) |
| **Status** | Each ticket starts *To do* — track in the live artifact tracker |

---

## A. Target Information Architecture (sidebar reorganisation)

Several scenarios are really one structural change: regroup the flat 13-item sidebar into **logical sections**. Target left-nav:

```
INGESTION
  • Capture / Documents            (upload, OCR, export, filter)
  • Document Viewer                 🆕  (just below Capture)
  • Review Queue                    🔀 (moved here, below Document Viewer)
DOCUMENT MANAGEMENT
  • Repository
  • Document Lifecycle              ✨ (System Flow → 4 lifecycle lanes)
  • Record Management               ✨ (retention rules + dashboard)
OPERATIONS
  • Case Management
  • Alerts & Events                 ✨ (analytics)
ANALYTICS
  • Dashboard (AI-assisted)
  • Reports
INTELLIGENCE
  • AI Features
  • Validation Configuration        🆕
PLATFORM
  • Integration Hub
  • Configuration                   (rebuild = prototype)
  • Master Setup
  • User Management                 (was Security & RBAC; single page)
  • System Administration           ✨
```

**Removed:** the "Enterprise" item (SC-08) and the duplicate standalone "User Management" page (SC-17 — its function merges into the renamed Security & RBAC page, SC-16).

**Global rule (SC-10):** every nav link must route to a working page — no dead links. Add an automated check that each `data-page` has a matching rendered section.

---

## B. Scenarios (dev-ready)

### SC-01 — AI-assisted Dashboard + report/graph config · ✨ · P2
**Current:** Dashboard shows static KPI cards, one funnel (Chart.js), branch table — all from hardcoded arrays.
**Change:** (a) Add an **"AI-assisted" panel** that narrates the dashboard (what's happening today, anomalies, SLA risks) via the chat/LLM service. (b) Make **all graphs configurable** — user picks the data source (pipeline stage data vs document/case data) and chart type. (c) Allow choosing whether a metric is shown **in the pipeline view or as a graph**.
**UI:** "Customise" button per chart → choose dataset, dimension, measure, chart type; AI-assist card at top with a refresh.
**API:** `GET /api/dashboard/kpis`, `GET /api/dashboard/funnel?source=`, `POST /api/ai/insights` (LLM narration over current metrics). `GET/PUT /api/dashboard/layout` (saved per user).
**DB:** aggregates over `documents`, `cases`, `processing_events`; `dashboard_layouts(user_id, config_json)`.
**Done when:** charts re-render from a chosen data source; AI-assist text reflects live numbers; layout persists per user.

### SC-02 — Capture: OCR, data export & filter · ✨ · P1
**Current:** Documents/Capture has client-side Tesseract OCR (demo), a table, basic filters; export shows a prototype CSV alert.
**Change:** (a) Replace demo OCR with **server-side OCR** call (qwen-vl/granite-vision). (b) Real **data export** (CSV/Excel) of the filtered set. (c) Richer **filter** (type, branch, status, date-range, confidence range, doc-type).
**API:** `POST /api/ai/ocr`, `GET /api/documents?type=&branch=&status=&from=&to=&minConf=`, `GET /api/documents/export?<filters>`.
**DB:** `documents`, `document_metadata`, `ocr_results`.
**Done when:** OCR returns server text; export downloads the actual filtered rows; all filters combine and reflect in a "showing N of M" note.

### SC-03 — Indexing & Queue: document view · 🆕 · P1
**Current:** AI Processing queue (`queue[]`) lists items per step but you can't open the document.
**Change:** Each queue row is **clickable → opens the Document Viewer** (SC-09) showing the doc + its current AI step/results.
**API:** `GET /api/ai/queue`, `GET /api/documents/:id`, `GET /api/ai/queue/:jobId`.
**DB:** `processing_jobs`, `processing_steps`.
**Done when:** clicking any queue item opens a working viewer with live step status.

### SC-04 — Case Management: clickable KPIs, type breakdown, layout · ✨🐞 · P1
**Current:** Active/Total/Closed boxes are static; case-by-type breakdown thin; visible blank space in layout.
**Change:** (a) **"Active cases" and "Total closed" boxes become clickable** → filter the board to that set. (b) Add **case-by-type breakdown** chart/list. (c) **Remove the blank space** — tighten the board grid.
**UI:** KPI box click sets a board filter (with a clear-filter chip); breakdown is a small bar/donut by `case_type`.
**API:** `GET /api/cases?status=&type=`, `GET /api/cases/stats`.
**DB:** `cases`, `case_types`, `case_history`.
**Done when:** clicking KPI boxes filters the board; breakdown renders from real counts; no empty gap remains.

### SC-05 — Repository: preview, new-folder/path, upload bugs · 🐞🆕 · P1
**Current:** Document **preview not working** (no file behind seed docs); no folder-create; **upload "Choose file" bug** — the dropzone keeps offering "browse" even after a file is selected (both `dz.onclick` and the Browse button call `fileInput.click()` with no selected-state).
**Change:**
1. **Document preview** — render the stored file from MinIO (PDF/image viewer); for text, show extracted text.
2. **Create new folder** with a **path/directory picker** (choose parent dept/folder).
3. **Upload dialog fixes:** after a file is chosen, show it in the staged list and **stop re-prompting**; "Browse" only adds more, not re-opens blindly; **document Title** and **Branch** become proper selectable fields (Branch = dropdown of branches, not free text); fix the duplicate file-choose trigger.
**API:** `GET /api/documents/:id/file` (presigned MinIO URL), `POST /api/folders {parentId,name}`, `GET /api/folders/tree`, `POST /api/documents` (multipart → MinIO).
**DB:** `folders(id,parent_id,name,dept_id)`, `documents.folder_id`, object in MinIO.
**Done when:** preview opens the real file; a new folder can be created under a chosen path; uploading a file shows it staged once, with Title + Branch dropdown, and no repeat-prompt bug.

### SC-06 — Record Management: retention rules + dashboard · ✨🆕 · P2
**Current:** Retention only referenced indirectly (doctype retention column, an "auto-archived" audit line).
**Change:** A **Record Management** page where you can **create/edit retention rules** (per doc-type: period, action = archive/delete/legal-hold) and an **enhanced dashboard** (records by retention status, due-for-archival, on legal hold, storage reclaimed).
**API:** `GET/POST/PUT /api/retention/rules`, `GET /api/retention/dashboard`, scheduled job for auto-archival.
**DB:** `retention_policies(doc_type,period,action)`, `retention_events`.
**Done when:** a new retention rule can be saved and shows in the dashboard; due-for-archival count is computed from real dates.

### SC-07 — Document Lifecycle: 4 full system flows · ✨ · P2
**Current:** "System Flow" is one static diagram.
**Change:** Show **four lifecycle lanes**: (1) **Document Lifecycle** (capture→OCR→classify→extract→validate→approve→archive), (2) **AI Processing Layer** (model pipeline + confidence gates), (3) **Business Workflow** (maker→checker→approver hierarchy), (4) **Integration Lifecycle** (LOS/mBoB IN → CBS/CRM OUT events). Each lane interactive (click a node → detail).
**API:** `GET /api/flows/{document|ai|workflow|integration}` (definitions from config).
**DB:** read-only over `workflows`, `workflow_steps`, `integration_connectors`.
**Done when:** all four lanes render; nodes are clickable with detail; reflects configured workflows, not hardcoded.

### SC-08 — Remove "Enterprise" · 🗑️ · P2
**Change:** Remove the **Enterprise** item/section entirely from nav and code.
**Done when:** no "Enterprise" nav link or page remains; no dead references.

### SC-09 — Document Viewer module (below Capture) · 🆕 · P1
**Current:** No dedicated viewer; preview only works for the OCR image temporarily.
**Change:** New **Document Viewer** module placed **directly below Capture** in the Ingestion section. It renders the selected document (PDF/image/text), shows extracted metadata side-by-side, AI confidence, and version history. Must be reachable from Documents, Repository, AI Queue, Cases.
**API:** `GET /api/documents/:id`, `GET /api/documents/:id/file`, `GET /api/documents/:id/versions`, `GET /api/documents/:id/metadata`.
**DB:** `documents`, `document_versions`, `document_metadata`.
**Done when:** viewer opens a real file with metadata + versions; deep-linkable by doc id.

### SC-10 — Move Review Queue into Ingestion + navbar audit · 🔀🐞 · P1
**Change:** (a) Move **Review Queue** under Ingestion, **below the Document Viewer**. (b) **Audit every navbar link** — confirm each routes to a live page; fix any dead links.
**Done when:** Review Queue sits below Document Viewer; an automated nav check passes for all links (none dead).

### SC-11 — Compliance & Audit: enhance · ✨ · P2
**Current:** Audit is a flat table (`audit[]`); compliance scattered.
**Change:** Dedicated **Compliance & Audit** view: tamper-evident audit log (chained-hash), filters (actor, action, date, entity), **export**, and a **compliance panel** (RMA checks status, policy violations, overrides). 
**API:** `GET /api/audit?actor=&action=&from=&to=`, `GET /api/audit/export`, `GET /api/compliance/status`.
**DB:** `audit_log` (hash_prev chain), `validation_results`, `compliance_checks`.
**Done when:** audit filters + export work; compliance panel shows real RMA/policy status; log entries are hash-chained.

### SC-12 — Alerts & Events: analytics · ✨ · P2
**Current:** Alerts/events minimal.
**Change:** Add an **analytics section**: events over time, by type/severity, top sources, MTTR/ack rate; drill-down to event detail.
**API:** `GET /api/events?type=&severity=&from=&to=`, `GET /api/events/analytics`.
**DB:** `events(type,severity,source,ts,ack_by)`.
**Done when:** analytics charts render from real events with drill-down.

### SC-13 — Integration Hub: enhance · ✨ · P2
**Current:** 15 connector cards all fake "Connected".
**Change:** Real **health checks** (live status + latency), per-connector **config** (endpoint, auth via Vault, retry), **logs** view, and IN/OUT direction badges. (Connector list & mapping per blueprint §6.)
**API:** `GET /api/integrations` (real health), `PATCH /api/integrations/:id/config`, `GET /api/integrations/:id/logs`.
**DB:** `integration_connectors`, `integration_logs`; secrets in **Vault**.
**Done when:** each card shows real reachability; config saves; logs viewable; no hardcoded "Connected".

### SC-14 — Configuration page: rebuild = prototype · 🆕 · P2
**Change:** Build the **Configuration** page exactly as the prototype: institution details, upload formats & size limits, AI thresholds, workflow/SLA rules, security/retention — all persisted.
**API:** `GET/PUT /api/config`.
**DB:** `system_config(key,value,updated_by)` (audited).
**Done when:** every prototype config control reads/writes real config and applies across the app.

### SC-15 — Validation Configuration module · 🆕 · P2
**Change:** New **Validation Configuration** page per prototype: define validation rules per doc-type/field (required, format/regex, cross-field, CBS/KYC check), severity, and exception handling.
**API:** `GET/POST/PUT /api/validation/rules`.
**DB:** `validation_rules`, `validation_results`.
**Done when:** a rule can be created and is enforced during extract/validate; failures surface in the doc and the queue.

### SC-16 — Security & RBAC → rename "User Management" + enhance · ✨ · P2
**Change:** **Rename** the Security & RBAC module to **"User Management"** and **enhance** it: users CRUD, roles & permissions matrix (RBAC), scope (branch/bank-wide), AD/SSO import, MFA settings, account lock/unlock. This becomes the **single** place for users/roles.
**API:** `GET/POST/PUT /api/users`, `GET/POST /api/roles`, `POST /api/admin/import-ad`.
**DB:** `users` (extend foundation), `roles`, `role_permissions`.
**Done when:** one "User Management" page covers users + roles + import; old "Security & RBAC" label gone.

### SC-17 — Remove duplicate User Management page · 🗑️ · P1
**Change:** Remove the **separate/standalone** User Management page so there is no duplication with SC-16. (Apparent conflict with SC-16 resolved: keep ONE consolidated page = the renamed module; delete the redundant one.) **→ Confirm with product owner.**
**Done when:** exactly one users/roles page exists; no duplicate nav entry.

### SC-18 — System Administration: enhance · ✨ · P2
**Current:** Admin tabs (general, security, audit, library, builder, workflows, doctypes, upload).
**Change:** Enhance **System Administration**: system health/status, background jobs & schedulers, AI model management (versions, thresholds), workflow builder, backup/retention status, license/info. (Audit & compliance split out to SC-11; users split out to SC-16.)
**API:** `GET /api/admin/health`, `GET /api/admin/jobs`, `GET/PUT /api/ai/models`, workflow-builder CRUD.
**DB:** `system_config`, `ai_models`, `processing_jobs`, `workflows`.
**Done when:** admin shows live system health + jobs + model mgmt; workflow builder saves real workflows.

### SC-19 — Master Setup module (per prototype) · 🆕 · P2
**Change:** Build **Master Setup** per prototype: CRUD for **branches, departments, document types, workflows** (and roles if not in User Management). Each with add/edit, validation, and audit.
**API:** CRUD `/api/master/{branches|departments|doctypes|workflows}`.
**DB:** `branches`, `departments`, `document_types`, `workflows`, `workflow_steps`.
**Done when:** every master entity can be created/edited and is used by the rest of the app (dropdowns reference these, not hardcoded arrays).

---

## C. Cross-cutting requirements (apply to every ticket)

1. **No mock data:** every screen reads/writes through real APIs + DB; remove hardcoded JS seed arrays once the matching endpoint exists.
2. **Reuse foundation:** route all APIs through the existing gateway; all tables via the existing Postgres/Oracle migration layer; extend existing auth — never fork it.
3. **Server-side AI only:** drop client-side Tesseract.js; all OCR/AI via FastAPI + vLLM.
4. **Storage:** binaries to MinIO (presigned URLs for preview), never the browser.
5. **Security on every action:** RBAC/ABAC checks, audit-log write (hash-chained), PII masking in previews by role.
6. **Nav integrity (SC-10):** automated test asserts every `data-page` has a live route.

---

## D. Priority build order

**Wave 1 — P1 fixes/blocking (do first):**
SC-05 (repository/upload bugs), SC-09 (document viewer), SC-02 (capture OCR/export/filter), SC-03 (queue → viewer), SC-04 (case KPIs), SC-10 (review-queue move + nav audit), SC-17 (remove duplicate page).

**Wave 2 — P2 core enhancements:**
SC-01 (AI dashboard), SC-06 (record mgmt), SC-07 (lifecycle flows), SC-11 (compliance/audit), SC-12 (alerts analytics), SC-13 (integration hub), SC-14 (configuration), SC-15 (validation config), SC-16 (user management), SC-18 (system admin), SC-19 (master setup), SC-08 (remove Enterprise).

**Wave 3 — P3:** any remaining polish surfaced during Wave 1–2.

---

## E. Open questions — confirm before/while building

1. **SC-16 vs SC-17 conflict:** rename Security&RBAC → "User Management" AND remove a separate User Management page. Confirmed interpretation = consolidate to one page. **Verify.**
2. **SC-08 "Enterprise":** confirm exactly which element is the "Enterprise" item to remove (no such nav label in current prototype — may be a section heading/card).
3. **Document Lifecycle (SC-07):** confirm the four lanes' exact node sequences with the business team.
4. Carried from blueprint: **Dzongkha OCR** feasibility, **CBS = BaNCS vs "GBP"**, **React+TS vs current front-end** — still open and gate several tickets.

---

### Definition of Done (whole iteration)
Every scenario meets its acceptance criteria; no nav dead-links; no hardcoded mock arrays remain on shipped screens; all data flows through real APIs + DB on the foundation; document viewer + preview work end-to-end with MinIO; and the open questions in §E are resolved with the client.
