# ZorDMS — Gap Analysis (Blueprint vs. Actual Code)

**Prepared:** 29 Jun 2026
**Companion to:** `ZorDMS_Implementation_Analysis.md` (the build blueprint)
**Purpose:** Reconcile every item in the blueprint (§4 modules, §5 AI features, §6 connectors, §7 schema, §8 platform/security) against **what is actually implemented in this repository today** — so we *extend, not rebuild* (blueprint §2), and so "Pending" reflects reality.

**Method:** five evidence-based code audits run in parallel over the live repo (`/Users/chuadhary_taniya/DMS_Network`) — backend routes + web pages, the Python AI service, integration connectors, DB migrations, and infra/platform/security. Every status below is backed by a concrete file path.

---

## 0. Headline finding — read this first

The blueprint's §3 describes the **foundation** as an *EJS, server-rendered* app and treats most capabilities as greenfield/"Pending". **That premise is stale.** This repo already contains a **substantially-built React + microservices + Python-AI system** (ZorDMS), and `docs/RUNBOOK-foundation.md` itself points at that microservices stack (`@zordms/gateway` :4000, `@zordms/web` :5174, `packages/db`).

There *is* a legacy EJS monolith in the tree (`server.js`, `views/*.ejs`, `routes/`, `db/nbe-dms.db`, `python-service/`), but it is **not** the live system — the React microservices are. So the real work is **not** "build the backend behind the prototype"; most of that exists. The real work is **closing specific feature gaps** and **deploying the already-designed infrastructure**.

**Roll-up of what already exists vs. what's genuinely left** (columns: as-audited 29 Jun → after the 30 Jun increments below):

| Blueprint section | Built | Partial | Missing |
|---|---|---|---|
| §4 Modules (13 + Chat) | 7 → **11** | 4 → 3 | 3 → **0** |
| §5 AI features (10) | 3 → **4** | 2 → 1 | 5 |
| §6 Connectors (15) | 3 → **13** | 7 → 1 | 5 → **1** |
| §7 DB tables (38) | 18 → **23** | 7 | 13 → **8** (+ new `report_definitions`) |
| §8 Platform/security | majority built **or coded-but-not-deployed** | — | a few true gaps (Kafka, Vault, live S3 driver) — unchanged |

> **Legend** — **Built**: implemented and working. **Partial**: exists but narrower than the blueprint (or designed/harness-only, not deployed). **Missing**: no implementation.

---

## 0b. Update — shipped on `taniya_local` (30 Jun 2026)

Nine code increments closed the code-completable gaps below. Each was built behind the existing gateway/DB/auth (extend, not rebuild), tested, and committed. Suites grew: **core 205 → 226**, **AI 257 → 264**, **integration → 82**.

| Increment | Closes | Commit |
|---|---|---|
| **Config module** (§4.13) — `system_config` + `/config` CRUD, audited | §4.13 Missing → Built | `52bfb03` |
| **Validation module** (§4.6) — `validation_rules`/`validation_results` + engine + run-on-extract | §4.6 Missing → Built | `05324ca` |
| **Audit tamper-evidence** — persisted `prev_hash`/`row_hash`; `verifyAuditChain` now compares | §7 audit_log claim → real | `5462644` |
| **Reports module** (§4.10) — `report_definitions` + whitelisted run-engine + CSV export | §4.10 Missing → Built | `ba802f9` |
| **AI console** (§4.7) — `ai_feature_config` + `ai_metrics` + enable/threshold endpoints | §4.7 Partial → Built | `c09d317` |
| **Dzongkha OCR** (§5.1) — `lang="dzo+eng"` + installed-lang resolve + eng fallback | §5.1 English-only → bilingual code-path* | `96ce7e8` |
| **6 config-only connectors** (§6) — mBoB/GoBoB/Internet-Banking/CRM/ERP/Contact-Center: ops + mock + live-or-mock + `POST /integration/systems/:system/call` | §6 Partial ×6 → Built | `1aad092` |
| **e-Signature** (§6.12) — REST connector (`sign.request`/`sign.status`) | §6.12 Missing → Built | `519cdcf` |
| **RMA reporting** (§6.13) — `SftpConnector` (ssh2-sftp-client, injectable/mock-tested) | §6.13 Missing → Built | `2dcb251` |

\* Dzongkha OCR: the code path + graceful fallback are built and tested; **real Dzongkha accuracy still depends on deploying the `dzo` traineddata + client sign-off (§9.3)**.

