# ZorDMS — Microservices Architecture Design

**Date:** 2026-06-23
**Status:** Approved (design phase)
**Context:** Greenfield monorepo for a bank-grade Document Management System (ZorDMS),
built to satisfy the **Bank of Bhutan DMS tender** (Tender No. 000/BoB/Tender/2026/009),
grounded in the existing HTML prototypes and the prior Node/Express + Python/FastAPI codebases.

---

## 1. Goals & Constraints

### Product goal
Deliver a microservices-based, web-based, highly available DMS that meets **all 29 items**
of the tender's Technical Specification (must score ≥ 85% to be responsive) and reaches
**full Enterprise v4.2 prototype parity** (all 19 screens).

### Hard constraints (from tender + user decisions)
- **Microservices-based**, fully web-based (all standard browsers), no client install (tender items 1–2).
- **Unicode / multi-language** content support (tender item 3).
- **No software licensing model.** There are NO per-seat or tier licenses. Access is governed
  **entirely by RBAC**. Bank supervisors provision an **unlimited number of users**.
  Scalability (tender item 4) is delivered as an infrastructure property (horizontal scaling),
  not as a license tier.
- **RBAC is the backbone** of the whole system — global-top-bank-grade. It is the single
  source of authority for the UI, every API, and the **workflow engine** (approval authority,
  step-up, escalation all derive from RBAC).
- **All services must be fully functional** — no mocks or stubs. Real auth, real OCR/AI,
  real notifications (email/SMS/WhatsApp), real signing, real search, real integrations.
- **Database: PostgreSQL ⇄ Oracle 19c (Enterprise)**, switchable via environment variables.
- **Frontend: full React** (Vite + React + TypeScript). No server-rendered Python/EJS UI.
- **Login UX:** split-screen — left half a blue dotted-pattern panel with a rotating
  **carousel** (feature slides + dot indicators), right half the sign-in form (see §3a).
- **Backend: Node/Express** for business services; **Python/FastAPI** retained only for AI/OCR/ML.
- **Granularity: hybrid** — a small number of coarse services, not fine-grained microservices.
- **Deployment: both on-premises and cloud/hybrid** (tender Price Schedule has both lines).
- **Codebase: fresh monorepo**, porting proven logic from the existing code.

### Non-goals
- Re-using the prototype HTML/EJS as production UI (prototypes define scope only).
- Reimplementing OCR/ML in Node (Python is the right tool; kept as one service).

---

## 2. Source Material Summary

### Prototypes
- `zordms.html` (== `zordms-1.html`): **Base**, 11 screens (MVP surface).
- `ZorDMS-v4.2-Enterprise.html` (== `…-1.html`): **Enterprise v4.2**, 19 screens — the
  **authoritative feature scope**. Adds Branch Network, Customer 360°, Case Management,
  Records Management, Document Lifecycle, Compliance & Audit, System Administration.
- All prototypes are pure UI mockups (no real logic, persistence, or APIs).

### Existing Node/Express backend (working DMS core to port)
Documents/capture/indexing/viewer, folders, versioning, FTS5 search, maker-checker
workflows + templates, RBAC (4 roles), TOTP MFA, SAML (env-gated), audit log, alerts,
REST + GraphQL APIs, inbound webhooks (CBS/LOS/KYC), WebSocket realtime, CSV/XLSX
export/import, BI drill-down, customer portal, cron jobs (expiry + retention).
Limitation: SQLite + synchronous `better-sqlite3` (replaced by the new async data layer).

### Existing Python/FastAPI service (AI/crypto/compliance to slim & reuse)
~70 routers. AI/OCR-native capabilities: Tesseract OCR (Arabic+English), MRZ extraction,
semantic vector search, fraud/face/voice, PAdES signing, envelope encryption/KMS,
CBE reports, retention, AML watchlist, Kafka/SIEM, OIDC/SAML. Already Postgres/Oracle-capable
via SQLAlchemy `DATABASE_URL`.

---

