# DocManager — Target Architecture

> **Where we are going — the SaaS-ready, multi-tenant, AI-native, integration-first architecture.**
>
> This document is the blueprint. [ARCHITECTURE.md](./ARCHITECTURE.md) describes the current pilot. [ROADMAP.md](./ROADMAP.md) shows the quarterly migration path from one to the other.

---

## 1. Design tenets (what every decision must satisfy)

1. **Tenant leakage is the one bug we never ship.** Every query, key, message, metric, and log line is tenant-scoped by construction, not by convention.
2. **Same code, three deployment modes.** Pooled SaaS, Silo SaaS, Dedicated on-prem all run the same artifacts — modes differ in *configuration*, not *code*.
3. **AI is a first-class service.** Every document touches the AI layer by default; opting out is explicit.
4. **Events first, CRUD second.** Every state change emits an event before the next service consumes it.
5. **Integration is a product, not plumbing.** Adapters are versioned, contract-tested artifacts with their own release train.
6. **On-prem is never second-class.** Every feature ships on-prem in the same release as SaaS.
7. **Observability is non-negotiable.** A service without traces, metrics, and logs is not production-ready.
8. **Compliance is mechanised.** Retention, DSAR, audit chain, and regulator reports are code, not PDFs.

---

## 2. Top-level system diagram

