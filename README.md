# ZorDMS — Enterprise Document Management System

A microservices-based, web-based Document Management System built for the
**Bank of Bhutan** DMS tender (Tender No. 000/BoB/Tender/2026/009) by **ZorFinotech Pvt. Ltd.**

ZorDMS is a full enterprise platform: multi-channel capture, AI/OCR document
processing (two-stage VLM IDP pipeline), maker–checker workflows, enterprise
search, records management & legal holds, compliance & audit, and core-banking
integration — fronted by a 19-screen React app.

---

## Quick start (local dev)

No external database required — local dev runs entirely on SQLite.

```bash
pnpm install            # install workspace deps (Node 20+, pnpm 9+)
./start.sh              # boot the whole stack (frees ports first)
# open http://localhost:5174  →  sign in:  admin / admin123
```

Management scripts:

| Command        | What it does                                                        |
| -------------- | ------------------------------------------------------------------- |
| `./start.sh`   | Frees the ports, then starts every service + the web app (SQLite). Waits until login is ready. |
| `./stop.sh`    | Kills everything on the ZorDMS ports (4000–4005, 5174, 8000).       |
| `./restart.sh` | `stop` + `start` — a clean restart.                                 |

(`pnpm dev` / `pnpm stop` / `pnpm restart` are aliases for the three scripts.)
Logs stream to `.devlogs/<service>.log`. Stop with `./stop.sh`.

### Default login

| Username | Password   | Role |
| -------- | ---------- | ---- |
| `admin`  | `admin123` | CDO (all permissions) |

`admin` is the only seeded account — it is auto-created on first boot. Every
other user is created **after login** by a Supervisor on the **User Management**
screen (no licensing; unlimited users). Roles: CDO, Supervisor, Maker, Checker,
Indexer, Viewer, Auditor.

---

## Services & ports

| Service           | Port | Stack            | Responsibility |
| ----------------- | ---- | ---------------- | -------------- |
| **gateway**       | 4000 | Node/Express     | Login, MFA, SSO-ready, RBAC engine, supervisor user provisioning, `/authz/check` (the workflow authority source). **Required for login.** |
| **core**          | 4001 | Node/Express     | Documents, repository/folders, capture, indexing + Bhutan metadata schemas, versioning, viewer, auto-catalog, directory mapper, **records/legal-hold/disposal, Customer 360, Branch Network, Compliance & Audit, Lifecycle, SysAdmin/DR**. |
| **workflow**      | 4002 | Node/Express     | Maker–checker, SLA & escalation, case management. |
| **notify**        | 4003 | Node/Express     | Multi-channel alerts (email/SMS/WhatsApp/Teams/in-app), expiry alert tiers, realtime WebSocket/SSE. |
| **search**        | 4004 | Node/Express     | Full-text / faceted search (SQL/PG-FTS now, Elasticsearch cutover ready). |
| **integration**   | 4005 | Node/Express     | CBS (TCS BaNCS) / LOS / KYC connectors, HMAC webhooks, API logs. |
| **ai** (optional) | 8000 | Python/FastAPI   | Two-stage VLM IDP pipeline: doc-type classifier → metadata extractor, confidence routing, human-review queue, OCR. |
| **web**           | 5174 | React + Vite     | The 19-screen enterprise UI. |

The web app reaches each backend through a Vite dev proxy at `/svc/<service>`
(e.g. `/svc/core`, `/svc/search`), so the frontend code uses stable paths
regardless of ports.

> The Python **ai** service is a separate toolchain and is started by
> `start.sh` only if its venv exists. To set it up:
> ```bash
> cd services/ai && python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
> ```

---

## Architecture

```
                       React SPA (apps/web, :5174)
                                │  /svc/<service>  (Vite proxy)
                 ┌──────────────┴───────────────────────────────┐
        GATEWAY/IDENTITY (:4000) ── issues JWT with RBAC claims ─┘
                 │ services authorize from the gateway-issued JWT claims
   ┌─────────────┼──────────────┬──────────────┬───────────────┐
 CORE(:4001)  WORKFLOW(:4002) NOTIFY(:4003) SEARCH(:4004) INTEGRATION(:4005)
   └───────────────────────── AI / IDP (Python, :8000) ────────┘
   Shared infra: per-service DB (SQLite dev · Postgres/Oracle 19c prod) ·
                 Redis (events) · object storage (MinIO/S3) · Elasticsearch
```

- **Database-per-service.** Each service owns its schema. Switch dialect per
  service via env: `DB_CLIENT=pg | oracledb | sqlite3` (Node, Knex) and
  `DATABASE_URL` (Python, SQLAlchemy). SQLite is dev/test only.