## 3. System Topology

7 deployable units: **1 React app + 5 Node services + 1 Python AI service**
(Gateway is a separate service per decision).

```
React SPA (apps/web)  ──HTTPS/REST+WS──►  GATEWAY / IDENTITY (Node)
                                              │ routes & aggregates
        ┌───────────────┬───────────────┬────┴──────────┬─────────────────┐
   CORE DMS (Node)   WORKFLOW &     NOTIFICATION &     SEARCH (Node)   INTEGRATION HUB
   docs, repository, CASES (Node)   ALERTS (Node)      ES (Phase 2)/   (Node)
   capture, index,   maker-checker, email/SMS/         PG-FTS (P1)     CBS/LOS/KYC/ERP/
   versions, viewer, BPMN, SLA,     WhatsApp/Teams/                    CRM/CC, mBoB/goBoB,
   records/holds,    escalation,    in-app, realtime                   webhooks, API mgmt
   customer360,      templates      WS/SSE
   branch, reports        │              │                │                  │
        └───────────────────────── EVENT BUS (Redis Streams; Kafka opt.) ───┘
                              │
                  AI / OCR (Python FastAPI)
                  Tesseract OCR, CID/Passport classification,
                  Name/DOB/DocNo/Expiry + MRZ extraction,
                  expiry detection, vector/fraud (optional)

  Shared infra: DB = PostgreSQL ⇄ Oracle 19c (env switch) · Redis (cache/queue) ·
                Object store (MinIO on-prem / S3 cloud) · Elasticsearch (Phase 2)
```

---

## 3a. Login & Authentication UX

Split-screen layout, served by `apps/web` (route `/login`), authenticated by the
Gateway/Identity service.

```
┌────────────────────────────────┬───────────────────────────────┐
│  LEFT (≈50%)                    │  RIGHT (≈50%)                  │
│  Deep-blue panel, subtle        │  White panel, centered card:   │
│  dotted texture + soft glow     │   • shield icon                │
│                                 │   • "Sign in"                  │
│  Brand lockup (top-left):       │   • subtitle: "Document        │
│   ▢ ZorDMS                      │     operations for authorised  │
│     Enterprise Document Mgmt    │     staff only"                │
│                                 │   • Username field             │
│  CAROUSEL (bottom-left):        │   • Password field             │
│   ▢ icon                        │   • Sign in button (primary)   │
│   Big headline (rotates)        │   • (no self-signup link —     │
│   1–2 line subcopy (rotates)    │     supervisors create users)  │
│   ●  ○  ○  ○   ← dot indicators │                                │
└────────────────────────────────┴───────────────────────────────┘
```

**Carousel slides** (auto-rotate, manual via dots; one per core capability):
1. **Capture, classify, index.** — "Multi-channel capture from branch scanners, mobile,
   email, and portal — OCR and AI classification in one pipeline."
2. **Maker–checker workflows.** — "Configurable approval chains with full audit, escalation,
   and step-up authentication for high-risk documents."
3. **Enterprise search across branches.** — "Full-text across OCR, metadata, and customer
   records — results scoped by branch, role, and risk band."
4. (extensible — e.g. Records & legal holds, Compliance & audit.)

Each slide has a leading icon, a bold headline, supporting copy, and the dot indicator
row reflects the active slide. Theme reuses the navy + gold design system (`packages/ui`).
**No public sign-up** — accounts exist only because a supervisor created them (see §3b).

---

## 3b. Identity, RBAC & User Provisioning (the backbone)

RBAC is the architectural backbone. There is **no licensing layer** gating users; the only
gate is RBAC.

- **Unlimited, supervisor-provisioned users.** A **Supervisor/Admin** role can create any
  number of users, assign roles, set branch scope, activate/lock, reset credentials, and
  enrol MFA. No seat counting, no license keys.
- **Role model (global-bank grade):** CDO/Admin, Supervisor, Maker, Checker, Indexer,
  Viewer, Auditor (extensible). Roles are data-driven, not hardcoded, so the bank can define
  additional roles without code changes.
