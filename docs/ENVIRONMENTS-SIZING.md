# ZorDMS — Environment Sizing (Dev / Staging / UAT / Prod)

**Project:** DMS Implementation — Bank of Bhutan Ltd. (BOBL) · **Deployment:** On-Premises, air-gapped
**Basis:** [`SYSTEM-REQUIREMENTS.md`](./SYSTEM-REQUIREMENTS.md) · MoM 25 June 2026 · ~100 concurrent users
**Version:** 0.1 (draft, pending bank inputs in §6)

> **Prod = Medium profile** (the recommended go-live baseline). Lower environments are
> scaled-down but **topology-faithful** so integration, SSO, and IDP behaviour are validated
> before production. All four environments are on-prem; only Prod has a DR site.

---

## 1. Purpose & posture per environment

| Aspect | **Dev** | **Staging** | **UAT** | **Prod** |
|---|---|---|---|---|
| Purpose | Active development, unit/integration tests | Integration + release validation, perf smoke, migration dry-runs | Bank acceptance testing, sign-off | Live operations |
| Owner | Vendor | Vendor | Bank + Vendor | Bank |
| Users | Developers (few) | QA / integration team | Bank UAT users (~20–50) | ~100 concurrent (≤300 headroom) |
| HA / redundancy | None (single-node OK) | Minimal | Prod-like (reduced) | **Full HA + DR** |
| Data | Synthetic / seed | Synthetic + masked sample | **Masked production-like** | Real |
| Integrations | Mocked / stubs | Source-system **test endpoints** | Source-system **UAT/pre-prod endpoints** | Production endpoints |
| GPU mode | `cpu_degraded` (or shared MIG) | 1 GPU (shared/MIG OK) | 1 GPU (dedicated) | 2 × L40S (HA) |
| Refresh cadence | Continuous (CI) | Per release | Per UAT cycle | Change-controlled |

---

## 2. Infrastructure sizing per environment (per site)

| Component | **Dev** | **Staging** | **UAT** | **Prod (Medium)** |
|---|---|---|---|---|
| **App / compute (K8s workers)** | 1 × (8 vCPU / 32 GB) | 2 × (8 vCPU / 32 GB) | 2 × (16 vCPU / 64 GB) | **4 × (16 vCPU / 64 GB)** |
| **K8s control plane** | 1 × (4 vCPU / 16 GB) (single, non-HA) | 1 × (4 vCPU / 16 GB) | 3 × (4 vCPU / 16 GB) HA | **3 × (4 vCPU / 16 GB) HA** |
| **Database (PostgreSQL)** | 1 × (4 vCPU / 16 GB / 200 GB) | 1 × (8 vCPU / 32 GB / 500 GB) | 2 × (8 vCPU / 32 GB / 1 TB) HA | **3 × (8 vCPU / 32 GB / 1 TB NVMe) HA** |
| **GPU — AI/LLM inference** | 0 (CPU-degraded) or 1 shared MIG slice | 1 × L40S (shared/MIG) | 1 × L40S (48 GB) | **2 × L40S (48 GB)** |
| **Object storage (MinIO/Ceph, usable)** | ~1 TB (single node) | ~3 TB | ~10 TB | **~50 TB** |
| **Search (Elasticsearch/OpenSearch)** | 1 node | 1 node | 3 nodes | **3 nodes** |
| **Event bus (Kafka)** | 1 broker (or embedded) | 1 broker | 3 brokers | **3 brokers** |
| **Management tier** | Shared with Dev (single Keycloak/Vault/Harbor) | Shared mgmt VLAN | Dedicated (prod-like) | **Harbor, Keycloak, Vault, GitLab, Prometheus/Grafana** |
| **Indicative compute total** | ~20 vCPU / ~80 GB | ~40 vCPU / ~160 GB | ~120 vCPU / ~0.45 TB | **~300 vCPU / ~1.1 TB RAM** |

