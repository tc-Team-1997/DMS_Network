# ZorDMS — Enterprise Document Management System

A microservices-based, web Document Management System built for the
**Bank of Bhutan** DMS tender (Tender No. 000/BoB/Tender/2026/009) by **ZorFinotech Pvt. Ltd.**

ZorDMS is a full enterprise platform with a real, working document lifecycle:
multi-channel **capture** → **AI/OCR document processing** (local open-source
VLMs via Ollama, GPU vLLM in prod) → **metadata mapping + completeness/quality**
→ **doc-type detection** → **maker–checker workflow** → **review queue** →
**document viewer with stamping/redaction & approval** → **records, retention &
legal holds** → **core-banking (CBS/LOS) integration** → **notifications &
email** — fronted by a React app, with **UUIDv7** identifiers, a **durable job
queue** for scale, **per-service OpenAPI**, and **env-toggled enterprise SSO**.

---

## Quick start (local dev)

No external database required — local dev runs entirely on in-memory SQLite.

```bash
pnpm install            # install workspace deps (Node 20+, pnpm 9+)
./start.sh              # boot the whole stack (frees ports first)
# open http://localhost:5174  →  sign in:  admin / admin123
```

| Command | What it does |
| --- | --- |
| `./start.sh`   | Frees the ports, then starts every service + the web app (SQLite). Waits until login is ready. |
| `./stop.sh`    | Kills everything on the ZorDMS ports (4000–4005, 5174, 8000). |
| `./restart.sh` | `stop` + `start` — a clean restart. |

(`pnpm dev` / `pnpm stop` / `pnpm restart` are aliases.) Logs stream to `.devlogs/<service>.log`.

### Default login

| Username | Password | Role |
| --- | --- | --- |
| `admin` | `admin123` | CDO (all permissions) |

`admin` is the only seeded account (auto-created on first boot, flagged for a
forced password reset before production). Every other user is created **after
login** by a Supervisor on **User Management** (no licensing; unlimited users).
Roles: CDO, Supervisor, Maker, Checker, Indexer, Viewer, Auditor. All accounts
now carry an **email** (used by notifications). Identifiers are **UUIDv7**.

---

## Services & ports

| Service | Port | Stack | Responsibility |
| --- | --- | --- | --- |
| **gateway** | 4000 | Node/Express | Login, MFA, **env-toggled SSO** (LDAP/OIDC/SAML), RBAC engine, user provisioning, `/authz/check` (workflow authority). **Required for login.** |
| **core** | 4001 | Node/Express | Documents, repository/folders, capture, indexing + Bhutan metadata, versioning, **viewer/stamp/redact**, auto-catalog, **dedup**, **doc-type admin**, **records/legal-hold/disposal**, Customer 360, Compliance, **durable job queue**. |
| **workflow** | 4002 | Node/Express | Maker–checker `/act` state machine, **claim**, SLA & auto-escalation cron, cross-status review queue. |
| **notify** | 4003 | Node/Express | Multi-channel alerts; **role/group → user-email resolution**; SMTP (email). |
| **search** | 4004 | Node/Express | Full-text / faceted search (SQL/PG-FTS; Elasticsearch-cutover ready). |
| **integration** | 4005 | Node/Express | CBS/LOS/KYC connectors (live via env, mock fallback), **inbound webhooks consumed by core**, HMAC in/out. |
| **ai** (optional) | 8000 | Python/FastAPI | IDP pipeline: classify → extract → **metadata field inference**, copilot (RAG), human-review queue, OCR — on **local Ollama models**. |
| **web** | 5174 | React + Vite | The enterprise UI. |
| **ollama** (optional) | 11434 | local LLM runtime | Serves the vision + text models the `ai` service uses. |

The web app reaches each backend through a Vite dev proxy at `/svc/<service>`
(env-overridable `VITE_SVC_*`), so the frontend uses stable, **no-hardcoded** paths.

---

## Document lifecycle (end-to-end, wired)

```
Capture (scanner / file upload / bulk; front+back; live preview)
  → POST /documents                                              [core]
  → AI classify + extract (Ollama qwen2.5-vl; ocr-fallback)      [core→ai]
  → field mapping + completeness/quality score + raw metadata    [core]
  → doc-type detection + new-type suggestion                     [core]
  → low quality/conf → auto-create maker-checker case            [core→workflow]
  → Review Queue: claim / approve / reject / escalate (SLA cron) [workflow]
  → Viewer: preview · stamp · redact (burned into a new version) · approve→back
  → Records: retention dates · legal-hold blocks disposal · scheduled disposal scan
  → Integration: CBS/LOS inbound upsert + outbound webhooks (HMAC)
  → Notifications/Email to maker/checker/escalate (resolved user emails)
```