- **Permission model:** fine-grained `permission` = `resource:action` (e.g.
  `document:approve`, `legal_hold:place`, `user:create`, `crossbranch:read`). Roles are sets
  of permissions; users get roles; effective permissions = union of role permissions, scoped
  by branch/region. Enforced at three layers: UI (hide/disable), Gateway (route guard), and
  each service (resource check).
- **Single source of authority.** The same RBAC decisions drive the **workflow engine**:
  who may submit (maker), who may approve/reject (checker), approval thresholds, step-up
  requirements, and escalation targets are all resolved from RBAC roles/permissions — not a
  parallel ACL. A workflow step references required permissions; the engine asks the RBAC
  service whether the actor qualifies.
- **Auditability.** Every privileged action (user create/modify, role change, approval,
  override) is written to the tamper-evident audit log with actor, role, branch, timestamp.
- **Fully functional.** Real password hashing (bcrypt/argon2), real TOTP MFA, real SSO/SAML,
  real session+JWT issuance — no stubbed auth.

---

## 4. Service Catalog

| # | Service | Stack | Responsibilities (domains / prototype screens) |
|---|---------|-------|-----------------------------------------------|
| 1 | **Gateway / Identity** | Node/Express | AuthN (session + JWT), **RBAC engine (data-driven roles + `resource:action` permissions) — the system backbone**, **supervisor-managed unlimited user provisioning** (create/role/branch/lock/reset, no licensing), MFA (TOTP), SSO (SAML2 / AD), API keys, rate-limiting, request routing/aggregation (BFF), centralized tamper-evident audit log, **authority resolution for the workflow engine**. → *Security & Access Control, login*. |
| 2 | **Core DMS** | Node/Express | Documents, folders/repository, multi-channel capture orchestration, indexing/metadata + QA, versioning + rollback, viewer data (annotations/redaction/stamps), **Records Mgmt** (retention/legal-hold/disposal), **Customer 360**, **Branch Network**, **Document Lifecycle**, **Reports/BI/dashboards**, exports. → *Dashboard, Capture, Indexing, Repository, Viewer, Records, Customer360, Branch, Lifecycle, Reports, Admin*. |
| 3 | **Workflow & Cases** | Node/Express | Maker-checker, BPMN-style builder, confidence gates (≥90%), SLA countdown & escalation, **Case Management** (KYC/Loan/Account/AML), workflow templates. → *Workflow Engine, Case Management*. |
| 4 | **Notification & Alerts** | Node/Express | Alert-rule engine, multi-channel dispatch (Email/SMS/WhatsApp/Teams/in-app), escalation routing to named roles, expiry campaigns, realtime WebSocket/SSE. → *Alerts & Event Management*. |
| 5 | **Search** | Node + Elasticsearch | Full-text OCR, boolean/wildcard/fuzzy/semantic, faceted filters, saved searches, relevance scoring. **Phase 1: PostgreSQL FTS; Phase 2: Elasticsearch.** → *Enterprise Search*. |
| 6 | **Integration Hub** | Node/Express | Connectors: CBS (TCS BaNCS/GBP, Temenos), LOS, KYC, ERP, CRM, Contact Center, mBoB/goBoB/Internet Banking; inbound/outbound webhooks (HMAC), API request logs & status. → *Integration Hub*. |
| 7 | **AI / OCR** | Python/FastAPI | OCR (Tesseract), CID/Passport auto-classification, Name/DOB/DocNo/Expiry extraction + MRZ, expiry detection at scan time, confidence scoring, vector & fraud (optional). Slimmed from existing service. → *AI Engine*. |

Each service is independently deployable, owns its schema namespace, communicates
synchronously via the gateway/REST and asynchronously via the event bus, and can be
understood/tested in isolation.

---

## 5. Data Layer — PostgreSQL ⇄ Oracle 19c

