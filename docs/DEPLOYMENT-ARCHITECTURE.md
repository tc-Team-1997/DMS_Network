# ZorDMS — Deployment Architecture (Staging / UAT / Production)

**Project:** DMS Implementation — Bank of Bhutan Ltd. (BOBL) · **Deployment:** On-Premises, air-gapped
**Basis:** [`ENVIRONMENTS-SIZING.md`](./ENVIRONMENTS-SIZING.md) · [`SYSTEM-REQUIREMENTS.md`](./SYSTEM-REQUIREMENTS.md)
**Orchestration decision:** apps via **Docker Compose (Staging)** / **k3s (UAT + Prod)** — *no full RKE2 required*;
**vLLM runs as a container pinned to the GPU node** (not orchestrated/autoscaled). Bank manages LB + SSO.

Legend: `[ ]` host/VM · `( )` container/service · `<<>>` external/bank system · `==` HA pair/cluster

---

## 1. Staging — lightweight integration / release validation

Single-host-class, non-HA. Docker Compose. Shared GPU (MIG/time-sliced). Test integration endpoints.

```
              <<QA / Integration team>>
                       │ HTTPS
                       ▼
              ( Ingress / nginx )            ┌──────────── Mgmt (shared) ───────────┐
                       │                     │ Harbor(offline)  Keycloak(test)       │
                       ▼                     │ Vault  Prometheus/Grafana             │
  ┌──────────────── APP VM #1 ─────────────┐ └───────────────────────────────────────┘
  │ Docker Compose                          │
  │ (gateway)(core)(search-api)(workflow)   │     ┌──────── GPU VM (shared) ────────┐
  │ (notify)(integration)(web/EJS)          │────▶│ (vLLM) 1×L40S  MIG/time-slice   │
  └──────────────────┬──────────────────────┘     │  • granite-vision (classify)    │
  ┌──────────────── APP VM #2 ─────────────┐       │  • qwen-vl (extract)            │
  │ Docker Compose (replicas for QA)        │       │  • qwen3-text (copilot/aux)     │
  │ (ai/python-service FastAPI)             │────▶  └─────────────────────────────────┘
  └──────────────────┬──────────────────────┘
                     ▼  data tier (single-node)
  [ PostgreSQL  1×(8/32/500GB) ]   [ Elasticsearch 1 ]   [ Kafka 1 ]   [ MinIO ~3TB single ]

  Integrations → <<GBP test>> <<LOS test>> <<RTGS/SWIFT stub>> <<MBOB stub>>   (mocked/test endpoints)
  Data: synthetic + masked sample · No DR · Backup: best-effort snapshots
```

---

## 2. UAT — prod-like (reduced) for bank acceptance & SLA sign-off

Prod-faithful topology at lower capacity. k3s (HA control plane). Dedicated GPU. Bank UAT SSO + UAT integration endpoints. Masked production-like data.

```
        <<Bank UAT users (~20–50)>>            <<Bank SSO / IdP (UAT)>>──┐ (SAML/OIDC)
                  │ HTTPS                                                │
                  ▼                                                      ▼
        <<Bank Load Balancer (UAT)>> ───────────────▶ ( Keycloak broker )
                  │
                  ▼
  ┌──────── k3s cluster (control plane 3× HA) ───────────────────────────────────┐
  │                                                                              │
  │   APP NODE #1 (16/64)            APP NODE #2 (16/64)                          │
  │   (gateway)(core)(search)        (workflow)(notify)(integration)             │
  │   (web)(ai/python-service)       (ai/python-service replica)                 │
  │            │                              │                                  │
  └────────────┼──────────────────────────────┼──────────────────────────────────┘
               │                              │
               ▼                              ▼
     ┌──── GPU NODE (1×L40S 48GB, dedicated) ────┐     ┌──────── Data tier ────────┐
     │ (vLLM container — not in k3s scheduler)    │     │ PostgreSQL == 2× HA        │
     │  • granite-vision (classify)               │     │   (primary + replica)      │
     │  • qwen-vl (extract, guided_json)          │     │ Elasticsearch  3-node      │
     │  • qwen3-text (copilot + summarize +       │     │ Kafka          3-broker    │
     │    covenants + coach + retention)          │     │ MinIO ~10TB (EC)           │
     └────────────────────────────────────────────┘     └────────────────────────────┘

  Integrations → <<GBP UAT>> <<LOS UAT>> <<RTGS/SWIFT UAT>> <<MBOB/D-Form UAT>> <<IdM UAT>>
  Data: masked production-like (PII masked) · No DR · Backup: scheduled snapshots
  Mgmt VLAN (prod-like): Harbor · Keycloak · Vault · GitLab · Prometheus/Grafana
```

