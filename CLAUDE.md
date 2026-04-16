# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout (multi-service monorepo)

This is the National Bank of Egypt Document Management System. Four independent deployables live in one repo:

- **Node.js Express app** (root) — the original web UI + primary HTTP surface. Entry: [server.js](server.js). EJS views in [views/](views/), per-module routers in [routes/](routes/), cross-cutting logic in [services/](services/), SQLite via `better-sqlite3` in [db/](db/).
- **Python FastAPI microservice** ([python-service/](python-service/)) — the "real" backend implementing the architecture in `DMS Architecture.pdf`: document service, OCR, workflow engine, search, integrations, duplicate detection, plus a large surface of compliance/risk/AI routers. Entry: [python-service/app/main.py](python-service/app/main.py). SQLAlchemy + Alembic, async engine auto-initialized when an async driver is installed.
- **Playwright E2E** ([e2e/](e2e/)) — targets the **Python service** by default (`E2E_BASE_URL=http://localhost:8000`), not Node. Five projects: chromium-ltr, chromium-rtl (Arabic locale), firefox, webkit, mobile (Pixel 7).
- **Expo/React Native mobile** ([mobile/](mobile/)) — branch-officer capture app that talks to the Python service's `/api/v1/*` endpoints (JWT auth, not API key).

Supporting pieces: [opa/policies/dms.rego](opa/policies/dms.rego) (ABAC policy), [loadtest/k6.js](loadtest/k6.js) (load test against Python service), [.github/workflows/](.github/workflows/) (CI, multicloud, release, supply-chain).

## Running locally

**Node app** (port 3000):
```bash
npm install
node db/seed.js      # creates db/nbe-dms.db with seed users/docs
npm start            # or `npm run dev` for nodemon
```
Seed logins: `admin/admin123` (Doc Admin), `sara/sara123` (Maker), `mohamed/mohamed123` (Checker), `nour/nour123` (Viewer, Locked).

**Python service** (port 8000):
```bash
cd python-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt        # pinned
# or requirements-local.txt for Python 3.13+ without wheel-build issues
cp .env.example .env                   # set API_KEY, JWT_SECRET, DATABASE_URL
uvicorn app.main:app --reload --port 8000
```
Swagger at `/docs`, UI at `/`. Default API key header: `X-API-Key: dev-key-change-me`.

**Both services together**: Node proxies to Python via [routes/py-proxy.js](routes/py-proxy.js) mounted at `/py`. Configure with `PYTHON_SERVICE_URL` and `PYTHON_SERVICE_KEY`. Both default to port 8000 independently — run Python on a different port if you need them side-by-side.

**Docker**: `docker compose up --build` starts the Node app only. The Python service has its own [python-service/docker-compose.yml](python-service/docker-compose.yml).

## Testing

```bash
# Python unit/integration tests
cd python-service && pytest -q
pytest tests/test_api.py::test_upload_and_list -q   # single test

# E2E (needs Python service running on :8000)
cd e2e
npm install
npx playwright install --with-deps chromium firefox
npx playwright test                                   # all projects
npx playwright test --project=chromium-ltr            # one project
npx playwright test tests/api.spec.ts                 # one file

# Load test
k6 run --vus 50 --duration 2m loadtest/k6.js
```

There is **no JavaScript test suite** for the Node app — CI only runs `node -c routes/py-proxy.js` as a syntax check. Alembic migrations: `alembic upgrade head` from `python-service/`.

## Architecture — how the pieces talk

**Two parallel auth schemes, do not confuse them:**

- Node app uses **session cookies** for browser users (`express-session`, login via `POST /login`) and **`x-api-key` per-user** for its `/api/v1/*` surface ([routes/api.js](routes/api.js)). The key is stored on the `users.api_key` column.
- Python service uses **a single shared `X-API-Key`** from settings ([python-service/app/security.py](python-service/app/security.py)) for all `/api/v1/*`, AND **JWT** (HS256) for user-scoped flows with tenant+branch+roles claims ([python-service/app/services/auth.py](python-service/app/services/auth.py)). The mobile app uses JWT; `X-API-Key` is the gateway check.

**RBAC lives in two places and must stay in sync:**
- Node: [services/rbac.js](services/rbac.js) — roles `Doc Admin / Maker / Checker / Viewer`.
- Python: [python-service/app/services/auth.py](python-service/app/services/auth.py) — roles `doc_admin / maker / checker / viewer / auditor` (lowercase, plus `auditor`).
- OPA ABAC policy layers tenant, branch, risk-band, and after-hours checks on top: [opa/policies/dms.rego](opa/policies/dms.rego).

**Storage models differ:**
- Node stores files under `uploads/` (gitignored) with filenames in the DB row.
- Python uses **SHA-256 content-addressed storage** under `STORAGE_DIR`; duplicate detection uses SHA-256 + pHash + fuzzy. Dedup is a core invariant — [python-service/app/services/storage.py](python-service/app/services/storage.py) and [services/duplicates.py](python-service/app/services/duplicates.py).

**Full-text search** is an FTS5 virtual table `documents_fts` in the Node schema ([db/schema.sql](db/schema.sql)), kept in sync by `AFTER INSERT/UPDATE/DELETE` triggers over `documents.original_name, customer_name, customer_cid, doc_number, ocr_text, notes`. The Python service uses its own SQL full-text index in [python-service/app/services/search_backend.py](python-service/app/services/search_backend.py).

**Node server wiring** ([server.js](server.js)): route order matters — `/api/v1`, `/py`, `/graphql`, `/webhooks`, `/portal` are mounted **before** the `requireAuth` middleware; everything else (`/`, `/documents`, `/workflows`, etc.) sits behind session auth. SAML is initialized via `services/saml.configure(app)` and two cron-like jobs start on boot: `expiry-job` and `retention`. A WebSocket server from [services/ws.js](services/ws.js) attaches to the same HTTP server.

**Python main.py** imports ~60 routers. When adding a router, include it in both the import block and an `app.include_router(...)` line. Middleware order: CORS → Prometheus metrics → WAF → Carbon → Usage → (optional) Failpoint. Tasks use a worker pool started by `services.tasks.start_workers`; task handlers register themselves via module import side-effects in `services/task_handlers.py`.

## Database conventions

- **Node SQLite**: schema in [db/schema.sql](db/schema.sql), seeded via `node db/seed.js`. Passwords are bcrypt; WAL journal mode is enabled in [db/index.js](db/index.js). The DB file `db/nbe-dms.db` is gitignored — delete it and re-seed to reset state.
- **Python SQLAlchemy**: models in [python-service/app/models.py](python-service/app/models.py). `DATABASE_URL` swaps SQLite ↔ Postgres; pool settings come from env (`DB_POOL_SIZE`, etc.). When you edit models, generate a migration: `alembic revision --autogenerate -m "…" && alembic upgrade head`.

## CI gates

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs: `python -m compileall` (lint), `pytest`, `terraform fmt -check && validate`, `helm lint python-service/helm/nbe-dms`, and Playwright E2E (chromium-ltr + chromium-rtl) against a live uvicorn on port 8000. Tesseract and poppler are apt-installed in CI — local runs need them too for OCR tests (see `TESSERACT_CMD` / `POPPLER_PATH` in [python-service/app/config.py](python-service/app/config.py)).