### Node services
- Single shared `packages/db` built on **Knex.js**.
- `client` chosen by env: `DB_CLIENT = pg | oracledb`.
- Schema via Knex schema-builder only (no raw SQLite-isms). `increments()` →
  `SERIAL`/identity on PG and **IDENTITY columns** on Oracle 19c (12c+ feature).
- Connection from env (`DB_HOST/PORT/USER/PASSWORD/NAME`, or service name for Oracle).
- Oracle 19c **thin mode** by default (no Instant Client required); thick mode optional.
- This async data layer also resolves the prior synchronous-driver limitation.

### Python AI service
- SQLAlchemy `DATABASE_URL`:
  - PostgreSQL: `postgresql+psycopg://…`
  - Oracle 19c: `oracle+oracledb://…` (add `oracledb` dependency).

### One switch for the whole stack
A single environment profile flips both layers:
- Node: `DB_CLIENT` + `DB_*`
- Python: `DATABASE_URL`

### Migrations
- Node: Knex migrations. Python: Alembic.
- CI runs both migration suites against **PostgreSQL and Oracle (XE/19c)** to guarantee
  dialect compatibility.

---

## 6. Cross-Cutting Concerns

- **Object storage:** S3-compatible — **MinIO** on-prem, **AWS S3** in cloud. Content-addressed
  (SHA-256), AES-256 at rest.
- **Event bus:** Redis Streams by default (`document.captured`, `workflow.approved`,
  `alert.raised`, `document.expiring`, …); Kafka as an enterprise drop-in.
- **Realtime:** WebSocket/SSE owned by Notification service; gateway proxies `/ws`.
- **Auth / RBAC:** shared `packages/auth`; 6 roles (CDO/Admin, Maker, Checker, Indexer,
  Viewer, Auditor) × module permission matrix (Capture, Indexing, Approve/Reject,
  Repository, Legal Hold, Compliance/Audit, Admin, Cross-Branch).
- **Async jobs:** Redis-backed **BullMQ** (OCR dispatch, notification fan-out, disposal
  checks, ES re-index, expiry scans).
- **Security:** AES-256 at rest, TLS in transit, tamper-evident audit log (hash-chained),
  MFA, SSO, account lockout, rate limiting, HMAC-verified webhooks.
- **Observability:** structured logs, Prometheus metrics, OpenTelemetry traces.

---

## 7. Monorepo Layout

```
zordms/
  apps/
    web/                 # React SPA (Vite + React + TypeScript) — 19 screens
  services/
    gateway/             # Node — auth, RBAC, routing, BFF
    core/                # Node — DMS, records, customer360, branch, reports
    workflow/            # Node — maker-checker, cases, BPMN
    notify/              # Node — alerts, channels, realtime
    search/              # Node — Elasticsearch / PG-FTS
    integration/         # Node — CBS/LOS/KYC/ERP/CRM connectors, webhooks
    ai/                  # Python FastAPI — OCR/classification/extraction
  packages/
    db/                  # Knex config + dialect switch + migrations
    auth/                # JWT/session/RBAC middleware
    events/              # event-bus client
    ui/                  # React design system (navy + gold theme)
    types/               # shared API contracts (TypeScript)
    config/  logger/
  infra/
    docker-compose.yml   # on-prem single-box
    helm/                # K8s for cloud/hybrid
  .env.example           # DB_CLIENT=pg|oracledb, DATABASE_URL, ...
```

Tooling: **pnpm workspaces + Turborepo** for JS/TS; the Python `ai` service vendored in
the same repo with its own `pyproject`.

---

## 8. Tender 29-Requirement → Service Coverage Map