```
                    ┌──────────────────────────────────────────────────────────┐
                    │                     Customers                            │
                    │  Branch staff (desktop)   Branch officers (mobile)       │
                    │  Compliance (desktop)     End customers (portal embed)   │
                    │  Regulators (read-only)   Bank ops (admin portal)        │
                    └──────────────────────────────────────────────────────────┘
                                         │
                                         ▼
     ┌──────────────────────────────────────────────────────────────────────────────┐
     │                    Edge & CDN (Cloudflare / AWS CloudFront)                  │
     │   WAF · DDoS · bot protection · TLS · static asset caching · edge OCR        │
     └──────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
     ┌──────────────────────────────────────────────────────────────────────────────┐
     │                      API Gateway (Kong / Envoy)                              │
     │   Auth (JWT validation) · rate limit per tenant · request routing ·          │
     │   tenant subdomain → tenant_id resolution · SLA tracking                     │
     └──────────────────────────────────────────────────────────────────────────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    ▼                    ▼                    ▼
     ┌──────────────────────┐  ┌──────────────────┐  ┌──────────────────────┐
     │   DocManager Web     │  │   DocManager     │  │   Partner / BYO      │
     │   (apps/web SPA)     │  │   Mobile (Expo)  │  │   clients via API    │
     │   React/TS/Tailwind  │  │   branch capture │  │   SDK + webhooks     │
     └──────────────────────┘  └──────────────────┘  └──────────────────────┘
                    │
                    ▼
     ┌──────────────────────────────────────────────────────────────────────────────┐
     │                    Application Services (Python FastAPI · polyglot-ready)    │
     │                                                                              │
     │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────┐  │
     │  │ documents  │  │ workflows  │  │ integration│  │ compliance │  │ admin  │  │
     │  │ + capture  │  │ (BPMN/DMN  │  │ hub        │  │ (DSAR,     │  │ tenant │  │
     │  │ + repo     │  │ via Temporal/│ (adapters) │  │ retention, │  │ mgmt   │  │
     │  │ + viewer)  │  │ Zeebe)     │  │            │  │ audit)     │  │        │  │
     │  └────────────┘  └────────────┘  └────────────┘  └────────────┘  └────────┘  │
     │                                                                              │
     │  ┌──────────────────────────────────────────────────────────────┐            │
     │  │  DocBrain AI layer                                           │            │
     │  │   · OCR (Tesseract / Textract / Azure FR / ABBYY routing)    │            │
     │  │   · classification (Llama 3.1 fine-tuned)                    │            │
     │  │   · entity extraction (NER)                                  │            │
     │  │   · forgery / signature / face / duplicate                   │            │
     │  │   · RAG + chat (LangChain orchestrator, LangSmith traces)    │            │
     │  └──────────────────────────────────────────────────────────────┘            │
     └──────────────────────────────────────────────────────────────────────────────┘
                    │                  │
                    ▼                  ▼
     ┌──────────────────────┐  ┌──────────────────────────────────────────────────┐
     │  Event bus (Kafka /  │  │  Workers (RQ / Celery / Temporal)                │
     │  Redpanda)           │  │  · async OCR                                     │
     │  documents.uploaded  │  │  · AI inference (GPU queue)                      │
     │  documents.classified│  │  · workflow step execution                       │
     │  workflows.*         │  │  · integration calls (with retry/DLQ)            │
     │  audit.*             │  │  · notifications (email/SMS/WhatsApp)            │
     └──────────────────────┘  └──────────────────────────────────────────────────┘
                    │
                    ▼
     ┌──────────────────────────────────────────────────────────────────────────────┐
     │                            Data plane                                        │
     │                                                                              │
     │  Metadata (Postgres)      Object store (S3 / MinIO / Azure Blob)             │
     │   + Row-Level Security     + tenant-scoped buckets                           │
     │   + pgvector for vectors   + SHA-256 content-addressed                       │
     │                            + WORM bucket for retention                       │
     │                                                                              │
     │  Search (OpenSearch /     Vector DB (Qdrant per silo tenant · pgvector for   │
     │  Meilisearch)              pooled) — tenant-scoped collections               │
     │   + FTS + faceted                                                            │
     │                            Cache (Redis Cluster, per-tenant key prefixes)    │
     │  Event log / audit        Secret / key store (Vault, per-tenant KEKs)        │
     │  (append-only,            Session store (Redis)                              │
     │   hash-chained)                                                              │
     └──────────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
     ┌──────────────────────────────────────────────────────────────────────────────┐
     │                          External integrations                               │
     │                                                                              │
     │  CBS adapters:    Temenos T24, FLEXCUBE, Finastra, Mambu, Thought Machine,   │
     │                   Oracle Banking, FIS Profile, 10x, Pismo                    │
     │  KYC/AML:         ComplyAdvantage, Trulioo, Jumio, Onfido, Actimize          │
     │  E-signature:     DocuSign, Adobe Sign, national eID (Nafath, UAE Pass…)     │
     │  Regulators:      CBE portal, SAMA, RBI, ECB, FED, …                         │
     │  Identity:        Azure AD, Okta, PingIdentity, Google Workspace             │
     │  Messaging:       SWIFT MT/MX, SEPA, ISO 20022                               │
     │  Notifications:   Twilio, Infobip (SMS/WhatsApp/voice), SendGrid/SES (email) │
     │  BI / DW out:     Snowflake, Databricks, BigQuery, Fabric (via CDC/Debezium) │
     └──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Deployment modes — one codebase, three shapes

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ POOLED SaaS (tier-3, tier-4)                                                    │
│  · Shared Postgres (Row-Level Security on tenant_id)                            │
│  · Shared Kafka, Redis, object store (tenant-scoped buckets/keys)               │
│  · Shared AI layer (Llama 8B default; tenant can pay for 70B routing)           │
│  · Isolation:  logical (RLS + app enforcement)                                  │
│  · Cost / tenant:  lowest  →  price: lowest                                     │
│  · SLA:  99.9%                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                   │
┌─────────────────────────────────────────────────────────────────────────────────┐
│ SILO SaaS (tier-2)                                                              │
│  · Dedicated Postgres schema per tenant                                         │
│  · Dedicated Kafka topic prefix, Qdrant collection, Redis keyspace              │
│  · Dedicated object-storage bucket, own KMS key                                 │
│  · Can opt for regional deployment (e.g. Riyadh-only for KSA banks)             │
│  · Isolation:  physical data + logical compute share                            │
│  · Cost / tenant:  medium  →  price: medium                                     │
│  · SLA:  99.95%                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
                                   │
┌─────────────────────────────────────────────────────────────────────────────────┐
│ DEDICATED / ON-PREM (tier-1, central banks)                                     │
│  · Entire DocManager stack in customer's Kubernetes / OpenShift / VMware        │
│  · Fully air-gappable (models bundled, no outbound calls)                       │
│  · Customer owns the keys (HSM-backed KEKs, e.g. Thales Luna)                   │
│  · Optional: customer's own LLM infrastructure (vLLM, TGI, Ollama)              │
│  · Isolation:  physical (everything)                                            │
│  · Cost / tenant:  highest  →  price: highest                                   │
│  · SLA:  99.95%, with tenant-run ops if airgapped                               │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Rule:** the difference between modes is **Helm values.yaml**, not forked code paths. If a feature is hard to ship on-prem, we don't ship it on SaaS either until it can.

---

## 4. Tenancy model — the most important invariant

### 4.1 Tenant identifier

Every persisted row, every S3 object key, every Kafka message header, every log/metric/trace attribute includes a `tenant_id` (UUID). The identifier is authoritative; human-readable subdomains (`nbe.docmanager.io`) resolve to it at the edge.

### 4.2 Enforcement layers (defence in depth)

| Layer | Mechanism | What it blocks |
|---|---|---|
| Edge / gateway | Resolve tenant from subdomain + JWT `tenant_id` claim. Reject mismatch. | URL tampering |
| Application middleware | Inject `TenantContext` at request boundary; fail-closed if missing. | Missing guards |
| ORM / DB layer | SQLAlchemy event hook adds `WHERE tenant_id = :tenant` to every query. Postgres RLS as backstop. | Developer forgetting a filter |
| Database | Postgres RLS policy + `app.current_tenant_id` session var. | SQL injection that bypasses ORM |
| Object storage | S3 bucket policy scoped by prefix + per-tenant IAM role for long-lived access. | Cross-tenant blob reads |
| Secret store | Per-tenant path in Vault; transit engine; no shared keys. | KEK leakage |
| Search index | Tenant-scoped Qdrant collection, OpenSearch index per tenant. | Cross-tenant vector matches |
| Audit | Every access attempt logged; cross-tenant access attempts flagged as P1 alerts. | Detection even if prevention fails |

### 4.3 Tenant provisioning (automated, < 5 minutes)

```
POST /platform/tenants
  {
    "name": "Acme Bank",
    "tier": "silo",
    "region": "eu-west-1",
    "data_residency": "eu",
    "admin_email": "admin@acmebank.com",
    "branding": { ... }
  }
    │
    ▼
