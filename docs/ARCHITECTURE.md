# DocManager — Architecture

> Last updated: **2026-05-10** (post-Wave-B). For shipped state see [CHANGELOG.md](../CHANGELOG.md); for the cross-cutting platform layer see §10h–§10l below.

> How the system is organised, how requests flow, and where the boundaries are.
> Companion docs: [TECHNICAL.md](./TECHNICAL.md) · [PROJECT.md](./PROJECT.md).

Last updated: 2026-05-09 · Sections §10c–§10g added (5 shipped Q2 features)

---

## 1. Component diagram

```
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │                                 Browser                                      │
 │  ┌────────────────────────────────────────────────────────────────────────┐  │
 │  │ DocManager SPA (React 18 · TS · Vite · Tailwind)                       │  │
 │  │   – Sidebar / Topbar / AppLayout (apex design system)                  │  │
 │  │   – Modules: auth · dashboard · capture · repository · viewer · search │  │
 │  │             · alerts · _placeholder (9 routes awaiting M2/M3)          │  │
 │  │   – store: zustand (auth) · react-query (server state) · zod (schemas) │  │
 │  └────────────────────────────────────────────────────────────────────────┘  │
 │                                     │ same-origin cookie                     │
 └─────────────────────────────────────┼────────────────────────────────────────┘
                                       │
            dev: Vite :5174 proxy ▶───┤ prod: Node serves dist/
                                       ▼
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │                      Node Express :3000 (Node 20)                            │
 │                                                                              │
 │  ┌──────────────┐    ┌────────────────────────┐    ┌──────────────────────┐  │
 │  │ middleware   │    │ routers (mounted)      │    │ services (shared)    │  │
 │  │              │    │                        │    │                      │  │
 │  │ security     │    │ /spa/api  ◀── SPA      │    │ rbac                 │  │
 │  │ headers      │    │ /api/v1   ◀── machine  │    │ ocr                  │  │
 │  │ sessions     │    │ /py       ◀── proxy    │    │ ws (alerts)          │  │
 │  │ body parsers │    │ /login (EJS)           │    │ saml, expiry-job,    │  │
 │  │ static /css  │    │ /documents (EJS)       │    │ retention            │  │
 │  │ static /up   │    │ /workflows (EJS)       │    │                      │  │
 │  │              │    │ /alerts, /search, …    │    │                      │  │
 │  └──────────────┘    └────────────────────────┘    └──────────────────────┘  │
 │           │                                                                  │
 │           ▼                                                                  │
 │  ┌───────────────────────────┐                                               │
 │  │ db/nbe-dms.db             │    SQLite + WAL                               │
 │  │   users, documents,       │    FTS5 on documents_fts                      │
 │  │   folders, workflows,     │                                               │
 │  │   alerts, audit_log,      │                                               │
 │  │   retention_policies      │                                               │
 │  └───────────────────────────┘                                               │
 └──────────────────────────────────────────────────────────────────────────────┘
                                       │ /py/* (session-guarded proxy)
                                       │ /spa/api/docbrain/* (also session-guarded,
                                       │                      server-side X-API-Key)
                                       ▼
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │                       FastAPI :8001 (Python 3.14)                            │
 │                                                                              │
 │   60+ routers: documents · ocr · workflow · search · duplicates · face ·     │
 │   redaction · **aml** · **retention** · dsar · cbe · stepup · customer_risk · fraud ·      │
 │   vector · copilot · ledger · zkkyc · **docbrain** · … (see app/routers/)    │
 │                                                                              │
 │   services: storage (SHA-256 CAS) · tasks (queue) · metrics · tracing ·      │
 │             kafka_bus · opa (ABAC) · signing (PAdES) · etl · provenance      │
 │             **docbrain (llm · ocr · classify · extract · embed · rag)**      │
 │             **aml** · **retention_scheduler**                               │
 │                                                                              │
 │   ┌──────────────────────────────┐     ┌─────────────────────────────┐       │
 │   │ SQLAlchemy                   │     │ MinIO S3 bucket "docmanager" │       │
 │   │ (SQLite dev / Postgres prod) │     │ tenants/…/sha256/aa/bb/full  │       │
 │   └──────────────────────────────┘     └─────────────────────────────┘       │
 │   ┌──────────────────────────────┐     ┌─────────────────────────────┐       │
 │   │ storage/docbrain.sqlite      │     │ Ollama :11434                │       │
 │   │ analyses + vectors (BLOB)    │     │ llama3.2:3b · nomic-embed    │       │
 │   │ numpy cosine @ query time    │     │ (local, no phone-home)       │       │
 │   └──────────────────────────────┘     └─────────────────────────────┘       │
 └──────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Layers, by responsibility

| Layer | Owner of | Does NOT own |
|---|---|---|
| **SPA** | Presentation, client routing, form UX, RBAC nav hiding, local form validation | Authoritative RBAC, persistence, business rules |
| **Node spa-api** | Session auth, SPA JSON contract, SQL queries against Node SQLite, file uploads, FTS5 search | OCR, duplicate detection, workflow state machine, ABAC |
| **Node /py proxy** | Session gate + request forwarding | Any business logic |
| **Node legacy EJS** | Server-rendered mirror of the old UI (still live, no longer the default) | New features |
| **Python FastAPI** | Real document pipeline: OCR, classification, workflow engine, duplicate detection, integrations, retention jobs | UI, session cookies |

**Principle:** the SPA talks to Node. Node talks to Python. The browser never calls Python directly. This keeps the auth boundary single-purposed (express-session) and Python free to speak `X-API-Key` / JWT without knowing about browsers.

---

## 3. Data flow

### 3.1 Auth hydration (SPA boot)

```
Browser                 Node /spa/api/me                 SQLite
   │                          │                             │
   │── GET /spa/api/me ──────▶│                             │
   │   (cookie: connect.sid)  │── req.session.user?         │
   │                          │◀─ { id, username, role, … } │
   │                          │                             │
   │◀── { user: {...} } ──────│                             │