- **Auth.** The gateway is the identity authority. On login it issues an
  HS256 JWT embedding the user's roles/permissions/branch. Downstream services
  verify the JWT and authorize from those **claims** (no shared user DB). RBAC
  is the single source of authority for the UI, every API, and the workflow engine.
- **RBAC backbone.** Data-driven roles + `resource:action` permissions, enforced
  at three layers (UI, gateway, each service), fail-closed.

See the design docs in `docs/superpowers/specs/`:
- `2026-06-23-zordms-microservices-architecture-design.md` — system architecture
- `2026-06-23-zordms-idp-design.md` — the AI/IDP (Intelligent Document Processing) design

---

## Repository layout

```
zordms/
  apps/
    web/                 React SPA (Vite + TS) — 19 enterprise screens + design system
  services/
    gateway/             auth, RBAC, user provisioning, /authz/check
    core/                documents, repository, records, enterprise modules
    workflow/            maker-checker, cases, SLA
    notify/              alerts, channels, realtime
    search/              full-text / faceted search
    integration/         CBS/LOS/KYC connectors, webhooks
    ai/                  Python FastAPI IDP pipeline
  packages/
    config/              typed env (incl. the PG⇄Oracle switch)
    db/                  Knex factory + per-service migration helper
    auth/                JWT, RBAC engine, claims-based Express middleware, MFA
    types/               shared TypeScript contracts
  docs/superpowers/      architecture + IDP specs, implementation plans
  start.sh stop.sh restart.sh
```

---

## Common tasks

```bash
pnpm -r build           # build every package/service (tsc)
pnpm -r test            # run all tests (~600 Node tests on SQLite)
# Python AI tests:
cd services/ai && .venv/bin/pytest        # ~87 tests (vLLM/OCR mocked, no GPU)

# run one service in the foreground (e.g. while debugging):
pnpm --filter @zordms/gateway dev         # DB_CLIENT=sqlite3 baked in
```

### Switching the database (production)

Each Node service reads its DB from env (defaults: SQLite in dev). For prod:

```bash
# PostgreSQL
DB_CLIENT=pg DB_HOST=... DB_PORT=5432 DB_USER=... DB_PASSWORD=... DB_NAME=... \
  node services/core/dist/server.js

# Oracle 19c
DB_CLIENT=oracledb DB_USER=... DB_PASSWORD=... \
  DB_ORACLE_CONNECT_STRING=host:1521/PDB  node services/core/dist/server.js
```

Python AI service: `DATABASE_URL=postgresql+psycopg://…` or `oracle+oracledb://…`.

---

## Tech stack

- **Frontend:** React 18, Vite 5, TypeScript, react-router, Recharts.
- **Backend:** Node 20+, Express 4, Knex (pg / oracledb / sqlite3), TypeScript (ESM).
- **AI/IDP:** Python 3.11, FastAPI, Pydantic v2, SQLAlchemy; vLLM-served VLMs
  (Granite 3.2 Vision classifier → Qwen2.5-VL extractor) in production; Tesseract OCR fallback.
- **Auth:** bcrypt, JWT (HS256), TOTP MFA (speakeasy), SAML-ready.
- **Tooling:** pnpm workspaces + Turborepo; Vitest + Supertest (Node), pytest (Python).

---

## Troubleshooting

- **Login shows "Invalid credentials" / 500 in the console** — the gateway isn't
  running (the web proxy returns 500 to a dead port). Run `./start.sh` (or
  `./restart.sh`) to boot the whole stack, then retry `admin / admin123`.
- **Port already in use** — `./stop.sh` frees 4000–4005, 5174, 8000; `./restart.sh`
  does it before starting.
- **A screen shows API errors after login** — that screen's service isn't up.
  `./start.sh` starts them all; check `.devlogs/<service>.log`.
- **Data resets on restart** — dev uses in-memory SQLite. For persistence set
  `SQLITE_FILE=./dev.sqlite` per service, or point at Postgres/Oracle via env.

---

## Deployment notes

- **On-premises / air-gapped** (the BoB target): RKE2 Kubernetes, per-service
  Postgres or Oracle 19c, MinIO object storage, offline image/model registry.
  The AI/IDP service needs **NVIDIA L40S GPUs** running vLLM (CPU-degraded mode
  works for validation).
- **Redis** is required for cross-service event emission (it lazy-connects, so
  dev runs without it).
- **Cloud / hybrid:** Helm chart on K8s, managed DB + S3 + Elasticsearch + a GPU node pool.

---

## License

Proprietary — © ZorFinotech Pvt. Ltd. Prepared for Bank of Bhutan.
