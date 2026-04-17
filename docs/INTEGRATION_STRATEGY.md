# DocManager — Integration Strategy

> **How DocManager plugs into any bank's stack — the commercial moat we build on.**
>
> Implementation quarters: see [ROADMAP.md Q4 2026 → Q2 2027](./ROADMAP.md).
> Architecture context: [TARGET_ARCHITECTURE.md §8](./TARGET_ARCHITECTURE.md#8-integration-hub).

---

## 1. The problem we solve

Every bank we meet has the same story: "We bought a DMS five years ago, paid $X million for it, and we *still* don't have it integrated with our CBS / LOS / AML systems. Every new integration is a 6-month professional-services engagement."

This is not a technology problem. It is a **product design** problem. Legacy DMS vendors sell integration as services revenue. We flip it: **integrations are code, shipped as product, contract-tested in CI, priced into the subscription.**

When a buyer evaluates DocManager vs a legacy DMS, the decisive question is not "does it do OCR" or "does it have workflows." It's "**how fast can we go live?**" Our answer is weeks, not months. This document explains how we keep that promise.

---

## 2. Integration catalogue (target state)

### 2.1 GA launch (end of Q2 2027) — 10 adapters

| # | System | Vendor | Category | Interaction pattern |
|--:|---|---|---|---|
| 1 | **Temenos T24** | Temenos | Core banking (largest in MENA + EMEA) | REST + IRIS event stream |
| 2 | **FLEXCUBE** | Oracle | Core banking (large in GCC + India) | REST + JMS / webhook |
| 3 | **Finastra Fusion** | Finastra | Core banking + trade finance | REST + Kafka |
| 4 | **Mambu** | Mambu | Cloud-native core banking (neobanks) | REST + webhooks |
| 5 | **Thought Machine Vault** | Thought Machine | Cloud-native core (tier-1 modernisers) | REST + Kafka streams |
| 6 | **Oracle Banking Platform** | Oracle | Core banking (N.A., India) | REST + SOAP + JMS |
| 7 | **FIS Profile** | FIS | Core banking (US + Canada) | REST + batch SFTP |
| 8 | **Salesforce Financial Services Cloud** | Salesforce | CRM (customer master, cases) | REST + Platform Events |
| 9 | **DocuSign** | DocuSign | E-signature | REST + webhooks |
| 10 | **Microsoft Fabric** | Microsoft | Analytics / DW (data export) | OneLake / Delta tables |

### 2.2 Post-GA roadmap

Added in tranches. Q3 2027 onwards:

- **10x Banking** (tier-1 modernisers, UK/US)
- **Pismo** (Latam tier-2)
- **SWIFT AllianceAccess / SWIFT gpi** — MT/MX message ingest
- **ISO 20022 pacs.*** — SEPA / INTERAC / FedNow
- **ComplyAdvantage / NICE Actimize / Oracle FCCM** — AML screening
- **Jumio / Onfido / Trulioo** — eKYC (document verification + liveness)
- **Adobe Sign** — e-signature (alternative to DocuSign)
- **National eID schemes:** UAE Pass, Nafath (KSA), DigiLocker (India), SingPass, e-Estonia
- **Regulator portals:** CBE (Egypt), SAMA (KSA), RBI (India), ECB (EU), FED (US)
- **Azure AD / Okta / Ping / Google Workspace** — SSO/SCIM (part of platform, not "integration" strictly, but catalogued here)
- **Snowflake / Databricks / BigQuery** — analytics export via CDC
- **ServiceNow / Jira Service Management** — ops ticketing

### 2.3 Partner-built adapters

From Q3 2027, SIs and ISVs can ship adapters via our SDK. We run a certification program — tested against our sandbox — so a bank can trust a partner adapter the same way they trust ours.

---

## 3. What "integrated" actually means

For each adapter, we commit to these capabilities out of the box:

| Capability | Description |
|---|---|
| **Customer lookup** | Pull customer by CID/account number from CBS into DocManager (name, branch, KYC status, risk band) |
| **Customer sync** | Receive customer updates from CBS (address change, status change, new account) as events |
| **Document push** | Send approved KYC documents back to CBS with attachment IDs |
| **Document pull** | Retrieve existing documents from CBS (for migrations) |
| **Status feedback** | Notify CBS/LOS of document workflow transitions (approved / rejected / expired) |
| **Health monitoring** | Live health check per adapter exposed in admin UI |
| **Error surfacing** | Integration failures surface as in-app alerts with replay UI |
| **Audit trail** | Every external call logged with request/response hash for 7 years |
| **Circuit breaker** | Automatic degradation when upstream is failing; graceful UI messaging |
| **Idempotency** | Safe to retry without side effects |

Not every vendor API exposes all of these. Where the vendor is limited, we document the gap in the adapter's README and expose it in the tenant admin UI ("This adapter supports customer lookup but not document pull — we recommend migrating historical docs via our bulk-import tool.").

---

## 4. Adapter architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          DocManager Application                             │
│    documents · workflows · compliance · portal                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                   ▲
                                   │ tenant-scoped client
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Integration Hub (orchestrator)                          │
│                                                                             │
│  tenant config    ┌──────────────────────────────────────────────────────┐  │
│  (mappings,       │  Request routing · schema translation ·              │  │
│   credentials,    │  circuit breaker · rate limit · retry · DLQ · audit  │  │
│   endpoints) ────▶│                                                      │  │
│                   └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                   ▲
                                   │ uniform internal contract
                                   ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌───────┐
│ Temenos      │ │ FLEXCUBE     │ │ Finastra     │ │ Mambu        │ │ ...   │
│ adapter      │ │ adapter      │ │ adapter      │ │ adapter      │ │       │
│ (service)    │ │ (service)    │ │ (service)    │ │ (service)    │ │       │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘ └───────┘
       │                │                │                │               │
       ▼                ▼                ▼                ▼               ▼
  Temenos T24      Oracle           Finastra          Mambu          ...
  (on-prem / cloud) FLEXCUBE         Fusion           cloud
```

### 4.1 The uniform internal contract

Every adapter implements the same gRPC service definition:

```proto
service AdapterService {
  // Customer
  rpc LookupCustomer(LookupCustomerRequest) returns (Customer);
  rpc UpdateCustomer(UpdateCustomerRequest) returns (Customer);

  // Documents
  rpc AttachDocument(AttachDocumentRequest) returns (AttachDocumentResult);
  rpc FetchDocument(FetchDocumentRequest) returns (DocumentBytes);
  rpc ListDocuments(ListDocumentsRequest) returns (DocumentList);

  // Workflow callbacks
  rpc NotifyWorkflowTransition(WorkflowEvent) returns (Ack);

  // Health
  rpc Health(google.protobuf.Empty) returns (HealthStatus);
}
```

**Not every adapter implements every RPC.** Capabilities are advertised via:

```proto
rpc Capabilities(...) returns (CapabilityBitmap);
```

The integration hub reads capabilities at startup; the admin UI shows tenants which operations their CBS supports.

### 4.2 Schema mapping (per-tenant config)

```
DocManager canonical model          Tenant's CBS schema (mapped via UI)
─────────────────────────           ──────────────────────────────────
customer.cid                 ◀──▶   T24.CustomerId
customer.legal_name          ◀──▶   T24.Name (concatenation rule)
customer.dob                 ◀──▶   T24.DateOfBirth (format yyyy-MM-dd)
customer.risk_band           ◀──▶   T24.KycStatus (LOW/MED/HIGH → 1/2/3)
document.type = Passport     ◀──▶   T24.DocTypeCode = PP
document.expiry_date         ◀──▶   T24.ExpiryDate (format dd/MM/yyyy)
...
```

Mapping is **visual** — the tenant admin drags source fields onto DocManager fields in a UI. Mappings are validated against a JSON Schema derived from the adapter's metadata. Mapping changes are versioned and audited.

### 4.3 Credentials & secrets

- Credentials per tenant per adapter stored in Vault under `secret/tenants/{tenant_id}/integrations/{adapter}`.
- Short-lived access tokens fetched on demand; long-lived creds rotated quarterly (automated where the vendor API supports rotation).
- mTLS client certs (common with on-prem CBS) stored as secrets with cert-manager auto-renewal.

### 4.4 Patterns

Each adapter supports whichever patterns the upstream system supports:

| Pattern | When | Examples |
|---|---|---|
| **Synchronous REST** | Real-time lookups (customer CID → name) | Temenos T24 REST APIs, Mambu REST |
| **Webhook in** | CBS pushes an event to us (customer updated) | Mambu webhooks, Finastra events |
| **Kafka stream** | High-volume state change feed | Thought Machine Vault, Finastra Fusion |
| **File drop (SFTP)** | Nightly batch (common in FIS Profile, core banking migrations) | FIS Profile daily batches |
| **SOAP** | Legacy CBS (we don't love it but we speak it) | Oracle Banking Platform, older Temenos versions |
| **SWIFT** | Trade finance, payments documentation | MT700 LC issuance, MT103 credit |
| **Queue (IBM MQ / JMS)** | Enterprise ESB deployments | FLEXCUBE with MQ, Oracle AQ |

---

## 5. Contract testing — the unfair advantage

Every adapter has three layers of automated testing:

### 5.1 Unit tests (per adapter)

Standard Python / Go unit tests for the adapter logic.

### 5.2 Contract tests against vendor sandbox

- Every supported vendor exposes a sandbox — Temenos TCIB, FLEXCUBE demo, Finastra FusionFabric, Mambu sandbox, DocuSign demo, Jumio demo.
- **CI runs adapter tests against these sandboxes nightly.** A vendor API regression → we know by morning.
- Where sandboxes are rate-limited, we record/replay fixtures via VCR-style cassettes; refresh cassettes quarterly.
- Results published on an internal status page per adapter: green / yellow / red.

### 5.3 Compatibility matrix

Each adapter declares which **versions** of the upstream system it supports (Temenos R22 vs R23, FLEXCUBE 14.5 vs 14.6). CI runs against each supported version.

We publish this matrix publicly. Bankers love it:

```
                   R22    R23    R24 (beta)
DocManager v1.5    ✓      ✓      ◎
DocManager v1.6    ✓      ✓      ✓
DocManager v2.0    —      ✓      ✓
```

### 5.4 Partner-certified adapters

Partner-shipped adapters run through our certification test suite. A passing adapter carries a "Certified for DocManager vX.Y" badge; tenants can trust them the same way they trust ours.

---

## 6. Ingestion & sync patterns

### 6.1 Real-time customer lookup

```
Branch staff scans passport  ──▶  Capture screen
                                     │
                                     │ extracts CID via OCR + NER
                                     ▼
                              Integration Hub → Temenos adapter → T24
                                     │
                                     ◀── customer { name, branch, kyc_status }
                                     │
                              DocManager auto-fills metadata form
                                     │
                                     ▼
                              Staff confirms, document saved
```

### 6.2 Event-driven sync

```
┌─────────────────────────────────────────────────────────────────┐
│  Temenos T24 (customer updated: address changed)                │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 │ IRIS event stream (MQ / Kafka)
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  Temenos adapter service                                        │
│     · consume event                                             │
│     · translate to canonical model                              │
│     · enrich with tenant_id                                     │
│     · publish to Kafka topic: tenant.X.customer.updated         │
└─────────────────────────────────────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
      DocManager customer service    DocManager workflow engine
      updates local read model       triggers "re-verify address" workflow
```

### 6.3 Batch / reconciliation

For CBS systems that don't do events well (older FIS, FLEXCUBE 12, legacy SAP FS-CM):
- Nightly SFTP drop → adapter consumes → translates → emits events as if they arrived real-time.
- Reconciliation job flags drift between CBS and DocManager; ops team reviews in admin UI.

### 6.4 Outbound (DocManager → CBS)

```
Workflow completes: "KYC approved, attach to customer"
           │
           ▼
    Integration Hub publishes KYC approval event
           │
    ┌──────┴──────┐
    ▼             ▼
  Temenos       DocuSign
  adapter       adapter (if signed contract)
    │             │
    ▼             ▼
  POST to T24   Archive completed envelope
  with CID +
  doc pointer
```

Idempotency key in every outbound call so retries don't duplicate.

---

## 7. Migration tooling

Onboarding a new tenant usually includes migrating **existing** documents (hundreds of thousands to tens of millions). Our migration toolkit:

- **Inventory scanner** — read from the customer's current DMS (SharePoint, OpenText, filesystem), classify, estimate scope.
- **Migration pipeline** — stream-based, resumable, parallel. Preserves metadata, OCR text, audit trail where available.
- **Chain-of-custody** — every migrated document carries a provenance record (source system, source hash, migration time, operator).
- **Side-by-side mode** — new captures go to DocManager; lookups fan out to both DocManager and old DMS until cutover.
- **Rollback plan** — for 30 days after cutover, the old DMS is kept as read-only; DocManager data can be exported back if needed.

Typical migration: **100k docs = 2 days; 10M docs = 2 weeks**, parallel with our onboarding.

---

## 8. Change-data-capture (outbound)

Banks' data teams want our data in their warehouse. We commit to CDC out:

- Debezium on Postgres → Kafka → customer's Snowflake / Databricks / BigQuery / Fabric via fivetran/airbyte connector.
- Per-tenant, per-table opt-in.
- Schema evolution handled with Avro + schema registry.
- Access via a customer-specific IAM role; we never push credentials to the customer.

This turns DocManager into an **active data source** for the bank's analytics, not a black-box silo.

---

## 9. Webhooks framework

### 9.1 Outbound (customer subscribes)

- Tenants configure webhooks per event type from the admin portal.
- Delivery with HMAC signature, exponential backoff, DLQ after 10 retries.
- Customer can replay from the admin UI.
- Rate-limited per destination.

### 9.2 Inbound (customer posts to us)

- Versioned endpoints: `/v1/webhooks/{source}`.
- HMAC signature verification required.
- Request body stored raw for debug; processed async via a task queue.
- Response < 500ms always (processing is async).

---

## 10. Security considerations for integrations

- **No tenant data ever leaves the DocManager boundary unencrypted** — TLS 1.3 mandatory, cert pinning where the vendor supports it.
- **Credentials never exposed to logs or traces** — integration calls redact auth headers by framework default.
- **Per-adapter capability allowlist** — tenants explicitly enable each RPC; default deny.
- **Network segmentation** — adapter services run in their own namespace with network policies; CBS outbound allowed, inter-tenant allowed only via the event bus.
- **Vendor API key rotation** — automated where the vendor supports it; reminder + manual procedure where it doesn't, 90-day cadence.

---

## 11. Non-functional commitments per adapter

Shipped-product criteria (no adapter is "GA" without all of these):

- ☐ Docs page: intro, capabilities, configuration schema, required credentials, supported versions, known limitations.
- ☐ Admin UI: connection test, health indicator, live error feed, replay button.
- ☐ Observability: Prometheus metrics per RPC (QPS, latency, error rate), Grafana dashboard template.
- ☐ CI: nightly sandbox run, 5+ scenario tests, regression gate.
- ☐ Sample data: end-to-end demo tenant that a buyer can click through in the sandbox environment.
- ☐ Runbook: what to do when the adapter's health goes red.
- ☐ Migration path: if the vendor releases a new major version, how do we upgrade the adapter.

---

## 12. Commercial packaging

- **Included in all tiers:** SSO, basic webhooks, 3 adapters from the catalogue.
- **Tier-2 and above:** all catalogued adapters, event streaming out (CDC).
- **Tier-1 only:** custom adapter SLA (if the tenant needs a CBS we haven't built yet, we commit to building it within a quarter for a fee).
- **Partner-built adapters:** procured from the partner directly; DocManager earns a revenue share.

Pricing never depends on call volume below a "fair use" ceiling. We do not nickel-and-dime.

---

## 13. Metrics that matter

| Metric | Target |
|---|---|
| Time from contract signed to first successful integration health-check | **≤ 7 days** |
| Time from contract signed to go-live on first end-to-end workflow | **≤ 45 days (Y1), ≤ 14 days (Y3)** |
| Adapter nightly test pass rate | **≥ 99%** |
| Integration incidents per tenant per quarter | **≤ 1** |
| % of tenants using ≥ 3 adapters | **≥ 80%** |

---

## 14. The anti-list

Things we will NOT do on the integration front:

- **No bespoke integration work sold as PS.** All adapters are product; partners do PS if the customer needs customisation.
- **No screen scraping.** If the vendor has no API, we recommend a partner RPA tool, we don't become one.
- **No promises about vendors we haven't tested against.** We say "coming soon"; we don't ship a fiction.
- **No "universal adapter."** Every vendor is different; pretending otherwise is how the legacy DMS vendors ended up shipping empty frameworks.
- **No data brokering.** We never aggregate tenant data across tenants to sell insights. Tenant data belongs to the tenant. Period.

---

## 15. Decision log

| # | Question | Status |
|---|---|---|
| I1 | gRPC vs REST for internal adapter contract | Leaning gRPC; final decision 2026-07-01 |
| I2 | Whether to include a lightweight ETL engine for migrations, or rely on partners | Leaning in-house for v1; revisit Q3 2027 |
| I3 | Whether to offer a "universal JDBC" adapter for home-grown CBSs | Against; would dilute quality claim |
| I4 | Partner revenue share: flat 20% or tiered | Open; GTM decides by Q4 2026 |