```

Store transitions: `status: 'unknown' → 'authenticated' | 'guest'`.

### 3.2 Login

```
LoginPage                Node /spa/api/login             SQLite          Session
   │                            │                          │                │
   │── POST {username,password}▶│                          │                │
   │                            │── SELECT users WHERE ─ ▶ │                │
   │                            │◀─ row (bcrypt hash)      │                │
   │                            │   bcrypt.compareSync     │                │
   │                            │── INSERT audit_log ─────▶│                │
   │                            │   req.session.user = {…} ──────────────────▶
   │◀── Set-Cookie + {user} ────│                                           │
```

If `user.status = 'Locked'` → 403. If MFA enabled → deliberately ignored in SPA (EJS-only for now).

### 3.3 Document upload

```
CapturePage (form)
  │
  │── client: MIME + 50MB check
  │── FormData { file, doc_type, customer_cid, expiry_date, … }
  ▼
POST /spa/api/documents (multer)
  │── require session
  │── require perm: 'capture'  (services/rbac.js)
  │── multer diskStorage → uploads/{timestamp}-{sanitised}
  │── INSERT INTO documents (… status='Valid', version='v1.0')
  │── fire-and-forget: runOcr(path) → UPDATE documents SET ocr_text, ocr_confidence
  ▼
{ ok: true, id }
```

### 3.4 Search (FTS5)

```
SearchPage                   Node /spa/api/search         SQLite FTS5
   │                               │                         │
   │── GET /spa/api/search?q=… ───▶│                         │
   │                               │   escape → "word1" "w2" │
   │                               │── SELECT d.* FROM       │
   │                               │      documents_fts f    │
   │                               │      JOIN documents d   │
   │                               │      ON d.id = f.rowid  │
   │                               │      WHERE f MATCH ? ─ ▶│
   │                               │◀─ rows                  │
   │◀── array<DocumentRow> ────────│                         │
```

FTS5 virtual table `documents_fts` is kept in sync by `AFTER INSERT/UPDATE/DELETE` triggers on `documents` (see `db/schema.sql`).

### 3.5 DocBrain analyze + RAG chat

```
ViewerPage / CapturePage         Node /spa/api/docbrain           Python /api/v1/docbrain
    │                                    │                                 │
    │  (cookie: connect.sid)             │                                 │
    │── POST /analyze {id:42} ──────────▶│                                 │
    │                                    │── require session ✓             │
    │                                    │── inject X-API-Key ──────▶      │
    │                                    │                            require_api_key ✓
    │                                    │                            OCR (tesseract)
    │                                    │                            classify (Llama JSON)
    │                                    │                            extract (Llama JSON)
    │                                    │                            embed (nomic-embed)
    │                                    │                            upsert vectors (BLOB)
    │                                    │                            write docbrain_analyses
    │                                    │◀─ { classification, extraction, chunks_indexed }
    │                                    │── persist doc_type + high-confidence fields to
    │                                    │   Node documents row (confidence ≥ 0.7)
    │◀── analysis JSON ──────────────────│
    │
    │── POST /chat {question, doc_id} ──▶│── require session ✓
    │                                    │── inject X-API-Key ──────▶ retrieve top-k (cosine)
    │                                    │                            build prompt with chunks
    │                                    │                            Llama generate answer
    │                                    │                            strip unsupported [^N]
    │                                    │                            has_evidence = top-k ≥ τ
    │                                    │◀─ { answer, citations, has_evidence }
    │◀── answer + citations ─────────────│
