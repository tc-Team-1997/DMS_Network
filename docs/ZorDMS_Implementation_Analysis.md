# ZorDMS — Implementation Analysis & Build Blueprint
### AI-Powered Document Management System · Bank of Bhutan Ltd. (BOBL)

**Prepared:** 29 Jun 2026
**Purpose:** Turn the approved prototype into a buildable plan — mapping every prototype screen to the backend API, database, AI service and integration it needs, **without re-building what already exists** in the foundation.

**Inputs used for this analysis**
- `DMS Technical Proposal.docx` — client's contracted requirements
- `DEPLOYMENT-ARCHITECTURE.md` — infrastructure blueprint (Staging / UAT / Prod)
- `RUNBOOK-foundation.md` — what is actually built & running today
- `bob-dms.html` — the approved UI prototype (13 modules, 15 connectors, 10 AI features)

---

## 1. The three layers we already have (read this first)

We are **not** starting from zero, and we must not duplicate any of it. There are three layers in hand:

| Layer | Artifact | What it gives us | Status |
|---|---|---|---|
| **Foundation (code, running)** | `RUNBOOK-foundation.md` | Monorepo: API gateway (`:4000`), web app (`:5174`), DB package (Postgres **+** Oracle 19c, migrate/seed), auth/login, test harness | **Built** |
| **Infrastructure (blueprint)** | `DEPLOYMENT-ARCHITECTURE.md` | 3 environments (Compose/k3s), GPU + vLLM models, data tier (PG/ES/Kafka/MinIO), mgmt stack | **Designed, not deployed** |
| **Experience (prototype)** | `bob-dms.html` | The exact UI/UX the client approved — screens, flows, fields, terminology | **Mockup (front-end only, fake data)** |

> **The job is to connect these three layers**: build real backend services + DB behind the prototype's screens, deployed on the architecture's infrastructure, reusing the foundation's gateway/DB/auth.

---

## 2. Anti-duplication guardrails — what NOT to re-build

These already exist in the foundation. **Extend them, do not recreate them.**

1. **API Gateway** — Node/Express gateway already runs on `:4000`. Add routes/services behind it; don't write a new gateway.
2. **Database access layer** — the DB package already abstracts **Postgres and Oracle 19c** with migrations + seed and *no code change to switch*. All new tables go through this same package's migrations. Do **not** introduce a second ORM/DB client.
3. **Auth / login** — base auth exists (`admin/admin123`). Extend it into full RBAC + SSO/MFA; don't build a parallel auth system.
4. **Web app shell** — a web app already serves on `:5174`. Decide (see §3) whether the prototype becomes that app or replaces it — but only **one** front-end ships.
5. **Test harness** — unit/integration tests already run against in-memory SQLite. New services plug into this; don't stand up a separate test framework.

Everything below is **net-new** work unless it explicitly says "extend existing."

---

## 3. Technology stack (final — with the decisions we must lock)

The prototype, the proposal, and the foundation currently disagree on the front-end. This must be decided before build.

| Layer | Proposal says | Foundation has | Prototype is | **Recommended decision** |
|---|---|---|---|---|
| **Frontend** | React + TypeScript | Web app in **EJS** (server-rendered) | Vanilla JS + HTML | **Rebuild prototype as React + TS** (honours contract; prototype is the design source-of-truth). Retire EJS shell or keep only for admin. |
| **Backend (DMS core)** | Node + Express | Gateway in Node/Express ✅ | n/a (no backend) | **Keep Node/Express**, extend foundation gateway. |
| **AI services** | Python FastAPI | — | Tesseract.js (client-side, demo only) | **Python FastAPI** services calling **vLLM**; drop client-side Tesseract. |
| **AI models** | Tesseract/Vision/custom | — | Tesseract.js | **vLLM**: granite-vision (classify), qwen-vl (extract/OCR), qwen3-text (chat/summarize) per architecture. |
| **Messaging** | Kafka / RabbitMQ | — | — | **Kafka** (single standard). |
| **Database** | PostgreSQL / Oracle | **Postgres + Oracle 19c** ✅ | in-memory arrays | **Keep** foundation DB layer. |
| **Search** | Elasticsearch | — | — | **Elasticsearch/OpenSearch** (per architecture). |
| **Object storage** | MinIO / S3 | — | `URL.createObjectURL` (browser only) | **MinIO** (S3 API), sized 3/10/50 TB per env. |
| **Containers** | ECS/ECR/Docker (AWS wording) | — | — | **On-prem**: Docker Compose (Staging) / **k3s** (UAT+Prod) + Harbor registry. *Update proposal's AWS wording.* |

