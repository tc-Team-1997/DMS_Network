# DocManager — Technical Document

> Engineering reference for the DocManager SPA and its supporting services.
> Read this alongside [ARCHITECTURE.md](./ARCHITECTURE.md) and [PROJECT.md](./PROJECT.md).

Last updated: 2026-04-17

---

## 1. Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| SPA runtime | React | 18.3.1 | Component model |
| Language | TypeScript | 5.6.2 | Strict types, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| Build / dev server | Vite | 5.4.x | HMR + production bundling |
| Styling | Tailwind CSS | 3.4.x | Utility classes + design tokens |
| Router | react-router-dom | 6.27.x | `BrowserRouter` (not data router) + `useLocation` |
| Server state | @tanstack/react-query | 5.56.x | Caching, retries, invalidation |
| Global state | zustand | 4.5.x | Auth session store (non-persisted) |
| Forms | react-hook-form + zod | 7.53 + 3.23 | Type-safe form validation |
| HTTP | axios + zod | 1.7 + 3.23 | Runtime-validated responses |
| Icons | lucide-react | 0.451.x | Consistent 16–18px line icons |
| Charts | recharts | 2.13.x | KPI visualisations |
| Web API gateway | Express (Node 20) | 4.19.x | Session auth + SPA JSON + proxy |
| Persistence A | better-sqlite3 | 11.x | Node-side document metadata + FTS5 |
| Persistence B | SQLAlchemy + SQLite | 2.x | Python service metadata |
| Python service | FastAPI | 0.136.x | OCR, workflow engine, duplicate detection, 60+ routers |
| OCR | Tesseract + Poppler | system | Via pytesseract / pdf2image |
| Object storage | MinIO (S3-compatible) | `RELEASE.2024-*` | Content-addressed blob store (`tenants/…/sha256/aa/bb/full`); filesystem fallback when the daemon is down |
| Local LLM runtime | Ollama | 0.5.x | Serves `llama3.2:3b` (chat, JSON-mode) and `nomic-embed-text` (768-dim embeddings) |
| Vector search | sqlite3 BLOB + numpy | — | Float32 cosine similarity over rows; **not** pgvector / sqlite-vec in dev (Homebrew Python 3.14 ships without `enable_load_extension`) |
| E2E | Playwright | 1.59.x | 22 specs (18 M1 + 4 DocBrain), chromium project, green |

---

## 2. Runtime topology

```
Browser  ──▶  Vite dev (:5174, prod: static dist via Node)
              │
              │  proxy /spa/api, /api/v1, /py, /uploads
              ▼
         Node Express (:3000)
              │
              ├─▶  express-session + SQLite (nbe-dms.db)   ◀─ SPA auth lives here
              ├─▶  routes/spa-api.js                        ◀─ SPA JSON endpoints
              │       └─▶  /spa/api/docbrain/*             ─▶ Python :8001 (server-side X-API-Key)
              ├─▶  routes/api.js        (x-api-key)         ◀─ machine API
              ├─▶  routes/*.js          (EJS views)         ◀─ legacy UI
              └─▶  routes/py-proxy.js   (session-guarded)   ◀─ generic forward to Python
                         │
                         ▼
                    FastAPI (:8001)
                         ├─▶ SQLAlchemy (SQLite → Postgres via env)
                         ├─▶ storage/docbrain.sqlite (analyses + vector BLOBs)
                         ├─▶ Ollama (:11434)  — llama3.2:3b · nomic-embed-text
                         └─▶ MinIO   (:9100)  — S3-compatible CAS bucket "docmanager"
```

Boot/teardown: `./start.sh` · `./stop.sh` · `./restart.sh`. Flags: `WEB=0` (skip Vite), `AI=0` (skip Ollama). The script is idempotent — it probes each port and only boots what's not already up.

