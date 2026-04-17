# DocManager — Roadmap

> **Quarterly execution plan from NBE pilot through GA to platform maturity.**
> Paired with [VISION.md](./VISION.md) (the *why*) and [TARGET_ARCHITECTURE.md](./TARGET_ARCHITECTURE.md) (the *how*).

Last updated: 2026-04-17 · Horizon: **7 quarters (Q2 2026 → Q4 2027)**

---

## 0. Reading this document

- Work is broken into **tracks** that run in parallel, not a single waterfall.
- Each quarter has **objectives** (outcomes we commit to) and **key deliverables** (shippable artifacts).
- **Exit criteria** per quarter are binary — either we've met them or we slip the next quarter.
- "NBE" = the Tier-1 pilot customer, National Bank of Egypt.
- Dates assume a **5-pod team** at Q3 2026 scaling to **8 pods** by Q2 2027 (see §8).

---

## 1. Milestone map

```
  Q2 2026         Q3 2026         Q4 2026         Q1 2027         Q2 2027         Q3 2027         Q4 2027
  ────────        ────────        ────────        ────────        ────────        ────────        ────────

  NBE GO-LIVE     MULTI-TENANT    DocBrain AI     WORKFLOW 2.0    INTEGRATION     CERT & SCALE    TIER-1 GA
  (single         FOUNDATION      (RAG + NER +    (BPMN + DMN     HUB (10         (SOC 2 Type II  (on-prem air-
  tenant)         (tenant_id,     forgery +       + designer)     adapters)       + ISO 27001)    gap, edge,
                  BYOK,                                                                            GLOBAL)
  ▽               provisioning)   signature)
  M1 shipped
  (Apr 17)        Track A cont.   Track A cont.   Track A cont.   Track A cont.   Track A cont.   Track A cont.
                  M2 screens      AI screens      Workflow UI     Integration     Ops hardening   v1.5
                  + Postgres      + DocBrain      + Designer      Hub UI +        + DR drills     + partner
                  + Redis + S3    search          + Simulator     marketplace     + SOC 2                 ecosystem
                                                                                  audit pass

  Track B ▸ Multi-tenant foundation ──────────────────────────────────────────────────────────────────────────▶
  Track C ▸ DocBrain (AI) ────────────────────────────────────────────────────────────────────────────────────▶
  Track D ▸ Workflow Engine 2.0 ─────────────────────────────────────────────────────────────────────────────▶
  Track E ▸ Integration Hub ─────────────────────────────────────────────────────────────────────────────────▶
  Track F ▸ Security / Compliance / SRE ─────────────────────────────────────────────────────────────────────▶
```

---

## 2. Q2 2026 — **Ship NBE, lay the foundation rails**

**8 weeks (2026-04-17 → 2026-06-12)** · Team: 3 pods (Frontend, Backend, SRE)

### Objectives

- NBE production deployment of DocManager v1.0 on a single-tenant stack, zero open P0/P1 bugs.
- Swap every single-node assumption in the codebase (SQLite, filesystem uploads, in-memory sessions) for cloud-ready equivalents **without changing the UI**.
- Lock in engineering hygiene (CI, observability, deploy playbooks) that every later track depends on.

### Key deliverables

**Product / UI (M2 + M3 of the original plan)**

- ✓ Workflows screen (approve/reject/escalate, maker-checker chain, reassign).
- ✓ Workflow Templates (list, edit, clone, publish).
- ✓ Indexing / QA queue (documents missing metadata → human review).
- ✓ Reports & BI (KPI dashboards, exportable).
- ✓ Admin (retention policies editor, audit viewer, background-job status).
- ✓ Security & RBAC (user CRUD, role assignment, lock/unlock, session list).
- ✓ MFA enrolment in the SPA (TOTP via speakeasy; webauthn-ready).
- ✓ Compliance / Audit screen (events + filters + export).
- ✓ Integration status dashboard (read-only health of CBS/LOS/AML stubs).

**Platform foundations**