**Locked stack:** React+TS · Node/Express · Python FastAPI + vLLM · Kafka · PostgreSQL/Oracle · Elasticsearch · MinIO · Keycloak (SSO) · Vault (secrets) · Docker/k3s · Prometheus/Grafana.

---

## 4. Prototype module walkthrough — screen → API → DB → AI

The prototype has **13 modules + a chat assistant**. Every screen below is currently driven by hardcoded JS arrays. Here is what each needs to become real.

### 4.1 Dashboard
- **Prototype:** KPI cards, processing funnel (Chart.js), branch health table (`branches[]`).
- **Backend API:** `GET /api/dashboard/kpis`, `GET /api/dashboard/funnel`, `GET /api/branches/health`.
- **Database:** aggregates over `documents`, `cases`, `branches`, `processing_events`.
- **Notes:** funnel = counts by pipeline stage; branch SLA from `cases.sla_due` vs now.

### 4.2 Documents
- **Prototype:** document table (`docs[]`), filters (type/branch/status), upload drop-zone, **OCR scan via Tesseract.js (client-side — demo only)**, export CSV.
- **Backend API:** `GET /api/documents` (filter/paginate), `POST /api/documents` (upload → MinIO), `GET /api/documents/:id`, `GET /api/documents/export`.
- **Database:** `documents`, `document_metadata`, `document_versions`, `ocr_results`.
- **AI:** replace Tesseract.js with **server-side OCR** (qwen-vl/granite-vision via FastAPI). Upload → MinIO → Kafka event → AI pipeline → metadata back.
- **Storage:** binary to **MinIO**, never the browser.

### 4.3 Repository
- **Prototype:** folder tree by department (`repoDocs[]`), approve/reject in repo.
- **Backend API:** `GET /api/repository/tree`, `POST /api/documents/:id/approve|reject`.
- **Database:** `documents.dept_id`, `folders` (virtual via dept/type), `approvals`.

### 4.4 Cases (Workflow board)
- **Prototype:** Kanban (New → Document Review → Approval → Resolved), case types, priority, SLA KPIs, create case from doc (`cases[]`, `caseTypes[]`).
- **Backend API:** `GET/POST /api/cases`, `PATCH /api/cases/:id/advance`, `GET /api/cases/types`.
- **Database:** `cases`, `case_types`, `case_history`, `sla_policies`.
- **Engine:** ties into Workflow engine (§4.6).

### 4.5 Flow (Process visualisation)
- **Prototype:** static diagram LOS → Capture → OCR → Classify → Extract → Validate → CBS post.
- **Backend:** rendered from `workflows[]` definitions — read-only view of the workflow engine config.

### 4.6 Validation
- **Prototype:** validation rules screen, add rule (`initValidation`, `openAddValRule`).
- **Backend API:** `GET/POST /api/validation/rules`, validation runs on extract.
- **Database:** `validation_rules`, `validation_results`.
- **AI:** rule-based + ML cross-field checks; validate extracted fields against **CBS/KYC** (see §6).

### 4.7 AI (capability console)
- **Prototype:** grid of **10 AI features** with accuracy %, enable toggles, throughput (`aiFeatures[]`), tune thresholds.
- **Backend API:** `GET /api/ai/features`, `PATCH /api/ai/features/:id` (enable/threshold).
- **Database:** `ai_models`, `ai_feature_config`, `ai_metrics`.
- **AI services:** each feature → a FastAPI endpoint (see §5).

### 4.8 AI Queue
- **Prototype:** live processing queue with per-step status (`queue[]`).
- **Backend API:** `GET /api/ai/queue` (poll or WebSocket), driven by **Kafka** pipeline state.
- **Database:** `processing_jobs`, `processing_steps`.

### 4.9 Integration
- **Prototype:** 15 connector cards, each "Connected · NN ms" (**all fake**), configurable (`integrations[]`).
- **Backend API:** `GET /api/integrations` (real health checks), `PATCH /api/integrations/:id/config`.
- **Database:** `integration_connectors`, `integration_logs`, `integration_credentials` (secrets in **Vault**).
- **See §6** for the full per-connector integration map.

### 4.10 Reports
- **Prototype:** report builder (group-by + measures), report library, CSV export, charts (`libReports[]`, `REC[]`).
- **Backend API:** `POST /api/reports/run`, `GET /api/reports/library`, `GET /api/reports/:id/export`.
- **Database:** query layer over `documents`/`cases`/`processing_events`; saved `report_definitions`.