> Dev/Staging may run as **VMs on shared hosts**; UAT and Prod should run on **dedicated nodes**
> (UAT prod-like for valid acceptance, Prod for isolation/HA).

---

## 3. GPU / AI strategy by environment

| Env | GPU | Models served (vLLM) | Rationale |
|---|---|---|---|
| Dev | `INFERENCE_MODE=cpu_degraded` or 1 MIG slice | Smaller VL models / extractive copilot | Validate pipeline logic without GPU cost |
| Staging | 1 × L40S (MIG/time-sliced) | Granite Vision + Qwen-VL + text model | Functional + light perf checks |
| UAT | 1 × L40S dedicated | Full production model set | Accuracy/perf sign-off against SLAs |
| Prod | 2 × L40S | Full set + redundancy/throughput | HA + meets IDP P95 targets (classify ≤700 ms, extract ≤5 s, e2e ≤8 s) |

All weights load from the **offline HuggingFace bundle on NFS PVC**; images from **offline
Harbor**. No environment pulls from the public internet. (See [`ON-PREMISE-AI.md`](./ON-PREMISE-AI.md).)

---

## 4. Security & access parity

| Control | Dev | Staging | UAT | Prod |
|---|---|---|---|---|
| Auth | Local/dev users | Domain auth (test) | **Domain auth + bank SSO (UAT IdP)** | Domain auth + bank SSO (prod IdP) |
| TLS | Self-signed OK | Internal CA | Internal CA (prod-like) | Internal CA / bank PKI |
| Encryption at rest | Optional | Enabled | Enabled | Enabled (TDE + SSE + Vault) |
| Data sensitivity | Synthetic only | Masked | **Masked PII only** | Real PII |
| Network isolation | Dev VLAN | Staging VLAN | UAT VLAN (no internet) | Prod VLAN (no internet) |
| RBAC | Open for devs | QA roles | **Full RBAC matrix (UAT validates)** | Full RBAC |

> **No real customer data in Dev/Staging.** UAT uses masked, production-representative data
> only after the bank confirms masking rules.

---

## 5. DR, backup & load balancing

| Item | Dev / Staging / UAT | Prod |
|---|---|---|
| DR site | None | **DR mirrors data tier**, compute sized for failover (Small profile acceptable at DR) |
| Backup | Best-effort snapshots | **Bank-managed**; PITR + object-store versioning; RPO/RTO **pending** |
| Load balancing | Simple ingress | **Bank infrastructure team-managed** |
| Parallel run / rollback | N/A | Per bank confirmation (pending) |

---

## 6. Assumptions & pending inputs (affect lower-env sizing too)

Same open items as the system spec — these refine storage and data volumes per environment:

- [ ] Total document volume, storage size, annual growth → object-store per env
- [ ] Max file size (4 MB recommended) + supported formats
- [ ] Metadata / indexing / versioning model
- [ ] Source-system **test / UAT endpoints** availability (GBP, LOS, RTGS/SWIFT, MBOB, IdM)
- [ ] Data-masking rules for UAT
- [ ] SSO UAT vs prod IdP details
- [ ] SLAs, Backup/DR (RPO/RTO), parallel-run expectations

**Working assumptions:** ~100 prod concurrent users · 4 MB max file · Prod = Medium · UAT prod-like
(reduced) · Dev/Staging on shared/virtualised hosts · masked data below prod · no internet egress anywhere.

---

### Summary

- **Prod** = Medium profile (4 app / 3 DB / 2× L40S / ~50 TB) + DR site.
- **UAT** = prod-like but reduced (2 app / 2 DB HA / 1× L40S / ~10 TB) — valid for bank sign-off and SLA checks.
- **Staging** = lightweight integration/release env (2 app / 1 DB / shared GPU / ~3 TB).
- **Dev** = minimal, non-HA, GPU-optional via `cpu_degraded` (1 app / 1 DB / ~1 TB).

Lower-environment storage and node counts will be re-confirmed once the bank provides document
volume, growth, and UAT data-masking scope (§6).
</content>