- Postgres migration (from SQLite), Alembic migrations on both Node and Python sides.
- Redis session store (session cookie still our auth — but stored in Redis, not process memory).
- S3-compatible object storage (MinIO in dev, AWS S3 / Azure Blob in prod) for `/uploads/*` — SHA-256 CAS already partially done in Python service (`python-service/app/services/storage.py`).
- Kafka (or Redpanda for lower ops overhead) — event bus skeleton, even if only two topics (`documents.uploaded`, `workflows.transitioned`) are live at quarter end.
- JWT-in-HttpOnly-cookie auth model — backward compatible with session cookie, adds stateless verification downstream.
- OpenTelemetry instrumented on Node and Python; Grafana + Loki + Tempo in a docker-compose for local, Helm-deployable for staging.
- GitHub Actions pipeline runs: `tsc`, `pytest`, `playwright`, `helm lint`, `terraform validate`, SBOM generation, Trivy container scan, `semgrep` SAST. **All green before merge.**
- Helm chart for DocManager (web + node + python + worker + redis + postgres + kafka + minio in dev mode).
- `./start.sh` stays working locally for developer productivity; production deploys via Helm + ArgoCD.

**Security/Compliance groundwork**

- Threat model document (STRIDE per subsystem — the python-service has `/routers/stride.py` stub).
- Dependency scanning live in CI (Snyk / Dependabot + GitHub Advanced Security).
- CSP headers on the SPA; per-request CSRF token on state-changing routes.
- Immutable audit log (hash-chained; anchor to external source Q4).

### Exit criteria

- [ ] NBE's 40 branch users can perform: login with MFA, capture, index, workflow approve/reject, search, download, delete (admin-only), audit review.
- [ ] Load test: 100 concurrent users, 500 uploads/hour, p95 < 2s on every SPA page. (Use existing `loadtest/k6.js`.)
- [ ] Zero P0/P1 bugs open. ≤ 5 P2 bugs open with owners.
- [ ] Uptime on a 2-week staging soak: ≥ 99.9%.
- [ ] CI green on every commit for the final 2 weeks of the quarter.
- [ ] SOC 2 Type I audit initiated (evidence collection begins).

### Risks & mitigation

| Risk | Mitigation |
|---|---|
| SQLite→Postgres migration introduces regression in FTS5 search | Keep FTS5 on Postgres via `pg_trgm` or wire Meilisearch/OpenSearch as a parallel search backend behind a feature flag. |
| NBE's integration (CBS lookup) is a gap until Q3 | Stub the integration in Q2 with a recorded-response mock; hide the "Verify with CBS" button behind a feature flag for NBE. |
| Team is still small (3 pods) | No new verticals added. Everything not on this list is Q3+. |

---

## 3. Q3 2026 — **Multi-tenant foundation + early AI**

**12 weeks (2026-06-13 → 2026-09-04)** · Team: 5 pods (add Platform pod, AI pod)

### Objectives

- Make the system genuinely multi-tenant: no single-tenant assumption left anywhere in code or infrastructure.
- Onboard a **second pilot bank** (ideally a Tier-2 African or Gulf bank) on a silo deployment.
- Ship the first AI features end-to-end (classification + NER) through DocBrain.

### Key deliverables

**Track B — Multi-tenant foundation**

- `tenant_id` on every row, every S3 key, every Kafka message, every log line, every metric label. Enforced by Postgres Row-Level Security (pooled tier) and separate schemas (silo tier).
- Tenant provisioning API: `POST /platform/tenants` spins up a tenant in < 5 minutes — DB objects, encryption keys, seed users, default workflows, default branding.
- Tenant admin portal (separate SPA at `apps/admin`): provision, suspend, impersonate-with-audit, usage dashboards, billing export.
- BYOK encryption: per-tenant KEK stored in Hashicorp Vault (or AWS KMS / Azure Key Vault); data-encryption-keys wrapped by tenant KEK.
- SCIM 2.0 endpoint for auto user provisioning from Azure AD / Okta.
- Per-tenant subdomain routing (nbe.docmanager.io, acme.docmanager.io) with strict Same-Site cookies.
- JWT claims: `tenant_id`, `roles`, `branch`, `permissions` — replaces session-only model; browser still gets HttpOnly cookie but wire-format is JWT (align with apex).

