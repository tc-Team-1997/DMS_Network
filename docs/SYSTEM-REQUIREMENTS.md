# ZorDMS — System Requirements (On-Premises)

**Project:** Document Management System (DMS) Implementation — Bank of Bhutan Ltd. (BOBL)
**Deployment model:** On-Premises (bank data centre + DR site) · no cloud / no internet egress
**Basis:** Requirements Discussion MoM dated **25 June 2026** + AI/IDP architecture (`services/ai`)
**Prepared by:** Datanetworks Consultancy · **Version:** 0.1 (draft, pending bank inputs)

> Scope: this document specifies the **system / infrastructure requirements only** (hardware,
> platform, security, sizing, AI/GPU, supporting tier, DR). Functional scope, document flow,
> API contracts, RBAC detail, and migration approach are deferred to the Functional Workshops
> per the MoM.

---

## 1. Sizing verdict (is the proposed system sufficient?)

The MoM confirms **~100 concurrent users**. Against the published sizing profiles:

| Driver | MoM value | Maps to | Sufficient? |
|---|---|---|---|
| Concurrent users | ~100 | **Small** (rated up to ~300) | ✅ Load is comfortably within Small |
| High availability expected | Yes | Small is HA on app/CP/DB, **single GPU** | ⚠️ GPU is a single point of failure in Small |
| Customer base / branches | ~400K customers / 45 branches | **Medium** baseline (per profile note) | ➜ drives the recommendation |

**Conclusion:** Small *meets the 100-user load*, but its single L40S GPU has no AI-inference
redundancy. Given the bank's stated HA expectation and the 400K-customer footprint, **adopt
the Medium profile as the go-live baseline** (2× L40S, 3-node Postgres, 4× app servers). Use
**Small as the DR-site floor**. Scale to **High** as concurrency approaches ~1,000+ or document
volume grows (figures pending from the bank).

---

## 2. Recommended go-live profile (Medium) — per site

| Component | Spec | Qty | Notes |
|---|---|---|---|
| **App / compute (K8s workers)** | 16 vCPU / 64 GB | 4 | Hosts gateway, core DMS, search, workflow, notify, AI service pods |
| **K8s control plane (HA)** | 4 vCPU / 16 GB | 3 | RKE2 / k3s; stacked or external etcd |
| **Database (PostgreSQL HA)** | 8 vCPU / 32 GB / 1 TB NVMe | 3 | Primary + 2 replicas; sync + async standby |
| **GPU — AI/LLM inference** | NVIDIA L40S (48 GB) | 2 | vLLM; Granite Vision (classify) + Qwen-VL (extract) fit on one 48 GB card; 2nd = redundancy + throughput |
| **Object storage (MinIO/Ceph)** | usable | ~50 TB | Document blobs; erasure-coded |
| **Indicative total** | ~300 vCPU / ~1.1 TB RAM | — | Excludes supporting tier below |

**Supporting tier (every profile, per site):**

| Service | Qty | Purpose |
|---|---|---|
| Elasticsearch / OpenSearch | 3 | Full-text & metadata search index |
| Kafka | 3 | Event bus (capture → classify → catalog, notifications, audit fan-out) |
| Management VLAN | — | **Harbor** (offline registry), **Keycloak** (SSO/IdP broker), **Vault** (secrets/KMS), **GitLab** (CI/artifacts), **Prometheus + Grafana** (monitoring) |

**Profiles for reference:**

| Component | Small (≤~300 users) | Medium (≈300–1,000) ✅ go-live | High (≈1,000–2,500+) |
|---|---|---|---|
| App / compute | 2 × (16 vCPU/64 GB) | 4 × (16 vCPU/64 GB) | 8 × (16 vCPU/64 GB) |
| K8s control plane (HA) | 3 × (4 vCPU/16 GB) | 3 × (4 vCPU/16 GB) | 3 × (4 vCPU/16 GB) |
| Database (PostgreSQL HA) | 2 × (8 vCPU/32 GB/1 TB) | 3 × (8 vCPU/32 GB/1 TB) | 3 × (16 vCPU/64 GB/2 TB) |
| GPU (L40S 48 GB) | 1 | 2 | 4 |
| Object storage (usable) | ~20 TB | ~50 TB | ~150 TB |
| Indicative total | ~120 vCPU / ~0.5 TB RAM | ~300 vCPU / ~1.1 TB RAM | ~600 vCPU / ~2.2 TB RAM |