---

## 3. Production — Medium profile, full HA + DR site

Full HA across app / DB / GPU. k3s (or RKE2 if bank standardises). Bank prod LB + SSO. DR site mirrors the data tier.

```
   <<Branch / HO users (~100 concurrent)>>        <<Bank SSO / IdP (Prod)>>──┐
                 │ HTTPS                                                     │ SAML/OIDC
                 ▼                                                           ▼
   <<Bank Load Balancer (Prod, HA) >> ───────────────────────▶ ( Keycloak broker, HA )
                 │
                 ▼
 ┌──────────────────── k3s cluster · control plane 3× HA ─────────────────────────────┐
 │  APP NODE #1     APP NODE #2     APP NODE #3     APP NODE #4    (each 16 vCPU/64 GB) │
 │  (gateway)       (core)          (search)        (workflow)                          │
 │  (notify)        (integration)   (web/EJS)       (ai/python-service ×N replicas)     │
 │        └──────── HPA/replicas across nodes · rolling deploys ────────┘               │
 └───────────────┬──────────────────────────────────────────┬──────────────────────────┘
                 │                                          │
                 ▼                                          ▼
   ┌──── GPU NODE A (1×L40S) ────┐   ┌──── GPU NODE B (1×L40S) ────┐    (2× L40S = HA + throughput)
   │ (vLLM)  granite-vision      │   │ (vLLM)  granite-vision      │
   │         qwen-vl (extract)   │   │         qwen-vl (extract)   │
   │         qwen3-text          │   │         qwen3-text          │
   └──────────────┬──────────────┘   └──────────────┬──────────────┘
                  └───────────────┬──────────────────┘
                                  ▼  DATA TIER (HA)
   ┌──────────────────────────────────────────────────────────────────────────────────┐
   │  PostgreSQL ==3× HA (primary + 2 replicas, PITR)                                   │
   │  Elasticsearch/OpenSearch  3-node      Kafka  3-broker      MinIO/Ceph ~50TB (EC)  │
   └──────────────────────────────────────────────────────────────────────────────────┘
                                  │  async replication
                                  ▼
   ┌──────────────── DR SITE (mirrors data tier; compute sized for failover) ──────────┐
   │  PostgreSQL standby · MinIO replica · ES/Kafka rebuildable · app = Small profile   │
   └────────────────────────────────────────────────────────────────────────────────────┘

   Integrations (Prod) → <<Core Banking GBP>> <<LOS>> <<RTGS/SWIFT (Foreign Remittance)>>
                          <<MBOB / D-Form>> <<Bank IdM/SSO>>   (Email/Notify per Ops)
   Mgmt VLAN: Harbor · Keycloak · Vault · GitLab · Prometheus/Grafana · log aggregation
   Backup: bank-managed (PITR + object versioning) · RPO/RTO pending · No internet egress
```

---

## 4. Cross-environment summary

| Layer | Staging | UAT | Production |
|---|---|---|---|
| Orchestration | Docker Compose | **k3s (HA)** | **k3s (RKE2 optional)** |
| App nodes | 2 × (8/32) | 2 × (16/64) | 4 × (16/64) |
| Postgres | 1 (single) | 2 × HA | **3 × HA** |
| GPU (L40S) | 1 shared (MIG) | 1 dedicated | **2 (HA)** |
| ES / Kafka | 1 / 1 | 3 / 3 | 3 / 3 |
| Object store | ~3 TB | ~10 TB | **~50 TB** |
| SSO / IdP | test | bank UAT IdP | bank Prod IdP |
| Integrations | mock/stub | UAT endpoints | prod endpoints |
| Data | synthetic/masked | masked prod-like | real |
| DR | none | none | **DR site mirror** |

**Notes**
- **vLLM is a container pinned to the GPU node in every tier — never autoscaled by the orchestrator.** Only the stateless app services scale/roll.
- The GPU is the binding constraint and is already satisfied: both vision models fit on **one** 48 GB L40S; the 2nd Prod card is redundancy/throughput.
- Bank owns **Load Balancer, SSO/IdP, and Backup** in every environment that integrates with bank infra (per MoM).
- All diagrams are logical; physical host consolidation (e.g. co-locating ES/Kafka on app VMs in Staging) is allowed below Prod.
```