```

Security properties:
- SPA never sees `X-API-Key`. The Node spa-api router injects it server-side before proxying.
- Every DocBrain response is zod-validated by the SPA ([`modules/docbrain/api.ts`](../apps/web/src/modules/docbrain/api.ts)).
- When `has_evidence === false`, [RagChat.tsx](../apps/web/src/modules/docbrain/RagChat.tsx) renders the "No grounded evidence" banner — an unsupported answer is never shown as if it were confident.

### 3.6 Python proxy flow

```
 Browser  ──▶  Node /py/api/v1/foo
                 │
                 │── require session  (401 otherwise)
                 │── rewrite to http://127.0.0.1:8001/api/v1/foo
                 │── inject X-API-Key = $PYTHON_SERVICE_KEY
                 ▼
              Python FastAPI
                 │── require_api_key == settings.API_KEY ✓
                 ▼
              router logic
```

---

## 4. Routing

### 4.1 SPA routes

```
/login                         → LoginPage (split-screen carousel)

/                              → DashboardPage
/capture                       → CapturePage
/repository                    → RepositoryPage
/viewer                        → ViewerPage (no id — instructional)
/viewer/:id                    → ViewerPage (loads document)
/search                        → SearchPage
/alerts                        → AlertsPage

/indexing, /workflows, /ai,
/reports, /compliance,
/integration, /security,
/users, /admin                 → ComingSoonPage (M2 / M3)

