# NBE DMS — Python Microservice

FastAPI microservice that implements the architecture in `DMS Architecture.pdf`:
Document Service, OCR Engine (AI), Workflow Engine, Search, Integration Layer, Duplicate Detection.
Runs alongside the existing Node.js app in [../](../).

## Architecture mapping

| PDF layer              | Component in this service                                 |
|------------------------|-----------------------------------------------------------|
| DMS Portal (Web UI)    | Jinja2 templates at `/` (app/templates/index.html)        |
| API Gateway            | FastAPI w/ `X-API-Key` auth                               |
| Document Service       | `app/routers/documents.py`                                |
| OCR Engine (AI)        | `app/services/ocr.py` + `app/routers/ocr.py` (Tesseract)  |
| Workflow Engine        | `app/routers/workflow.py` (maker–checker state machine)   |
| Search Engine          | `app/routers/search.py` (SQL full-text over OCR+metadata) |
| Document Store         | SHA-256 content-addressed on-disk (`storage/documents`)   |
| Metadata DB            | SQLAlchemy + SQLite (swap to Postgres via `DATABASE_URL`) |
| Integration Layer      | `app/routers/integrations.py` (CBS/LOS/AML/IFRS9 mocks)   |
| Duplicate Detection    | `app/services/duplicates.py` (SHA-256 + pHash + fuzzy)    |

## Phases

- **Phase 1** — upload/storage:   `POST /api/v1/documents`
- **Phase 2** — OCR + workflows:  `POST /api/v1/ocr/{id}`, `POST /api/v1/workflow/{id}/actions`
- **Phase 3** — integrations:     `POST /api/v1/integrations/call`
- **Bonus**  — duplicate scan:    `POST /api/v1/duplicates/{id}/scan`

## Run locally

```bash
cd python-service
python -m venv .venv && .venv\Scripts\activate   # Windows
pip install -r requirements.txt         # pinned, reproducible
# or for newer Python (3.13+) without pinned-wheel headaches:
pip install -r requirements-local.txt    # unpinned, latest compatible
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```

Open http://localhost:8000 for the UI, http://localhost:8000/docs for Swagger.

### Smoke test

```bash
curl http://127.0.0.1:8000/health
curl -H "X-API-Key: dev-key-change-me" http://127.0.0.1:8000/api/v1/dashboard/kpis
curl -X POST http://127.0.0.1:8000/api/v1/auth/token \
     -H "Content-Type: application/json" \
     -d '{"username":"sara.k","password":"demo"}'
```

### Troubleshooting

- **Port 8000 in use** — pass `--port 8765` (or anything free). The existing Node.js
  app in [../](../) also defaults to 8000.
- **Pillow / other deps fail to build on Python 3.14** — use `requirements-local.txt`
  (unpinned) or Docker (below).
- **Windows: `ModuleNotFoundError: resource`** — already fixed in this tree
  ([services/carbon.py](app/services/carbon.py) uses `time.process_time()` now).

## Run with Docker

```bash
docker compose up --build
```

## Authentication

All `/api/v1/*` endpoints require `X-API-Key: <API_KEY>` header.
The web UI injects it automatically from the server-rendered template.

## Example API calls

```bash
# Upload
curl -X POST http://localhost:8000/api/v1/documents \
  -H "X-API-Key: dev-key-change-me" \
  -F "file=@passport.pdf" \
  -F "doc_type=passport" \
  -F "customer_cid=EGY-2024-00847291" \
  -F "branch=Cairo West" \
  -F "expiry_date=2032-01-09"

# OCR a document
curl -X POST http://localhost:8000/api/v1/ocr/1 -H "X-API-Key: dev-key-change-me"

# Workflow action
curl -X POST http://localhost:8000/api/v1/workflow/1/actions \
  -H "X-API-Key: dev-key-change-me" -H "Content-Type: application/json" \
  -d '{"stage":"maker","action":"approve","actor":"Ahmed M.","comment":"OK"}'

# Call CBS
curl -X POST http://localhost:8000/api/v1/integrations/call \
  -H "X-API-Key: dev-key-change-me" -H "Content-Type: application/json" \
  -d '{"system":"cbs","endpoint":"/customers/verify","payload":{"cid":"EGY-2024-00847291"}}'

# Duplicate scan
curl -X POST http://localhost:8000/api/v1/duplicates/1/scan -H "X-API-Key: dev-key-change-me"
```

## Windows: Tesseract + Poppler

1. Install Tesseract: https://github.com/UB-Mannheim/tesseract/wiki
2. Install Poppler: https://github.com/oschwartz10612/poppler-windows/releases
3. In `.env` set `TESSERACT_CMD` and `POPPLER_PATH` to the installed paths.

## Swapping SQLite → Postgres

Set `DATABASE_URL=postgresql+psycopg://user:pass@host:5432/dms` and `pip install psycopg[binary]`.

## Database migrations (Alembic)

```bash
# Apply migrations
alembic upgrade head

# Generate a new migration after editing app/models.py
alembic revision --autogenerate -m "add new field"
alembic upgrade head
```

The `render_as_batch` flag in `migrations/env.py` makes migrations safe on SQLite too.

## Elasticsearch (optional)

Set `ELASTICSEARCH_URL=http://localhost:9200` and restart. The service will:
- Index every uploaded document (metadata) and OCR result (full text)
- Route `/api/v1/search` queries to ES with fuzzy multi-field matching
- Transparently fall back to SQL `LIKE` if ES is down or unset

Check which backend is active: `GET /api/v1/search/backend` → `{"elasticsearch": true|false}`.

## Node.js integration

The existing Node app at [../](../) now mounts a transparent proxy at `/py/*`:

```js
// server.js
app.use('/py', require('./routes/py-proxy'));
```

Example from the Node side:
```
GET  /py/api/v1/dashboard/kpis    → FastAPI /api/v1/dashboard/kpis
POST /py/api/v1/ocr/42            → FastAPI OCR
```
The proxy injects `X-API-Key` from `PYTHON_SERVICE_KEY`; set
`PYTHON_SERVICE_URL=http://python-service:8000` in compose to point Node at the Python container.

## Seeding demo data

```bash
python scripts/seed.py
```

## Digital signatures

Detached RSA-PSS-SHA256 signatures with auto-generated self-signed cert (stored under `storage/keys/`):

```bash
curl -X POST http://localhost:8000/api/v1/signatures/1 \
  -H "X-API-Key: dev-key-change-me" -H "Content-Type: application/json" \
  -d '{"signer":"Ahmed M.","reason":"Maker-Checker approval","visible":true}'

curl http://localhost:8000/api/v1/signatures/1/verify -H "X-API-Key: dev-key-change-me"
```

Swap the self-signed cert under `storage/keys/` with a CA-issued one for production. For full
PAdES/eIDAS compliance add a timestamp authority and use `pyhanko` / `endesive`.

## Live events (WebSocket)

Subscribe to `ws://localhost:8000/ws/events?api_key=dev-key-change-me` to receive events as they happen:

```js
const ws = new WebSocket("ws://localhost:8000/ws/events?api_key=dev-key-change-me");
ws.onmessage = (e) => console.log(JSON.parse(e.data));
// {type: "document.uploaded", id: 42, ...}
// {type: "workflow.action", document_id: 42, action: "approve", ...}
// {type: "task.succeeded", id: "...", name: "ocr.process", result: {...}}
```

The existing Node app can bridge this to its own WS at `services/ws.js` by connecting as a
client to `/ws/events` and re-emitting to authenticated browser sessions.

## Background task queue

In-process async queue with persisted history (`task_runs` table). Two handlers shipped:

- `ocr.process` — payload `{document_id}`
- `duplicates.scan` — payload `{document_id}`

```bash
# Enqueue
curl -X POST http://localhost:8000/api/v1/tasks \
  -H "X-API-Key: dev-key-change-me" -H "Content-Type: application/json" \
  -d '{"name":"ocr.process","payload":{"document_id":1}}'
# → {"id":"<uuid>","status":"queued"}

# Poll
curl http://localhost:8000/api/v1/tasks/<uuid> -H "X-API-Key: dev-key-change-me"
```

To scale beyond one process, swap `app/services/tasks.py::enqueue` with an RQ/Celery backend —
handlers in `task_handlers.py` stay unchanged.

## PAdES signing (eIDAS-style)

`POST /api/v1/signatures/{id}/pades` embeds a PAdES-B-B signature inside the PDF
(PAdES-B-LT if a TSA URL is provided). Replace the self-signed cert at
`storage/keys/signer.cert.pem` with a CA-issued one for production trust.

```bash
curl -X POST http://localhost:8000/api/v1/signatures/1/pades \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"signer":"Ahmed M.","reason":"KYC approved","tsa_url":"http://timestamp.digicert.com"}'
```

## Authentication & RBAC (JWT)

Two credential modes are accepted everywhere:

- **`X-API-Key: <API_KEY>`** → acts as `doc_admin` in the default tenant (useful for server-to-server).
- **`Authorization: Bearer <JWT>`** → user-scoped with tenant + branch + roles.

Get a token (demo user store in [routers/auth.py](app/routers/auth.py) — swap for LDAP/SAML in prod):

```bash
curl -X POST http://localhost:8000/api/v1/auth/token \
  -H "Content-Type: application/json" \
  -d '{"username":"sara.k","password":"demo"}'
```

Roles & permissions:

| Permission   | Roles allowed                        |
|--------------|--------------------------------------|
| `view`       | viewer, maker, checker, doc_admin, auditor |
| `capture`    | maker, doc_admin                     |
| `index`      | maker, doc_admin                     |
| `approve`    | checker, doc_admin                   |
| `sign`       | checker, doc_admin                   |
| `admin`      | doc_admin                            |
| `audit_read` | auditor, doc_admin                   |

Documents carry a `tenant` and are scoped by it on every query. Non-admin/non-auditor users are
further restricted to their own `branch` (if their JWT has one).

## Metrics (Prometheus) + Grafana

`GET /metrics` exposes standard Prometheus metrics:

- `dms_http_requests_total{method,path,status}` / `dms_http_request_seconds_bucket{...}`
- `dms_documents_uploaded_total{tenant,doc_type}`
- `dms_ocr_confidence_bucket` — histogram of OCR confidence
- `dms_duplicate_matches_total{match_type}`

Drop [grafana/dashboard.json](grafana/dashboard.json) into Grafana. Scrape config in
[grafana/prometheus.yml](grafana/prometheus.yml).

## Kubernetes

Raw manifests:

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/
```

Helm chart at [helm/nbe-dms/](helm/nbe-dms/):

```bash
helm install dms ./helm/nbe-dms -n nbe-dms --create-namespace \
  --set image.tag=1.0.0 \
  --set secrets.API_KEY=$(openssl rand -hex 32) \
  --set secrets.JWT_SECRET=$(openssl rand -hex 32)
```

Production-grade defaults include HPA (2–10 replicas @ 70% CPU), PVC for `/data`,
WebSocket-safe Ingress annotations, and an optional `ServiceMonitor` for the
Prometheus Operator (enable via `--set serviceMonitor.enabled=true`).

## OpenTelemetry tracing

Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318` and the service auto-instruments
FastAPI, httpx (integration calls), and SQLAlchemy. For quick local inspection:
`OTEL_TRACES_EXPORTER=console` prints spans to stdout. Zero code changes needed — see
[services/tracing.py](app/services/tracing.py).

## AWS infrastructure (Terraform)

[terraform/](terraform/) provisions a production-ready footprint:

- VPC across 3 AZs (private + public subnets, single NAT in non-prod)
- EKS cluster (managed node group, sized via `node_size`/`node_min`/`node_max`)
- RDS Postgres 16 (encrypted, 7-day backups, multi-AZ in prod)
- S3 bucket for document store (versioning + SSE + public-access-block)
- ElastiCache Redis (ready for swapping the in-process task queue for RQ)

```bash
cd terraform
terraform init -backend-config="bucket=nbe-dms-tf-state" \
               -backend-config="key=python-service/terraform.tfstate" \
               -backend-config="region=eu-west-1"
terraform apply -var="db_password=$(openssl rand -hex 16)" -var="environment=dev"
```

Outputs feed directly into the Helm install:
```bash
export DATABASE_URL=$(terraform output -raw database_url)
helm upgrade --install dms ../helm/nbe-dms -n nbe-dms --create-namespace \
  --set secrets.DATABASE_URL="$DATABASE_URL"
```

## CI/CD

Two GitHub Actions workflows under [.github/workflows/](../.github/workflows/):

- **ci.yml** — on every PR: Python tests, compileall, Node syntax check, `terraform validate`, `helm lint`.
- **release.yml** — on tags `v*.*.*` or manual dispatch: builds multi-arch image to GHCR,
  assumes an AWS IAM role via OIDC, `aws eks update-kubeconfig`, then `helm upgrade --atomic --wait`.

Required repo secrets: `AWS_DEPLOY_ROLE_ARN`, `AWS_REGION`, `EKS_CLUSTER_NAME`,
`APP_API_KEY`, `APP_JWT_SECRET`, `APP_DATABASE_URL`.

## BI / Power BI

Two ingestion paths for Power BI:

1. **Semantic SQL views** (DirectQuery) — created by `POST /api/v1/bi/views/refresh`:
   - `vw_fact_documents` (with `ocr_confidence`, `is_expiring_30d`, `is_expired` calc columns)
   - `vw_fact_workflow_steps`, `vw_dim_branch`, `vw_dim_doc_type`

2. **Flat files** (Import mode) — nightly ETL `python scripts/etl_run.py` writes
   `fact_documents.csv/.parquet` + `fact_workflow_steps.csv/.parquet` to `storage/etl/`
   (override via `ETL_OUTPUT_DIR`). Point Power BI "Folder" or "SharePoint folder" connector there.

Trigger on demand via `POST /api/v1/bi/etl/run` (requires `admin`).

## SAML 2.0 SSO

Endpoints under `/saml`:

- `GET  /saml/metadata` — SP metadata XML for the IdP
- `GET  /saml/login`    — SP-initiated SSO redirect
- `POST /saml/acs`      — ACS callback; mints an internal JWT and redirects to `/?token=…`

Configure via env (Azure AD / ADFS / Okta / OneLogin compatible):

```
SAML_SP_ENTITY_ID=https://dms.nbe.local/saml/metadata
SAML_SP_ACS_URL=https://dms.nbe.local/saml/acs
SAML_IDP_ENTITY_ID=https://login.microsoftonline.com/<tenant>/
SAML_IDP_SSO_URL=https://login.microsoftonline.com/<tenant>/saml2
SAML_IDP_X509_CERT=MIID...   # PEM body, no headers
SAML_ATTR_USERNAME=http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name
SAML_ATTR_TENANT=tenant
SAML_ATTR_BRANCH=branch
SAML_ATTR_ROLES=http://schemas.microsoft.com/ws/2008/06/identity/claims/role
```

The IdP's attribute statements are mapped to the same `Principal` shape used by the
JWT path, so RBAC/scoping works identically. `python3-saml` requires `xmlsec1` system
binary in the runtime image (already installed in the production Dockerfile if you add
`apt-get install -y libxmlsec1-dev xmlsec1`).

## Redis-backed task queue (RQ)

Set `REDIS_URL=redis://redis:6379/0` and the in-process queue is automatically replaced
by Redis + RQ — no handler changes. Run dedicated worker pods with
[Dockerfile.worker](Dockerfile.worker) and [k8s/worker-deployment.yaml](k8s/worker-deployment.yaml):

```bash
docker build -f Dockerfile.worker -t nbe/dms-python-worker:latest .
kubectl apply -f k8s/worker-deployment.yaml
```

API pods then act as enqueuers only; CPU-heavy OCR runs out-of-band on the worker pool.

## Argo Rollouts (canary deploy)

[k8s/rollout.yaml](k8s/rollout.yaml) defines a Rollout with progressive traffic shifting
(10% → 25% → 50% → 100%) and Prometheus-driven analysis on:

- HTTP success rate (≥ 97%)
- p95 latency (≤ 500 ms)

Auto-rollback fires after 2 failed checks. Requires the Argo Rollouts controller and
nginx ingress controller to be installed in the cluster.

## Mobile capture app

[../mobile/](../mobile/) is an Expo React Native app for branch officers:
camera capture → resize → upload → enqueue OCR. Same JWT auth + RBAC flow as web.
See [mobile/README.md](../mobile/README.md).

## Blockchain anchoring

Tamper-evident log of signed bundles (file + .sig + .sig.json). Two backends selected by env:

- **Local Merkle log** (default) — append-only `storage/anchors/chain.jsonl`, each block links to
  the previous hash. Zero external deps; ideal for private-cloud and demos.
- **EVM chain** — set `ANCHOR_RPC_URL`, `ANCHOR_PRIVATE_KEY`, `ANCHOR_CONTRACT_ADDR`. The service
  calls a minimal `anchor(bytes32)` contract (any OpenZeppelin-style anchor contract works).

```bash
curl -X POST http://localhost:8000/api/v1/anchor/42 -H "Authorization: Bearer $JWT"
curl http://localhost:8000/api/v1/anchor/42/verify -H "Authorization: Bearer $JWT"
```

## Face match (ID vs selfie)

`POST /api/v1/face/{doc_id}/match` with a `selfie` multipart file returns distance,
threshold, and match boolean. Requires optional extras:

```bash
pip install -r requirements-extras.txt
```

On Windows install a dlib wheel (or build tools) before `pip install face_recognition`.
For production scale swap in InsightFace (ArcFace embeddings) or AWS Rekognition — the
router contract stays the same.