**Track C — DocBrain v0.1 (first AI)**

- Self-hosted Llama 3.1 8B via Ollama on dedicated GPU node (dev cluster only this quarter).
- Vector DB: Qdrant (tenant-scoped collections).
- LangChain orchestrator — single LangGraph workflow: *upload → classify → extract entities → write to document metadata → index to vector DB*.
- LangSmith observability for every LLM call, trace + latency + cost per tenant.
- Document classifier fine-tuned on 30 KYC-style banking doc classes (passport, national ID, utility bill, salary cert, bank statement, trade license, …) using synthetic + public + NBE-shared corpus. Target 95% F1 on held-out set.
- NER model for customer CID, doc number, dates, issuing authority, addresses. English + Arabic.
- UI: Capture screen gets "AI suggested" fields pre-filled after upload; user confirms or overrides.

**Track F — Security/Compliance**

- SOC 2 Type I report delivered.
- ISO 27001 Stage 1 audit passed.
- Penetration test #1 (external firm — Cobalt, NCC Group, or Sygnia).
- Cryptographic audit chain signed & anchored to an external source (Git, public blockchain, or regulator TSA) — we have `/routers/anchor.py` stub.

### Exit criteria

- [ ] Second bank (pilot) live on silo tier with < 45-day onboarding.
- [ ] Provisioning a new tenant: < 5 minutes, fully automated.
- [ ] Tenant-isolation penetration test: zero cross-tenant data access demonstrated.
- [ ] DocBrain classifier: ≥ 95% F1 on 30 bank doc classes, ≥ 92% on Arabic subset.
- [ ] p95 latency for classification: < 3 seconds on a 5-page PDF.
- [ ] Two tenants serving in production simultaneously; load test at 500 concurrent users sustained for 1 hour.
- [ ] SOC 2 Type I delivered; ISO 27001 Stage 1 passed.

---

## 4. Q4 2026 — **DocBrain goes deep**

**10 weeks (2026-09-05 → 2026-11-14)** · Team: 6 pods (add Mobile pod)

### Objectives

- Move from "AI assist" to "AI decisions with human oversight" — 35% of documents clear without human review at target confidence.
- Ship in-product **RAG chat** ("ask questions about this customer's documents").
- Ship forgery detection + signature verification as trust signals visible in the workflow UI.

### Key deliverables

**Track C — DocBrain v1.0**

- **RAG** over customer document history: tenant-scoped vector store, citations mandatory in answers, source document linkable.
- **Multi-model routing**: cheap Llama 3.1 8B for classification, 70B only for reasoning / chat (auto-routed).
- **Forgery detection** pipeline (ELA + noise residual + LayoutLM anomaly). Uses `/routers/adversarial.py` stub.
- **Signature verification** (ArcFace-style Siamese net comparing captured signature to KYC signature on file).
- **Face match** productionized (already stubbed in `/routers/face.py`).
- **Summarisation** of long documents (loan agreements, policies) with citation-bound output.
- **Guardrails**: Presidio + custom banking-specific PII redactor; prompt-injection filter; output hallucination check before display.
- **Eval harness**: automated evaluation per prompt, per model — regression gates on deployment.
- UI: new "DocBrain" panel on document viewer (classification, extracted entities, forgery score, signature match, related docs).
- UI: "Ask the documents" chat surface (scoped to customer or case).

**Track D — Workflow Engine 2.0 begins**

- Integrate Temporal (or Camunda Zeebe — decision point at start of quarter). Temporal favored for dev velocity; Zeebe favored for BPMN-fidelity and compliance familiarity.
- Port existing workflows (expiry renewal, retention purge, maker-checker) onto the new engine.
- Event sourcing for every document state transition.

**Track E — Integration Hub kickoff**

- First 3 adapters shipped: Temenos T24, FLEXCUBE, Finastra (the three largest CBS platforms by bank count).
- Visual field-mapper MVP.
- Adapter contract-testing framework (record/replay against vendor sandboxes).