Highlights:
- **Capture** — Scanner / File Upload / Bulk Upload; **single or front & back**
  sides; live preview (zoom/rotate) + full-screen modal (image/PDF); a **Proceed**
  button (enabled only after a file is selected) runs extraction; an editable
  **result drawer** shows mapped fields, a **mandatory-field checklist**,
  **quality/completeness**, **duplicates** (open in viewer), and the **raw
  extracted-metadata JSON** (all keys preserved, incomplete-tolerant). Bulk can
  run extraction **in the background** via the durable queue.
- **Dedup & auto-versioning** — hash + CID/doc-no matching; admin-configurable
  (flag vs auto-version).
- **Doc-type admin** — CRUD document types + per-type mandatory/optional field
  schemas; **AI sample-based field detection** (`/idp/infer-fields` reads a sample
  doc and proposes the field schema); accept new-type suggestions.
- **Viewer** — annotations, plus **stamp** and **destructive redact** that are
  **burned into a new document version** (PDF pages rasterized via poppler so
  redacted text is unrecoverable); **approve-from-viewer** closes the
  review→viewer→approve→back loop via URL params.
- **Records** — retention years/destruction date; an active **legal hold blocks
  delete & disposal** (409); a scheduled job marks over-retention, hold-free docs
  disposal-eligible (human certify required — never auto-deletes).

---

## AI / IDP — local open-source LLMs (Ollama)

The AI service runs **real local models** on Apple Silicon / CPU via **Ollama**,
and **GPU vLLM** in production — selected by `AI_BACKEND` (`auto` prefers Ollama
when reachable, else vLLM, else a deterministic mock so dev never breaks). When
the model is unavailable, extraction degrades to a grounded `ocr-fallback`.

| Capability | Model (default) |
| --- | --- |
| Vision: classify + extract + field inference | `qwen2.5vl:7b` |
| Text: copilot (RAG, grounded + citations) | `granite3.3:8b` |

**One-time local setup (macOS):**
```bash
brew install ollama poppler            # poppler enables PDF→image for scanned PDFs
brew services start ollama
ollama pull qwen2.5vl:7b
ollama pull granite3.3:8b
cd services/ai && python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
./restart.sh
```
Env: `AI_BACKEND` (auto|ollama|vllm|mock), `OLLAMA_BASE_URL`, `OLLAMA_VLM_MODEL`,
`OLLAMA_TEXT_MODEL`, `OLLAMA_TIMEOUT_S`. Set `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`
to use a cloud LLM for the copilot instead. (First call cold-loads the model
~10–30s; subsequent calls ~1–3s.)

---

## Enterprise SSO (LDAP/AD · OIDC/OAuth2 · SAML 2.0)

SSO is **purely env-toggled** and additive — **local username/password login is
always the default** when providers are off. The IdP supplies *identity*; ZorDMS
RBAC supplies *authorization* (with optional IdP-group → role maps). Enabling a
provider makes its button appear automatically via the public `GET /auth/config`.

| Provider | Enable | Key vars |
| --- | --- | --- |
| LDAP / Active Directory | `AUTH_LDAP_ENABLED=true` | `LDAP_URL`, `LDAP_BIND_DN`, `LDAP_BIND_CREDENTIALS`, `LDAP_SEARCH_BASE`, `LDAP_SEARCH_FILTER`, `LDAP_GROUP_ROLE_MAP` |
| OIDC / OAuth2 (Entra ID) | `AUTH_OIDC_ENABLED=true` | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `OIDC_GROUP_ROLE_MAP` |
| SAML 2.0 | `AUTH_SAML_ENABLED=true` | `SAML_ENTRY_POINT`, `SAML_ISSUER`, `SAML_IDP_CERT`, `SAML_CALLBACK_URL`, `SAML_GROUP_ROLE_MAP` |

- **Test it locally** with the bundled harness — a Keycloak (OIDC+SAML) +
  OpenLDAP stack with pre-seeded users/groups: see **`deploy/sso-local/README.md`**
  (`docker compose up`, paste the enable-block from `env.sso-local.example`,
  `./restart.sh`, sign in).
- **Multi-replica safe:** OIDC `state`/PKCE is carried in a signed HttpOnly
  cookie, so login→callback works across load-balanced gateway instances (no Redis).
