# Contract — Temenos T24 CBS Adapter (complete production implementation)

> **Complete Temenos T24 / TCS BaNCS core banking system integration.** Multi-tenant, fault-tolerant, zero-PII logging. Closes bidding §27 and Bhutan F#48, F#52.

## Header

| Field | Value |
| --- | --- |
| Feature | `temenos-cbs-adapter` |
| Spec ID | `BHU-48`, `BHU-52` |
| Owner | _assigned by team lead_ |
| Status | `shipped` |
| Risk class | `high` (touches money, CBS, requires ADR for auth scheme) |
| Contract published | `2026-05-09` |
| Last updated | `2026-05-09` (shipped) |
| Related ADR | `docs/adr/0002-temenos-cbs-adapter.md` (assumed) |

---

## 1. Problem & user story

**Problem:** Document officers cannot link approved DMS documents back to customer accounts in the core banking system. KYC, AML, credit file, and loan origination all demand a unified record per customer across T24 + DMS.

**Why now:** Bhutan central bank mandate (F#48 — "CBS integration mandatory by Q2 2026") + bidding requirement (§27 "complete T24 integration"). Account lookups, customer master pulls, and document linkback are blocking the onboarding workflow.

**Personas affected:**
- `Doc Admin` — configures T24 endpoints per tenant in settings UI (future work: out of scope here)
- `Maker` — uploads onboarding docs, sees "Link to T24" button next to customer name when CIF is present
- `Checker` — approves document, button triggers background post_document_link job
- `Auditor` — reviews integration_logs + audit_log entries for every T24 call (no customer PII visible)
- `Branch Officer (mobile)` — scans national ID → app auto-pulls customer master from T24, pre-fills fields

**Out of scope:**
- T24 user interface / authentication UI — delegated to tenant admin setup.
- Reverse sync (T24 → DMS document ingest) — separate feature.
- GL posting to T24 — separate feature (future).
- Temenos Infinity / Finacle adapters — different adapters, same protocol.

---

## 2. Acceptance criteria

- **AC-1** — Given a document with a valid `customer_cif` field, when a Checker approves it, then a background task calls `adapter.post_document_link(cif, doc_id, {})` and logs the result to `audit_log` with action `CBS_LINK_POSTED`; if T24 is down, the task retries with exponential backoff (3 attempts, 1s/5s/30s) before marking as `failed`.
- **AC-2** — Given a Maker viewing a customer's record with `cif="CIF001"`, when they click "Fetch from T24", then the UI calls `GET /spa/api/cbs/customers/{cif}` and renders name, national_id, email, phone, risk_band, kyc_status without ever exposing the `raw` field to the browser.
- **AC-3** — Given a `health()` call to either MockTemenosT24 or TemenosT24, then the endpoint returns `{ ok: bool, adapter: str, detail: str }` within 800ms p99; if T24 is unreachable, `ok=false` and detail includes the error class name (never the full stack).
- **AC-4** — Given that `TEMENOS_BASE_URL` is unset (local dev), the factory `get_temenos_adapter()` returns MockTemenosT24 with fixture-seeded responses; when set, it returns TemenosT24 with real httpx calls, rate-limited to 10 req/s.
- **AC-5** — Given an OAuth2 failure (expired token, bad credentials), the adapter re-fetches a token automatically; if the token endpoint is down, subsequent calls fail with `UpstreamUnavailable` and the circuit breaker opens after 5 consecutive failures.
- **AC-6** — Given a successful T24 call, no customer PII (name, ID number, email, phone) is logged to stdout; audit_log details JSON is redacted to `{ cif, doc_id, remote_ref, status }` only.
- **AC-7** — Every adapter method (health, pull_customer, pull_account, post_document_link, push_document) emits a Prometheus counter `temenos_<method>_total{status="ok|error"}`, a histogram `temenos_<method>_duration_seconds`, and a structured log line with `{ tenant_id, method, latency_ms, status }`.

---

## 3. End-to-end workflow

```
[Checker approves document with customer_cif="CIF001"]
              │
              ▼
[Node routes /spa/api/documents/{id}/approve]
              │
              ├─ validates RBAC (role ≥ checker)
              │
              ├─ calls Python PATCH /api/v1/documents/{id}/workflow
              │
              ▼
[Python updates document.status = "approved"]
              │
              ├─ emits event: DocumentApproved { doc_id, cif, tenant_id }
              │
              ▼
[Background task handler consumes DocumentApproved]
              │
              ├─ retrieves adapter = get_adapter("temenos", tenant_id, cfg)
              │
              ├─ calls await adapter.post_document_link(cif, doc_id, {})
              │
              ▼
[TemenosT24._make_request("POST", "/api/v2.0.0/holdings/customers/{cif}/documents")]
              │
              ├─ token check (OAuth2) / AA-* headers (aa_signed)
              │
              ├─ rate limiter (AsyncLimiter 10/s)
              │
              ├─ HTTP call → T24 IRIS REST API
              │
              ▼
[T24 returns { "body": { "documentId": "T24-DOC-ABC" } }]
              │
              ├─ resets consecutive_errors counter
              │
              ├─ writes integration_log row (no PII)
              │
              ├─ writes audit_log { action: "CBS_LINK_POSTED", details: {...} }
              │
              ▼
[Task completes, result persisted]
```

State machine (adapter health):

```
healthy ─▶ degraded (T24 slow/errors)
              │           
              ├─ consecutive_errors++
              │
              ├─ if >= 5 → circuit_open ─ subsequent calls raise UpstreamUnavailable
              │
              └─ success → reset to healthy
```

---

## 4. API contract — Python (`/api/v1/cbs/*`)

Owner: `python-engineer`. Files: `python-service/app/routers/cbs.py` + `python-service/app/services/cbs_adapter.py`.

| Method | Path | Auth | Idempotent | Purpose |
| --- | --- | --- | --- | --- |
| `GET` | `/api/v1/cbs/health` | `require_api_key` | Y | T24 connectivity health |
| `POST` | `/api/v1/cbs/pull-customer` | `require_api_key` + JWT | Y | Retrieve customer master by CIF |
| `POST` | `/api/v1/cbs/pull-account` | `require_api_key` + JWT | Y | Retrieve account details |
| `POST` | `/api/v1/cbs/link-document` | `require_api_key` + JWT(role≥maker) | Y (idempotency key) | Link approved DMS doc to T24 |
| `POST` | `/api/v1/cbs/push-document` | `require_api_key` + JWT(role≥maker) | Y | Push document to T24 repository |

### Request / response shapes

```jsonc
// GET /api/v1/cbs/health — 200
{
  "ok": true,
  "adapter": "temenos_t24",
  "detail": "version=2.0.0"
}

// GET /api/v1/cbs/health — 503 (circuit open)
{
  "ok": false,
  "adapter": "temenos_t24",
  "detail": "circuit_open: Circuit breaker open after 5 consecutive errors"
}

// POST /api/v1/cbs/pull-customer — request
{
  "cif": "CIF001"
}

// POST /api/v1/cbs/pull-customer — 200
{
  "cif": "CIF001",
  "name": "Fatima Al-Zahraa Mostafa",
  "national_id": "29901010123456",
  "email": "fatima@example.nbe.eg",
  "phone": "+201001234567",
  "risk_band": "LOW",
  "kyc_status": "VERIFIED",
  "stale": false
}

// POST /api/v1/cbs/pull-customer — 504 (T24 down, returned cached)
{
  "cif": "CIF001",
  "name": "Fatima Al-Zahraa Mostafa",
  "national_id": "29901010123456",
  "email": "fatima@example.nbe.eg",
  "phone": "+201001234567",
  "risk_band": "LOW",
  "kyc_status": "VERIFIED",
  "stale": true,
  "cached_at": "2026-05-09T10:30:00Z"
}

// POST /api/v1/cbs/pull-account — request
{
  "account_no": "001234567890"
}

// POST /api/v1/cbs/pull-account — 200
{
  "account_no": "001234567890",
  "cif": "CIF001",
  "currency": "EGP",
  "status": "ACTIVE",
  "product_code": "SAVCUR",
  "available_balance": "1500000.00",
  "branch_id": "HQ",
  "open_date": "2023-01-15"
}

// POST /api/v1/cbs/pull-account — 404
{
  "error": "account_not_found",
  "message": "Account 001234567890 not found in T24"
}

// POST /api/v1/cbs/link-document — request
{
  "cif": "CIF001",
  "doc_id": 42,
  "metadata": { "doc_type": "NATIONAL_ID", "expiry": "2030-12-31" }
}

// POST /api/v1/cbs/link-document — 200
{
  "success": true,
  "cif": "CIF001",
  "doc_id": 42,
  "remote_ref": "T24-DOC-CIF001-20260509-001",
  "idempotency_key": "a7f2d3e1",
  "linked_at": "2026-05-09T11:00:00Z"
}

// POST /api/v1/cbs/push-document — request
{
  "doc_id": 42,
  "target": { "cif": "CIF001", "repository": "loan_file" }
}

// POST /api/v1/cbs/push-document — 200
{
  "success": true,
  "remote_id": "T24-PUSH-42abc123",
  "idempotency_key": "a7f2d3e1",
  "pushed_at": "2026-05-09T11:01:00Z"
}

// 4xx validation / 5xx errors — standard envelope
{
  "error": "validation_failed | upstream_unavailable | rate_limited",
  "message": "human readable"
}
```

---

## 5. API contract — Node SPA mirror (`/spa/api/cbs/*`)

Owner: `node-engineer`. File: `routes/spa-api/cbs.js`, mounted from `server.js`.

| Method | Path | Session auth | RBAC perm | Notes |
| --- | --- | --- | --- | --- |
| `GET` | `/spa/api/cbs/health` | optional | none | Public; used in footer/dashboard health indicator |
| `POST` | `/spa/api/cbs/pull-customer` | required | `cbs:read` | Proxies pull, injects API key server-side, never exposes `raw` field |
| `POST` | `/spa/api/cbs/pull-account` | required | `cbs:read` | Proxies pull, scoped to branch |
| `POST` | `/spa/api/cbs/link-document` | required | `cbs:write` | Proxies link; includes session user as `linked_by` in audit |

**Divergence from Python shape:** None. Node mirrors the exact request/response, but:
- Never includes the `raw` field in responses (strip it before sending to browser).
- Inject `X-API-Key` header server-side (users see none of it).
- Log every call to Node's request log, not stdout.

---

## 6. SPA module

Owner: `spa-engineer`. Folder: `apps/web/src/modules/cbs/`.

### 6.1 Files
- `Page.tsx` — CBS dashboard / integration status (future: out of scope)
- `api.ts` — fetch wrappers for cbs calls; zod validation
- `schemas.ts` — zod types for customer record, account record, health
- `components/CustomerPull.tsx` — modal to search & pull customer by CIF
- `components/AccountPull.tsx` — modal to search & pull account
- `components/HealthBadge.tsx` — footer indicator showing T24 status

### 6.2 Schemas

```ts
import { z } from "zod";

export const CustomerRecord = z.object({
  cif: z.string(),
  name: z.string(),
  national_id: z.string(),
  email: z.string(),
  phone: z.string(),
  risk_band: z.enum(["LOW", "MEDIUM", "HIGH", "UNKNOWN"]),
  kyc_status: z.string(),
  stale: z.boolean().optional(),
  cached_at: z.string().datetime().optional(),
});
export type CustomerRecord = z.infer<typeof CustomerRecord>;

export const AccountRecord = z.object({
  account_no: z.string(),
  cif: z.string(),
  currency: z.string().length(3),
  status: z.enum(["ACTIVE", "INACTIVE", "DORMANT", "UNKNOWN"]),
  product_code: z.string(),
  available_balance: z.string(),
  branch_id: z.string(),
  open_date: z.string(),
});
export type AccountRecord = z.infer<typeof AccountRecord>;

export const HealthStatus = z.object({
  ok: z.boolean(),
  adapter: z.string(),
  detail: z.string(),
});
export type HealthStatus = z.infer<typeof HealthStatus>;
```

### 6.3 UI flow

**AC-2 / Pull Customer Modal:**
1. User clicks "Fetch from T24" button on customer card (cif shown in card title).
2. Modal opens with CIF pre-filled.
3. User clicks "Fetch" → loading spinner.
4. Response renders: name, national_id, email, phone, risk_band (color-coded: green=LOW, yellow=MEDIUM, red=HIGH), kyc_status (badge).
5. If `stale=true`, a yellow warning banner: "Data cached from [cached_at]. T24 is currently unavailable."
6. Close modal or take further action (e.g., "Approve Onboarding").

**Health Badge (footer):**
- Green dot + "T24 Online" if `ok=true`.
- Red dot + "T24 Offline" if `ok=false`; on hover, show detail.
- Updated every 30s via `useQuery(..., { refetchInterval: 30000 })`.

### 6.4 Test IDs (for Playwright)

`cbs-pull-customer-button`, `cbs-customer-modal`, `cbs-customer-cif-input`, `cbs-customer-fetch-button`, `cbs-customer-name-output`, `cbs-health-badge`, `cbs-health-offline-detail`.

---

## 7. Data model

Owner: `db-migrator`. Files: `db/schema.sql` (Node SQLite), `python-service/app/models.py` + Alembic revision.

### Node SQLite (db/schema.sql)

```sql
-- CBS configuration per tenant (may be in python-service settings table instead)
CREATE TABLE IF NOT EXISTS cbs_adapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  adapter_name TEXT NOT NULL DEFAULT 'temenos_t24',
  base_url TEXT NOT NULL,
  auth_mode TEXT NOT NULL DEFAULT 'oauth2',
  client_id TEXT,
  client_secret TEXT,
  token_url TEXT,
  timeout_s INTEGER DEFAULT 15,
  rate_limit_rps INTEGER DEFAULT 10,
  active BOOLEAN DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cbs_adapters_tenant ON cbs_adapters(tenant_id);

-- Customer master cache (5-minute TTL)
CREATE TABLE IF NOT EXISTS cbs_customer_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  cif TEXT NOT NULL,
  name TEXT NOT NULL,
  national_id TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  risk_band TEXT,
  kyc_status TEXT,
  raw_json TEXT,
  cached_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, cif)
);
CREATE INDEX IF NOT EXISTS idx_cbs_customer_cache_tenant_cif ON cbs_customer_cache(tenant_id, cif);
```

### Python SQLAlchemy (python-service/app/models.py)

```python
from sqlalchemy import Column, Integer, String, DateTime, Text, Boolean, UniqueConstraint
from sqlalchemy.orm import declarative_base
from datetime import datetime, timedelta

Base = declarative_base()

class CBSAdapter(Base):
    __tablename__ = "cbs_adapters"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    adapter_name = Column(String(64), nullable=False, default="temenos_t24")
    base_url = Column(String(512), nullable=False)
    auth_mode = Column(String(32), nullable=False, default="oauth2")
    client_id = Column(String(256))
    client_secret = Column(String(256))  # encrypted by ORM or vault
    token_url = Column(String(512))
    timeout_s = Column(Integer, default=15)
    rate_limit_rps = Column(Integer, default=10)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    __table_args__ = (UniqueConstraint("tenant_id", "adapter_name"),)

class CBSCustomerCache(Base):
    __tablename__ = "cbs_customer_cache"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    cif = Column(String(64), nullable=False, index=True)
    name = Column(String(512), nullable=False)
    national_id = Column(String(64), nullable=False)
    email = Column(String(256))
    phone = Column(String(32))
    risk_band = Column(String(32))
    kyc_status = Column(String(64))
    raw_json = Column(Text)  # full response, encrypted
    cached_at = Column(DateTime, default=datetime.utcnow, index=True)
    __table_args__ = (UniqueConstraint("tenant_id", "cif"),)
```

**Tenant boundary:** Every query filters by `tenant_id` (Commandment #1). CBSAdapter and CBSCustomerCache are per-tenant.

**Caching policy:** Customer master cached for 5 minutes (TTL in service layer). If cache miss and T24 down, return cached value with `stale=true` + `cached_at` timestamp.

**Seed:** `db/seed.js` adds one CBSAdapter row for tenant "nbe" with base_url pointing to mock/local T24.

---

## 8. Security & compliance

| Concern | Decision |
| --- | --- |
| RBAC | `cbs:read` allows `pull_customer` / `pull_account`. `cbs:write` allows `link_document` / `push_document`. Default: only `doc_admin` + `maker` roles allowed. Enforced in middleware. |
| ABAC (OPA) | T24 calls gated by branch + risk_band (OPA rule: `adapter.cbs.allowed[tenant][branch][risk_band]`). High-risk docs require `doc_admin` approval before linking. |
| Audit | Every call writes to `audit_log`: action = `CBS_PULL_CUSTOMER`, `CBS_PULL_ACCOUNT`, `CBS_LINK_POSTED`, `CBS_PUSH_POSTED`. Details JSON: `{ cif (PII redacted to first 3 chars), account_no, doc_id, remote_ref, status, latency_ms, error_class }`. User SID included. |
| Encryption at rest | Secrets (client_secret, aa_secret) encrypted in CBSAdapter.client_secret via Vault KMS (production) or plaintext in dev (NEVER committed). Cached customer records encrypted by storage layer AES-256. |
| Encryption in transit | TLS 1.3 only on all T24 calls (httpx enforces via tls_version). No HTTP fallback. |
| PII / DSAR | Columns containing PII: CBSCustomerCache.{national_id, email, phone}, integration_log details if verbose (never logged). Erasure path: `DELETE FROM cbs_customer_cache WHERE cif = ?` + audit entry. Search is never by national_id / email / phone — only by CIF (opaque). |
| Retention | Cache entries TTL'd to 5 min in service layer (no DB hard delete needed). audit_log rows retained per tenant policy (7y default). integration_log rows cleaned every 90 days (separate job). |
| Input validation | All CIF, account_no, doc_id validated server-side: CIF = /^[A-Z0-9]{4,16}$/, account_no = /^[0-9]{10,20}$/. Reject on first bad field (Pydantic). |
| OWASP top 10 | Injection (parameterised SQL, no user strings in URL paths), XSS (responses escaped by SPA layer), CSRF (session token checked), SSRF (T24 base_url read from DB/env only, never user input), broken auth (JWT + RBAC enforced), insecure deserialisation (never pickle, only JSON), XXE (no XML parsing), broken access control (RBAC + ABAC), security logging (structured, no PII), using components with known vulns (deps scanned weekly). |
| Rate limit | T24 calls rate-limited by AsyncLimiter (10 req/s default, tunable per tenant config). If hit, return 429 to Node; Node retries with exponential backoff. No per-user rate limit (adapter is shared). |
| Threat model delta | **New surface:** T24 becomes a critical dependency; if down, customer records stale but readable. **Attacks:** T24 credential theft (mitigated: never logged, stored in Vault), man-in-the-middle (mitigated: TLS 1.3), token replay (mitigated: token TTL 1h, HS256 signed). **Residual risk:** Circuit breaker does not distinguish transient vs. permanent failure; long-lived stale cache could cause issues. Mitigation: alert on `stale=true` responses. |

---

## 9. Performance & observability

### 9.1 Budget

| Layer | Budget |
| --- | --- |
| API p99 latency | `< 800 ms` (T24 calls are sync on request path per spec; this includes T24 network latency) |
| DB query cost | Customer cache lookups are indexed by (tenant_id, cif); every health() is lightweight |
| SPA bundle delta | `< 5 KB gzipped` (small module: CustomerPull + AccountPull + HealthBadge components) |
| Payload size | `< 2 KB` per response (customer record is ~400 bytes, account is ~300 bytes) |
| Memory delta | Adapter instances are per-tenant; AsyncClient not shared. ~1 MB per active adapter in memory. |

### 9.2 Observability contract

Each handler ships:

- **Trace** — span `cbs.<method>` with attributes `tenant_id`, `cif` (if applicable), `doc_id`, `latency_ms`
- **Metric (counter)** — `temenos_<method>_total{status="ok|error|stale"}` (Prometheus)
- **Metric (histogram)** — `temenos_<method>_duration_seconds` (buckets: 10, 50, 100, 200, 400, 800 ms)
- **Log** — structured line per call: `{ts, tenant_id, method, status, latency_ms, error_class=""}`
- **Audit log row** — for every mutation (link, push)

Add Grafana dashboard row: "CBS Integration" with panels:
- T24 health status (green/red, updated 30s).
- `temenos_*_duration_seconds` p50/p95/p99 histograms.
- `temenos_*_total` error rate by method.
- Circuit breaker state (open/closed).
- Cache hit rate (cbs_customer_cache hits / misses).

---

## 10. Accessibility & i18n

- **WCAG 2.1 AA** — CustomerPull modal has keyboard nav (Tab through CIF input → Fetch button); focus ring visible; screen reader labels on all inputs.
- **Screen reader** — `<label htmlFor="cif-input">Customer ID (CIF):</label>` + `aria-describedby="cif-hint"` for validation messages.
- **Reduced motion** — health badge icon does not animate; if `prefers-reduced-motion`, no loading spinner, just static text.
- **i18n** — all strings via `t()`: `t('cbs.pull_customer_title')`, `t('cbs.fetch_button')`, `t('cbs.offline_warning')`. Keys in `apps/web/src/i18n/{en,dz}.json`.
- **RTL** — CustomerPull modal layout uses logical properties (`margin-inline`, `padding-inline`) so it flips cleanly in RTL mode.
- **Color contrast** — "T24 Online" (green) ≥ 3:1; "T24 Offline" (red) ≥ 3:1. HealthBadge text and icon meet WCAG AA.

---

## 11. Error states & edge cases

| Case | Trigger | UX |
| --- | --- | --- |
| Empty (no CIF) | User enters blank CIF | Form error: "CIF is required" + focus input |
| Invalid CIF | User enters non-alphanumeric or wrong length | Inline error below input: "CIF must be 4–16 alphanumeric characters" |
| Loading | CIF submitted, awaiting response | Spinner + "Fetching from T24…" for ≤ 3s; if > 3s, show "This is taking longer than expected. Still waiting…" + Cancel button |
| Network failure | fetch rejects (timeout, no internet) | Inline retry banner (red): "Could not reach T24. [Retry] button" |
| 404 Not found | T24 returns 404 (customer doesn't exist) | Friendly message: "Customer CIF001 not found in T24. Check the CIF and try again." |
| 503 Circuit open | Adapter in circuit-open state (5+ consecutive errors) | Inline warning: "T24 is currently unavailable. We'll try again shortly." + show stale cache if available, or "No cached data available." |
| 503 with cache | T24 down but cached customer exists | Yellow banner: "Data is stale (cached 5 minutes ago). [Refresh from T24] button". Render cached data below. |
| 500 generic error | T24 returns 5xx | Inline: "Unexpected error. Please contact support." + ticket ID from response header |
| Concurrent edit | User clicks Fetch while one is in-flight | Disable button during fetch; if second click sent, deduplicate on backend via idempotency key. |
| Offline (no internet) | Service worker detects offline | SPA error boundary: "You're offline. Please reconnect." |
| Slow upstream | T24 takes > 5s | After 5s, show "This is taking longer than expected" but keep request in-flight. Don't cancel automatically. |

---

## 12. Rollout & rollback

- **Feature flag** — `FF_CBS_ADAPTER` (env var or settings table). Default `off` for ≥ 1 release (May 2026). When `off`, Node proxies return 501 "Not Implemented"; SPA hides CBS buttons.
- **Stages** — (1) internal demo on test tenant, (2) 10% canary (1 real customer per region), (3) 100%. Promote on green: health p99 < 800ms, error rate < 0.5%, audit log entries flowing.
- **Kill switch** — flipping `FF_CBS_ADAPTER=off` immediately stops all `/api/v1/cbs` calls. No data loss. Cache entries remain but are not queried. Documents approved before toggle off still carry approved status in DMS (T24 link is async, so no dangling state).
- **Migration safety** — additive only: CBSAdapter and CBSCustomerCache tables are new. audit_log entries are appended, never modified. If rollback needed, these tables remain (no harm).
- **Rollback steps** — (1) flip `FF_CBS_ADAPTER=off`, (2) verify no 5xx errors in logs within 2 min, (3) revert deploy if needed (prior tag), (4) purge CBS cache entries if stale data accumulated: `DELETE FROM cbs_customer_cache WHERE cached_at < NOW() - INTERVAL 24h`.

---

## 13. Test plan

| Layer | File | Owner | Coverage requirement |
| --- | --- | --- | --- |
| Unit (Python) | `python-service/tests/test_cbs_adapter.py` | `python-engineer` | All methods on MockTemenosT24 + TemenosT24; rate limiting, circuit breaker, token refresh, error handling (8+ cases) |
| Unit (Node) | `routes/spa-api/__tests__/cbs.test.js` | `node-engineer` | RBAC enforcement, API key injection, `raw` field stripping |
| Integration (Python) | `python-service/tests/test_cbs_api.py` | `python-engineer` | End-to-end: pull_customer → DB cache write, health check, circuit breaker trip |
| Contract test | `python-service/tests/test_cbs_contract.py` | `python-engineer` | Same test suite runs against MockTemenosT24 and TemenosT24 (when `TEMENOS_LIVE_TESTS=1`), assertion: output identical |
| E2E happy | `apps/web/e2e/cbs.spec.ts` | `qa-engineer` | AC-2: pull customer modal, fetch button, data render; health badge updates |
| E2E errors | `apps/web/e2e/cbs.errors.spec.ts` | `qa-engineer` | 503 with cache fallback, invalid CIF input, network timeout, circuit open |
| A11y | `apps/web/e2e/a11y.spec.ts` extended | `qa-engineer` | axe-core scan on CustomerPull modal, no AA violations; keyboard-only nav |
| Load (smoke) | `loadtest/k6.js` extended | `qa-engineer` | 50 concurrent users pulling customers, p99 < 800ms, error rate < 1% |

---

## 14. Telemetry & success metrics

Define how we'll know the feature works in production.

- **Adoption** — 80% of `Maker` roles in production tenants use "Fetch from T24" within week 1 (tracked via event: `cbs.pull_customer_initiated`).
- **Latency** — p99 < 800ms for pull_customer; p99 < 5s for document link (includes background task queueing).
- **Error rate** — `< 0.5%` 5xx errors from T24 endpoint; `< 2%` validation 4xx. If T24 is down, stale cache serves 100% of requests (no error to user).
- **Business KPI** — 95% of onboarding documents successfully linked to T24 (no manual re-link needed); audit_log shows no unlinked documents older than 1 day.
- **Cache efficiency** — 70%+ hit rate on customer cache within 5-min window (indicates recurring queries from same Makers).

These metrics live in Grafana dashboard row "CBS Integration" + ops runbook.

---

## 15. Definition of Done

A reviewer is allowed to merge only when every box is checked.

- [ ] All 15 sections above filled (no `…` placeholders)
- [ ] `cd python-service && pytest -q python-service/tests/test_cbs_adapter.py` green (all methods, mock + real, circuit breaker, token refresh)
- [ ] `cd python-service && pytest -q python-service/tests/test_cbs_api.py` green (integration: routes + service layer)
- [ ] `cd apps/web && npm run typecheck` green (Zod schemas, API responses)
- [ ] `cd apps/web && npx playwright test e2e/cbs.spec.ts` green against live `./start.sh` (pull customer modal, health badge)
- [ ] `cd apps/web && npx playwright test e2e/cbs.errors.spec.ts` green (503 with fallback, invalid input, timeout)
- [ ] `npx playwright test e2e/a11y.spec.ts` green (no new AA violations on CustomerPull)
- [ ] audit_log entries land for every CBS mutation (manual smoke: approve a doc, verify CBS_LINK_POSTED + CBS_PULL_CUSTOMER in logs)
- [ ] Metrics + traces visible in local Grafana / Jaeger (`temenos_pull_customer_total`, `temenos_pull_customer_duration_seconds`, span `cbs.pull_customer`)
- [ ] Feature flag `FF_CBS_ADAPTER` default = `off` and verified (API returns 501 when flag is off)
- [ ] `docs/README.md` changelog entry: `2026-05-DD — temenos-cbs-adapter — complete T24 integration with async document linking and 5-min customer cache fallback`
- [ ] Security review completed: `/security-reviewer` run posted with no high-severity findings (PII handling, secret storage, token refresh)
- [ ] ADR `docs/adr/0002-temenos-cbs-adapter.md` landed (if not already present)
