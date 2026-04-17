# DocManager — Architecture

> How the system is organised, how requests flow, and where the boundaries are.
> Companion docs: [TECHNICAL.md](./TECHNICAL.md) · [PROJECT.md](./PROJECT.md).

Last updated: 2026-04-17

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
 │   redaction · retention · dsar · cbe · stepup · customer_risk · fraud ·      │
 │   vector · copilot · ledger · zkkyc · **docbrain** · … (see app/routers/)    │
 │                                                                              │
 │   services: storage (SHA-256 CAS) · tasks (queue) · metrics · tracing ·      │
 │             kafka_bus · opa (ABAC) · signing (PAdES) · etl · provenance      │
 │             **docbrain (llm · ocr · classify · extract · embed · rag)**      │
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

**Contract stability:** every swap above is a config + single-file change. The SPA, the `/spa/api/docbrain/*` surface, and the `docbrain/{llm,classify,extract,embed,vectors,rag}.py` module signatures are the stable contract; what backs them rotates with deployment tier.

**Why this matters architecturally:** bank procurement wants to hear "your AI layer runs locally on our own hardware, with open-weight models, no phone-home." The pilot is literal proof of that — one laptop, no cloud, no API keys to Anthropic/OpenAI. The same code path scales to a silo or dedicated datacenter by swapping serving engine + vector store.

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
