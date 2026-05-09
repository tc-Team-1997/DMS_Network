# ADR 0002: Temenos T24 CBS Adapter Integration

**Status:** Accepted

**Date:** 2026-05-09 | **Date accepted:** 2026-05-09

**Decision:** Implement a production-grade Temenos T24 / TCS BaNCS core banking system adapter as part of the DocManager integration hub, closing Bhutan F#48 / F#52 (CBS integration mandate) and bidding §27.

---

## Context

Every bank we target has a core banking system (CBS) as the system of record for customer identity, accounts, risk classification, and regulatory compliance. Document capture workflows cannot reach their full value — customer master verification, KYC/AML screening, automated account linking — without integrating with the bank's CBS.

**Current State:**
- DocManager has a stub AML screening router and a skeletal Temenos adapter (`python-service/app/services/integrations/temenos_t24.py`).
- The skeleton includes both a `MockTemenosT24` class (dev/test) and a `TemenosT24` real implementation, but the real implementation lacks production-grade error handling, caching, and observability.
- No unified adapter protocol; no registry.
- No customer master cache to degrade gracefully when T24 is unavailable.
- No audit trail for integration calls.

**Blocker:** Bhutan central bank mandate (F#48 — "CBS integration mandatory by Q2 2026") requires that every uploaded onboarding document can be linked back to the authoritative customer record in T24. Without this integration, DocManager cannot go live in Bhutan.

**Business Value:**
- **Same-day onboarding** — instead of manual CIF lookup, the system auto-populates customer master from T24 on every document capture.
- **AML pre-screening** — every document is tagged with the customer's risk band fetched from T24, enabling risk-based review workflows.
- **Unified audit trail** — regulators see a complete provenance chain: document uploaded → linked to CIF → linked to T24 → approved by checker.
- **Open-door for integration** — once Temenos is live, the same adapter protocol and factory can scale to FLEXCUBE, Finastra, Mambu, FIS, etc.

---

## Decision

Implement the Temenos T24 CBS adapter with three mandatory production characteristics:

### 1. Multi-Tenant OAuth2 with Short-Lived Tokens

- Each tenant stores T24 credentials in Vault under `secret/tenants/{tenant_id}/integrations/temenos_t24`.
- OAuth2 client credentials grant (standard, widely supported); tokens cached per adapter instance, refreshed 30 seconds before expiry.
- Fallback: Temenos AA-* HMAC signed header scheme for banks with specialized auth requirements.
- **Non-negotiable:** no long-lived API keys in code, logs, or traces.

### 2. Graceful Degradation via Circuit Breaker + 5-Minute Cache

- Customer master lookups cached for 5 minutes in `cbs_customer_cache` table (SQLite for Node, SQLAlchemy for Python).
- If T24 becomes unavailable (5+ consecutive 5xx errors), the circuit breaker opens and subsequent calls immediately return cached data with a `stale=true` flag.
- SPA renders a yellow warning: "Data cached from [timestamp]. T24 is currently unavailable."
- **Design principle:** a stale customer record is better than an error; users can proceed with reduced confidence while the bank's ops team investigates T24.

### 3. Idempotent Outbound Calls with Exponential Backoff

- Every document-link request carries an idempotency key (SHA256 of `tenant_id|cif|doc_id|adapter_name`).
- Background task retries with exponential backoff (1s → 5s → 30s) on failure, marking as `failed` after 3 attempts.
- If T24 returns 400/403, the error is permanent; task aborts immediately.
- If T24 returns 5xx/network timeout, the error is transient; task retries.

### 4. Zero-PII Logging and Audit Trail

- No customer name, national ID, email, or phone number logged to stdout or structured logs.
- Every T24 call writes an `audit_log` row with action `CBS_PULL_CUSTOMER`, `CBS_LINK_POSTED`, etc.
- Audit details redacted to opaque references: `{ cif (first 3 chars only), doc_id, remote_ref, status, latency_ms }`.
- Prometheus metrics and structured logs include `tenant_id` and method name for observability.

### 5. Uniform Adapter Protocol with Mock-Real Swap

- All adapters (Temenos, FLEXCUBE, Mambu, etc.) implement the same `Adapter` protocol:
  ```python
  async def health() -> HealthStatus
  async def pull_customer(cif: str) -> CustomerRecord
  async def pull_account(account_no: str) -> AccountRecord | None
  async def post_document_link(cif: str, doc_id: int, metadata: dict) -> PostResult
  async def push_document(doc: Document, target: dict) -> PushResult
  ```
- Factory function `get_adapter(name: str, tenant_id: str, cfg: dict)` returns a configured instance.
- **Critical:** `MockTemenosT24` and `TemenosT24` are interchangeable; tests run against mock by default, real adapter swapped via env var (`TEMENOS_BASE_URL`) or test decorator.

---

## Alternatives Considered

### A. Direct T24 ODBC Connection
**Rejected.** Requires the bank to open network bridges from the DocManager pod to T24 infrastructure. Breaks our local-first development principle; every engineer would need VPN access to T24. Maintenance burden on the customer's network team.

### B. Third-Party iPaaS Gateway (MuleSoft, Boomi)
**Rejected.** Adds cost and vendor dependency. Our competitors' value proposition is "we reduce dependencies"; outsourcing integration to a third-party platform contradicts that. Integration as code (not SaaS config) is strategic.

### C. Nightly ETL Snapshot
**Rejected.** Customer master data would be 24+ hours stale. For same-day onboarding, we need real-time lookups. Compliance would object to approving documents linked to yesterday's risk band.

### D. Synchronous T24 Calls on Document Approval Path
**Rejected.** T24 outages would block workflow approvals. Our decision: customer-master lookups are synchronous (real-time UX); document-linking is async (background task with retry).

---

## Consequences

### Positive

1. **Closes regulatory mandate** — Bhutan F#48 unblocked; go-live on track for Q2 2026.
2. **Scales to other vendors** — once Temenos is shipped and contract-tested, adding FLEXCUBE / Mambu / Finastra takes 3–4 weeks per adapter, not months.
3. **Audit trail becomes the compliance moat** — every integration call is logged; regulators see complete provenance.
4. **Graceful degradation without operator intervention** — circuit breaker auto-mitigates T24 outages; users don't see errors.

### Negative / Trade-offs

1. **T24 outages degrade DocManager UX** — not eliminated, only mitigated. If T24 is down for > 5 minutes, users see stale cache warnings. If cache miss (new customer), user cannot proceed.
   - *Mitigation:* Alert operations on circuit-breaker open; expedite T24 restoration.

2. **Cache invalidation is eventual** — 5-minute TTL means a customer's risk band changes in T24 and takes up to 5 minutes to propagate to DocManager.
   - *Mitigation:* Webhook hooks (out of scope v1) can invalidate cache on T24 customer update.

3. **Token credential rotation requires manual procedure** — OAuth2 credentials rotate per bank policy (typically quarterly). If the bank uses long-lived client_secret, we inherit that risk.
   - *Mitigation:* Vault auto-rotation where T24 supports it; quarterly reminder email to ops where it doesn't.

4. **Integration test suite must cover both adapters** — every pytest must run against `MockTemenosT24` and `TemenosT24` with identical assertions.
   - *Mitigation:* Contract test pattern established; future adapters follow same model.

5. **PII redaction in logs is a steady-state requirement** — developer must remember never to log `customer_name`, `national_id`, etc. A single mistake could leak sensitive data.
   - *Mitigation:* Pre-commit hook + linter rule forbidding these fields in log format strings.

### New Operational Responsibilities

- **Vault credential management** — keep `TEMENOS_CLIENT_SECRET` rotated, encrypted at rest.
- **Circuit breaker alerts** — page ops if circuit breaker opens for > 5 minutes (indicates T24 infrastructure issue).
- **T24 API version tracking** — when T24 releases a new major version (R24), validate our IRIS endpoint paths still match; possible adapter code bump.
- **Cache growth monitoring** — `cbs_customer_cache` can grow unbounded if cache cleanup is not automated; add a 90-day TTL hard-delete job.

---

## Assumptions

1. **Temenos T24 IRIS v2 REST API is stable and versioned.** We assume T24 vR22+ exposes `/api/v2.0.0/holdings/customers/{cif}` and `/api/v2.0.0/holdings/customers/{cif}/documents`.

2. **OAuth2 client credentials flow is available in all target banks' T24 environments.** If a bank uses AA-* HMAC headers instead, we provide a config flag to swap auth modes.

3. **Every bank has HTTPS / TLS 1.3 support on T24 REST endpoints.** We enforce TLS 1.3 and reject HTTP fallback.

4. **The bank provides a T24 sandbox environment for integration testing.** CI nightly contract tests run against the bank's test T24; regression detected by morning.

---

## Implementation Reference

**Code location:** `python-service/app/services/integrations/temenos_t24.py`

**Key classes:**
- `MockTemenosT24` — fixture-based mock for dev/test (line 97).
- `TemenosT24` — real async adapter with OAuth2, circuit breaker, rate limiting (line 300).

**Factory:** `get_temenos_adapter()` (line 730) returns mock or real based on `TEMENOS_BASE_URL` env var.

**Router:** `python-service/app/routers/cbs.py` exposes the unified `/api/v1/cbs/*` surface.

**Node mirror:** `routes/spa-api/cbs.js` proxies to Python; RBAC gated; never exposes `raw` field or secrets.

**Contract:** `docs/contracts/temenos-cbs-adapter.md` — comprehensive spec for all five team roles (SPA, Node, Python, DB, QA).

---

## Status Tracking

| Milestone | Owner | Target Date | Status |
|-----------|-------|-------------|--------|
| Contract approval | docs-architect | 2026-05-09 | ✓ Draft complete |
| Schema + migrations | db-migrator | 2026-05-15 | Pending |
| Python adapter completion | python-engineer | 2026-05-20 | In progress (mock GA, real TBD) |
| Node SPA mirror | node-engineer | 2026-05-22 | Pending |
| SPA UI (CustomerPull modal) | spa-engineer | 2026-05-25 | Pending |
| Playwright E2E | qa-engineer | 2026-05-28 | Pending |
| Security review | security-reviewer | 2026-05-30 | Pending |
| Ship / merge to main | — | 2026-06-02 | Pending |

---

## Questions for the Team

1. **T24 Auth:** Does the target bank (Bhutan) support OAuth2, or do we need AA-* signed headers from day one? [Pending clarification]

2. **Cache TTL:** Is 5 minutes the right window? Should it be configurable per tenant? [Assume fixed for v1]

3. **Circuit breaker threshold:** 5 consecutive errors feels right, but should we also track error rate (e.g., 50% error rate in a 1-minute window)? [Assume simple consecutive counter for v1]

4. **Webhook invalidation:** When T24 customer master changes, should we invalidate cache immediately via webhook? Or accept 5-minute eventual consistency? [Assume eventual consistency v1; webhooks in v1.1]

---

## Related Documents

- **Contract:** `docs/contracts/temenos-cbs-adapter.md` (Sections 4–15 detail API shapes, test plan, rollout, success metrics)
- **Integration Strategy:** `docs/INTEGRATION_STRATEGY.md` §16 (Temenos reference implementation; capability matrix)
- **Engineering Principles:** `docs/ENGINEERING_PRINCIPLES.md` §1 (Ten Commandments: tenant safety, observability, testing, no PII logging)
- **Architecture:** `docs/TARGET_ARCHITECTURE.md` §8 (integration hub pattern)

---

**Decision Approved By:** [Team lead to sign off]

**Implemented By:** `python-engineer`, `node-engineer`, `spa-engineer`, `db-migrator`, `qa-engineer`

**Reviewed By:** `security-reviewer` (mandatory for high-risk slice)