**Track A — Mobile**

- Branch officer native-capable Expo build; biometric login (Face ID / Fingerprint) + offline queue + background sync.
- The existing `mobile/` app is an Expo MVP — evaluate ejection to bare React Native if native performance becomes a bottleneck.

### Exit criteria

- [ ] 35%+ of incoming documents processed end-to-end with zero human touch at ≥ 95% confidence.
- [ ] RAG chat answers with mandatory citations; measured hallucination rate < 2%.
- [ ] Forgery detector: false-positive rate < 5% on a curated test set, recall > 80% on known tampered docs.
- [ ] 3 CBS adapters contract-tested in CI nightly.
- [ ] Mobile app passes iOS App Store + Google Play private-distribution review.

---

## 5. Q1 2027 — **Workflow Engine 2.0 (compliance-editable)**

**12 weeks** · Team: 7 pods (add Design pod)

### Objectives

- Workflow changes no longer require engineering — a compliance officer drags, drops, publishes.
- 20 pre-built banking workflow templates become the product's "day-one value."

### Key deliverables

**Track D — Workflow**

- BPMN 2.0 visual designer built with `@xyflow/react` (React Flow), full schema compliance with the BPMN DI standard (export/import from/to Camunda Modeler).
- DMN decision tables editor (same designer, new palette) — compliance rules in plain English + conditions.
- Simulation mode: run a proposed workflow change against last-week's traffic before deploying.
- Workflow versioning with in-flight migration (old instances complete on old version; new ones start on new).
- 20 pre-built template library:
  1. New customer KYC onboarding
  2. Corporate KYC onboarding
  3. Loan application — personal
  4. Loan application — SME
  5. Loan application — corporate
  6. Mortgage application
  7. Credit card application
  8. Account closure
  9. Beneficiary update
  10. Address change
  11. Document expiry renewal
  12. Sanctions re-screen
  13. High-risk customer periodic review
  14. Trade finance — LC issuance
  15. Trade finance — LC amendment
  16. Remittance documentation
  17. Dormant account reactivation
  18. POA update
  19. Deceased customer handling
  20. Fraud case handling
- Human task inbox (maker/checker work queues) with SLAs and escalation.

**Track E — Integration Hub**

- Adapters 4–7: Mambu, Thought Machine, Salesforce Financial Services, DocuSign.
- SWIFT MT / MX message ingestion (MT103, MT700, MT799, pacs.008 etc.) → auto-index into DocManager.
- Webhook framework: bidirectional (inbound from CBS, outbound to tenant systems).

**Track F — Compliance**

- SOC 2 Type II — 6-month observation window complete, audit in progress.
- NCA ECC (KSA Essential Cybersecurity Controls) cert initiated.
- CBE (Central Bank of Egypt) document-management regulation attestation.

### Exit criteria

- [ ] A non-engineer compliance officer (with training) can deploy a workflow change end-to-end in < 30 minutes.
- [ ] 20 templates cataloged; new tenant onboarding uses them as starting point → < 20 days to first live workflow.
- [ ] SOC 2 Type II issued.
- [ ] 4 additional CBS/adjacent adapters live (total 7).

---

## 6. Q2 2027 — **Integration Hub GA + 5 more adapters**

**12 weeks** · Team: 8 pods (add Partner / BD Engineering pod)

### Objectives

- Claim integration leadership. 10 adapters, contract-tested, documented, purchasable.
- Launch partner program: SIs can certify on our platform and resell implementation.

### Key deliverables

**Track E — Integration Hub GA**

- Adapters 8–10: Oracle Banking, FIS Profile, Microsoft Fabric.
- Adapter marketplace in the tenant admin portal — activate, configure, monitor.
- Event-driven change-data-capture (CDC) from DocManager → tenant's data warehouse (Snowflake / Databricks / BigQuery).
- Partner portal with SDK, sandbox tenant, certification program.

**Track A — Product polish**