*                              → redirect /
```

Auth gate: every route under `<RequireAuth><AppLayout/></RequireAuth>` except `/login`.

### 4.2 Node routes (relevant to DocManager)

| Mount | File | Auth |
|---|---|---|
| `/spa/api/*` | [routes/spa-api.js](../routes/spa-api.js) | Session (self-enforced per-route) |
| `/api/v1/*` | [routes/api.js](../routes/api.js) | Per-user `x-api-key` |
| `/py/*` | [routes/py-proxy.js](../routes/py-proxy.js) | Session (enforced in server.js) |
| `/uploads/*` | static | None (served files already indexed server-side) |
| `/login`, `/documents`, `/workflows`, `/alerts`, `/search`, `/admin`, `/reports`, `/mfa`, `/exports`, `/versions`, `/bulk`, `/workflow-templates`, `/annotations`, `/import`, `/audit`, `/bi` | EJS routers | Session (via global `requireAuth`) |
| `/graphql`, `/webhooks`, `/portal` | routers | Each handles its own auth |

---

## 5. Persistence

### Node SQLite (`db/nbe-dms.db`)

```
users ────────────────────── workflows
   │                              │
   │ uploaded_by                  │ doc_id
   ▼                              ▼
documents ◀── folder_id ── folders
   ▲
   │ FTS5 triggers
   ▼
documents_fts (virtual, FTS5)

alerts         — independent
audit_log      — user_id → users.id (no FK enforced)
notifications  — user_id → users.id
document_versions
annotations
workflow_templates
retention_policies
signatures ──▶ documents.id
```

WAL journal mode; DB file is gitignored and recreated by `node db/seed.js`.

### Python SQLAlchemy (`storage/dms.db` or Postgres)

Independent schema in `python-service/app/models.py`. Documents stored SHA-256 content-addressed under `storage/documents/`. Alembic migrations in `python-service/migrations/`.

**The two databases don't share state today.** They represent two worldviews of the same domain. A future milestone may unify them (likely by making the Node DB a cache / projection).

---

## 6. RBAC & branch scoping

Three independent mirrors — all must stay in sync:

| Layer | File | Roles | Permissions |
|---|---|---|---|
| Node | [services/rbac.js](../services/rbac.js) | `Doc Admin`, `Maker`, `Checker`, `Viewer` | `capture`, `index`, `approve`, `reject`, `admin`, `security`, `delete`, `upload`, `view`, `workflow` |
| Python | [python-service/app/services/auth.py](../python-service/app/services/auth.py) | `doc_admin`, `maker`, `checker`, `viewer`, `auditor` | `capture`, `index`, `approve`, `sign`, `admin`, `audit_read`, `view` |
| OPA (ABAC) | [opa/policies/dms.rego](../opa/policies/dms.rego) | same as Python + tenant/branch/risk/after-hours context | same + critical-risk step-up + after-hours guard |

**Branch scoping** for Maker/Viewer: every `/spa/api/stats` and `/spa/api/documents` query appends `AND branch = ?` server-side. The SPA never performs the scoping itself.

**SPA-side role gating** (`nav.ts#canAccess`) is defence in depth; hiding a link never replaces a server check.

---

## 7. Styling system

Single source of truth: [tailwind.config.ts](../apps/web/tailwind.config.ts) — tokens ported from `apex_core_cbs/UI_AGREEMENT.md §2`. See [TECHNICAL.md §5](./TECHNICAL.md#5-design-system) for the full table.

Enforcement:
- No raw hex in `.tsx` (except in `tokens.ts` itself and in the login carousel's inline styles for dynamic CSS variables).
- Component classes (`.btn-primary`, `.card`, `.module-label`, …) centralised in `styles/index.css`.
- Icons: `lucide-react` only, never a different icon set.
- Animations for the login carousel live in `styles/index.css` under `.auth-*` classes (perspective rotate + blur + drift + grid pan).

---

## 8. Deployment targets

| Env | Where |
|---|---|
| Local dev | `./start.sh` — Python :8001 + Node :3000 + Vite :5174 |
| Container (current) | [Dockerfile](../Dockerfile) runs Node + SQLite in a single image |
| Python container | [python-service/Dockerfile](../python-service/Dockerfile) + `docker-compose.yml` |
| K8s (planned) | [python-service/helm/nbe-dms](../python-service/helm/nbe-dms) + [python-service/terraform/](../python-service/terraform/) |

For the SPA: `vite build` produces `apps/web/dist/` (~224 KB gzipped). Production serving plan: add `app.use(express.static('apps/web/dist'))` to [server.js](../server.js) and a catch-all to serve `index.html` for SPA routes. Not yet wired — the dev server is the current delivery path.

---

## 9. Operational concerns

- **Logs:** `.run/{node,python,web}.log` (gitignored).
- **Health checks:** Node `/login` (200), Python `/health` (200), SPA `/` (200).
- **Background jobs:** `services/expiry-job.js` (daily 02:00), `services/retention.js` (daily 02:30). Both start inside `server.js`.
- **Observability (Python):** Prometheus middleware on `/metrics`, OpenTelemetry tracing initialisable via `services/tracing.py`.
- **Restart script:** `./restart.sh` stops all three, then starts them.

---

## 10. DocBrain layer (what ships in the pilot)

The target AI architecture is in [AI_STRATEGY.md](./AI_STRATEGY.md) — vLLM, Qdrant, BGE-M3, LangSmith. That is the destination. This section is what **actually runs** today, and the intended migration path:

| Concern | Pilot (today) | Target |
|---|---|---|
| Chat model | Ollama + `llama3.2:3b` | vLLM + Llama 3.1 8B/70B + Qwen-2 (Arabic) |
| Embeddings | Ollama + `nomic-embed-text` (768-dim) | ONNX BGE-M3 (1024-dim, multilingual) |
| Vector store | `docbrain_vectors` (SQLite BLOB) + numpy cosine | pgvector (pooled) / Qdrant (silo+) |
| OCR | Tesseract + pdf2image | Tesseract (default) + LayoutLM v3 + opt-in Textract/Azure FR |
| Object storage | MinIO `docmanager` bucket, S3 API | AWS S3 / Azure Blob / on-prem object store (same client code) |
| Observability | `.run/*.log` + structured request logs | LangSmith traces + Prometheus + Arize |
| Guardrails | `has_evidence` flag + `_strip_unsupported_citations` + display gate | + Presidio PII pre/post + prompt-injection classifier + toxicity filter |

**OCR confidence thresholds:** Document Type admins can now tune per-doctype OCR confidence thresholds (autofill_floor and high_confidence) via a dual-range slider in the Document Types admin tab, with live sample preview. See [docs/contracts/ocr-confidence-tuning.md](./contracts/ocr-confidence-tuning.md) §6 for UI spec.

**Contract stability:** every swap above is a config + single-file change. The SPA, the `/spa/api/docbrain/*` surface, and the `docbrain/{llm,classify,extract,embed,vectors,rag}.py` module signatures are the stable contract; what backs them rotates with deployment tier.

**Why this matters architecturally:** bank procurement wants to hear "your AI layer runs locally on our own hardware, with open-weight models, no phone-home." The pilot is literal proof of that — one laptop, no cloud, no API keys to Anthropic/OpenAI. The same code path scales to a silo or dedicated datacenter by swapping serving engine + vector store.

---

## 10a. Compliance layer — AML screening

**AML watchlist screening** ([contract](./contracts/aml-screening.md), [ADR 0001](./adr/0001-aml-screening-architecture.md)) runs synchronously on every customer create/update. The Python service's `aml` router (`python-service/app/routers/aml.py`) loads OFAC SDN, EU Consolidated, and UN watchlists at startup (refreshable via `POST /api/v1/aml/watchlists/refresh`). When a customer is created, an async task enqueues to match the customer name against all watchlist entries using Levenshtein distance (threshold 0.85, configurable). Hits create `aml_hits` rows and assign a workflow task to compliance officers for human review and decision (cleared/escalated/blocked). Every decision is audited with action names `AML_SCREENING_TRIGGERED`, `AML_SCREENING_COMPLETED`, `AML_HIT_DECIDED`, `AML_HIT_ESCALATED`. The Compliance card on the dashboard queries `/spa/api/aml/stats` to show pending review counts. This is local-first (no PII egress to third-party SaaS) with full explainability (Levenshtein score + original record visible to auditors).

## 10c. Immutability layer — WORM retention lock

**Filesystem-level Write-Once-Read-Many locks** ([contract](./contracts/worm-retention-lock.md)) protect documents under legal hold or retention policy from modification or deletion. When a document is committed to retention, the Python storage service (`python-service/app/services/storage.py`) sets OS immutable flags (`chflags uchg` on macOS/BSD, `chattr +i` on Linux). A nightly cron job verifies that locked files remain immutable and haven't been tampered (via SHA-256 hash comparison). Locked documents show a WormBadge in the Repository and Viewer (locked until date). Unlock requires a Doc Admin role + audit trail entry with reason. This is a local-only feature (on-prem filesystems only; S3 Object Lock handles the cloud case).

## 10d. Privacy layer — Document redaction

**PDF text destruction** ([contract](./contracts/document-redaction.md)) allows users to permanently erase PII regions from documents. The SPA Viewer page provides a rectangle-draw tool where users select sensitive regions; the backend uses pikepdf to physically remove text content from the PDF's content streams (not a visual overlay). Every redaction is recorded in a `redaction_log` table (audit trail), and the redacted PDF is saved as a new document version (original preserved). Post-redaction verification runs `pdftotext` to confirm text no longer exists in the marked regions. This closes the "annotation without destruction" gap and enables safe sharing of documents.

## 10e. KYC layer — Face match biometric verification

**Offline face biometric verification** ([contract](./contracts/face-match-kyc.md)) using dlib's face_recognition library enables branch officers to match ID photos against live selfies during onboarding. The mobile app (Expo) and web SPA support consent-gated capture; the Python service (`python-service/app/routers/face_match.py`) computes 128-dimensional face encodings (not raw images), caches them for 90 days, and returns Euclidean distance + confidence. Matches are idempotent (same ID photo → same encoding, ≤ 50ms latency). All operations are audited with action `BIOMETRIC_MATCH_PERFORMED`. DPIA compliance: encodings are sensitive PII but not reversible to faces; raw image retention is optional per consent.

## 10f. Offline layer — Sync queue for branch officers

**IndexedDB outbox + Service Worker background sync** ([contract](./contracts/offline-sync-queue.md)) lets branch officers capture documents while offline and automatically replay uploads when connectivity returns. When a document POST fails (offline), the SPA queues it to IndexedDB with an `Idempotency-Key` header. When connectivity restores, the Service Worker replays the exact request. The Node server deduplicates by idempotency key (24h TTL) — if the same key is replayed with different content, it rejects with 409 Conflict. This prevents accidental double-uploads and ensures no documents are lost.

## 10g. Localization layer — Dzongkha translation

**Offline Meta NLLB-200-distilled-600M translation** ([contract](./contracts/dzongkha-translation.md)) enables branch officers to translate documents between Dzongkha and English (or Arabic). The Python service loads the model once, caches it for the process lifetime, and caches translations by source SHA-256 for 7 days. Cold-load is ≤ 30s; cache hits ≤ 50ms. The SPA Viewer shows a "Translate" button that opens a side-by-side modal with original (left) and translation (right). Confidence scoring (0–1) is included; low confidence (<0.7) triggers a warning. This replaces Amazon Translate and enables air-gapped deployment.

## 10h. Configuration layer — tenant_config spine + admin Settings shell

**Foundation phase (commit `ebae97e`) replaced scattered ENV vars + per-table columns with a universal config primitive.** Every operational threshold, enum, label, branding string, locale, retention rule, AML weight, RBAC matrix, ABAC ruleset, and provider choice resolves through `tenant_config` — a `(tenant_id, namespace, key) → JSON` store with a hash-chained history table for audit (deterministic SHA-256 over canonical JSON; client-side `changed_at` for reproducible verification). Service layers in both languages: `db/tenant-config.js` (Node) + `python-service/app/services/tenant_config/service.py` (Python) expose matching `get / getNamespace / setConfig` APIs. JSON Schemas live at repo-root `schemas/tenant-config/<namespace>.json` and are read by both layers — single source of truth, no drift. Writes enforce reason ≥ 20 chars and `additionalProperties: false`. See [ADR-0008](./adr/0008-tenant-config-spine.md), [ADR-0010](./adr/0010-hash-chained-config-history.md), [PLATFORM_CONFIG.md](./PLATFORM_CONFIG.md) for the namespace catalog.

**Admin Settings shell (`/admin/settings/*`) auto-generates per-namespace forms from those schemas.** `SettingsLayout.tsx` left-rail nav groups 16 panels (Branding & Tenants / Operational / Access & Security / Platform); `ConfigPanel.tsx` walks the schema and renders typed inputs with combobox enums, range-validated numbers, regex-validated strings, and dotted-key nested objects up to depth 2. Concrete panels (Branding, Integrations, Tenants) coexist with Wave-A/B-published panels (Workflows, Viewer, Search, Capture, Dashboard, Indexing, Workflow Templates, AML, Customer-360, Retention, RBAC, Auth, ABAC, Notifications). Every save round-trips through `setConfig` so the hash chain captures it. RBAC is the single `requireNamespacePermJson(namespace)` middleware — a one-line change moves any namespace from "Doc Admin only" to per-namespace permissions when needed.

## 10i. Integration registry — provider abstraction over local-first defaults

**Foundation CC6 (`python-service/app/services/integrations/`) factored 13 capability boundaries into abstract base classes**: `OcrProvider`, `EmbeddingProvider`, `LlmProvider`, `TranslateProvider`, `FaceMatchProvider`, `SmsProvider`, `EmailProvider`, `StorageProvider`, `KmsProvider`, `WatchlistProvider`, `BiProvider`, `CdnProvider`, `CacheProvider`. Each ships a seeded local implementation (`OllamaOcr`, `OllamaLlm`, `OllamaTranslate`, `LocalFaceMatch`, `LocalSmtp`, `LocalFsStorage`, `LocalKms`, `OfacJsonWatchlist`, etc.) and an AWS stub class registered but seeded off (raises `NotImplementedError` with a hint pointing at the tenant_config flag). The resolver in `provider_registry.py` keys its instance cache by `(tenant_id, kind, provider_name)` — switching `tenant_config.integrations.ocr.provider = 'aws'` changes the cache key, the next call loads the new class, no restart. See [ADR-0009](./adr/0009-local-first-adapter-registry.md), [docs/aws/phase-2/README.md](./aws/phase-2/README.md).

## 10j. SPA platform layer — design-system primitives + cross-module event bus

**Foundation CC4 (`apps/web/src/components/ui/`) shipped 12 hand-rolled primitives + a backwards-compatible DataTable v1**: Modal (focus trap), Toast/useToast (hover-pause, max 5), Tabs (roving tabindex), Combobox (200ms debounce + abort), Drawer (right/left/bottom + swipe-dismiss), Tooltip, Popover, Stepper, Skeleton, EmptyState, AiConfidenceBadge (4-band color, popover with model + promptId + sourceSpan + Override/Confirm/Show buttons). Zero new npm deps; all of Wave A and Wave B build on top of this set.

**`apps/web/src/lib/events.ts` ships a typed pub/sub event bus** with three documented events: `viewer:scroll-to-span` (AiConfidenceBadge → ViewerPage navigation + highlight), `tenant:switched` (Topbar tenant chip → store reload), `config:updated` (admin Settings save → consumer hooks invalidate). This is the only sanctioned cross-module communication channel in the SPA — modules cannot import from each other directly.

**DataTable v1 powers six pages** (Repository, Workflows, Compliance, Reports, Admin, Security, Integrations, Users). Features: server-side pagination, column visibility toggle, density toggle, virtualization (auto >1k rows via IntersectionObserver), mobile card-mode default <md, keyboard nav, RTL alignment, and prop-driven empty/loading/error variants.

## 10k. Operational modules (Wave A)

**Wave A (commit `06d3967`) shipped 5 vertical-slice operational modules**, each with SPA + Node API + Alembic migration + admin Settings JSON Schema + Playwright spec. Every module reads its config from `tenant_config` — zero hardcoded business values:

- **Dashboard v2** (`/admin/settings/dashboard`, namespace `dashboard`) — VISION §6-aligned KPIs (KYC cycle time p50, % automated, AI confidence ≥70%, expiring 30d, audit failures YTD), each with delta + 60×16 hand-rolled SVG sparkline + status-vs-target chip. Single endpoint `GET /spa/api/dashboard/kpis` returns all tile + chart data. Recharts lazy-loaded.
- **Workflows v2** (namespace `workflows`) — filter chips with URL state, 5 tabs, sticky bulk-action bar, right action drawer with audit trail + Approve/Reject/Escalate + reason-code dropdown + ≥20-char comment + WebAuthn step-up gate via `tenant_config.workflows.{step_up_risk_band, step_up_amount_threshold}`. Server REJECTS with 403 when threshold met but assertion missing — does not silently skip. New `wf_actions` table (migration 0028) is the Node-side audit log; intentionally separate from Python's `workflow_steps` state journal (bifurcation flagged for Wave C reconciliation).
- **Viewer + AI v2** (namespace `viewer`) — replaced iframe with PDF.js (pdfjs-dist@4 lazy-loaded; 0 KB first-paint). Right-rail tabs (Extracted fields with clickable AiConfidenceBadge → `viewer:scroll-to-span` / Annotations CRUD / Versions / Audit). New `redactions` + `redaction_pages` tables (migration 0029) close the page-0-only data-leak class issue.
- **Search v2** (namespace `search`) — FTS5 `snippet()` + `bm25()` + `highlight()` exposed in UI; operator-token chips; facets sidebar (5 parallel COUNT(*) queries via Promise.all). Saved searches CRUD with private/team/tenant scope (migration 0030 fixed the legacy CHECK constraint via rename-recreate-copy-drop). Cmd-K command palette (`apps/web/src/components/CommandPalette.tsx`) — global portal indexing Documents · Customers · Actions · Recents · Saved searches.
- **Capture v2** (namespace `capture`) — 2,520-line god component decomposed into 514-line orchestrator + 9 components + 2 hooks (79% reduction). 7 demo-theatre CSS animations stripped. `AiPipelineProgress` polls real document status (no more elapsed-time advancement). Camera path via `<input capture="environment">`. Dedup precedence: `tenant_config.capture.dedup.*` → DEFAULTS (legacy `dedup_settings` table dropped in Wave B migration 0036).

## 10l. Admin & access modules (Wave B)

**Wave B (commit `9bbae4a`) shipped 7 vertical-slice admin & access modules**. Selected highlights:

- **Users v2** (namespaces `auth`, `rbac`, `_user_meta`, `notifications`) — strips admin-typed plaintext passwords entirely. Invite flow via emailed magic-link with 32-byte hex token (`services/invite-mailer.js` reads SMTP from `tenant_config.notifications`). 4-tab UsersPage: Users / MFA Policies / SAML / Sessions. SoD enforcement at PATCH rejects with 400 sod_violation if a forbidden role pair is created. Migration 0037 makes `users.password` nullable via rename-recreate-copy-drop.
- **DocTypes + Learn Wizard** (namespace `doctypes`) — 6-step wizard (Pick template → Drop samples → AI inference → Visual labeler → Test pass → Publish). The bbox labeler reuses Wave A's PdfCanvas — drag rectangles, name fields, save to `doctype_field_bbox`. Schema versioning UI: v1/v2/v3 history with rollback + diff + A/B test. `workflow_instances` pin to `doctype_versions.id` (migration 0031) so old instances finish on old rule. `services/expiry-job.js` rewritten to read per-doctype `notify_days` CSV — closes the hardcoded-90-days finding from UI/UX line #14.
- **Templates designer** (namespace `workflow_templates`) — pure-SVG BPMN canvas (drag stages, decision diamond, parallel split/join, DMN gateway, EDD case). Pure-JS DMN evaluator. Simulation runner (BFS through canvas + DMN). Per-template SLA + business calendar editor (BoB national holidays seeded; Asia/Thimphu hours). True versioning: `workflows.template_version_id` FK pins old instances.
- **Indexing station** (namespace `indexing`) — 3-pane (queue / PDF with bbox overlay / field form). Race-safe claim/lock with TTL via INSERT-OR-FAIL + transaction. Beacon-release on tab close + 60s server sweeper as safety net. Keyboard nav (J/K/Tab/Shift+Enter/Esc/?).
- **AML hit-decide v2 + Customer-360** (namespaces `aml`, `customer_360`) — HitDecideV2Modal with Compare/History/Adverse Media/Action tabs. Tokenized name diff. Score-breakdown bars. False-positive memory via `aml_hit_suppressions` (migration 0035). SAR draft PDF via `pdf-lib`. Customer-360 right-drawer with 6 tabs and PII reveal pattern (60s TTL countdown audited to `customer_pii_reveals`).
- **ABAC editor** (namespace `abac`) — visual rule builder with closed-enum field paths. JSON-to-Rego compiler (`scripts/abac-compile.js`) emits `opa/policies/dms.rego` atomically; HTTP-driven OPA push via `PUT /v1/policies/dms_authz`. Safety belt: compile failure → no file write, no OPA contact. See [ADR-0011](./adr/0011-abac-closed-enum-field-paths.md).
- **Retention + WORM admin** (namespace `retention`) — per-doctype rules table, legal-hold flag with audit, scheduler health tile, WORM extend-only admin (admin can extend, never shorten — see [ADR-0012](./adr/0012-worm-extend-only-immutability.md)). Migration 0036 migrated `dedup_settings` rows into `tenant_config.capture.dedup.*` and dropped the legacy table.

## 10b. Integration layer — CBS adapters

**CBS Integration Hub** ([contract](./contracts/temenos-cbs-adapter.md), [INTEGRATION_STRATEGY.md §4](./INTEGRATION_STRATEGY.md#4-adapter-architecture), [ADR 0002](./adr/0002-temenos-cbs-adapter.md)) ships a uniform adapter protocol (`Adapter` interface in `python-service/app/services/integrations/base.py`) enabling real-time customer master lookups, account verification, and document linkback to core banking systems. **Temenos T24 / TCS BaNCS** (`python-service/app/services/integrations/temenos_t24.py`) is production-ready as of 2026-05-09: OAuth2 token management, 5-minute customer cache with graceful degradation on T24 unavailability, 3-state circuit breaker (healthy → degraded → open), exponential backoff retries, and PII-masked audit logging. Every integration call is routed through the hub with rate limiting (10 req/s per tenant, configurable), idempotency key validation, and observability (Prometheus metrics + structured logs). Mock and real adapters are interchangeable; test suite runs against both with identical contract assertions. Node SPA proxy (`routes/spa-api/cbs.js`) mirrors Python endpoints (`/api/v1/cbs/*` → `/spa/api/cbs/*`) with session auth, RBAC gating (`cbs:read` / `cbs:write` permissions), and PII field stripping before browser delivery. Future adapters (FLEXCUBE, Finastra, Mambu) follow the same protocol; see [ROADMAP.md Q4 2026](./ROADMAP.md#4-q4-2026--docbrain-goes-deep) for the integration roadmap.

---

## 11. Extension points

Adding a new module (e.g. "Indexing"):

1. Create `src/modules/indexing/api.ts` with zod schemas + axios calls.
2. Create `src/modules/indexing/IndexingPage.tsx`.
3. Replace the placeholder in [App.tsx](../apps/web/src/App.tsx): `<Route path="/indexing" element={<IndexingPage />} />`.
4. Add server endpoints to [routes/spa-api.js](../routes/spa-api.js) (session-authenticated, RBAC-checked).
5. Add a Playwright spec under `apps/web/e2e/`.
6. Tick the `comingSoon: true` flag off in `components/layout/nav.ts`.

**No cross-module imports.** If you need shared behaviour, lift it into `lib/`, `components/ui/`, or `components/layout/`.