| Tender items | Requirement summary | Service(s) |
|---|---|---|
| 1–4 | Microservices, web-based, Unicode/multi-lang, enterprise scalability (item 4 met via horizontal scaling + RBAC-governed unlimited users — no license tiers) | Topology + apps/web + Gateway |
| 5–9 | Capture: centralized/decentralized scan, WIA/TWAIN, batch, CID-indexed, OCR auto-classify | Core + **AI** |
| 10–11 | Indexing: unlimited metadata, mandatory/unique/searchable | Core |
| 12–14 | AI: CID/Passport classify, extract Name/DOB/DocNo/Expiry, expiry alerts | **AI** + Notify |
| 15–16 | Repository: folders + permissions, version control + rollback | Core |
| 17–18 | Viewer: annotation/redaction/stamps, signatures | Core (+AI for PAdES) |
| 19–20 | Search: full-text OCR boolean/wildcard/fuzzy, saved searches | **Search** |
| 21–23 | Security: RBAC (the backbone — fine-grained, supervisor-provisioned unlimited users), MFA + SSO, AES-256 + audit | Gateway |
| 24–25 | Alerts: Email/SMS/WhatsApp, expiry detection → auto-alert | Notify + AI |
| 26 | Standard + custom dashboards/reports | Core |
| 27 | Integration: CBS, mBoB, goBoB, Internet Banking, KYC, LOS, ERP, CRM, Contact Center | **Integration Hub** |
| 28–29 | Vendor-led implementation & training; ≥1-yr warranty/support | Delivery process (not code) |

All 29 mapped → comfortably clears the 85% responsiveness threshold.

---

## 9. Deployment

- **On-Premises:** `docker-compose` single-box or small K8s; Oracle 19c or PostgreSQL on-prem;
  MinIO; all services containerized.
- **Cloud / Hybrid:** Helm chart on K8s; managed DB (RDS/OCI); S3; managed Elasticsearch.
- **One build, two targets:** identical container images, env-driven config.

---

## 10. Phasing (within full v4.2 parity)

**Phase 1 — tender-responsive core**
Gateway/Identity, Core DMS (docs/repo/capture/index/version/viewer), Workflow, Notify,
Search (PG-FTS), Integration (CBS/LOS/KYC), AI (OCR/classify/extract).
→ Covers all 29 specs.

**Phase 2 — enterprise depth**
Branch Network, Customer 360°, Case Management, Records/Legal-Hold/Disposal, Compliance
matrix, DR posture, Elasticsearch cutover, remaining connectors (ERP/CRM/Contact
Center/mBoB/goBoB).

---

## 11. Key Decisions (resolved)

| Decision | Choice |
|---|---|
| Feature scope | Full Enterprise v4.2 parity (19 screens) |
| AI/OCR | Dedicated Python FastAPI service (reuse/slim) |
| Granularity | Hybrid — 7 coarse units (1 web + 5 Node + 1 Python) |
| Codebase | Fresh monorepo, port proven logic |
| Database | PostgreSQL ⇄ Oracle 19c via env (Knex for Node, SQLAlchemy for Python) |
| Frontend | Vite + React + TypeScript |
| Gateway | Separate Gateway/Identity service |
| Licensing | **None** — RBAC-governed; supervisors provision unlimited users |
| RBAC | **System backbone** — data-driven roles + `resource:action` perms; drives UI, APIs, and the workflow engine |
| Build quality | **All services fully functional** (no mocks/stubs) |
| Login UX | Split-screen: left blue dotted carousel panel + right sign-in form (§3a) |

---

## 12. Open Items for the Implementation Plan
- Concrete database schema per service (port + extend existing `db/schema.sql`).
- API contract definitions (`packages/types`) per service.
- Event catalog (names, payloads, producers/consumers).
- Auth token flow details (session vs JWT boundaries between gateway and services).
- React design-system component inventory mapped to the 19 screens (incl. the split-screen
  carousel login component and the supervisor User-Management screen).
- RBAC data model: tables for `roles`, `permissions`, `role_permissions`, `user_roles`,
  branch/region scoping; seed of default roles; permission catalog (`resource:action`).
- Workflow ↔ RBAC contract: how a workflow step declares required permissions and how the
  engine resolves actor authority/step-up/escalation from RBAC.
- CI matrix for PG + Oracle migration testing.