> All figures are **per site**. The **DR site mirrors the same data tier**, with compute sized
> for failover (Small profile acceptable at DR for a 100-user load).

---

## 3. Platform & software stack (on-prem, air-gapped)

| Layer | Technology | Requirement |
|---|---|---|
| Orchestration | Kubernetes (RKE2 / k3s) | HA control plane (3 nodes); CNI with NetworkPolicy support |
| Container registry | Harbor (offline) | All images pre-loaded; no Docker Hub / public pull |
| App runtime | Node.js services + Python AI service (FastAPI) | Per-service pods, HPA-scaled |
| Relational DB | PostgreSQL (HA) | Streaming replication; PITR backups; Oracle-compatible switch available (`oracle+oracledb://`) |
| Search | Elasticsearch / OpenSearch (3-node) | Index metadata + OCR text |
| Event bus | Kafka (3-broker) | Capture/classify/catalog pipeline + audit |
| Object store | MinIO or Ceph | S3-compatible; versioned buckets; erasure coding |
| AI inference | **vLLM** (OpenAI-compatible) on GPU nodes | See §6; fully local, no external LLM provider |
| Secrets / KMS | HashiCorp Vault | Encryption keys, DB creds, JWT secrets |
| Identity broker | Keycloak | Bridges bank SSO / domain auth to the app (§5) |
| Observability | Prometheus + Grafana + log aggregation | SLO dashboards, alerting |

**Internet dependency:** none at runtime. Updates ship via the air-gap bundle process
(`python-service/docs/AIRGAP.md`) — quarterly image rebuilds, monthly wheel refresh, 48-h
emergency CVE path.

---

## 4. Storage & document handling

| Item | Requirement / decision | Source |
|---|---|---|
| Current storage | File-based repository (legacy) | MoM 1.B |
| Target storage | S3-compatible object store (MinIO/Ceph), versioned | This spec |
| Max file size | **Recommend 4 MB** (bank to confirm) | MoM 1.B |
| Supported formats | PDF, PNG/JPG/TIFF (scans), Office docs — final list pending | MoM / Functional |
| Volume / annual growth | **Pending from bank** — drives object-store sizing (~20/50/150 TB tiers) | MoM §4 |
| Metadata / indexing / versioning | **Pending from bank**; system supports per-doc-type metadata schemas + versioning | MoM 1.B |
| OCR / extraction | Local two-stage IDP (classify → extract every field as metadata) | `services/ai` |

> **Sizing caveat:** object-store capacity (and therefore the Small/Medium/High choice on the
> storage axis) **cannot be finalized** until the bank provides total document count, current
> storage size, and annual growth. The 50 TB Medium figure is an interim assumption.

---

## 5. Security & identity

| Control | Requirement | Source |
|---|---|---|
| Authentication | **Domain-based authentication** | MoM 1.C |
| SSO | **Provided by the bank**; brokered via Keycloak; SSO endpoints/APIs **pending** | MoM 1.C / §4 |
| Access control | Role-based (RBAC); detailed permission matrix in Functional Workshop | MoM 1.C |
| Encryption in transit | TLS 1.2+ everywhere (ingress, inter-service, DB); standards **pending from bank** | MoM 1.C |
| Encryption at rest | DB TDE + object-store SSE + Vault-managed keys; standards **pending from bank** | MoM 1.C |
| Audit logging | Tamper-evident audit trail; detailed requirements in Functional Workshop | MoM 1.C |
| Network | Segregated management VLAN; NetworkPolicy isolation; **no outbound internet** | This spec |
| Secrets | Vault; no plaintext creds in config/images | This spec |

---

## 6. AI / GPU tier (fully on-premise)