## E-form builder (KYC questionnaires)

Define a JSON-schema form once, submit many. Typed fields (`string`, `number`, `date`,
`enum`, `boolean`) with `required`/`min`/`max`/`max_length`/`options` validation.
Submissions can be linked to a `document_id` and `customer_cid` for traceability.

```bash
curl -X POST http://localhost:8000/api/v1/eforms \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"key":"kyc_v1","title":"KYC Questionnaire",
       "schema":{"fields":[
         {"key":"full_name","type":"string","required":true},
         {"key":"dob","type":"date","required":true},
         {"key":"income_egp","type":"number","min":0}
       ]}}'

curl -X POST http://localhost:8000/api/v1/eforms/kyc_v1/submit \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"customer_cid":"EGY-2024-00847291","data":{"full_name":"Ahmed H.","dob":"1986-04-14","income_egp":25000}}'
```

Each upsert automatically bumps the form's `version`.

## SIEM exporter

Every `emit()` event is shipped to the configured SIEM plus written to `storage/audit.jsonl`
(kept locally as a safety net so network errors never lose an event). Backends auto-select
from env:

- **Splunk HEC**: `SIEM_SPLUNK_HEC_URL`, `SIEM_SPLUNK_TOKEN`
- **Elasticsearch**: `SIEM_ELASTIC_URL`, `SIEM_ELASTIC_INDEX`, `SIEM_ELASTIC_API_KEY`
- **Syslog (RFC 5424 UDP)**: `SIEM_SYSLOG_HOST`, `SIEM_SYSLOG_PORT`

Events are ECS-normalized (`@timestamp`, `event.action`, `event.dataset`, `service.name`)
so they drop straight into Elastic SIEM / Splunk ES dashboards. Endpoints:

- `POST /api/v1/siem/ship` — ad-hoc audit event (admin)
- `GET  /api/v1/siem/tail?lines=100` — local audit tail (auditor / admin)

## Fraud scoring

`GET /api/v1/fraud/{doc_id}` returns a 0..100 risk score with per-signal attribution.
Signals: velocity (per CID and per uploader), SHA-256/near-image duplicate, past expiry,
low OCR confidence, missing required KYC fields, and IsolationForest anomaly score over
recent submissions. Scores ≥ 60 (`high`/`critical`) emit a `fraud.alert` event into the
live bus + SIEM so approvers see them in real time.

```bash
curl -H "Authorization: Bearer $JWT" http://localhost:8000/api/v1/fraud/42
```

Requires `scikit-learn` from [requirements-extras.txt](requirements-extras.txt) for the
anomaly component; without it the rule-based score still works.

## Semantic (vector) search

Natural-language search over OCR text. Backend auto-selected from env:

- **pgvector** when `DATABASE_URL` is Postgres (table + HNSW index auto-created)
- **Qdrant** when `QDRANT_URL` is set
- **In-memory** fallback (no config)

Embeddings from `sentence-transformers` (`all-MiniLM-L6-v2`, 384-dim) — falls back to
a deterministic hashing vectorizer so the API still works without the model downloaded.

```bash
curl "http://localhost:8000/api/v1/vector/search?q=expired+passport+Ahmed" \
  -H "Authorization: Bearer $JWT"
curl -X POST http://localhost:8000/api/v1/vector/reindex \
  -H "Authorization: Bearer $JWT"
```

Every OCR completion auto-indexes the document, so under normal operation no manual
reindex is needed.

## Internationalization (Arabic RTL + English)

Toggle via the EN / عربي buttons in the top bar. The app:

- Flips `<html dir>` between `ltr` and `rtl`, swapping sidebar borders and header alignment
- Loads the Cairo font family for Arabic glyph support
- Translates nav labels, KPIs, placeholders, and CTAs via `[data-i18n]` attributes
- Persists the choice in `localStorage`

Add languages by extending [app/static/i18n.js](app/static/i18n.js).

## End-to-end tests (Playwright)

[../e2e/](../e2e/) runs browser + API tests against a live DMS:

```bash
cd e2e
npm install && npx playwright install
E2E_BASE_URL=http://localhost:8000 E2E_API_KEY=dev-key-change-me npm test
```

Projects cover LTR + Arabic RTL on Chromium, Firefox, WebKit, and mobile Pixel 7.
`ci.yml` runs the `chromium-ltr` + `chromium-rtl` projects on every PR and uploads
the HTML report as an artifact.

## DMS Copilot (chat over your documents)

`POST /api/v1/copilot/ask` with `{"question": "..."}` returns a deterministic structured
answer when the query matches patterns like *"expired passports in Cairo West"* or
*"how many KYC docs for EGY-2024-00847291?"*, else falls back to RAG: vector search →
context stitching → LLM call (Anthropic Claude or OpenAI GPT if `ANTHROPIC_API_KEY` /
`OPENAI_API_KEY` is set, else an extractive templated answer). Returns `sources[]` with
document IDs + scores so users can drill into the citation.

```bash
curl -X POST http://localhost:8000/api/v1/copilot/ask \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"question":"expired passports in Cairo West"}'
```

Results are tenant- and branch-scoped automatically — a Giza checker can't see Cairo docs.

## Customer self-service portal

Customers upload & track their own documents without a branch visit:

1. `POST /portal/request-otp  {customer_cid, email}`  → OTP emailed (stubbed to stdout)
2. `POST /portal/verify-otp   {customer_cid, code}`   → opaque token (1h TTL)
3. Use `X-Portal-Token: <token>` on subsequent calls:
   - `GET  /portal/documents` — my submissions
   - `POST /portal/documents` (multipart) — upload a new doc
   - `GET  /portal/status/{doc_id}` — pipeline status

Separate from the staff JWT flow; customer uploads land with `uploaded_by=portal:<email>`
so they're auditable and can be filtered.

## PII / PCI redaction

`app/services/redaction.py` detects Egyptian National IDs, passports, IBANs, Luhn-valid
credit cards, emails, Egyptian mobile numbers, and IPv4 addresses. Endpoints:

- `POST /api/v1/redact/detect`   — return findings only (dry run)
- `POST /api/v1/redact/text`     — mask matches, keep last 4 chars for traceability
- `POST /api/v1/redact/{id}/pdf` — overlay black rectangles on a PDF (pymupdf, preserves layout)

SIEM shipping auto-redacts every event before it leaves the process — so audit logs never
carry raw PII, even if an emit() call accidentally passes one.

## Disaster recovery

- **IaC**: [terraform/dr.tf](terraform/dr.tf) — S3 cross-region replication
  (eu-west-1 → eu-central-1) + RDS cross-region read replica + IAM for replication role.
- **Runbook**: [docs/DR-RUNBOOK.md](docs/DR-RUNBOOK.md) — T+0..T+30 min failover procedure
  with role assignments, RPO/RTO targets (15 min / 30 min), failback steps, and a quarterly
  drill checklist. Each step has a check-box; commanders run the doc live during incidents.

## Accessibility (WCAG 2.2 AA)

The web UI ships with:
- Semantic landmarks (`<header>`, `<nav>`, `<main>` with `role="main"`) + a skip link
- `<button>` (not `<div>`) for interactive nav items, with `aria-current="page"` on the active screen
- `aria-label` on icon-only controls, visible `:focus-visible` rings that meet WCAG 2.2 AA contrast (≥3:1)
- `prefers-reduced-motion` and `prefers-contrast: more` media-query adaptations
- Full LTR ⇄ Arabic RTL support (see i18n section)

A new [e2e/tests/a11y.spec.ts](../e2e/tests/a11y.spec.ts) runs `@axe-core/playwright`
and fails the build on any `serious` / `critical` violation, for both LTR and RTL modes.

## Performance & load testing

- **Connection pool**: [app/db.py](app/db.py) sets `pool_size=10`, `max_overflow=20`,
  `pool_recycle=1800`, `pool_pre_ping=True` for non-SQLite backends. Tunable via
  `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` / `DB_POOL_TIMEOUT` / `DB_POOL_RECYCLE` env vars.
- **Async option**: when `DATABASE_URL` uses `asyncpg` or `aiosqlite`, an async engine
  is auto-initialized alongside the sync one. New endpoints can `Depends(get_async_db)`.
- **N+1 fix**: workflow `/pending` now issues a single SQL `GROUP BY` + join instead of
  a per-document lookup.
- **k6 script**: [loadtest/k6.js](../loadtest/k6.js) mixes read (KPIs + search, ramp 0→50 VUs)
  and write (uploads, constant 5/s) scenarios with SLO thresholds
  (p95 KPI <300ms, p95 search <500ms, p95 upload <800ms, failure rate <1%).
  ```
  k6 run -e BASE_URL=http://localhost:8000 -e API_KEY=dev-key-change-me loadtest/k6.js
  ```