- Customer portal embed kit (bank-branded document uploads for end-customers).
- Advanced search: faceted, filter-builder, saved searches, alerts on searches.
- "Document diff" — already in `/routers/doc_diff.py` — surface in UI for contract amendments.
- "Document timeline" — full version history + annotation layers.

**Track F — SRE / Scale**

- Multi-region active-active (primary EU/AWS, secondary KSA/local cloud).
- Auto-scaling hits 1,000 concurrent SPA users per tenant × 100 tenants.
- Chaos engineering on staging (LitmusChaos or Gremlin) as part of release checklist.
- Quarterly DR drill with documented RTO < 1 hour, RPO < 5 minutes.

### Exit criteria

- [ ] 10 adapters GA, 100% contract-tested nightly in CI.
- [ ] At least 1 SI partner certified and delivering.
- [ ] Platform hits 20 live tenants, 1M documents/day sustained.
- [ ] DR drill passes with RTO ≤ 1h, RPO ≤ 5min.

---

## 7. Q3 2027 — **Certifications, scale, central-bank readiness**

**12 weeks** · Team: 8 pods

### Objectives

- Unblock tier-1 sales. All certs that central banks and top-5 national banks demand — delivered.
- Scale-test to 10k docs/sec ingestion, 10M-doc tenants.

### Key deliverables

**Track F — Compliance**

- **ISO 27001** full certification.
- **PCI-DSS SAQ-D** (for tenants storing card PANs in documents).
- **NCA ECC** cert for KSA.
- **CBE compliance attestation** for Egyptian banks.
- **RBI cybersecurity framework** attestation for Indian banks.
- Third-party VAPT #2 (different firm from #1); public bug bounty program live (HackerOne or Intigriti).
- Supply-chain hardening: SLSA Level 3 provenance on all releases (we have `.github/workflows/supply-chain.yml` stub); reproducible builds; signed container images; SBOM per release.

**Track A — Central-bank feature set**

- Air-gapped deployment mode — we have `scripts/build_airgap.sh` stub; Q3 hardens it.
- Sovereign AI: **no LLM egress ever** under air-gap mode; models bundled with release.
- HSM-backed key custody (Thales, Entrust).
- Advanced redaction (manual + AI-proposed) already stubbed in `/routers/redaction.py`.
- Transparency logs (verifiable claim-log for external regulator inspection) — `/routers/transparency.py`.

**Track E — Ecosystem**

- Adapter SDK for third-party developers to ship their own.
- First third-party adapter shipped (e.g. a regional CBS or a specialized KYC vendor).

### Exit criteria

- [ ] Certifications above, all delivered.
- [ ] Tier-1 reference customer signed (central bank or top-5 national bank).
- [ ] Air-gapped install runs a full smoke-test suite, zero egress events.
- [ ] Load test: 10k documents/sec ingestion sustained for 1 hour.

---

## 8. Q4 2027 — **GA v1.5, global, partner-led**

**12 weeks** · Team: 10 pods

### Objectives

- Product growth is partner-led, not bespoke sales-led.
- Product feels "finished" to an outside analyst (Gartner MQ / Forrester Wave submission ready).

### Key deliverables

- **20 adapter marketplace** (10 more adapters shipped by internal team + 5 more by partners).
- **Workflow marketplace** — pre-built, buy-and-deploy vertical workflows per region (Gulf KYC, SEPA onboarding, RBI loan pre-sanction, ECB sanctions re-screening).
- **Edge OCR**: Cloudflare Workers / AWS Lambda@Edge for sub-100ms scan results on capture.
- **AI v2.0**: fine-tuned models per tenant tier (shared baseline → optional per-tenant fine-tune).
- **Language coverage**: English, Arabic, French, Urdu, Hindi, Swahili — production-grade.
- **Analyst-ready** demo scripts, reference architectures, public case studies (3 live).
- **Submissions**: Gartner MQ Banking Document Management, Forrester Wave ECM for Financial Services.

### Exit criteria