- **Two-stage IDP pipeline** served via **vLLM** (OpenAI-compatible API), no Claude/OpenAI:
  - **Stage 1 — classify:** Granite 3.2 Vision 2B (upgradeable to Granite 4.0 3B Vision).
  - **Stage 2 — extract:** Qwen2.5-VL 7B (constrained JSON, Pydantic-validated) — extracts
    each field with per-field confidence and routes low-confidence docs to human review.
  - **Text/RAG copilot + auxiliary** (summarize, covenants, compliance, retention NL) served by
    a local text model on the same GPU tier. See [`ON-PREMISE-AI.md`](./ON-PREMISE-AI.md).
- **GPU fit:** both vision models fit on a single 48 GB L40S; the **2nd L40S (Medium)** provides
  inference redundancy + throughput headroom. **4× (High)** for high document/concurrency volume.
- **Weights:** offline HuggingFace bundle on a shared NFS PVC; never baked into images (air-gap).
- **Degraded mode:** `INFERENCE_MODE=cpu_degraded` validates the full pipeline pre-GPU and acts
  as a fallback if GPUs are unavailable.

---

## 7. Integration points (interfaces only; contracts via Functional Workshops)

| System | Interface | Status (MoM §2) |
|---|---|---|
| Core Banking (GBP) | API — formats/specs TBD | After Functional Discussions |
| Loan Origination (LOS) | No re-upload of existing docs; LOS remains system of record; new docs stored in LOS | Flow finalized in Functional Workshop |
| Internet/Mobile Banking | Foreign Remittance via RTGS/SWIFT; D-Form via MBOB | Bank to confirm |
| Identity Management | SSO + related APIs from bank | Pending |
| Email / Notification | Requirements from Operations Team | Pending |
| Government / regulatory | **Out of scope** | MoM §2 |

> The DMS does **not** become the system of record for source-system documents; it
> indexes/links and applies IDP. Integration methodology, document categories, and file formats
> are finalized in the Functional Workshops.

---

## 8. Non-functional requirements

| Area | Requirement | Source |
|---|---|---|
| Concurrent users | ~100 (design for 300 headroom = Small tier load) | MoM 1.C |
| Availability | High availability expected; HA across app/CP/DB/GPU at Medium | MoM 1.D |
| Performance / SLA | Specific SLAs **pending**; AI targets: classify P95 ≤700 ms/page, extract ≤5 s/page, end-to-end ≤8 s/page | MoM / `services/ai` |
| Load balancing | **Managed by the bank's infrastructure team** | MoM 1.D |
| Backup | **Managed by the bank** | MoM 1.D |
| DR / RPO / RTO | DR site mirrors data tier; **RPO/RTO pending from bank** | MoM 1.D / §4 |
| Parallel run / rollback | Bank to confirm expectations | MoM §3 |

---

## 9. Migration (system view)

- **No migration from the legacy TCS DMS** (decommissioned 3–4 years ago) — **key decision**.
- Source systems remain the system of record; validation rules applied while fetching.
- Migration scope finalized after document types, source systems, API specs, and file formats
  are confirmed. No cutover drill currently planned (bank to confirm parallel-run/rollback).

---

## 10. Assumptions & open items (block final sizing/sign-off)

The following bank inputs are **required to finalize** the profile (esp. storage axis & SLAs):

- [ ] Total document volume, current storage size, annual growth → object-store tier
- [ ] Maximum document size (4 MB recommended) and supported file formats
- [ ] Metadata, classification, indexing & versioning details
- [ ] Security architecture, encryption standards (rest + transit)
- [ ] SSO details + API documentation (Core Banking, LOS, IdM)
- [ ] Email/notification integration requirements
- [ ] Source systems list + document categories
- [ ] Performance SLAs; Backup & DR (RPO/RTO); parallel-run expectations

**Working assumptions until confirmed:** ~100 concurrent users · 4 MB max file · ~50 TB usable
object storage (Medium) · domain auth + bank SSO via Keycloak · bank-managed LB & backup ·
DR site mirrors data tier.

---

### Summary

For ~100 concurrent users the **Small** profile is technically sufficient on load, but its
**single GPU** is a redundancy gap. Given the bank's HA expectation and 400K-customer scale,
**deploy the Medium profile at go-live** (2× L40S, 3-node Postgres, 4× app servers) with **Small
at the DR site**, and scale to **High** as volume/concurrency grow. Final capacity (particularly
object storage and SLA-driven node counts) is pending the bank inputs in §10.
</content>