### 4.11 Master Data
- **Prototype:** tabs for **branches, departments, doctypes, roles, users, workflows** (`branches[]`, `depts[]`, `doctypes[]`, `roles[]`, `users[]`, `workflows[]`), add/edit each.
- **Backend API:** CRUD `GET/POST/PUT /api/master/{branches|departments|doctypes|roles|users|workflows}`.
- **Database:** `branches`, `departments`, `document_types`, `roles`, `users`, `workflows`, `workflow_steps`.

### 4.12 Admin
- **Prototype:** tabs — general, **security**, **audit log**, library, **workflow builder**, doctypes, **AD import**, upload settings.
- **Backend API:** `GET /api/audit`, `GET/PUT /api/admin/security`, `POST /api/admin/import-ad`, workflow builder CRUD.
- **Database:** `audit_log` (tamper-evident), `security_settings`, `workflows`.
- **Auth:** AD import → **SSO via Keycloak / LDAP**; extend foundation auth.

### 4.13 Config
- **Prototype:** AI thresholds (e.g. classification 0.90→0.92), max file size, allowed formats.
- **Backend API:** `GET/PUT /api/config`.
- **Database:** `system_config` (key/value, audited).

### 4.14 Chat Assistant (FAB)
- **Prototype:** rule-based bot matching keywords (`chatAnswer`, `chatSuggestions`) — **no real intelligence**.
- **Backend API:** `POST /api/chat` → **qwen3-text LLM + RAG** over Elasticsearch + document embeddings.
- **Database / store:** `chat_sessions`, vector index (embeddings) in ES / vector store.
- **Security:** role-based response filtering (user only sees what RBAC allows).

---

## 5. AI services — prototype features → real services

The prototype lists **10 AI features**. All must run **server-side** (Python FastAPI → vLLM on the GPU node). The browser Tesseract.js is demo-only and gets removed.

| # | Prototype feature | Real service / model | API endpoint | Status |
|---|---|---|---|---|
| 1 | OCR & ICR (Dzongkha + English) | qwen-vl / granite-vision (vLLM) | `POST /api/ai/ocr` | **Pending** — Dzongkha support is the #1 risk; validate early |
| 2 | Auto-Classification (34 classes) | granite-vision (vLLM) | `POST /api/ai/classify` | Pending — needs labelled BOBL data |
| 3 | Smart Data Extraction (120+ fields) | qwen-vl `guided_json` | `POST /api/ai/extract` | Pending |
| 4 | Semantic Smart Search | embeddings + Elasticsearch | `GET /api/search` | Pending |
| 5 | Anomaly & Fraud Detection (AML/FATF) | forensics + ML anomaly models | `POST /api/ai/fraud-check` | Pending |
| 6 | Document Summarization | qwen3-text | `POST /api/ai/summarize` | Pending |
| 7 | Compliance Validation (RMA) | rules + qwen3-text | `POST /api/ai/validate-compliance` | Pending |
| 8 | Auto-Translation (Dzongkha ⇄ English) | qwen-vl / qwen3-text | `POST /api/ai/translate` | Pending (marked optional in prototype) |
| 9 | AI Chat Assistant (LLM + RAG) | qwen3-text + vector search | `POST /api/chat` | Pending |
| 10 | Predictive Analytics (loan risk, segmentation) | ML pipeline | `POST /api/ai/predict` | Pending (marked optional) |

**Pipeline:** Upload → MinIO → Kafka topic `doc.ingested` → OCR → Classify → Extract → Validate → Fraud-check → metadata persisted → `doc.processed` event → CBS post. Each stage is a FastAPI consumer; the **AI Queue** screen reflects this pipeline's live state.

---

## 6. Integration map — all 15 connectors (prototype shows them "Connected"; none are real)

Direction: **IN** = we fetch documents/data; **OUT** = we post/share; **BOTH** = bidirectional.