- **Promotion (dev→UAT→prod):** the **code never changes** — only env values do
  (point issuer/redirect/callback at each env's HTTPS IdP host, pull secrets from
  the vault, and pre-register each env's exact redirect URI in the IdP).

---

## Background job queue & scale

Extraction and other heavy work run on a **durable, DB-backed job queue**
(portable across SQLite/Postgres/Oracle — no broker required):

- **No data loss** — the payload is persisted on enqueue before any processing.
- **Idempotency keys** prevent duplicate work / rework under load.
- **Retries with exponential backoff** → **dead-letter** after max attempts.
- **Crash recovery** — a visibility timeout re-queues jobs whose worker died.
- Async extraction: `POST /documents/:id/extract {async:true}` → `202 {jobId}`;
  poll `GET /jobs/:id`; admins see a **Processing Queue** monitor (counts + DLQ).

Cross-service events use an event bus (in-memory in dev; `RedisStreamsEventBus`
available for prod fan-out).

---

## Architecture

```
                       React SPA (apps/web, :5174)
                                │  /svc/<service>  (Vite proxy, env-configurable)
                 ┌──────────────┴───────────────────────────────┐
        GATEWAY/IDENTITY (:4000) ── JWT (RBAC claims) · SSO ─────┘
                 │ services authorize from the gateway-issued JWT claims
   ┌─────────────┼──────────────┬──────────────┬───────────────┐
 CORE(:4001)  WORKFLOW(:4002) NOTIFY(:4003) SEARCH(:4004) INTEGRATION(:4005)
   │  durable job queue · dedup · stamp/redact · records         │  CBS/LOS
   └───────────── AI / IDP (Python, :8000) ──→ Ollama (:11434) ──┘
   Shared infra: per-service DB (SQLite dev · Postgres/Oracle 19c prod) ·
                 UUIDv7 PKs · Redis (events) · object storage (MinIO/S3)
```

- **Database-per-service** with **UUIDv7** primary keys (globally unique across
  service DBs, time-ordered for index locality, no enumerable sequential IDs).
  Switch dialect via env: `DB_CLIENT=pg | oracledb | sqlite3`.
- **Auth.** Gateway is the identity authority; issues an HS256 JWT with
  roles/permissions/branch claims; downstream services authorize from claims.
  RBAC enforced at three layers (UI, gateway, each service), fail-closed.
- **API contracts.** Every Node service serves **OpenAPI 3.1** at `GET /openapi.json`
  (specs also published under `docs/superpowers/specs/openapi/`), with **zod
  boundary validation** (`400 validation_error`) on mutating routes; the FastAPI
  `ai` service auto-serves its own OpenAPI.

See `docs/superpowers/specs/`:
- `2026-06-25-system-wiring-and-roadmap.md` — master interconnection diagram + wiring status
- `2026-06-23-zordms-microservices-architecture-design.md` — system architecture
- `2026-06-23-zordms-idp-design.md` — AI/IDP design
- `openapi/*.json` — per-service OpenAPI 3.1 specs

---

## Repository layout

```
zordms/
  apps/web/              React SPA (Vite + TS, Zustand, URL-driven filters)
  services/
    gateway/             auth, RBAC, SSO (sso/), user provisioning, /authz/check
    core/                documents, capture, dedup, doc-types, viewer/stamp/redact,
                         records, durable queue (queue/, worker/), openapi/
    workflow/            maker-checker /act, claim, SLA, review queue
    notify/              alerts, channels, email recipient resolution
    search/              full-text / faceted search
    integration/         CBS/LOS/KYC connectors, inbound→core, webhooks
    ai/                  Python FastAPI IDP (Ollama: classify/extract/infer/copilot)
  packages/
    config/ db/ auth/ types/    typed env · Knex + newId (UUIDv7) · JWT/RBAC · contracts
  deploy/sso-local/      local Keycloak + OpenLDAP IdP test harness
  docs/superpowers/      architecture/IDP/roadmap specs + OpenAPI specs
  start.sh stop.sh restart.sh
```

---

## Configuration (key env vars)

| Area | Vars |
| --- | --- |
| Database | `DB_CLIENT` (pg\|oracledb\|sqlite3), `DB_*` / `DB_ORACLE_CONNECT_STRING`, `DATABASE_URL` (ai), `SQLITE_FILE` (persist dev) |
| Auth | `JWT_SECRET` (shared across all services incl. ai), `INTERNAL_SERVICE_TOKEN` |
| AI | `AI_BACKEND`, `OLLAMA_BASE_URL`, `OLLAMA_VLM_MODEL`, `OLLAMA_TEXT_MODEL`, `OLLAMA_TIMEOUT_S`, `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` |
| Cross-service | `AI_URL` (core→ai), `WORKFLOW_URL` (core→workflow), `CORE_URL` (integration→core), `SEARCH_URL` (ai→search) |
| SSO | `AUTH_LDAP_ENABLED` / `AUTH_OIDC_ENABLED` / `AUTH_SAML_ENABLED` + provider vars; `SSO_DEFAULT_ROLE`, `WEB_APP_URL` |
| Notify | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (jsonTransport fallback when unset) |
| Integration | `CBS_BASE_URL`, `LOS_BASE_URL`, `KYC_BASE_URL` (unset → mock connector) |
| Jobs/records | queue poll/concurrency/visibility-timeout knobs; `DISPOSAL_SCAN_INTERVAL_MS` |
| Web | `VITE_SVC_*` (override the `/svc/*` proxy targets) |

`start.sh` exports a shared `JWT_SECRET` + `INTERNAL_SERVICE_TOKEN` and points
core/integration/ai at each other for local dev. See `.env.example`.

---

## Common tasks

```bash
pnpm -r build           # build every package/service (tsc + vite)
pnpm -r test            # ~960 Node tests on SQLite
cd services/ai && .venv/bin/pytest    # ~150 Python tests (Ollama HTTP mocked)
cd e2e && npx playwright test          # browser e2e smoke (needs the stack up)

pnpm --filter @zordms/gateway dev      # run one service in the foreground
```

### Switching the database (production)

```bash
# PostgreSQL
DB_CLIENT=pg DB_HOST=... DB_PORT=5432 DB_USER=... DB_PASSWORD=... DB_NAME=... \
  node services/core/dist/server.js
# Oracle 19c
DB_CLIENT=oracledb DB_USER=... DB_PASSWORD=... \
  DB_ORACLE_CONNECT_STRING=host:1521/PDB  node services/core/dist/server.js
```
Python AI: `DATABASE_URL=postgresql+psycopg://…` or `oracle+oracledb://…`.

---

## Tech stack

- **Frontend:** React 18, Vite 5, TypeScript, react-router, **Zustand**, Recharts.
- **Backend:** Node 20+, Express 4, Knex (pg/oracledb/sqlite3), **zod** boundary
  validation, **@asteasolutions/zod-to-openapi**, **pdf-lib + sharp + poppler**
  (stamp/redact), **uuidv7**.
- **AI/IDP:** Python 3.11, FastAPI, Pydantic v2, SQLAlchemy; **Ollama** local VLMs
  (qwen2.5-vl, granite3.3) for dev/on-prem; **vLLM** (Granite Vision → Qwen2.5-VL)
  on GPU in prod; Tesseract/poppler OCR fallback.
- **Auth:** bcrypt, JWT (HS256), TOTP MFA; SSO via ldap-authentication,
  openid-client (OIDC + PKCE), @node-saml/node-saml.
- **Tooling:** pnpm workspaces + Turborepo; Vitest + Supertest (Node), pytest
  (Python), Playwright (e2e).

---

## Troubleshooting

- **Login "Invalid credentials" / 500** — the gateway isn't running. `./start.sh` then retry `admin / admin123`.
- **Port already in use** — `./stop.sh` frees 4000–4005, 5174, 8000.
- **AI extraction returns `ocr-fallback` / mock** — Ollama isn't running or the model isn't pulled (`brew services start ollama`, `ollama pull qwen2.5vl:7b`), or `AI_BACKEND=mock`.
- **SSO button not showing** — the provider isn't enabled; check `GET /auth/config` and the `AUTH_*_ENABLED` env.
- **Data resets on restart** — dev uses in-memory SQLite. Set `SQLITE_FILE=./dev.sqlite` per service or point at Postgres/Oracle.

---

## Deployment notes

- **On-premises / air-gapped** (BoB target): RKE2 Kubernetes, per-service
  Postgres or Oracle 19c, MinIO object storage, offline image/model registry.
  The AI/IDP service uses **NVIDIA GPUs running vLLM** in prod (or Ollama on
  suitable hardware); CPU/mock mode works for validation.
- **Redis** for cross-service event fan-out + durable-stream events (lazy-connects; dev runs without it).
- **SSO/HTTPS:** UAT/prod redirect & callback URLs must be HTTPS and pre-registered in the IdP; secrets from the env's secret store.
- **Scale:** the durable job queue moves extraction off the request path with retries/DLQ/idempotency; run multiple core workers + gateway replicas behind a load balancer (OIDC state is replica-safe).

---

## License

Proprietary — © ZorFinotech Pvt. Ltd. Prepared for Bank of Bhutan.