Orchestrator (Temporal workflow)
    │
    ├─▶ create Postgres schema `tenant_acme` + RLS policies
    ├─▶ create Kafka topic prefix `tenant.acme.*`
    ├─▶ create Qdrant collection `acme`
    ├─▶ create S3 bucket `dm-acme-eu-west-1` + KMS key + bucket policy
    ├─▶ create Vault path `secret/tenants/acme/*` + root KEK
    ├─▶ create Redis keyspace prefix `acme:*`
    ├─▶ seed default workflow templates + retention policies
    ├─▶ seed admin user (email invite with one-time password)
    ├─▶ create DNS record: acme.docmanager.io → tenant gateway route
    ├─▶ register tenant in metering service
    ├─▶ register tenant in observability (per-tenant Grafana folder)
    └─▶ return { tenant_id, admin_activation_url, status: "ready" }
```

Tenant deprovisioning (off-boarding) runs the same workflow in reverse, with a 30-day grace period, full export bundle, cryptographic deletion confirmation, and certified-destruction evidence.

---

## 5. Data plane

### 5.1 Metadata: Postgres (primary)

- **Primary:** Postgres 16. Per-tenant schemas for silo tier, shared schema with Row-Level Security for pooled.
- **Why Postgres (not Aurora / Spanner / CockroachDB):** extensive RLS, pgvector for embeddings, battle-tested HA (patroni/pg_auto_failover), compliance-friendly (can run on-prem), operator tooling mature.
- **Replication:** logical replication → read replicas per region; Debezium → Kafka for CDC → customer data warehouses.
- **FTS:** start with Postgres FTS (`tsvector`) + pg_trgm for fuzzy; move to OpenSearch per-tenant when pooled scale demands it (> 100M docs per tenant).

### 5.2 Blob storage: S3-compatible

- **S3 / MinIO / Azure Blob / GCS** — abstracted behind a `BlobStore` interface.
- **SHA-256 content addressing** — files stored at `tenants/{tenant_id}/sha256/{aa}/{bb}/{full}` (we have this in `python-service/app/services/storage.py`).
- **Lifecycle policies** per retention rule (cold-archive → Glacier / Archive tier).
- **Server-side encryption** with per-tenant KMS keys (BYOK).
- **Object lock (WORM)** for retention-locked documents — regulator-demanded for Tier-1 tenants.
- **Pre-signed URLs** for browser downloads, per-request, 5-minute TTL.

### 5.3 Event bus

- **Kafka or Redpanda** (Redpanda leaning for smaller ops overhead).
- **Topic naming:** `{tenant_id}.domain.event` — e.g. `acme.documents.uploaded`.
- **Schema registry:** Confluent or Redpanda schema registry, Avro or Protobuf schemas versioned.
- **Header:** every message carries `tenant_id`, `correlation_id`, `causation_id`, `origin_service`, `schema_version`.
- **Ordering:** partition by `customer_id` or `document_id` as appropriate.
- **Dead-letter:** every consumer has a DLQ topic; retries + manual replay UI.

### 5.4 Vector store

- **Pooled tier:** `pgvector` inside Postgres (same DB → simpler ops, one fewer moving part).
- **Silo/Dedicated tier:** Qdrant (tenant-scoped collection) or Weaviate if schema modelling justifies it.
- Vector embeddings (BGE-large or `nomic-embed-text`) computed asynchronously after document classification.
- Hybrid search: BM25 (from Postgres/OpenSearch) + dense vector + reranker (bge-reranker-v2).

### 5.5 Search

- **Pooled:** Postgres FTS + pgvector for hybrid retrieval (BM25 + dense + RRF).
- **Silo/dedicated:** OpenSearch (tenant-scoped index). Reason: faceted search + filter aggregations scale better there.
- **Query path:** SPA → API → search service → parallel vector + keyword → reranker → SQL enrichment (metadata join).

### 5.6 Cache

- Redis Cluster, per-tenant key prefix.
- Session cache (moved out of Node process memory).
- Query result cache (opt-in per endpoint, with automatic invalidation on relevant event).
- Rate-limit counters (per-tenant and per-user).

### 5.7 Audit & transparency

- Every meaningful action emits an audit event.
- Audit events persisted append-only in Postgres + immediately published to a `tenant.audit.v1` Kafka topic.
- **Hash-chained:** each event includes `prev_hash` (SHA-256 of the previous event for that tenant); breaking the chain is detectable.
- **Anchored:** every N events (configurable), a Merkle root is anchored to an external source (customer's Git repo, a public notary, or a blockchain if contracted).
- **Exportable:** one API returns the full audit log for a tenant, verifiable offline.

---

## 6. Workflow engine

See [ROADMAP.md §5 (Q1 2027)](./ROADMAP.md#5-q1-2027--workflow-engine-20-compliance-editable) for timeline.

### 6.1 Engine choice

- **Temporal** for developer-friendliness, durable execution, retry semantics, out-of-the-box observability.
- *Alternative:* **Camunda Zeebe** for BPMN purity — consider if customers demand BPMN-spec fidelity for regulator export.
- **Decision D1** in [ROADMAP.md §12](./ROADMAP.md#12-decision-log--open-questions).

### 6.2 Authoring surfaces

Two concentric tools:

- **Designer** (for business / compliance users): drag-drop canvas built with React Flow, DMN table editor. No code. Deploys via a "publish" action that converts designer output to engine-native format.
- **Authoring SDK** (for engineers): TypeScript / Python SDKs to author workflows as code for version control + code review.

Both produce the same artifact — designer just generates code under the hood.

### 6.3 Core constructs

- **Process:** sequence of activities (human tasks + automated activities + gateways + timers).
- **Decision Table (DMN):** declarative if-then for business rules (e.g. "if risk_band = high and doc_type = national_id → step_up_required").
- **Human Task:** maker / checker inbox items with SLA timers, reassignment, delegation.
- **Timer / Signal:** wait conditions; external signals can advance workflows.
- **Compensation:** every step can have an undo (e.g. cancel a sanction screen if workflow aborts).
- **Versioning:** Workflow v2 deployed; in-flight v1 instances finish on v1.

### 6.4 Pre-built templates

20 templates shipped at GA. Full list in [ROADMAP.md §5](./ROADMAP.md#5-q1-2027--workflow-engine-20-compliance-editable).

---

## 7. AI layer (DocBrain)

Full spec in [AI_STRATEGY.md](./AI_STRATEGY.md). Summary of where it sits architecturally:

- **Sidecar to the application layer**, not inside it. Every FastAPI service calls DocBrain via an internal gRPC/REST contract.
- **Stateless services, stateful models.** DocBrain API is stateless; models served by vLLM / Text-Generation-Inference / Ollama.
- **Tenant-aware routing.** A request carries `tenant_id`; DocBrain looks up the tenant's chosen model (default → tenant-fine-tuned → tenant-provided).
- **Async by default.** OCR + classification run on a GPU queue; synchronous API returns a task ID and a promise.
- **LangSmith traces every call.** Per-tenant trace bucket; per-prompt eval harness regression gates.

---

## 8. Integration hub

Full spec in [INTEGRATION_STRATEGY.md](./INTEGRATION_STRATEGY.md). Architecturally:

- Each adapter is an **independently deployable service** with its own versioning, contract tests, and Helm chart.
- Adapters publish/subscribe to the event bus; they do not hold state.
- Schema mapping is a tenant-level config, stored in Postgres; edited via the tenant admin UI.
- Every external call is recorded in an `integration_call` ledger for replay and audit.
- DLQ + exponential backoff + circuit breaker per integration.

---

## 9. API surface

Three clear layers:

### 9.1 Public API (v1, versioned)

- **REST** (OpenAPI 3.1 spec in `python-service/docs/openapi.yaml`).
- **Webhooks** — customers subscribe to events.
- **SDK** generated from OpenAPI: TypeScript, Python, Java.
- Auth: **JWT bearer** (for machine-to-machine) — note this is *different* from the SPA's HttpOnly-cookie-carried JWT; both validate the same token format.
- Rate limits, pagination, idempotency keys (`Idempotency-Key` header).
- Backward-compat guarantee for 12 months after deprecation.

### 9.2 Internal API (between services)

- gRPC where latency matters (AI inference, adapter calls).
- REST/JSON where tooling matters (tenant provisioning, admin).
- mTLS between services (via service mesh — Istio or Linkerd).

### 9.3 Tenant/admin API (platform ops)

- Under `/platform/*` — separate from tenant APIs.
- Tenant provisioning, metering export, support impersonation (audited, time-bounded).
- Access restricted to internal operator identities only.

---

## 10. Observability

- **Tracing:** OpenTelemetry → Tempo (or Jaeger / Honeycomb / Grafana Cloud). Every span includes `tenant_id`.
- **Metrics:** Prometheus → Thanos (long-term). Per-tenant dashboards in Grafana.
- **Logs:** structured JSON → Loki (or Elasticsearch). `tenant_id` as an indexed label.
- **AI:** LangSmith for LLM calls; Arize or Fiddler for model monitoring.
- **RUM:** Sentry / Datadog RUM on the SPA.
- **Synthetics:** uptime checks per tenant-facing endpoint.
- **Alerting:** Alertmanager → PagerDuty; alert routing per tenant tier.

Operator SLIs:
- **Availability:** 99.9% (pooled), 99.95% (silo, dedicated)
- **Latency (p95):** SPA page < 2s, API call < 300ms, AI classification < 3s, document upload → searchable < 5s
- **Data integrity:** zero cross-tenant access events in audit

---

## 11. Security posture (summary)

Full spec in [SECURITY_COMPLIANCE.md](./SECURITY_COMPLIANCE.md).

- **Zero-trust:** every internal call mTLS-authenticated via SPIFFE/SPIRE identities.
- **Encryption:** TLS 1.3 in transit, AES-256-GCM at rest, per-tenant KEK via Vault/KMS/HSM.
- **Auth:** JWT-in-HttpOnly-cookie (browser) or JWT bearer (API/SDK). RS256 with short-lived tokens + refresh rotation.
- **RBAC + ABAC:** roles + attribute-based policies via OPA (we have `opa/policies/dms.rego`).
- **WAF:** Cloudflare / AWS WAF rules + ML-based bot scoring.
- **DLP:** PII scanner on outbound API responses (Presidio + custom banking rules).
- **Rate limiting:** per-tenant, per-user, per-endpoint.
- **Secret management:** HashiCorp Vault; no secrets in env files.
- **Supply chain:** SLSA Level 3 provenance, signed container images (cosign), SBOM per release, dependency scanning (Snyk + Dependabot).

---

## 12. Mobile

Full spec in [ROADMAP.md §4 (Q4 2026)](./ROADMAP.md#4-q4-2026--docbrain-goes-deep).

- **Expo managed workflow** at GA (already in `mobile/`).
- **React Native bare** if native performance is a bottleneck (camera, OCR on-device).
- **Offline-first:** document capture queue, sync on network recovery.
- **Biometric auth:** Face ID / fingerprint / WebAuthn-passkeys where supported.
- **App distribution:** Private (enterprise) for tier-1, Public for tier-3/4.

---

## 13. Developer platform

- **Portal:** `developers.docmanager.io` — OpenAPI docs, quickstarts, SDKs, webhooks, sample apps.
- **Sandbox tenants:** zero-cost, seeded with synthetic data (we have `python-service/scripts/seed_synthetic.py`).
- **Changelog:** versioned, public.
- **Community channels:** dedicated Slack / Discord, status page, RFC process.

---

## 14. Disaster recovery

- **RPO:** 5 minutes (point-in-time recovery on Postgres + S3 cross-region replication).
- **RTO:** 1 hour (failover via Route53/Azure Traffic Manager → secondary region).
- **Backups:** Postgres WAL + daily snapshot, S3 cross-region replication, encrypted.
- **DR drills:** quarterly, documented; full-stack failover to secondary region tested.
- **Tenant-specific:** customer-triggered restore of a specific tenant from backup to their silo; per-customer contract terms govern retention.

---

## 15. Migration plan — current pilot → target

This is the work the [ROADMAP.md](./ROADMAP.md) executes. Mapping current → target below:

| Component (current) | Component (target) | Migration quarter |
|---|---|---|
| SQLite | Postgres (RLS-ready schema, pgvector) | Q2 2026 |
| Process-memory sessions | Redis Cluster | Q2 2026 |
| Local `uploads/` dir | S3 + SHA-256 CAS + KMS | Q2 2026 |
| No message bus | Kafka/Redpanda | Q2 2026 (skeleton) → Q3 (fan-out) |
| Session cookie auth | JWT-in-HttpOnly-cookie | Q2 2026 |
| No tenant_id | tenant_id everywhere + RLS | Q3 2026 |
| Tesseract OCR in Node | DocBrain OCR via GPU queue | Q3 2026 |
| Stub duplicate detect | pHash + vector similarity via Qdrant | Q3 2026 |
| Cron expiry-job | Temporal workflow | Q4 2026 |
| No observability | OTel + Prom + Loki + LangSmith | Q2 2026 (skeleton) → Q3 (dashboards) |
| 3 CBS adapter stubs in /py routers | 10 production adapters | Q4 2026 → Q2 2027 |
| Ad-hoc workflow in code | BPMN engine + designer | Q1 2027 |
| No tenant admin portal | apps/admin SPA | Q3 2026 |
| No certifications | SOC 2 II + ISO 27001 + regional | Q1 → Q3 2027 |

---

## 16. What NOT to build (architectural anti-list)

- No DIY cryptography (use libsodium / HashiCorp Vault / KMS).
- No shared tenant state in-memory (Redis with tenant-scoped keys only).
- No `SELECT * FROM documents` anywhere — all queries are tenant-filtered at the ORM layer.
- No synchronous OCR on the request path (always async via queue).
- No DIY auth (session cookie + JWT-in-cookie, use battle-tested libraries: `iron-session`, `jose`).
- No filesystem-as-database (all persistence goes through the data-plane services).
- No cross-tenant caches (every cache key prefixed with `tenant_id`).
- No silent LLM calls (every AI call logs tenant_id + prompt hash + model + cost + trace ID).