See [ARCHITECTURE.md §3](./ARCHITECTURE.md#3-data-flow) for request lifecycle details.

---

## 3. Authentication contract

**Single source of truth: the `express-session` cookie set by `POST /spa/api/login`.**

```http
POST /spa/api/login
Content-Type: application/json

{"username":"admin","password":"admin123"}
```

Response sets `connect.sid=...; HttpOnly` and returns:

```json
{"ok":true,"user":{"id":1,"username":"admin","full_name":"...","role":"Doc Admin","branch":"Cairo West"}}
```

Every subsequent request from the SPA carries the cookie automatically (`axios` is configured with `withCredentials: true`). **No tokens in localStorage** — a deliberate VAPT-mitigation choice that survives XSS far better than bearer tokens.

- `GET /spa/api/me` — returns the current user (or `{user: null}`) without throwing; the SPA calls this on boot to hydrate auth state.
- `POST /spa/api/logout` — destroys the session cookie.

MFA lives on the legacy EJS `/login` only and is not surfaced in the SPA flow for M1. A later milestone (M4) will add SPA-side step-up.

---

## 4. SPA folder layout

```
apps/web/
├── index.html                    # <title>DocManager · NBE Document Management</title>
├── package.json                  # @docmanager/web
├── tailwind.config.ts            # mirrored apex tokens (brand.*, ink, divider, …)
├── tsconfig.json                 # strict + noUncheckedIndexedAccess
├── vite.config.ts                # proxies /spa/api, /api/v1, /py, /uploads → Node :3000
├── playwright.config.ts          # E2E against :5174
├── src/
│   ├── main.tsx                  # StrictMode root
│   ├── App.tsx                   # routes + QueryClient
│   ├── styles/
│   │   ├── index.css             # tailwind layers + apex components + auth-* keyframes
│   │   └── tokens.ts             # hex values for Recharts
│   ├── lib/
│   │   ├── http.ts               # axios instance + HttpError + zod-validated get/post/del
│   │   ├── cn.ts                 # clsx alias
│   │   └── schemas.ts            # shared zod schemas (User, Document, Workflow, …)
│   ├── store/
│   │   └── auth.ts               # zustand auth store (hydrate/login/logout)
│   ├── components/
│   │   ├── ui/                   # Button · Input · Badge · Panel · MetricCard · DataTable
│   │   └── layout/
│   │       ├── AppLayout.tsx
│   │       ├── Sidebar.tsx
│   │       ├── Topbar.tsx
│   │       ├── RequireAuth.tsx
│   │       └── nav.ts            # navItems + section taxonomy + canAccess RBAC
│   └── modules/
│       ├── auth/LoginPage.tsx           # apex split-screen carousel
│       ├── dashboard/{api.ts,DashboardPage.tsx}
│       ├── capture/{api.ts,CapturePage.tsx}
│       ├── repository/{api.ts,RepositoryPage.tsx}
│       ├── viewer/ViewerPage.tsx
│       ├── search/SearchPage.tsx
│       ├── alerts/AlertsPage.tsx
│       └── _placeholder/ComingSoonPage.tsx
└── e2e/                          # Playwright specs (18 tests)
    ├── helpers.ts
    ├── auth.spec.ts
    ├── dashboard.spec.ts
    ├── navigation.spec.ts
    ├── rbac.spec.ts
    └── search.spec.ts
```

**Module rule:** one folder per domain, each with its own `api.ts` (axios + zod) and page component(s). No cross-module imports below `modules/`. Shared concerns live in `components/`, `lib/`, `store/`.

---

## 5. Design system

Mirrored 1:1 from `apex_core_cbs/UI_AGREEMENT.md`. Never introduce raw hex in TSX; reference tokens.

### Color tokens ([`tailwind.config.ts`](../apps/web/tailwind.config.ts))

| Purpose | Hex | Tailwind class |
|---|---|---|
| Sidebar background | `#0D2B6A` | `bg-sidebar` / `bg-brand-navy` |
| Primary action | `#1565C0` | `bg-brand-blue` |
| Primary action hover | `#104a94` | `bg-brand-blueHover` |
| Sky accent | `#2196F3` | `text-brand-sky` |
| Sky accent bg | `#E3EFFF` | `bg-brand-skyLight` |
| Success / warning / danger / purple | semantic pairs | `bg-success-bg text-success` (etc.) |
| Primary text | `#2C2C2A` | `text-ink` |
| Secondary text | `#5F5E5A` | `text-ink-sub` or `text-sub` |
| Muted | `#888780` | `text-muted` |
| Border / divider | `#D3D1C7` / `#F1EFE8` | `border-border` / `border-divider` |
| Page bg | `#F1F4F8` | `bg-page` |

### Typography

`font-family: Inter, system-ui, sans-serif`. Tailwind size scale: `2xs:10`, `xs:11`, `sm:12`, `base:13`, `md:14`, `lg:16`, `xl:20`, `2xl:28`. Use `tabular` class on numerics.

### Component utilities (defined in `index.css`)

- `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`
- `.input`, `.label`, `.field-error`
- `.card` (surface + divider + rounded-card + shadow-card)
- `.module-label`, `.page-title`, `.section-title`, `.caption`
- `.table-header`
- Login-only: `.auth-slide`, `.auth-blob-a/b`, `.auth-grid`, `.auth-dot-active-bar`

---

## 6. HTTP contract

Every SPA call goes through `src/lib/http.ts`, which:

1. Wraps `axios` with `withCredentials: true` and a 20s timeout.
2. Converts errors into a typed `HttpError { message, status, data }`.
3. Parses every response with a zod schema — drift becomes a typed runtime error, never silent `any`.

```ts
// src/modules/dashboard/api.ts
export const fetchStats = () => get('/spa/api/stats', StatsSchema);
```

The server router [`routes/spa-api.js`](../routes/spa-api.js) is the canonical catalogue of endpoints. Current surface (all session-authenticated unless noted):

| Method | Path | Purpose |
|---|---|---|
| POST | `/spa/api/login` | Start session (no session required) |
| POST | `/spa/api/logout` | End session |
| GET  | `/spa/api/me` | Current user (no session required — returns `null`) |
| GET  | `/spa/api/stats` | KPIs, branch-scoped for Maker/Viewer |
| GET  | `/spa/api/stats/expiry` | Expiry histogram |
| GET  | `/spa/api/stats/doc-types` | Doc-type breakdown |
| GET  | `/spa/api/folders` | Folder tree |
| GET  | `/spa/api/documents` | Query by folder / status / type / q / limit |
| GET  | `/spa/api/documents/:id` | One document |
| POST | `/spa/api/documents` | Multipart upload; RBAC: `capture` |
| DELETE | `/spa/api/documents/:id` | RBAC: `delete` (Doc Admin) |
| GET  | `/spa/api/workflows` | Recent workflows |
| POST | `/spa/api/workflows/:id/actions` | `approve` / `reject` / `escalate`; RBAC: `workflow` |
| GET  | `/spa/api/alerts` | Recent alerts |
| POST | `/spa/api/alerts/:id/read` | Mark read |
| GET  | `/spa/api/search?q=` | FTS5 across name + CID + doc_number + OCR text + notes |
| GET  | `/spa/api/docbrain/health` | Ollama liveness + model-ready flags + KYC class list |
| POST | `/spa/api/docbrain/analyze` | OCR → classify → extract → embed; persists back to `documents.doc_type` + high-confidence fields |
| GET  | `/spa/api/docbrain/document/:id` | Last stored analysis (404 if not analysed yet) |
| POST | `/spa/api/docbrain/chat` | Hybrid retrieval + grounded answer with `has_evidence` flag and citations |

---

## 7. Security posture

Specific mitigations implemented for SonarQube Hotspot rules and common VAPT findings:

| Control | Implementation |
|---|---|
| **Cookie auth, not JWT** | `express-session` `HttpOnly` cookie; SPA never touches tokens. Mitigates XSS → account takeover. |
| **Response validation** | Every `get/post` runs through zod; prevents `any` propagation and prototype-pollution-style drift. |
| **File upload hardening** | Client + server MIME whitelist (PDF/JPEG/PNG/WEBP/TIFF/DOCX/TXT), 50 MB cap, filename sanitised (`[^a-zA-Z0-9._-]` → `_`). |
| **Security headers** | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), geolocation=(), microphone=()`. |
| **Python proxy lockdown** | `/py/*` previously public; now requires a session (VAPT-found hole closed). |
| **RBAC mirroring** | Server enforces (`services/rbac.js` + `spa-api.js` per-route `requirePermJson`); client hides nav items (`nav.ts#canAccess`). UI hiding is **defence in depth**, not the gate. |
| **SQL** | All queries are parameterised (`db.prepare(...).run(...)`); FTS5 query wraps each word in quotes to avoid injection. |
| **Strict TS** | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, ESLint `@typescript-eslint/no-explicit-any: error`. |

Open items (tracked for M2):
- CSP header (requires removing inline font-face URL in `index.html`).
- Per-request CSRF token on state-changing routes (session + same-origin carries today, but defence in depth warranted).
- Audit-log every `DELETE /spa/api/documents/:id`.
- Rate limiting on `POST /spa/api/login`.

---

## 8. Build & deploy

```bash
# Development (from repo root)
./start.sh                       # Python :8001 + Node :3000 + Vite :5174

# Production build
cd apps/web
npm run build                    # → dist/
# Serve via Node by adding app.use(express.static('apps/web/dist'))
```

Bundle size: **224 KB gzipped** (773 KB raw). Recharts is the dominant payload; code-splitting the dashboard route is the cheapest reduction path.

Typecheck: `npm run typecheck` (`tsc --noEmit`). ESLint: `npm run lint` (zero warnings allowed).

---

## 9. Testing

### Playwright E2E (apps/web/e2e)

```bash
cd apps/web
npx playwright test              # 22 tests, ~3s on a warm runner
npx playwright test e2e/docbrain.spec.ts
npx playwright test --grep "login"
```

Coverage today (all passing):

| Spec | Tests | What it covers |
|---|--:|---|
| auth.spec.ts | 5 | Branding, bad creds, admin happy path, logout, unauth redirect |
| dashboard.spec.ts | 4 | KPIs, charts panels, recent workflows/alerts, module label |
| navigation.spec.ts | 5 | Sidebar → each M1 route, coming-soon placeholder |
| rbac.spec.ts | 2 | Maker hides admin items; Doc Admin sees Platform + System Admin |
| search.spec.ts | 2 | FTS match + no-results state |
| docbrain.spec.ts | 4 | Empty-state AI panel, populated analysis render, grounded RAG answer w/ citation, no-evidence refusal |

DocBrain specs mock `**/spa/api/docbrain/*` with `page.route()` — tests stay deterministic whether or not Ollama is up on the CI runner.

### Python (existing)

```bash
cd python-service && pytest -q   # 7 tests, all green
```

### Build gates

- `tsc --noEmit` → 0 errors
- `vite build` → succeeds
- `pytest` → 7/7
- `playwright test` → 18/18
- CI additionally runs `python -m compileall`, `terraform fmt -check`, `helm lint`.

---

## 10. DocBrain — local AI stack (what ships today)

The AI layer is described aspirationally in [AI_STRATEGY.md](./AI_STRATEGY.md). This section documents **what actually runs on a laptop** today; the delta from the target stack is intentional and tracked.

### 10.1 Services

| Service | Port | Where it lives | Swap path to target |
|---|---|---|---|
| Ollama | 11434 | Homebrew cask `ollama` | → vLLM / TGI on GPU nodes |
| `llama3.2:3b` | — | pulled by `start.sh` on first boot | → Llama 3.1 8B / 70B + Qwen-2 |
| `nomic-embed-text` (768-dim) | — | pulled by `start.sh` on first boot | → BGE-M3 (multilingual, 1024-dim) |
| MinIO | 9100 (API) · 9101 (console) | Homebrew `minio/stable/minio` | → AWS S3 / Azure Blob / on-prem object store |
| Vector store | — | `storage/docbrain.sqlite` · BLOB + numpy cosine | → pgvector (pooled) / Qdrant (silo+) |

### 10.2 Pipeline (`python-service/app/services/docbrain/`)

```
capture  ──▶  OCR (tesseract + pdf2image)  ──▶  OcrResult { text, lang, confidence }
                                                     │
                                                     ▼
                        classify (Llama 3.2 3B · JSON-mode)  ──▶  ClassificationResult
                              {doc_class ∈ 12 KYC classes, confidence, reasoning, alternative}
                                                     │
                                                     ▼
                         extract (Llama 3.2 3B · JSON-mode)  ──▶  8 entity fields
                              {customer_cid, customer_name, doc_number, dob,
                               issue_date, expiry_date, issuing_authority, address}
                                                     │
                                                     ▼
                       embed  (nomic-embed-text, 768-dim, chunk 900/150)
                                                     │
                                                     ▼
                     upsert into docbrain_vectors (document_id, chunk_index, embedding BLOB, text)
```

### 10.3 RAG contract

`rag.py#rag_answer` returns `RagAnswer { answer, citations[], has_evidence }`. Guardrails:

1. **Retrieval floor:** if cosine similarity top-k < threshold → `has_evidence=false` and refusal text.
2. **Citation stripping:** `_strip_unsupported_citations` removes `[^N]` markers the LLM invents for chunks that were not retrieved.
3. **Display gate** (SPA-side, [RagChat.tsx](../apps/web/src/modules/docbrain/RagChat.tsx)): when `has_evidence === false`, the answer renders with the `ShieldAlert` "No grounded evidence" banner — the user sees the refusal and the reason, never a confidently wrong answer.

### 10.4 Analyze endpoint write-back

`POST /spa/api/docbrain/analyze` is not read-only. After classification + extraction, the server:

1. Upserts into `docbrain_analyses` (sidecar) via `ON CONFLICT(document_id) DO UPDATE`.
2. Persists classification → `documents.doc_type` on the Node side.
3. Persists **high-confidence extracted fields** (≥0.7) back to the Node `documents` row (`customer_cid`, `customer_name`, `doc_number`, `dob`, `issue_date`, `expiry_date`, `issuing_authority`). Lower-confidence fields are retained only on the sidecar so the Viewer can show them behind a "AI suggestion — please verify" chip.

### 10.5 Why the dev-time swaps are intentional

- **numpy cosine over sqlite-vec / pgvector** — Homebrew's Python 3.14 is compiled without `enable_load_extension`. Rather than pin Python 3.13 for every contributor, we keep the public API (`upsert_document`, `vector_search`, `delete_document`) stable and use numpy dot-products for dev. Flipping to pgvector in prod is a one-file change.
- **MinIO locally, S3 in prod** — same S3 client code (`storage_s3.py`) talks to both. MinIO makes the on-prem / air-gapped story real on day one.
- **`llama3.2:3b` not 70B** — 3B runs fast on a MacBook, and for the Egypt-pilot document classes (passports, national IDs, utility bills) the quality gap against 70B on extraction is small. The prod path swaps the model name in config; no code changes.

### 10.6 Observability today

- Ollama request log: `.run/ollama.log`.
- Python request log: `.run/python.log` — every DocBrain call logs `{document_id, op, latency_ms, model, has_evidence}`.
- No LangSmith yet; that's target-state. LangSmith hooks go in `python-service/app/services/docbrain/llm.py#chat_json` when we introduce them.

---

## 11. Conventions

1. **No raw hex in TSX.** Use tokens (see §5).
2. **No bearer tokens in localStorage.** Session cookie only.
3. **Every backend response → zod.** No `as` casts on fetched data.
4. **One module folder per domain.** Co-locate `api.ts` + page(s).
5. **Server enforces RBAC.** Client hides, never trusts.
6. **Branch scoping server-side.** Viewer/Maker queries always filter by `users.branch`.
7. **Don't reintroduce `useMatches`.** `BrowserRouter` is not a data router — use `useLocation()`.
8. **Keep `.auth-*` CSS login-only.** Everything else uses Tailwind utilities.
