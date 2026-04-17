# DocManager — Project Document

> **Current state, trajectory, and where this fits in the bigger plan.**
>
> For the bigger plan itself see [VISION.md](./VISION.md) (*why*), [ROADMAP.md](./ROADMAP.md) (*when*), and the full [docs/README.md](./README.md) index.

Last updated: 2026-04-17

---

## 1. One-line summary

**DocManager** is a standalone SaaS platform for enterprise banking document management. The NBE pilot (Tier-1 customer) is the beachhead; the platform scales to any bank, on any core banking system, via pre-built integration adapters and an AI layer that runs on-prem.

## 2. Product stance

- **Standalone product** — not a module of `apex_core_cbs`. We share design language (see the apex UI mirror in [TECHNICAL.md §5](./TECHNICAL.md#5-design-system)), not a codebase.
- **Pure DMS focus** — we do not build CBS, LOS, AML, or card rails. See [VISION.md §3](./VISION.md#3-what-we-are-not) for the full anti-list.
- **Integration-first** — 10 pre-built, contract-tested adapters at GA (Temenos, FLEXCUBE, Finastra, Mambu, Thought Machine, Oracle Banking, FIS Profile, Salesforce FS, DocuSign, Microsoft Fabric). See [INTEGRATION_STRATEGY.md](./INTEGRATION_STRATEGY.md).
- **AI-native, on-prem-capable** — DocBrain runs Llama 3.1 on Ollama / vLLM inside the bank's own perimeter. See [AI_STRATEGY.md](./AI_STRATEGY.md).
- **Triple deployment** — Pooled SaaS (tier-3), Silo SaaS (tier-2), Dedicated / on-prem (tier-1). Same codebase, three Helm configurations.

## 3. Where we are today

### 3.1 Shipped (Milestone 1, 2026-04-17)

Single-tenant NBE pilot, 18 Playwright tests green, ~224 KB gzipped SPA bundle, `tsc --noEmit` clean.

| Surface | What exists |
|---|---|
| **DocManager Web (SPA)** | React 18 + TypeScript + Vite + Tailwind. 7 shipped screens (Login, Dashboard, Capture, Repository, Viewer, Search, Alerts) + 9 coming-soon placeholders. Apex-aligned design system. |
| **Node gateway** | Express 4, session-cookie auth, SQLite + FTS5, 15+ JSON routes under `/spa/api/*`, security headers, `/py` proxy session-guarded. |
| **Python FastAPI** | 60+ routers (OCR, workflow, duplicate detection, fraud, face match, redaction, DSAR, CBE reports, step-up, IFRS 9, ledger, anchor, federated learning, zkKYC, OPA ABAC, vector search, copilot, adversarial testing, STRIDE, transparency, tenant_keys…). Most are stubs; the full list is our M2–M4 surface area. |
| **Mobile** | Expo app in `mobile/` — branch officer capture + OCR + document push. MVP. |
| **DevX** | `./start.sh` / `./stop.sh` / `./restart.sh`, Helm charts in `python-service/helm/`, Terraform in `python-service/terraform/`, Dockerfiles, CI workflows in `.github/workflows/` (Python + Node + Terraform + Helm + Playwright). |

### 3.2 Users (NBE pilot)

Four seeded accounts representing the four roles:

| Role | Seed user | Branch | Can |
|---|---|---|---|
| Doc Admin | admin / admin123 | Cairo West | Everything, all branches |
| Maker | sara / sara123 | Giza | Capture, index, submit workflow |
| Checker | mohamed / mohamed123 | Alexandria | Approve / reject workflow |
| Viewer | nour / nour123 | Cairo East | Read-only (locked — demonstrates status) |

### 3.3 Pending (Milestones 2 and 3)

- **M2 (Q2 2026):** Workflows UI, Workflow Templates, Indexing / QA queue, Reports & BI, System Admin (retention + audit), Security & RBAC (user CRUD, MFA enrolment).
- **M3 (Q3+ 2026):** Compliance & Audit screen, Lifecycle, Records Management, Integration Hub UI, AI Engine UI, Case Management, Customer 360, Branch Network.

See [ROADMAP.md](./ROADMAP.md) for the full execution plan.

## 4. Strategic milestones

```
  Q2 2026         Q3 2026         Q4 2026         Q1 2027         Q2 2027         Q3 2027         Q4 2027
  ────────        ────────        ────────        ────────        ────────        ────────        ────────
  NBE GO-LIVE     MULTI-TENANT    DocBrain AI     WORKFLOW 2.0    INTEGRATION     CERT & SCALE    TIER-1 GA
  single-tenant   foundation      (RAG+NER+       (BPMN/DMN       HUB (10         (SOC 2 Type II  (air-gap,
                  (2nd pilot on   forgery+sig)    designer)       adapters)       + ISO 27001)    global)
                  silo tier)
```

**First GA** (general availability, "ready for any bank"): **end of Q2 2027**, after 10 adapters and the workflow engine ship.

**Tier-1 readiness** (central-bank-capable): **end of Q3 2027**, after certifications and the air-gapped deployment mode lands.

## 5. Where the code lives

```
DMS_Network/                                    ← this repo
├── apps/
│   └── web/                                    ← DocManager SPA (shipped)
│   └── admin/      [future, Q3 2026]           ← Tenant admin portal
├── mobile/                                     ← React Native / Expo (MVP)
├── server.js                                   ← Node Express gateway
├── routes/
│   ├── spa-api.js                              ← SPA JSON backend
│   ├── api.js                                  ← machine API (x-api-key)
│   ├── py-proxy.js                             ← forwards to Python service
│   └── ...                                     ← legacy EJS routers (still live)
├── services/                                   ← shared Node services
├── views/                                      ← legacy EJS templates
├── db/                                         ← Node SQLite schema + seed
├── python-service/                             ← FastAPI microservice (60+ routers)
├── opa/policies/dms.rego                       ← ABAC policy
├── loadtest/k6.js                              ← Python service load test
├── e2e/                                        ← legacy Playwright (against Python)
├── docs/                                       ← this documentation set
│   ├── README.md                               ← index
│   ├── VISION.md · ROADMAP.md                  ← strategy
│   ├── ARCHITECTURE.md · TARGET_ARCHITECTURE.md
│   ├── TECHNICAL.md                            ← tactical reference
│   ├── INTEGRATION_STRATEGY.md · AI_STRATEGY.md
│   ├── SECURITY_COMPLIANCE.md · ENGINEERING_PRINCIPLES.md
│   └── rfcs/ [future]                          ← architecture decision records
├── start.sh · stop.sh · restart.sh             ← local dev orchestration
├── Dockerfile · docker-compose.yml
└── CLAUDE.md                                   ← in-repo guidance for Claude Code
```

## 6. Quality gates (as of M1 shipping)

- `tsc --noEmit` — 0 errors
- `vite build` — succeeds (~224 KB gzipped; budget 300 KB)
- `pytest -q` (python-service) — 7/7 green
- `npx playwright test` (apps/web/e2e) — **18/18 green in ~3s**
- ESLint — `@typescript-eslint/no-explicit-any: error`, zero warnings allowed
- No raw hex in TSX (enforced at code review; apex design-token discipline)

CI ([.github/workflows/ci.yml](../.github/workflows/ci.yml)) runs Python tests, Terraform fmt, Helm lint, and Playwright E2E against Python. Wiring SPA's `tsc` + Playwright into CI is the first task of M2.

## 7. How to run the project locally

```bash
# First time
git clone … && cd DMS_Network
./start.sh            # installs apps/web deps on first run, boots all three services
```

Local endpoints:

| URL | Use |
|---|---|
| http://localhost:5174 | **DocManager SPA** — primary entry |
| http://localhost:3000 | Legacy Node / EJS UI (still works, same sessions) |
| http://localhost:8001 | Python FastAPI (`/docs` for Swagger) |

Stop with `./stop.sh`. Restart with `./restart.sh`. Logs in `.run/{node,python,web}.log`.

## 8. What's changed since the docs were last written

Summary of the pivot from "enterprise DMS for NBE" to "SaaS DMS for any bank":

1. **Positioning is now a product platform,** not a bank-specific deployment. NBE is the first customer, not the final target.
2. **Pure DMS** — we build document operations deep. We do not build CBS or AML; we integrate.
3. **Three deployment modes** — same codebase, pooled / silo / dedicated Helm values.
4. **AI is first-class** — DocBrain with in-house Llama + LangChain + LangSmith; no SaaS LLM dependency for tier-1 customers.
5. **Integration is a product, not plumbing** — 10 adapters shipped, tested nightly against vendor sandboxes.
6. **Compliance is mechanised** — DSAR, retention, audit chain, regulator reports are features, not PDFs.

See [VISION.md](./VISION.md) for the long form.

## 9. Known gaps (honest inventory)

- **Multi-tenancy is not yet implemented.** Single-tenant pilot only. Migration planned Q3 2026.
- **Storage is local `uploads/`.** No S3, no CAS, no WORM. Migration Q2 2026.
- **Sessions live in process memory.** No Redis, no horizontal scale. Migration Q2 2026.
- **SQLite is the pilot DB.** No Postgres, no RLS, no replication. Migration Q2 2026.
- **No message bus.** Synchronous everywhere. Kafka/Redpanda introduced Q2 2026.
- **Observability is minimal.** OTel instrumentation added Q2 2026; dashboards Q3.
- **AI is not yet wired.** `/py/*` routers exist but SPA doesn't surface them. DocBrain Q3 → Q4 2026.
- **Integration adapters don't exist.** 10 shipped by Q2 2027.
- **No certifications yet.** SOC 2 + ISO 27001 + regional through Q3 2027.
- **MFA is EJS-only.** SPA MFA in M2 (Q2 2026).

The M1 pilot is a **proof of the design system + flow**, not a production-ready SaaS platform. Everything in the gap list above is scheduled, sized, and tracked in [ROADMAP.md](./ROADMAP.md).

## 10. Decision points awaiting sign-off

Captured in [ROADMAP.md §12](./ROADMAP.md#12-decision-log--open-questions) and the specialised-doc decision logs. Highlights:

- Temporal vs Camunda Zeebe (workflow engine).
- Kafka vs Redpanda (event bus).
- vLLM vs TGI (LLM serving).
- Qdrant vs pgvector (vector DB for silo tenants).
- Pricing model for tier-3 SaaS (usage vs seat).

Product owner (you) signs off on these with the pod lead in the quarter they become blocking.

---

## Appendix — how to update this document

When something meaningful changes about the project state (milestone shipped, new customer, major architectural shift), this document is edited in the same PR as the change itself. The changelog section in [docs/README.md](./README.md#5-changelog-for-the-documentation-set) is the canonical history for the documentation set.