| Connector | Dir | Protocol | What flows | Proposal ref | Status |
|---|---|---|---|---|---|
| **LOS** — Loan Origination | IN | REST | Loan docs → AI pipeline; checklist + income-proof validation | §5.6 | **Pending** |
| **mBoB** — Mobile Banking | IN | REST | KYC uploads, camera captures, real-time verify | §5.2 | Pending |
| **GoBoB Wallet** | IN | REST | e-KYC source, digital identity | §5.3 | Pending |
| **Internet Banking** | IN | REST | Statement/service-request docs | §5.4 | Pending |
| **e-KYC / National CID** | BOTH | REST | Identity validation, CID match | §5.5 | Pending |
| **CBS — TCS BaNCS** | OUT | REST / ISO 20022 | **Post validated metadata**, CIF linking, real-time doc access | §5.1 | **Pending — confirm BaNCS vs "GBP" in arch doc** |
| **CRM** — 360° view | OUT | REST | Customer document view | §5.7 | Pending |
| **ERP** — HR & Finance | BOTH | REST | HR/finance documents | §5.8 | Pending |
| **Contact Center** | OUT | REST | Instant doc access for agents | §5.9 | Pending |
| **AD / SSO** | IN | LDAP / SAML | User identity, login, AD import | §4.2/§7 | Pending — Keycloak broker |
| **SMS Gateway** | OUT | HTTP | Notifications / OTP | §3.3 (notify) | Pending |
| **e-Signature** | BOTH | REST | Digital signing of approvals | (implied) | Pending — confirm scope |
| **RMA Reporting** | OUT | SFTP | Regulatory reports (scheduled) | §2.3/§7 | Pending |
| **Archive — MinIO/S3** | BOTH | S3 API | Document object storage | Arch | Designed (deploy MinIO) |
| **Krystal — Legacy DMS** | IN | Bulk ETL | One-time data migration (prototype: 64%) | (migration) | **Pending — confirm legacy migration scope** |

> **All connectivity flows through the foundation API Gateway** (OAuth2/JWT) with **Kafka** event streaming. Credentials live in **Vault**, never in code/DB. Each connector needs: endpoint config, auth, retry/circuit-breaker, health check, and an `integration_logs` audit trail.

---

## 7. Database design — core schema (new tables via foundation DB layer)

All tables created through the **existing** migration package (Postgres + Oracle compatible). Grouped by domain:

**Documents & content**
- `documents` (id, name, type_id, branch_id, dept_id, status, confidence, object_key, created_by, created_at)
- `document_metadata` (doc_id, field_key, field_value, source: ocr|extract|manual, confidence)
- `document_versions` (doc_id, version_no, object_key, changed_by, changed_at, note)
- `ocr_results` (doc_id, lang, raw_text, confidence, model, processed_at)

**Processing & AI**
- `processing_jobs` (id, doc_id, status, current_step) · `processing_steps` (job_id, step, status, confidence, ts)
- `ai_models` · `ai_feature_config` (feature, enabled, threshold) · `ai_metrics` (feature, accuracy, throughput, period)

**Cases & workflow**
- `cases` (id, title, type, priority, stage, customer, branch, sla_due, assignee)
- `case_types` · `case_history` (case_id, action, by, ts)
- `workflows` · `workflow_steps` (wf_id, seq, type, approver_role) · `sla_policies`

**Master data**
- `branches` · `departments` · `document_types` (name, category, retention, approval_flow)
- `users` (extend foundation) · `roles` (perm, scope) · `role_permissions`

**Validation & compliance**
- `validation_rules` (doc_type, field, rule, severity) · `validation_results`
- `retention_policies` (doc_type, period, action) — drives auto-archival

**Integration & security**
- `integration_connectors` (code, name, protocol, config) · `integration_logs` (connector, direction, payload_ref, status, latency, ts)
- `audit_log` (ts, actor, action, entity, detail, hash_prev) — **tamper-evident chained hash**
- `system_config` (key, value, updated_by) · `security_settings`

**Search/RAG**
- Document text + embeddings indexed in **Elasticsearch** (not RDBMS); `chat_sessions` for assistant history.

---

## 8. Full functionality checklist — nothing left pending

Every capability from proposal + prototype, with where it lives. Use this as the "done = nothing pending" tracker.

**Core DMS**
- [ ] Centralized repository (structured + unstructured) — MinIO + `documents`
- [ ] Document upload (web + mobile/MBoB) → server-side pipeline
- [ ] **Version control** (history, rollback, compare) — `document_versions`
- [ ] RBAC (extend foundation auth) · **ABAC** (attribute policies)
- [ ] **Audit trail** — tamper-evident `audit_log` (prototype Admin→Audit screen)
- [ ] Retention & auto-archival — `retention_policies`

**AI / IDP** (all server-side, §5)
- [ ] OCR Dzongkha + English · [ ] Classification · [ ] Extraction · [ ] Semantic search
- [ ] Fraud/anomaly (AML) · [ ] Summarization · [ ] Compliance validation
- [ ] Translation (optional) · [ ] Chat assistant (LLM+RAG) · [ ] Predictive analytics (optional)