## Retention + legal hold

- Define per `doc_type` retention + action (`purge` or `archive_cold`) via `POST /api/v1/retention/policies`.
- Legal holds on a document immune it from purge until released. `GET /retention/due`,
  `POST /retention/apply?dry_run=true|false`, `POST /retention/holds`,
  `DELETE /retention/holds/{id}`.
- Scheduled purge via [scripts/retention_run.py](scripts/retention_run.py) — dry-run by
  default, pass `--apply` for destructive actions. Every action emits `retention.applied`,
  `legal_hold.placed`, `legal_hold.released` events → SIEM + WebSocket bus.

```bash
curl -X POST http://localhost:8000/api/v1/retention/policies \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"doc_type":"passport","retention_days":3650,"action":"archive_cold"}'
python scripts/retention_run.py --apply
```

## GDPR DSAR (data-subject requests)

- `GET  /api/v1/dsar/export/{customer_cid}` → ZIP with metadata, OCR, workflow trail,
  e-form submissions, portal sessions (PII-redacted), plus all original files.
- `DELETE /api/v1/dsar/erase/{customer_cid}` → right-to-erasure: soft-delete docs,
  null PII, keep audit chain intact. Documents under legal hold are skipped and
  returned in `skipped_legal_hold`.

Soft-delete preserves the CBE 7-year audit obligation; the retention engine picks up
the residual anonymized records once the audit window expires.

## CBE regulatory reports

Three CBE-shaped reports mapped to Circular 15/2022 Annex B field names. Each is available
in JSON or CSV (`?format=csv`):

- `GET /api/v1/cbe/kyc-compliance` — per-branch KYC completeness, expired/expiring counts,
  compliance %, mean time to approve, pending queue sizes
- `GET /api/v1/cbe/document-inventory` — counts by doc_type × status × branch
- `GET /api/v1/cbe/audit-trail?customer_cid=...&doc_type=...&since_days=90` — workflow events
  for a regulator's spot-audit of a specific customer or document type

All gated by `audit_read`. CSV output is upload-ready for the CBE reporting portal.

## WebAuthn / passkeys step-up

High-risk approvals (fraud `high`/`critical`) now require a recent WebAuthn assertion,
enforced in [routers/workflow.py](app/routers/workflow.py). Flow:

1. **Register** a passkey once: `POST /api/v1/stepup/register/start` → browser
   `navigator.credentials.create(…)` → `POST /api/v1/stepup/register/finish`
2. **Step-up** right before approving: `POST /api/v1/stepup/authenticate/start`
   `{action:"approve_document", resource_id:42}` → `navigator.credentials.get(…)`
   → `POST /api/v1/stepup/authenticate/finish`
3. The workflow approve action checks `has_valid_stepup(...)` within a 5-minute window;
   high-risk docs without a fresh assertion get a `403 stepup_required` with the
   fraud band + score for the UI to prompt the user.

Env for production:
```
WEBAUTHN_RP_ID=dms.nbe.local
WEBAUTHN_ORIGIN=https://dms.nbe.local
WEBAUTHN_RP_NAME=NBE DMS
```
Install `webauthn` from [requirements-extras.txt](requirements-extras.txt) for full
FIDO2 attestation/assertion verification; without it a challenge-only fallback runs
(useful for demos, not for production assurance).

## Loan-file summarization

`GET /api/v1/summarize/loan/{customer_cid}` collects every document, OCR extract, and
e-form submission for the customer, passes them to Claude / GPT with a structured
prompt, and returns a 1-page brief (Applicant · Documents · Red flags · Checklist ·
Recommendation) with `[#id]` citations. If neither `ANTHROPIC_API_KEY` nor
`OPENAI_API_KEY` is set, an extractive fallback (TF-IDF-like sentence scoring + expiry /
OCR-confidence rule checks + completeness checklist) runs so the endpoint always works.

## Customer risk dashboard

- `GET /api/v1/customers/{cid}/risk` — per-document scores rolled up to a customer
  band (low/medium/high/critical), plus AML watchlist hits (from `integration_logs`),
  duplicate-finding count, expired-document count, portal usage
- `GET /api/v1/customers/top-risks?limit=20` — portfolio ranking of highest-risk
  customers for the checker queue

Scores are boosted by AML hits (+10 each, capped +30) and duplicate findings (+5 each,
capped +20) on top of the per-document maximum.

## Mobile on-device OCR + offline queue

Branch officers in the field often work offline. The mobile app now:

- Parses **MRZ lines locally** on passports (TD3) and IDs (TD1) via
  [mobile/src/mrz.js](../mobile/src/mrz.js) — ICAO 9303 check-digit validation included.
  Auto-populates Document Number and Expiry Date into the capture form.
- Persists captures to an **offline queue** ([mobile/src/queue.js](../mobile/src/queue.js))
  when the device is offline; flushes automatically the moment NetInfo reports reconnection.
- Shows a live Online / Offline badge and a "Sync N" button for manual flush of the queue.

## Guided tours / training mode

[app/static/tour.js](app/static/tour.js) is a zero-dependency WCAG-aware tour engine.
Auto-runs once per user per screen (localStorage-tracked); a "Guide me" button in the
top bar starts the tour for the current screen on demand. Supports keyboard navigation
(←/→/Enter/Esc) and highlights each target with a dimmed, high-contrast ring.

## Multi-currency + FX (IFRS 9)

- Store rates: `POST /api/v1/fx/rates` `{base, quote, rate}`
- Query: `GET /api/v1/fx/rate?base=USD&quote=EGP&at=2026-04-15`
- Convert: `GET /api/v1/fx/convert?amount=1000&from=USD&to=EGP`
- Pull daily rates from CBS: `POST /api/v1/fx/refresh-from-cbs` (admin)
- Missing direct quote? Service triangulates via USD automatically and falls back to the inverse.

**IFRS 9 ECL** (`GET /api/v1/ifrs9/ecl?reporting_currency=EGP&as_of=...`) aggregates
every `loan_application` e-form submission, normalizes to the reporting currency using the
rate effective at `as_of`, then bucketizes by stage (1/2/3) with default PD×LGD
coefficients. Submissions lacking an FX quote are reported separately in `missing_fx_submission_ids`.

## Active-active multi-region

Each writable region stamps documents with a Lamport vector clock in
`documents.sync_clock`. [services/crdt.py](app/services/crdt.py) provides `stamp()`,
`lamport_compare()`, and `merge()`; the [replication router](app/routers/replication.py)
at `POST /api/v1/replication/apply` accepts mutation events from sibling regions and
resolves scalar fields via last-writer-wins Lamport order, with append-only collections
(workflow steps) merged by id union.

Env:
```
NBE_REGION=eu-west-1        # set per region
```

Terraform in [terraform/multi-region.tf](terraform/multi-region.tf) provisions a second
live EKS cluster in the DR region and adds Route 53 latency-based records so customer
traffic routes to the nearest healthy region. Both regions own writable copies of their
Postgres and document store; replication is bidirectional via the service's own HTTP
endpoint (Webhook-style).

## Document provenance chain

Every lifecycle event (upload, OCR, workflow approve/reject, sign, anchor, replication,
integration call) is appended to `provenance_events` as a hash-chained block:
`hash_self = SHA256(payload + hash_prev)`. Any row edit or delete breaks verification.

- `GET /api/v1/provenance/{id}/events`  — flat timeline with systems, actors, regions, hashes
- `GET /api/v1/provenance/{id}/lineage` — adjacency graph (nodes + edges) for d3/cytoscape
- `GET /api/v1/provenance/{id}/verify`  — recompute all hashes and report tampered events

Audit teams can follow a document from "created in Cairo West branch" through
"indexed by AI" → "approved by checker Sara K." → "PAdES-signed" → "replicated to
eu-central region" → "archived" as one continuous chain.

## Predictive expiry campaigns

[services/expiry_campaign.py](app/services/expiry_campaign.py) fires WhatsApp-first,
SMS-fallback messages at 90 / 60 / 30 / 7 / 0 day buckets before each document expires.
Idempotent: a `WorkflowStep(stage="campaign", action="bucket_N")` row makes each
customer×bucket unique, so re-running the job is safe.

```bash
python scripts/campaign_run.py           # dry-run
python scripts/campaign_run.py --send    # dispatch
curl -X POST http://localhost:8000/api/v1/campaigns/expiry/run?dry_run=false \
  -H "Authorization: Bearer $JWT"
```

English + Arabic templates shipped in the service; `CAMPAIGN_DEFAULT_LANG=ar` flips
the default. Provider env: `WHATSAPP_URL`, `WHATSAPP_TOKEN`, `SMS_URL`, `SMS_TOKEN`.

## Open-banking AISP

PSD2/CMA Open Banking flow for pulling the customer's bank statements with their consent,
so underwriters can see account history without asking them to upload PDFs:

1. `POST /api/v1/aisp/consents` → `authorize_url` to redirect the customer to the ASPSP
2. ASPSP callback hits `GET /api/v1/aisp/callback?state=…&code=…` → token exchange
3. `POST /api/v1/aisp/consents/{id}/fetch` → pulls accounts + balances + transactions
   and stores them as `AisStatement` rows
4. `DELETE /api/v1/aisp/consents/{id}` → revoke

Env: `AISP_AUTH_URL`, `AISP_TOKEN_URL`, `AISP_ACCOUNTS_URL`, `AISP_CLIENT_ID`,
`AISP_CLIENT_SECRET`, `AISP_REDIRECT_URI`. Without these the service returns synthetic
statements so end-to-end flows stay testable without a live ASPSP.

## Arabic OCR + signature extraction

`POST /api/v1/ocr-ar/{doc_id}` runs Tesseract with `ara+eng` language packs (falls back
to English-only if `ara.traineddata` isn't installed; check via `GET /api/v1/ocr-ar/capabilities`).

`POST /api/v1/ocr-ar/{doc_id}/signature` finds the largest ink blob in the lower 40% of
an ID/form page, crops it, alpha-mats it to a PNG beside the original document — useful
for extracting a signature sample to attach to the customer master or push to the sign
service for visual verification.

Install Arabic traineddata on the container: `apt-get install tesseract-ocr-ara`.

## Kafka event stream

Set `KAFKA_BOOTSTRAP=broker-1:9092,broker-2:9092` and every `emit()` call also publishes
to Kafka via [services/kafka_bus.py](app/services/kafka_bus.py):

- Topic pattern: `nbe.dms.<event-prefix>` (e.g. `nbe.dms.document`, `nbe.dms.workflow`,
  `nbe.dms.fraud`); override the prefix with `KAFKA_TOPIC_PREFIX`.
- Key: `document_id` (so per-doc ordering holds).
- Value: ECS-normalized JSON identical to SIEM.
- Idempotence + zstd compression + ack=all by default; silent no-op if
  `confluent-kafka` isn't installed or the broker is unreachable.

Downstream consumers (BI ETL, fraud model trainer, data-lake sink) just subscribe to
`nbe.dms.*` and don't need any coupling to the DMS.

## Differential-privacy analytics

[services/dp.py](app/services/dp.py) exposes Laplace-noise counts, clipped sums, and
histograms under `/api/v1/dp/*`. Each (tenant, query-class) has a nightly ε budget
(default `DP_DAILY_EPSILON=10.0`). Over budget → `HTTP 429`.

```bash
curl "http://localhost:8000/api/v1/dp/count?doc_type=passport&epsilon=1.0" \
  -H "Authorization: Bearer $JWT"
curl "http://localhost:8000/api/v1/dp/histogram-status?epsilon=2.0" -H "..."
curl "http://localhost:8000/api/v1/dp/budget" -H "..."
```

Useful for sharing portfolio-scale metrics with data-science partners without
revealing individual customer records. Budget tracking is in-process; wire to Redis
for multi-replica accounting in production.

## OIDC provider (partner apps)

Turn the DMS into a federated login source for partner systems:

- `GET  /.well-known/openid-configuration` — discovery
- `GET  /oidc/jwks`                        — RS256 public key
- `GET  /oidc/authorize`                    — login + consent page
- `POST /oidc/token`                        — auth-code exchange → `id_token` + `access_token`
- `GET  /oidc/userinfo`                     — claims for the access token
- `POST /oidc/clients` (admin)              — register a partner app, returns `client_id`/`client_secret`

Keypair auto-generates at `storage/keys/oidc.*.pem` on first use. Issuer URL from env
`OIDC_ISSUER`. Authorization code flow with confidential client (client_secret_post /
client_secret_basic). Claims include `tenant`, `branch`, `roles`.

## Adversarial / deepfake document detection

[services/adversarial.py](app/services/adversarial.py) scans uploaded docs for
tampering signals without needing a trained ML model:

- **PDF**: producer-string blacklist (Photoshop, Canva, iLovePDF…),
  post-save incremental updates (multiple `%%EOF`), embedded JavaScript
- **Image**: EXIF software string, JPEG ELA (Error-Level Analysis) standard-deviation
  spike, copy-move detection via 16×16 pHash grid (catches cloned stamps / signatures)

Returns a 0..100 score with the same band shape as fraud (low/medium/high/critical)
plus per-signal attribution. High/critical scores emit `adversarial.alert` events
into the event bus + SIEM + Kafka.

```bash
curl http://localhost:8000/api/v1/adversarial/42 -H "Authorization: Bearer $JWT"
```

## Envelope encryption at rest (per-customer KMS)

[services/encryption.py](app/services/encryption.py) implements the standard
envelope pattern: a per-customer 256-bit Data Encryption Key (DEK) is wrapped by a
Key Encryption Key (KEK) held in a KMS. Only the wrapped DEK is persisted. Files
use AES-256-GCM; every read/write does one KMS unwrap round-trip.

KMS backend auto-selects from env:
- **AWS KMS**: `AWS_KMS_KEY_ID`
- **Azure Key Vault**: `AZURE_KEYVAULT_URL` + `AZURE_KEY_NAME`
- **Local KEK** (dev only): `LOCAL_KEK_HEX` = 64-char hex
- **None**: wrapped DEK is stored raw — labelled `NO-KMS-DEV-ONLY`, loud warning in the DB

Endpoints (admin-only):
- `GET  /api/v1/encryption/backend` — which KMS is active
- `POST /api/v1/encryption/dek {customer_cid}` — provision DEK on first use
- `POST /api/v1/encryption/rotate {customer_cid}` — generate a new DEK (re-encrypt files outside band)
- `POST /api/v1/encryption/documents/{id}/encrypt` / `.../decrypt`

Rotating the KEK is a KMS-side operation — wrapped DEKs stay valid until you
explicitly re-wrap them against the new KEK version.

## Customer graph analytics

[services/graph_analytics.py](app/services/graph_analytics.py) builds a related-party
graph from document metadata + duplicate findings + uploader overlap + OCR token
overlap. Edge weights prioritize high-signal relationships (duplicates = 10,
shared uploader = 6, OCR overlap = 4).

- `GET /api/v1/graph` — full graph (nodes + weighted edges)
- `GET /api/v1/graph/rings?min_weight=6&max_cycle_len=5` — simple cycles (ring-fraud candidates)
- `GET /api/v1/graph/neighbors/{cid}?depth=2` — BFS neighborhood

For portfolios beyond ~100k customers, move this to Neo4j / Amazon Neptune and
replay the same edge semantics — the router contract stays identical.

## Voice biometrics

Branch staff and customers can step up on phone channels:

- `POST /api/v1/voice/enroll` (multipart `sample` = WAV) — adds a sample to the user's centroid
- `POST /api/v1/voice/verify` — returns cosine similarity vs centroid + match boolean

[services/voice.py](app/services/voice.py) uses `librosa` + `soundfile` for MFCC
embeddings when available; falls back to a spectral+ZCR fingerprint (lower accuracy)
in slim containers so the API keeps working. For production banking auth, swap in
Nuance Gatekeeper or Pindrop via the same router contract.

## Zero-knowledge KYC proofs

[services/zkkyc.py](app/services/zkkyc.py) issues selective-disclosure attestations
over boolean claims (`kyc_valid`, `age_over_18`, `resident_egypt`). The bank commits
to the claim (`SHA256(cid || claim || issued_at || nonce)`), signs it with a
persistent Ed25519 issuer key, and returns a portable token.

- `GET  /api/v1/zk/claims` — supported claims
- `POST /api/v1/zk/issue  {customer_cid, claim, ttl_days}` — bank-issues a proof
- `POST /api/v1/zk/verify {proof_token, customer_cid?, nonce?}` — **public** endpoint; third-parties verify without logging in
- `POST /api/v1/zk/revoke {commitment}` — admin revocation

The verifier learns only `{claim, issued_at, expires_at}` — never the customer's
identity or underlying documents. For full BBS+/zk-SNARK, swap `_commit()` + `_sign()`
with the BBS+ equivalents; the API surface stays unchanged.

## Supply chain: SBOM + signing (SLSA L3)

[.github/workflows/supply-chain.yml](../.github/workflows/supply-chain.yml) runs on every
tag and:

- Builds the image with provenance + SBOM attestations enabled
- Generates SPDX + CycloneDX SBOMs via syft
- Signs the image keyless with cosign (GitHub OIDC → Fulcio → Rekor)
- Attaches the SBOMs as signed attestations (`cosign attest --predicate`)
- Scans with grype and fails the release on any High/Critical CVE
- Emits SLSA Level 3 provenance via slsa-github-generator

The cluster enforces signatures at admission time: [k8s/policy.yaml](k8s/policy.yaml)
configures Sigstore `policy-controller` so any DMS image missing a valid signature,
SPDX attestation, or SLSA provenance is rejected by the Kubernetes API server.

## Immutable ledger

[services/ledger.py](app/services/ledger.py) ships every `emit()` event to a
tamper-evident ledger:

- **Local**: hash-chained JSONL at `storage/ledger/journal.jsonl` (always on)
- **AWS QLDB**: set `LEDGER_QLDB_NAME` for a regulator-grade cryptographic journal
- **BigQuery**: set `LEDGER_BQ_TABLE` for an append-only partitioned table

Endpoints (auditor-only):
- `GET /api/v1/ledger/backend` — which export is active
- `GET /api/v1/ledger/verify` — recompute hash chain, report tampered rows
- `GET /api/v1/ledger/tail?lines=100` — recent events

## Runtime threat detection

Three layers:

1. **Falco** rules in [k8s/falco-rules.yaml](k8s/falco-rules.yaml) detect shells
   inside the DMS container, unexpected file writes, privileged syscalls, key-material
   reads from non-Python processes, and outbound connections to non-approved CIDRs.
2. **Kubernetes NetworkPolicy** ([k8s/networkpolicy.yaml](k8s/networkpolicy.yaml)) —
   default-deny everywhere, explicit allow for Postgres / Redis / Elasticsearch /
   Kafka / OTel / ingress-nginx.
3. **In-app WAF** ([services/waf.py](app/services/waf.py)) — SQLi / XSS / path-traversal
   / command-injection / scanner-UA / SSRF regex rules + per-IP rate limiting.
   `WAF_MODE=monitor` (default) logs to SIEM; `WAF_MODE=block` returns 403.

Every WAF trigger fires a `waf.alert` event → SIEM, ledger, and Kafka.

## Carbon-footprint telemetry

[services/carbon.py](app/services/carbon.py) measures per-request CPU time and converts
it to gCO2e via the configured grid intensity:

```
CARBON_REGION=EG CARBON_G_PER_KWH=506 CARBON_CPU_W=25 CARBON_VCPU=2
```

- Per-response `X-Carbon-gCO2e` header for UX debugging
- Prometheus metric `dms_carbon_gco2e_total{tenant,endpoint}` for Grafana
- `GET /api/v1/sustainability/snapshot` — top endpoints by CO2e + per-tenant totals
- `POST /api/v1/sustainability/estimate {cpu_seconds}` — for batch jobs to report themselves

Tie this into sustainability disclosures so the bank can quote an actual number
("each loan application emits ~0.12 gCO2e of digital compute") instead of estimating.

## SRE — SLOs, error budgets, runbooks

- [docs/SLOs.md](docs/SLOs.md) — 6 SLOs (availability 99.9%, p95 latency < 500 ms, ingestion
  success 99.5%, OCR completion 99%, workflow latency ≤ 30 s, replication 99.5%) with
  owner + escalation tables and multi-window multi-burn policy (14.4× / 6×).
- [k8s/prometheus-rules.yaml](k8s/prometheus-rules.yaml) — recording + alert rules that
  compute burn rates from the `dms_*` metrics and page PagerDuty on breach.
- [docs/runbooks/dms-availability.md](docs/runbooks/dms-availability.md) and
  [dms-latency.md](docs/runbooks/dms-latency.md) — on-call runbooks with triage steps,
  common-cause table, low-risk + risky mitigations, and post-incident checklist.

## Chaos engineering

Three LitmusChaos ChaosEngines in [k8s/chaos/](k8s/chaos/):
- `pod-kill.yaml` — 30-minute pod-delete drill with a continuous `/health` HTTP probe
- `network-latency.yaml` — 200 ms latency + 5% loss for 10 minutes
- `db-failover.yaml` — primary Postgres pod deletion to exercise replica promotion

Plus [scripts/chaos_local.py](scripts/chaos_local.py) — a dev-box harness that works with
`docker-compose`: `kill-worker`, `latency-inject`, `integrations-down`, `dep-down`.
Latency injection is implemented via [services/failpoint.py](app/services/failpoint.py)
middleware — only compiled in when `CHAOS_FAILPOINTS=1`, so there is zero prod overhead.

## Visual regression testing

[e2e/tests/visual.spec.ts](../e2e/tests/visual.spec.ts) snapshots every screen in both
LTR and RTL plus the guided-tour overlay. Uses Playwright's `toHaveScreenshot` with
forced fonts, disabled animations, and a 0.2–0.3% mismatch tolerance. Baselines live
in the PR branch; update with `npx playwright test --update-snapshots`.

## Compliance coach

`GET /api/v1/coach/{doc_id}` returns a structured **explain-why-not-approvable** report:

```json
{
  "document_id": 42,
  "approvable": false,
  "blockers": [
    {"rule": "expired", "severity": "block",
     "message": "Document expired on 2024-12-02.",
     "fix": "Ask customer for a renewed copy before approval."}
  ],
  "warnings": [...],
  "advisories": [...],
  "summary": "Document #42 is NOT approvable. Blocking rules: expired. Action plan: …"
}
```

Rules are interpretable — every blocker cites its rule id, so approvers (and auditors)
can trust the output without reading code. An optional LLM paraphrase turns the
rule list into 2–3 sentences of plain language when `ANTHROPIC_API_KEY` or
`OPENAI_API_KEY` is present.

## Customer-journey simulator

[services/journey.py](app/services/journey.py) replays four realistic end-to-end
personas against a live service: `branch_onboarding`, `portal_selfservice`,
`mobile_field_capture`, `partner_oidc`. Each step records latency + status + ok.

```bash
# Run all from CLI
python scripts/journey_run.py
# Run one
python scripts/journey_run.py branch_onboarding
# Or via API (admin)
curl -X POST http://localhost:8000/api/v1/journey/run-all \
  -H "Authorization: Bearer $JWT"
```

Useful for smoke-testing a deployment, demo narration, and catching cross-feature
regressions (e.g. "did changing auth break the portal?"). Combine with the
Playwright suite for full coverage.

## Grafana Live dashboards

The WS event bus is also exposed as SSE at `/api/v1/live/events` so Grafana Live
data sources can subscribe directly:

```
GET /api/v1/live/events?api_key=dev-key-change-me
```

Drop [grafana/live-dashboard.json](grafana/live-dashboard.json) into Grafana for a
realtime operations view (document uploads, workflow rates, fraud alerts, WAF
blocks). `/api/v1/live/sample` is a demo stream that emits a tick per second — use
it to verify the pipeline before wiring real events.

## Per-feature usage analytics

A new `UsageMiddleware` classifies every request into a feature id and batches rows
into `usage_events`. Endpoints:

- `GET /api/v1/usage/top-features?days=7` — ordered by hits with unique-user counts
- `GET /api/v1/usage/adoption?feature=workflow.actions&days=30` — per-branch breakdown
- `GET /api/v1/usage/cohort?feature=coach.view&days=14` — daily unique users

Product teams can answer "which branches still haven't used the compliance coach?"
or "did adoption dip after the last release?" without custom instrumentation.

## Content moderation

[services/moderation.py](app/services/moderation.py) flags uploads that shouldn't
be archived: hate speech, violence, sexual content, drugs, self-harm cues,
sanctions-related terms, multi-ID-on-one-page leaks, and leaked credentials
(AWS secrets / PEM keys / api-key strings).

- `POST /api/v1/moderation/text {text}` — classify free text (`block` / `warn` / `clean`)
- `GET  /api/v1/moderation/{doc_id}` — classify a document using its OCR output

Optional image moderation calls an upstream service (AWS Rekognition / Azure
Content Safety) when `MODERATION_API_URL` + `MODERATION_API_KEY` are set.
`block`-band documents auto-emit a `moderation.flag` event to the bus + SIEM + ledger.

## Autonomous remediation agent

[services/remediation.py](app/services/remediation.py) subscribes to the event bus
on startup and takes **safe, bounded** actions:

- `fraud.alert` / `adversarial.alert` (critical) → quarantine document + open ticket
- `moderation.flag` (block band) → quarantine + ticket
- `waf.alert` burst (>50 / 5 min) → flip WAF from `monitor` to `block` + ticket
- `task.failed` burst (>20 / 10 min) → ticket only (no autoscale)

Tickets are appended to `storage/tickets/ticket.jsonl` — swap the `open_ticket()`
function for a Jira/ServiceNow REST call in production. Every autonomous action
emits `remediation.applied` so audit trails stay reconstructible.

- `GET /api/v1/remediation/tickets?limit=50`
- `GET /api/v1/remediation/waf-mode` (reflects sentinel file written by the agent)

## Air-gap installer bundle

[scripts/build_airgap.sh](scripts/build_airgap.sh) produces a single `.tar.zst`
containing everything an air-gapped NBE branch needs: docker-saved images, Python
wheels, Helm chart, k8s manifests, SPDX SBOMs, install/verify/uninstall scripts,
and SHA-256 checksums. Full runbook in [docs/AIRGAP.md](docs/AIRGAP.md).

```bash
bash scripts/build_airgap.sh 1.0.0
# ship nbe-dms-airgap-1.0.0.tar.zst on two independent USBs
```

## FIDO2 passwordless login (portal)

Customers register a passkey once, then log in to the portal without OTP or
password. The FIDO2 assertion mints a portal session token identical to the OTP
flow, so all portal endpoints keep working.

- `POST /api/v1/passkeys/register/start  {customer_cid}`
- `POST /api/v1/passkeys/register/finish {customer_cid, credential, friendly_name?}`
- `POST /api/v1/passkeys/login/start     {customer_cid}`
- `POST /api/v1/passkeys/login/finish    {customer_cid, credential}` → `{portal_token}`

Uses the same `webauthn` library as the staff step-up flow. Keys are stored per
`customer_cid` with a stable `user_handle` so authenticator-initiated discovery
works on new devices.

## Federated learning

[services/federated.py](app/services/federated.py) trains a per-branch logistic
regression on the fraud signals (no documents leave the branch) and returns
`{n_samples, weights}`. The central coordinator calls `fedavg()` to combine
all branch updates weighted by sample count, and persists the global model to
`storage/models/fraud_global.json`.

```
Branches:    POST /api/v1/federated/local-train   → {n_samples, weights}
Coordinator: POST /api/v1/federated/aggregate     {round, updates[]}
             → averages + saves global model
All:         GET  /api/v1/federated/predict/{id}  → {fraud_prob}
```

Set `FL_DP_EPSILON>0` to add Laplace noise to each branch's outgoing weights for
differential privacy. Run a fresh round nightly via cron for model freshness.

## Regulatory watchlist sync (OFAC / UN / EU PEPs)

- `POST /api/v1/watchlist/sync` — fetch latest OFAC SDN + UN consolidated (and
  EU feed if `WATCHLIST_EU_URL` is set), replace rows, emit `watchlist.synced`.
  Loads `storage/watchlist/seed.tsv` on top for local/manual entries.
- `POST /api/v1/watchlist/rematch?threshold=88` — fuzzy-scan every customer via
  rapidfuzz token-set ratio; new matches become `WatchlistMatch` rows and
  emit `aml.alert` events (bus + SIEM + ledger + remediation).
- `GET  /api/v1/watchlist/matches?status=open` — review queue
- `POST /api/v1/watchlist/matches/{id}/review {action}` — clear or escalate

Ship the seed TSV with the quarterly air-gap bundle so offline sites stay in sync.

## Loan-covenant extraction

[services/covenants.py](app/services/covenants.py) pattern-extracts 5 covenant
kinds from contract OCR: `financial`, `affirmative`, `negative`, `reporting`,
`event_of_default`. Each row has a normalized `metric`, `operator`, `threshold`,
`currency`, and confidence. Optional LLM refinement (`ANTHROPIC_API_KEY` /
`OPENAI_API_KEY`) fills in ambiguous thresholds.

- `POST /api/v1/covenants/{doc_id}/extract` — extract + persist
- `GET  /api/v1/covenants/{doc_id}` — list extracted covenants

## In-browser document classification (ONNX)

[static/doc_classifier.js](app/static/doc_classifier.js) loads an ONNX model
at `/static/models/doc_type.onnx` via ONNX Runtime Web. Wired into Quick Upload
in the top bar — files are classified client-side before hitting the API, so
the server already knows the `doc_type` on arrival (no round-trip to OCR).
Falls back to a filename heuristic when the model file isn't deployed.

Train + export:
```bash
pip install torch torchvision
python scripts/train_doc_classifier.py --data data --out app/static/models/doc_type.onnx
```

Swap the TinyCNN with a fine-tuned EfficientNet-lite for production accuracy;
the JS loader needs no changes.

## Multi-cloud portability CI

[.github/workflows/multicloud.yml](../.github/workflows/multicloud.yml) runs a
matrix across EKS, AKS, GKE, and kind every Sunday (or on manual dispatch):

- Helm lint + template render for each target
- `kubectl apply --dry-run=client` validation
- Full install + smoke test on kind (baseline that always runs, even on PRs
  without cloud secrets)

Gives early warning when a future change accidentally introduces a cloud-specific
annotation or CRD dependency. Configure per-cloud secrets (`AWS_DEPLOY_ROLE_ARN`,
`AZURE_CREDENTIALS`, `GCP_SERVICE_ACCOUNT_JSON`) to activate that cloud's leg.

## Data lineage (OpenLineage export)

[services/lineage.py](app/services/lineage.py) statically scans
[app/models.py](app/models.py) and every router/service to produce a map of
which fields flow where. Useful for GDPR Art. 30 records-of-processing and CBE
audits ("where does `customer_cid` live? who reads it?").

- `GET /api/v1/lineage` — JSON table graph + per-field read/write references
- `GET /api/v1/lineage?format=openlineage` — OpenLineage 1.x JSON for Marquez/DataHub
- `GET /api/v1/lineage/field/{name}` — narrow query for a single field

Uses the AST, not runtime hooks — zero overhead.

## Per-tenant key isolation

When the stack is multi-tenant (NBE + sister banks), each tenant gets a **distinct
KEK** so compromise of one tenant's data can't affect another.

Config:
```
TENANT_KEK_MAP='{"nbe":"arn:aws:kms:eu-west-1:...:key/nbe","audi":"arn:...audi"}'
TENANT_LOCAL_KEKS='{"nbe":"<64-hex>","audi":"<64-hex>"}'
```

Endpoints (admin):
- `GET  /api/v1/tenant-keys` — registered tenants + resolved backend
- `POST /api/v1/tenant-keys/provision {customer_cid}` — mint & wrap with my-tenant KEK
- `POST /api/v1/tenant-keys/rotate` — re-wrap all my-tenant DEKs under new KEK version
- `POST /api/v1/tenant-keys/dek/{customer_cid}` — unwrap-length probe (never returns key material)

Falls back to the bank-wide KEK when no per-tenant mapping is set.

## WCAG 2.2 AAA compliance mode (opt-in)

Users can toggle a stricter accessibility mode via the `AAA` button in the top
bar (or `window.NBE_A11Y.toggle()`). Enables:

- Contrast ratios ≥ 7:1 for body text, ≥ 4.5:1 for large text
- Hit targets ≥ 44×44 px (POUR 2.5.5)
- Animations fully disabled, captions for status changes via `aria-live`
- Line-height 1.6, paragraphs capped at 72ch
- Heavier focus ring (3 px + 6 px halo)
- Auto-enables if the OS requests `prefers-contrast: more`

Axe verification in [e2e/tests/a11y-aaa.spec.ts](../e2e/tests/a11y-aaa.spec.ts).

## CBE Regulatory Sandbox submission

[docs/REG-SANDBOX.md](docs/REG-SANDBOX.md) — the full application pack with:

- 1-page cover brief + cohort risk envelope
- Mapping table: each CBE Reg-22/2022 control → artifact in this repo
- Exit criteria (SLO ≥ 99.5%, 0 critical findings, successful DR drill, DSAR ≤ 30d)
- Regulator read-only OIDC client recipe

[scripts/regsandbox_checklist.py](scripts/regsandbox_checklist.py) probes a live
DMS against 15 mandatory controls and emits a JSON self-attestation report:

```bash
BASE=http://127.0.0.1:9002 API_KEY=dev-key-change-me python scripts/regsandbox_checklist.py
```

Commit the JSON report alongside the sandbox application.

## ABAC via Open Policy Agent

Instead of baking access checks into route code, decisions go through OPA:

- Policy: [opa/policies/dms.rego](../opa/policies/dms.rego) — considers subject
  roles + tenant + branch, resource risk band, context time-of-day, step-up
  freshness. Returns `{allow, reason}`.
- k8s sidecar: [k8s/opa.yaml](k8s/opa.yaml) — OPA 0.66 with policy mounted
  from a ConfigMap, 2 replicas, probed via `/health`.
- Service client: [services/abac.py](app/services/abac.py) calls OPA at
  `OPA_URL` with 250 ms timeout; falls back to the RBAC matrix if OPA is
  unreachable so the app never breaks.
- Endpoints: `POST /api/v1/abac/check`, `GET /api/v1/abac/policy-test`.

Policies can be updated without a service rebuild — just edit the ConfigMap.

## Multi-modal stamp search

Find every document that bears a given stamp by uploading a cropped photo of it.

- **Ingest**: `POST /api/v1/stamps/ingest/{doc_id}` — detects up to 5 inked
  regions per image (HSV mask + connected components), stores pHash + avg
  color + bbox in `stamp_fingerprints`.
- **Query**: `POST /api/v1/stamps/search` (multipart `query` = image) — returns
  top-k documents ranked by Hamming distance on the pHash.

Zero ML dependency; for rotated/handwritten stamps swap the fingerprinter with
a small CLIP image encoder (contract stays the same).

## Continuous-compliance scorecard

`POST /api/v1/compliance/run` evaluates 6 controls mapped to CBE Reg 22/2022,
PCI-DSS 4.0, ISO-27001 Annex A, and GDPR. Each control returns `pass|warn|fail`
with concrete evidence; rows are persisted in `compliance_scores` so the
posture trend is graphable.

- CBE-22.KYC-01 — no active expired KYC docs in open workflow
- CBE-22.AML-05 — AML matches reviewed within 5 business days
- PCI-3.4 — PAN detection / masking wired
- ISO A.5.1 — signed-image admission policy present
- ISO A.8.2 — 100% of documents have a doc_type
- GDPR-30 — records-of-processing (lineage) generable

`GET /api/v1/compliance/latest?days=7` for the dashboard tile.

## AI workflow designer

Type a sentence, get a validated workflow spec:

```bash
curl -X POST http://localhost:8000/api/v1/workflow-designer/compile \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"prompt":"KYC with dual sign-off, fraud scoring, anchor before archive", "save": true}'
```

Deterministic rule-based compiler ships out of the box; optional LLM refinement
(`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) cleans up edge cases. Every output goes
through a JSON-schema validator before it's trusted. `GET /api/v1/workflow-designer`
lists saved designs.

## Natural-language retention rules

Type an English rule, get a structured retention or legal-hold config:

```bash
curl -X POST http://localhost:8000/api/v1/retention-nl/compile \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"text":"Archive passports after 5 years", "apply": true}'
# → {kind:"retention_policy", doc_type:"passport", retention_days:1825, action:"archive_cold", applied_policy_id:42}

curl -X POST http://localhost:8000/api/v1/retention-nl/compile \
  -H "..." -d '{"text":"Place legal hold on case #litigation-2024", "document_id": 100, "apply": true}'
```

Deterministic rule compiler (pattern-based) with optional LLM refinement.
`apply=true` upserts the policy via the existing retention service — no new
data model, just an English layer.

## Conversational assistant pane

[static/assistant.js](app/static/assistant.js) injects a floating chat into
the UI. Subscribes to the existing `/api/v1/copilot/ask` endpoint so it works
with the same RAG + LLM pipeline, shows cited document IDs, and keeps the
last 40 turns in localStorage. Keyboard-accessible, RTL-aware, and respects
the AAA mode toggle.

## Synthetic Egyptian test data

[services/test_data.py](app/services/test_data.py) generates realistic Arabic
+ English transliterated names, EG-format CIDs + 14-digit national IDs,
plausible DOB/issue/expiry dates, and Document rows. All tagged
`uploaded_by='synthetic'` for one-query purge.

```bash
python scripts/seed_synthetic.py --customers 200 --docs 3
# or via API
curl -X POST "http://localhost:8000/api/v1/test-data/generate?n_customers=50" \
  -H "X-API-Key: dev-key-change-me"
curl -X DELETE http://localhost:8000/api/v1/test-data/purge -H "X-API-Key: ..."
```

## Transparency log (hourly Merkle roots)

[services/transparency.py](app/services/transparency.py) computes a SHA-256
Merkle tree over the previous hour of ledger entries and commits the root to
`storage/transparency/roots.jsonl`. Optional push to a public transparency
service via `TRANSPARENCY_PUSH_URL`.

```
0 * * * *  python scripts/publish_transparency_root.py
```

Endpoints:
- `POST /api/v1/transparency/publish` (admin) — publish the previous hour
- `GET  /api/v1/transparency/roots?limit=24` (auditor) — last 24 roots
- `POST /api/v1/transparency/verify {window_start}` — **public** endpoint;
  any third party can recompute the hour's root locally and prove the
  service hasn't altered history.

## Observability-as-code

Unified OTel pipeline ships traces to Tempo, metrics to Prometheus (remote-write),
logs to Loki — one collector config, one topology.

- [observability/otel-collector.yaml](observability/otel-collector.yaml) —
  OTLP receiver, filelog tail, Prometheus self-scrape; `attributes/pii` processor
  scrubs `customer_cid` / `email` / `passport_no` before export; tail-based
  sampling keeps all errors + p95 slow traces + 1% baseline.
- [observability/loki-config.yaml](observability/loki-config.yaml) — 31-day hot
  retention, TSDB store, sensible ingest limits.
- [observability/loki-alerts.yaml](observability/loki-alerts.yaml) — log-based
  alert rules: error bursts, auth-failure spikes, WAF block storms,
  **possible PII leak in logs** (critical).

## Continuous red-team agent

[services/redteam.py](app/services/redteam.py) autonomously runs 10 non-destructive
attacks against the service's own public endpoints and returns a scorecard:
SQLi/XSS/traversal WAF probes, forged-JWT auth, scanner UA, OIDC unregistered
redirect, tampered signature verify, rate-limit probe.

```bash
curl -X POST http://localhost:8000/api/v1/redteam/run \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{}'
python scripts/redteam_run.py   # CLI, non-zero exit on failure → wire into CI
```

Regression paging: the runbook auto-files a ticket when `verdict != "pass"`.

## Semantic document diffing

`GET /api/v1/diff/{a}/{b}` compares two document versions across four layers:
extracted fields (added/removed/changed), named entities (money amounts,
dates, percentages, national IDs), sentences (rapidfuzz-matched with an
edit changelog), and loan covenants (what new obligations appeared or
loosened). Byte-level noise is filtered; what a checker sees is what actually
changed in meaning.

## Board-level executive PDF

[services/exec_report.py](app/services/exec_report.py) renders a 1-pager with
the quarter's KPIs, compliance posture bar chart (per framework), open AML
queue, and top-5 features by adoption. Uses `reportlab` when installed, falls
back to Pillow's PDF export so the feature works with only base deps.

- `POST /api/v1/reports/exec/build` — render + persist to `storage/reports/`
- `GET  /api/v1/reports/exec/download` — stream latest as PDF

Schedule monthly via cron; distribute to the board via the existing OIDC
"Supervisor" client for single-click access.

## Blast-radius calculator

`GET /api/v1/blast-radius/{doc_id}` — answers *"if this document is compromised
or voided, what downstream operations break?"* Traverses peer KYC docs,
workflow trail, loan covenants, e-form submissions, legal holds, duplicates,
AML/watchlist matches, signatures, and anchor entries. Returns a 0..100
severity band plus a remediation playbook (re-issue PAdES, republish
transparency revocation, notify legal, recheck covenants, rescan peers).

## Auto-generated STRIDE threat model

[services/stride.py](app/services/stride.py) statically scans every router, maps
each endpoint to a STRIDE category + mitigation citation, and re-renders the
threat model on every release.

- `GET /api/v1/threat-model` — JSON (endpoint × threat × evidence matrix)
- `GET /api/v1/threat-model/markdown` — Markdown table for docs/THREAT-MODEL.md
- CLI: `python scripts/generate_threat_model.py > docs/THREAT-MODEL.md`

So drift between "what the policy promises" and "what the routes actually
expose" becomes impossible — the model rebuilds from code, not a wiki.

## Browser e-signature drawing pad

[static/sigpad.js](app/static/sigpad.js) — smoothed-Bézier, pressure-aware ink
pad with SVG + PNG export, "Type instead" fallback for accessibility, and
keyboard + Escape dismiss. Posts to a new endpoint [sigink.py](app/services/sigink.py)
that:

1. Saves the PNG beside the source file as `<doc>.inksig.png`.
2. Computes SHA-256 over (png + svg) → tamper-evident ink hash.
3. Calls the existing `sign_detached()` for cryptographic coverage.
4. For PDFs, overlays the ink onto the last page via pypdf → `.inksigned.pdf`.

Wired as `POST /api/v1/signatures/{id}/ink`. Workflow step `ink_signed` lands
in the provenance chain automatically.

Open from anywhere in the UI:
```js
window.NBE_SigPad.openSigPad({ documentId: 42, onDone: console.log });
```

## Multi-language OCR router

[services/lang_router.py](app/services/lang_router.py) — runs a cheap first
pass, counts Unicode-script signals (Arabic block, Latin diacritics, French
accents), and picks the right Tesseract lang pack (`ara`, `eng`, `fra+eng`,
`ara+eng`). Falls back to an upstream OCR service (AWS Textract / Azure
Document Intelligence) when `OCR_UPSTREAM_URL` is set and the document is
Arabic-heavy (better recall on Arabic handwriting).

- `POST /api/v1/ocr-route/{doc_id}` — returns `{detected_languages,
  detection_confidence, engine_used, text, confidence}` so the UI can show
  both the OCR and why *that* engine was picked.

## Running tests

```bash
pytest
```