- [ ] 30+ live tenants.
- [ ] $10M+ ARR.
- [ ] Analyst evaluations submitted (MQ + Wave).
- [ ] < 5% gross annual churn on Year-1 cohort.

---

## 9. Parallel continuous tracks

These run quarter-after-quarter with dedicated headcount:

### Track A — Product & UX

- Every quarter: ≥ 5 customer-visible improvements, always A/B-tested against NPS.
- UX research cadence: 5 customer interviews + 5 branch shadowing visits per quarter.
- Design system iteration: stay pixel-aligned with apex (shared token package `@docmanager/tokens`).

### Track C — AI

- Monthly model re-training with fresh labeled data (tenants opt-in to share anonymised corrections).
- Quarterly new-capability spike (e.g. table extraction, handwriting OCR, seal/stamp detection, cross-document entity linking).
- LangSmith-monitored regression eval on every deploy.

### Track F — Security / Compliance

- Monthly third-party dependency + container scan review.
- Quarterly threat model refresh (STRIDE).
- Semi-annual third-party VAPT, rotating firms.
- Continuous compliance monitoring (Vanta / Drata or in-house).

### Track G — Developer Experience

- Monthly DX retrospective — is the team shipping faster? If not, invest.
- API changelog and migration guides published per quarter.
- Internal "platform day" quarterly — a 2-day hackathon on DX improvements.

---

## 10. Team scaling

| Quarter | Pods (cumulative) | What's new |
|---|---|---|
| Q2 2026 | 3 (FE, BE, SRE) | Starting position |
| Q3 2026 | 5 | + Platform pod (multi-tenancy), + AI pod |
| Q4 2026 | 6 | + Mobile pod |
| Q1 2027 | 7 | + Design pod (workflow designer + visual tooling) |
| Q2 2027 | 8 | + Partner / BD Engineering pod (adapters, SI enablement) |
| Q3 2027 | 8 | (no growth; deepen) |
| Q4 2027 | 10 | + Analyst / Eval pod (MQ/Wave submissions, reference architectures), + International pod (language & regional regulatory) |

Each **pod** = 1 Staff or Senior Engineer + 2–4 engineers + 0.5 PM + 0.5 Designer + embedded QA.

---

## 11. What we will NOT do (anti-roadmap reaffirmed)

See [VISION.md §9](./VISION.md#9-what-we-say-no-to--the-anti-roadmap). Not repeating here, but every quarter this is reviewed in the pod leads sync. Feature creep is the single greatest risk to a vertical SaaS.

---

## 12. Decision log — open questions

Issues we need a call on, listed with owners and due dates:

| # | Question | Owner | Due | Status |
|---|---|---|---|---|
| D1 | Temporal vs Camunda Zeebe for workflow engine | Eng lead | 2026-09-01 | Open; lean Temporal |
| D2 | Kafka vs Redpanda | SRE lead | 2026-07-01 | Open; lean Redpanda |
| D3 | Llama 3.1 vs Mixtral for classifier base | AI lead | 2026-07-15 | Open; lean Llama 3.1 |
| D4 | Qdrant vs pgvector for vector DB | AI lead | 2026-07-15 | Open; pgvector for pooled, Qdrant for silo/dedicated |
| D5 | Keep JavaScript SPA or split apex into a DocManager-specific fork of apps/banking | Eng + Design | 2026-08-01 | Open; lean keep standalone |
| D6 | SaaS tier-3 pricing: usage-based or seat-based | Product + GTM | 2026-09-30 | Open |
| D7 | GA launch marketing positioning — "document AI for banks" vs "modern DMS for banks" | GTM | 2026-12-31 | Open |

---

## 13. How this plan changes

This roadmap is reviewed **monthly by pod leads**, **quarterly by exec**, and **before every major commitment** (cert audit, customer contract, hiring wave).

Changes go through a short RFC ( `docs/rfcs/NNN-title.md`) with pro/con/impact and a 5-business-day review window. After approval, the change is applied to this file and noted in the changelog at the bottom.

### Changelog

| Date | Change | Author |
|---|---|---|
| 2026-04-17 | Initial roadmap | docs-platform |