**Duplication avoided (verified):** **SMS** was *not* added as an integration connector — it already exists as a delivery channel in the notify service (`services/notify/src/channels/sms.ts`, Twilio-backed, with tests). So §6 "SMS Gateway" is covered there, not duplicated here.

**Still genuinely not code-completable now:**
- **Krystal legacy migration** (§6.15) — a bulk ETL subsystem; blocked on the legacy source format/access (blueprint §9.6). Not a request/response connector.
- **Infra-deploy** — activate the S3/MinIO storage driver, Kafka-vs-Redis-Streams decision, Vault, stand up Staging/UAT/Prod from the existing Terraform/Helm.
- **Client §9 decisions** — CBS naming, Dzongkha sign-off, e-Sign/SMS/RMA/Krystal scope, RTO/RPO, RACI.

---

## 1. §4 — Prototype modules (13 + Chat Assistant)

| # | Module | Status | Evidence (file · route) | Gap to close |
|---|---|---|---|---|
| 1 | Dashboard | 🟡 Partial | `services/core/src/routes/dashboard.ts` — `GET /dashboard/summary` (totals, byCategory, pendingReview, indexedToday); `apps/web/src/pages/Dashboard.tsx` | No processing **funnel** counts; no **branch-health/SLA-breach** detail endpoints |
| 2 | Documents | 🟢 Built | `services/core/src/routes/documents.ts` — upload/bulk/get/download/delete/versions/stamp/extract; legal-hold enforcement | Server-side **OCR is English-only** (see §2.1) |
| 3 | Repository | 🟢 Built | `folders.ts` (`/folders`, `/folders/:id/move`), `catalog.ts` (`POST /catalog/:documentId`, auto-route + retention) | — |
| 4 | Cases (Kanban) | 🟢 Built | `services/workflow/src/routes/cases.ts` — `/cases`, `/cases/metrics`, `/:id/advance`, `/:id/resolve`, SLA per step | No `departments` routing dimension |
| 5 | Flow (process viz) | 🟢 Built | `services/workflow/src/routes/workflows.ts` — templates CRUD + compile + instantiate | Read-only diagram is data-driven; OK |
| 6 | Validation | 🔴 Missing | — | No `validation_rules` CRUD / run engine (today validation = doc-type mandatory/optional JSON + Pydantic field checks in AI) |
| 7 | AI capability console | 🟡 Partial | Copilot exists (`services/ai/.../api/copilot.py`); `apps/web/src/pages/AiEngine.tsx` | No **feature grid**, no **enable/threshold** config endpoints, no `ai_metrics` surface |
| 8 | AI Queue | 🟢 Built | `services/core/src/routes/jobs.ts` — `GET /jobs` (counts+list), `GET /jobs/:id`; `Indexing.tsx` monitor | — |
| 9 | Integration | 🟢 Built | `services/integration/src/routes/management.ts`, `webhooks.ts`, `outbound.ts` — health, logs, HMAC inbound, outbound dispatch | Connector breadth (see §3) |
| 10 | Reports | 🔴 Missing | only `POST /search/export.csv` | No report **builder**, **library**, saved `report_definitions`, scheduling |
| 11 | Master Data | 🟡 Partial | users (`gateway/users.ts`), branches (`core/branches.ts`), doc-types (`core/doc_types.ts`) | No **departments** CRUD; **roles** only via RBAC (no role-management endpoint) |
| 12 | Admin | 🟡 Partial | audit (`compliance.ts` `/compliance/audit` + `/compliance/verify`), dedup-config, `/admin/health`, `/admin/dr` | No **AD-import** endpoint, no **security-settings** CRUD; "workflow builder" is JSON template editor, not visual |
| 13 | Config | 🔴 Missing | — | No runtime key/value `system_config` API; all config is env-based |
| ★ | Chat Assistant | 🟢 Built | `services/ai/.../api/copilot.py` — `POST /idp/copilot/ask`, RAG + intent + citations | RAG retrieval is keyword (not semantic — see §2.4) |

---

## 2. §5 — AI features (10)

The Python AI service (`services/ai`) is real: pluggable backends (Ollama / vLLM / mock), confidence-routing, a DB-backed review queue. **No Kafka** — the pipeline is synchronous + DB queue.