**Workflow**
- [ ] Workflow engine + builder (Admin) · [ ] Routing to departments
- [ ] Approval hierarchy branch→regional→HQ · [ ] SLA escalation + notifications (SMS/email)
- [ ] Cases Kanban board

**Integrations (15)** — §6: LOS, mBoB, GoBoB, Internet Banking, e-KYC/CID, CBS/BaNCS, CRM, ERP, Contact Center, AD/SSO, SMS, e-Sign, RMA, MinIO, Krystal migration

**Security & compliance**
- [ ] SSO (Keycloak/LDAP/AD) · [ ] **MFA** · [ ] AES-256 at rest · [ ] TLS 1.3 in transit
- [ ] WAF · [ ] SIEM + alerts · [ ] ISO 27001 mapping · [ ] RMA compliance + reporting

**Platform / infra** (§ deployment architecture)
- [ ] Microservices split · [ ] React+TS frontend · [ ] FastAPI AI services · [ ] GPU + vLLM
- [ ] Elasticsearch · [ ] Kafka · [ ] MinIO · [ ] Staging/UAT/Prod (Compose/k3s)
- [ ] HA (PG/ES/Kafka) · [ ] DR site + agreed RTO/RPO · [ ] Harbor/Vault/GitLab/Prom-Grafana

**Delivery**
- [ ] System testing · [ ] Bank UAT sign-off · [ ] Training + user docs · [ ] Go-live · [ ] SLA support (4h critical / 4working-day non-critical) + AMC

---

## 9. Gaps & mismatches to resolve with the client (decide before build)

1. **Frontend:** Proposal = React+TS, foundation = EJS, prototype = vanilla JS. **Recommend rebuilding prototype in React+TS.**
2. **CBS naming:** Prototype + proposal say **TCS BaNCS**; architecture doc says **"GBP"**. Confirm the real core-banking system.
3. **Dzongkha OCR:** Promised in proposal & prototype; no Dzongkha-specific model named. **Highest technical risk — prove feasibility early.**
4. **OCR engine:** Prototype uses Tesseract.js (client); architecture uses vLLM (server). Confirm server-side vLLM is acceptable.
5. **AWS vs on-prem:** Proposal tech table says ECS/ECR (AWS); deployment is **on-prem air-gapped**. Fix proposal wording.
6. **Extra/▲ scope:** Architecture adds **RTGS/SWIFT**; prototype adds **e-Signature, SMS, RMA SFTP, Krystal legacy migration**. Confirm each is in contracted scope.
7. **DR RTO/RPO:** Marked "pending" in architecture — agree concrete targets with the bank.
8. **Ownership (RACI):** Bank owns Load Balancer, SSO/IdP, Backup per architecture — confirm split.

---

## 10. Recommended build sequence (mapped to the 6-month plan)

1. **Now (M1–M2):** Lock §9 decisions. Stand up mgmt stack (Harbor, Vault, GitLab CI/CD, Prometheus/Grafana). Finalize DB schema (§7) as migrations on the existing DB layer.
2. **M2–M3 — Platform & DMS core:** React+TS frontend from prototype; split foundation into microservices; MinIO + upload pipeline; version control; RBAC/ABAC; tamper-evident audit log; deploy Elasticsearch + Kafka.
3. **M3 — AI engine:** GPU + vLLM; FastAPI services (OCR/classify/extract/validate); Dzongkha proof; AI Queue wired to Kafka.
4. **M3 — Workflow:** engine + builder, routing, branch→regional→HQ approvals, SLA + notifications, Cases board.
5. **M4 — Integrations & security:** CBS/BaNCS, LOS, mBoB, KYC first; then GoBoB/IB/CRM/ERP/Contact Center; SSO + MFA; fraud detection; chat assistant (RAG).
6. **M5 — Environments, HA, DR, hardening:** Staging/UAT/Prod; PG/ES/Kafka HA; DR + RTO/RPO; AES-256, TLS 1.3, WAF, SIEM; Krystal migration; predictive analytics (if in scope).
7. **M5–M6 — Testing → Go-live:** system test, bank UAT sign-off, training + docs, production deploy, SLA + AMC.

---

### One-line summary
The prototype is the **finished picture of the UI**; the foundation gives us the **gateway, DB layer and auth to reuse**; everything between them — **real backend APIs, the database, server-side AI (vLLM), and all 15 integrations** — is still to be built. Lock the §9 decisions first, then build in the §10 order, and reuse (never rebuild) the foundation per §2.