| # | Feature | Status | Evidence | Gap to close |
|---|---|---|---|---|
| 1 | OCR & ICR (Dzongkha + English) | 🟡 Partial | `api/ocr.py`, `ocr/tesseract.py` (`lang="eng"`) | **No Dzongkha** — hard-coded English. Blueprint's #1 technical risk. |
| 2 | Auto-classification | 🟢 Built | `api/idp.py` `POST /idp/classify`, `classify/classifier.py` (18 doc types, prescan + vision LLM) | — |
| 3 | Smart extraction | 🟢 Built | `POST /idp/extract`, `extract/extractor.py` (guided JSON + Pydantic validators) | Only **3 of 18** doc types have extraction schemas (CID, Passport, Loan) |
| 4 | Semantic search | 🔴 Missing | `copilot/search_client.py` calls keyword search | **No embeddings / vector index** — search is boolean/full-text only |
| 5 | Anomaly & Fraud (AML/FATF) | 🔴 Missing | — | Not implemented (SAR/CTR types classify but no scoring/rules) |
| 6 | Summarization | 🟡 Partial | intent detection in `copilot/intent.py` | No dedicated `POST /idp/summarize` endpoint |
| 7 | Compliance validation (RMA) | 🔴 Missing | only field-level Pydantic checks | No RMA **rule engine** |
| 8 | Translation (Dzongkha↔EN) | 🔴 Missing | — | Not implemented |
| 9 | Chat assistant (LLM + RAG) | 🟢 Built | `api/copilot.py` — 4-tier fallback (Anthropic→OpenAI→Ollama→extractive), citations | Retrieval keyword-based (ties to #4) |
| 10 | Predictive analytics | 🔴 Missing | — | Not implemented (marked optional in blueprint) |

---

## 3. §6 — Integration connectors (15)

Connector registry with **live-vs-mock** selection (`<SYS>_BASE_URL` env), **HMAC-SHA256** signed inbound webhooks (constant-time verify), DB-backed config. Secrets in DB/env — **no Vault**.

| # | Connector | Status | Evidence | Gap to close |
|---|---|---|---|---|
| 1 | LOS | 🟢 Built | `adapters/los.ts` + inbound `/webhooks/los/loan-application` → core `/integration/loan-intake` | — |
| 2 | mBoB | 🟡 Partial | seed config only (`seeds/0001_integration_bootstrap.ts`) | No adapter ops / inbound route |
| 3 | GoBoB Wallet | 🟡 Partial | seed config only | No adapter / route |
| 4 | Internet Banking | 🟡 Partial | seed config only | No adapter / route |
| 5 | e-KYC / National CID | 🟢 Built | `adapters/kyc.ts` + `/webhooks/kyc/verification-result` | Inbound `kyc.result` has no core ingest route yet |
| 6 | CBS (TCS BaNCS) | 🟢 Built | `adapters/cbs.ts` + `/webhooks/cbs/customer-updated` → core `/integration/customer-upsert` | Confirm BaNCS vs "GBP" naming (blueprint §9.2) |
| 7 | CRM | 🟡 Partial | seed config only | No adapter / route |
| 8 | ERP | 🟡 Partial | seed config (disabled) | No implementation |
| 9 | Contact Center | 🟡 Partial | seed config only | No implementation |
| 10 | AD / SSO (login) | 🟢 Built* | **Gateway** SSO: `services/gateway/src/sso/` LDAP/OIDC/SAML, env-gated | *Login works; the **AD-import connector** in integration is config-only. "AD import" admin action still missing. |
| 11 | SMS Gateway | 🔴 Missing | — | No config/adapter/route |
| 12 | e-Signature | 🔴 Missing | — | No config/adapter/route |
| 13 | RMA Reporting (SFTP) | 🔴 Missing | — | No SFTP client (needs ssh2/sftp lib) |
| 14 | Archive (MinIO/S3) | 🟡 Partial | seed config + core S3 client present, but storage driver is **local-only** today (§4) | Wire S3 driver + presigned URLs (AWS SigV4) |
| 15 | Krystal legacy migration | 🔴 Missing | — | No ETL/migration code |

> Note the split: **SSO *login*** (AD/OIDC/SAML) is genuinely **Built in the gateway**; the integration-service "AD" entry and the Admin **AD-import** action are not. Counted as Built\* with that caveat.

---

## 4. §7 — Database schema (38 proposed tables)

All tables go through the foundation migration layer (PG/Oracle/SQLite). **18 Built · 7 Partial · 13 Missing.**

**Built (exact or close):** `documents`, `document_versions`, `branches`, `document_types` (as `doc_type_registry`), `users`, `roles`, `role_permissions`, `cases`, `workflows`, `workflow_steps`, `retention_policies`, `integration_logs`, `processing_jobs` (as `jobs`), `audit_log`, plus extras the blueprint didn't list (`folders`, `legal_holds`, `disposal_queue`, `customers`, `loan_intakes`, `alert_rules`, `email_templates`, `search_index`, `review_items`).

**Partial (exists, differs/renamed):**
- `ocr_results` → OCR state lives on `documents` columns, no separate table
- `processing_steps` → `workflow_steps` (workflow-scoped, not generic)
- `case_history` → `workflow_audit`
- `integration_connectors` → `integration_config`
- (and `documents.metadata` JSON stands in for `document_metadata`)

**Missing:** `document_metadata`, `ai_models`, `ai_feature_config`, `ai_metrics`, `case_types`, `sla_policies`, `departments`, `validation_rules`, `validation_results`, `system_config`, `security_settings`, `chat_sessions` (embeddings expected in ES, not RDBMS).

**Audit log / tamper-evidence — important nuance:** the `audit_log` table (`packages/db/.../20260623_0001_identity_rbac.ts`) has **no stored `previous_hash` column**. However, a **verify-on-read hash chain exists** — `verifyAuditChain()` in `services/core/src/modules/compliance.ts`, exposed at `GET /compliance/verify`, recomputes `hash(previous + canonical_row)`. So "tamper-evident" is **partially** met: verification logic is present, but integrity rests on recompute + append-only convention, not a persisted chained hash. Closing this = add a stored `prev_hash`/`row_hash` column written at insert.

---

## 5. §8 — Platform / infrastructure / security

This is where the repo is **much further along than the blueprint assumes** — most platform items are **coded or fully designed**, several just **not deployed**.

| Area | Status | Evidence |
|---|---|---|
| Microservices split (6 Node + Python AI) | 🟢 Built | `services/*`, `services/ai` |
| React + TS frontend | 🟢 Built | `apps/web` (Vite SPA), nginx in compose |
| FastAPI AI service | 🟢 Built | `services/ai/Dockerfile`, vLLM + Ollama clients |
| PostgreSQL / Oracle / SQLite | 🟢 Built | `packages/db`, RDS in Terraform |
| Event bus | 🟢 Built | `RedisStreamsEventBus` + in-memory fallback (`services/core/src/events/`) |
| **Kafka** | 🔴 Missing | only referenced in a K8s NetworkPolicy egress; no broker/client |
| Elasticsearch | 🟢 Built (opt) | `services/search` ES backend + SQL fallback; `deploy/es-local` |
| **MinIO / live S3 driver** | 🟡 Partial | S3 client + `StorageConfig` exist but `createStorage()` returns **local** only |
| Docker / Compose | 🟢 Built | root + `deploy/server` + `deploy/es-local` + `deploy/sso-local` |
| Kubernetes / Helm | 🟡 Partial | `python-service/k8s/*`, `python-service/helm/zordms` — manifests/chart, not deployed |
| **Harbor registry** | 🔴 Missing | uses GHCR instead |
| SSO (OIDC/SAML/LDAP) | 🟢 Built (login) / 🟡 harness (IdP) | gateway `sso/`; `deploy/sso-local` Keycloak+OpenLDAP is **dev-only** |
| MFA (TOTP) | 🟢 Built | `services/mfa.js` (speakeasy), `users.mfa_*` |
| OPA / Rego (ABAC) | 🟢 Built (policy) | `opa/policies/dms.rego`, K8s `opa.yaml` sidecar (app-layer call-in not wired) |
| Observability (Prometheus/Loki/OTel/Tempo) | 🟢 Built (configs) | `python-service/k8s/prometheus-rules.yaml`, `observability/*` |
| Grafana dashboards | 🔴 Missing | referenced, no dashboards in repo |
| Supply chain (SBOM/Cosign/SLSA-3) | 🟢 Built | `.github/workflows/supply-chain.yml` (Syft, keyless Cosign, SLSA, Grype) |
| CI/CD (multi-cloud) | 🟢 Built | `.github/workflows/{ci,release,multicloud,monorepo-ci}.yml` |
| Mobile (Expo/RN) | 🟢 Built | `mobile/` capture→submit flow |
| Load testing (k6) | 🟢 Built | `loadtest/k6.js` |
| Terraform (AWS/EKS + DR + multi-region) | 🟡 Partial | `python-service/terraform/{main,dr,multi-region}.tf` — coded, not applied |
| Encryption at rest (AES-256) | 🟡 Partial | S3 SSE + RDS encrypted (Terraform); no app-level envelope/KMS |
| **Vault / secret manager** | 🔴 Missing | env vars + GitHub Actions secrets only |
| TLS 1.3 / WAF | 🟡 Partial | HTTPS in SSO; WAF only referenced by alerts, no ruleset |
| Staging / UAT / Prod | 🟡 Partial | Terraform `environment` var-gated, not stood up |

> Much of §8 lives under `python-service/` (a separate Python service with its own k8s/helm/terraform/observability), distinct from `services/ai`. It is the source of most "designed-not-deployed" infra.

---

## 6. Corrections to the blueprint's assumptions

1. **Frontend (§3):** "foundation = EJS" is wrong for the live system — it's **React + Vite** (`apps/web`). The EJS files are a legacy monolith, not the running app. Decision "rebuild prototype in React" is **already largely done**.
2. **"Mostly Pending" (§4–§6, §8):** factually overstated. Documents, Repository, Cases, Flow, AI Queue, Integration, Chat, classification, extraction, CBS/LOS/KYC connectors, RBAC, SSO login, MFA, audit-chain, OPA, supply-chain, mobile, k6 are **already implemented**.
3. **§9 items already partly resolved in code:** OCR engine is **server-side vLLM/Ollama** (not client Tesseract.js) — §9.4 effectively decided; on-prem Compose/k3s designed (not AWS-only) — §9.5 partly addressed. CBS naming (§9.2), Dzongkha OCR feasibility (§9.3), and scope confirmations (§9.6) remain genuine open questions.

---

## 7. The *real* gap list (what's actually left), prioritized

> **Status (30 Jun):** items marked ✅ shipped — see §0b for commits.

**A. True feature gaps (net-new code, no infra/client dependency):**
1. ✅ **Dzongkha OCR** — `lang="dzo+eng"` + fallback shipped (`96ce7e8`). *Real accuracy still needs the `dzo` model + §9.3 sign-off.*
2. **Semantic search** — embeddings + vector index behind copilot RAG. *AI + search.* (still open)
3. ✅ **Validation module (§4.6/§7)** — shipped (`05324ca`).
4. ✅ **Reports module (§4.10)** — shipped (`ba802f9`).
5. ✅ **Config module (§4.13)** — shipped (`52bfb03`).
6. ✅ **AI console config (§4.7)** — shipped (`c09d317`).
7. **Fraud/AML, Compliance/RMA rules, Translation, Predictive** — the 4 unbuilt AI features (some optional). (still open)
8. **Admin gaps** — AD-import action, security-settings CRUD, `departments` master data. (still open)
9. ✅ **Audit tamper-evidence** — persisted `prev_hash`/`row_hash` + compare shipped (`5462644`).

**B. Connector breadth:** ✅ finished the 6 config-only connectors (`1aad092`), ✅ e-Signature (`519cdcf`), ✅ RMA/SFTP (`2dcb251`). **SMS** is already covered by the notify channel (not duplicated). **Krystal ETL** remains open (blocked on §9.6 source-format scope).

**C. Deploy the already-designed infra:** activate the S3/MinIO storage driver; stand up Kafka (or formally drop it in favour of Redis Streams); wire Vault; provision Staging/UAT/Prod from the existing Terraform/Helm; add Grafana dashboards and the WAF ruleset.

**D. Client decisions (blueprint §9) — not code:** CBS naming, Dzongkha feasibility sign-off, e-Sign/SMS/RMA/Krystal scope, RTO/RPO, RACI.

---

## 8. Recommended first increments (small, non-duplicating)

Pick from **§7.A** — each is self-contained, needs no new infra, and is independently shippable + testable on the current stack:

1. **Config module** (`system_config` + `GET/PUT /config`) — smallest, unblocks AI-threshold tuning (§4.13 + §4.7).
2. **Validation module** (`validation_rules`/`validation_results` + run-on-extract) — closes a whole missing §4 module.
3. **Dzongkha OCR** (`lang` param + fixture test) — directly de-risks the #1 technical risk.
4. **Audit `prev_hash` column** — turns the existing verify-on-read chain into a persisted tamper-evident chain.

> Each lands as one migration + one route group + tests, behind the existing gateway/DB/auth — exactly the "extend, don't rebuild" mandate.
