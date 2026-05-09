# DocManager — Security & Compliance

> **The certifications, controls, and day-to-day operational posture that lets us sell to central banks.**
>
> Implementation timeline: [ROADMAP.md Track F](./ROADMAP.md).
> Architecture context: [TARGET_ARCHITECTURE.md §11](./TARGET_ARCHITECTURE.md#11-security-posture-summary).

Last updated: 2026-05-10 (post-Foundation + Wave A + Wave B) · 8 new controls shipped (tenant_config, Admin Settings, magic-link, SoD, ABAC, PII reveal audit, hash-chained config, WORM extend-only, step-up)

---

## 1. The commitment

Banking customers do not buy "hopefully secure." They buy **evidence**. This document catalogues the evidence we produce and the controls that produce it.

Our baseline: **SOC 2 Type II + ISO 27001 + regional cert (NCA ECC / CBE / RBI / PCI-DSS)** delivered by Q3 2027. Most competitors stop at SOC 2. The regional certs are what win tier-1 deals.

---

## 2. Certifications & attestations timeline

```
Q2 2026   ▌  SOC 2 Type I audit started (evidence collection)
Q3 2026   ▌  SOC 2 Type I report issued · ISO 27001 Stage 1 passed · pen test #1
Q4 2026   ▌  SOC 2 observation window running · ISO 27001 Stage 2 prep
Q1 2027   ▌  SOC 2 Type II issued · NCA ECC initiated · CBE attestation
Q2 2027   ▌  ISO 27001 full cert · SWIFT customer security programme attest
Q3 2027   ▌  PCI-DSS SAQ-D · NCA ECC cert · RBI CSF attest · pen test #2
Q4 2027   ▌  Public bug bounty live · first external VAPT report published
```

Certifications we deliberately do **not** pursue (until a customer demands):
- **FedRAMP** — 18-month process, US-gov specific, not our beachhead.
- **HIPAA** — wrong vertical.
- **CSA STAR Level 2** — overlaps with SOC 2 + ISO, diminishing returns.
- **IRAP (AU gov)** — revisit if we win AU customers.

---

## 3. Control framework mapping

Every control we implement maps to one or more standards. A single control usually satisfies multiple frameworks — that's the efficiency of a well-designed security programme.

| Control family | SOC 2 | ISO 27001 | PCI-DSS | NCA ECC | CBE | Notes |
|---|:-:|:-:|:-:|:-:|:-:|---|
| Access control | CC6 | A.9 | 7, 8 | 2-1 | ✓ | RBAC + MFA + least-privilege |
| Encryption at rest / transit | CC6.1, CC6.7 | A.10 | 3, 4 | 2-4 | ✓ | AES-256 at rest, TLS 1.3 transit, per-tenant KEK |
| Audit logging | CC7.2 | A.12.4 | 10 | 2-8 | ✓ | Append-only hash-chained, 7-year retention |
| Change management | CC8.1 | A.12.1 | 6.4 | 2-5 | ✓ | PR review, approval gates, SBOM on release |
| Incident response | CC7.3-7.5 | A.16 | 12.10 | 2-11 | ✓ | IRP document, quarterly drills |
| Vendor management | CC9.1-9.2 | A.15 | 12.8 | 2-3 | ✓ | Vendor assessment + DPA per sub-processor |
| Data retention / deletion | CC6.5 | A.8, A.11 | 3.1 | 2-7 | ✓ | Policy-driven retention + DSAR automation |
| Business continuity / DR | A1.2-A1.3 | A.17 | 9.5 | 2-9 | ✓ | RTO ≤ 1h, RPO ≤ 5min, quarterly drills |
| Vulnerability mgmt | CC7.1 | A.12.6 | 6.1, 6.2 | 2-6 | ✓ | Continuous scanning, patching SLAs by severity |
| Secure SDLC | CC7.1 | A.14 | 6.3, 6.5 | 2-5 | ✓ | SAST, DAST, dependency scan, secrets scan |
| Physical security | CC6.4 | A.11 | 9 | 2-10 | n/a | Inherited from cloud provider (AWS, Azure) |
| Data residency | Custom | A.18 | n/a | 2-7 | ✓ | Per-tenant region pinning, DSAR automation |
| AML screening | CC1.4, CC7.2 | A.12.4, A.18.1 | n/a | 2-6, 2-8 | ✓ | OFAC/EU/UN watchlist matching, human-reviewed hits, audit trail (AML_SCREENING_TRIGGERED, AML_HIT_DECIDED, AML_HIT_ESCALATED) |
| CBS integration | CC1.4, CC9.1, CC7.2 | A.15, A.12.4 | 10 | 2-3, 2-8 | ✓ | OAuth2 token mgmt, circuit breaker fallback, PII-masked logging, audit trail (CBS_PULL_CUSTOMER, CBS_LINK_POSTED, CBS_CACHE_INVALIDATED) |
| WORM immutability | CC6.5, CC7.2 | A.8, A.12.4 | 3.4 | 2-7, 2-8 | ✓ | OS-level immutable flags (chflags/chattr) on documents under retention, nightly verification with hash baseline, audit trail (WORM_LOCKED, WORM_UNLOCKED, WORM_VERIFIED, WORM_TAMPERED) |
| Document redaction | CC6.1, CC7.2 | A.10, A.12.4 | 3.1 | 2-4, 2-8 | ✓ | Pike PDF-based text destruction (not visual overlay), post-redaction pdftotext verification, parent-child version chain, audit trail (DOCUMENT_REDACTED, REDACTION_VERIFICATION) |
| Biometric KYC | CC1.2, CC6.1, CC7.2 | A.9, A.10, A.12.4 | 8.3 | 2-1, 2-4, 2-8 | ✓ | Offline dlib face_recognition, 128-dim encodings only (no raw images), 90-day encoding cache, consent audit trail, DPIA-style review, audit trail (BIOMETRIC_MATCH_PERFORMED, BIOMETRIC_CONSENT_GRANTED) |
| Offline sync queue | CC1.4, CC7.2 | A.12.4 | n/a | 2-8 | ✓ | IndexedDB outbox encryption, Service Worker background sync, 24h idempotency-key deduplication, audit trail (OFFLINE_SYNC_REPLAY, IDEMPOTENCY_CONFLICT) |
| Offline translation | CC6.1, CC7.2 | A.10, A.12.4 | n/a | 2-4, 2-8 | ✓ | Meta NLLB-200-distilled-600M model (fully offline, no API calls), 7-day translation cache, SHA-256 source dedup, audit trail (DOCUMENT_TRANSLATED, TRANSLATION_DELETED) |
| Tenant config spine | CC6, CC8 | A.9, A.12 | 6 | 2-1, 2-5 | ✓ | Unified tenant_config key-value JSON namespace, per-namespace RBAC (requireNamespacePermJson), hash-chained history (CC1 tenant_config_history table), 16 namespaces published as JSON Schemas, audit trail (CONFIG_CHANGED with reason ≥20 chars). Shipped Foundation (commit ebae97e). |
| Admin Settings UI | CC6, CC8 | A.9, A.12 | 6 | 2-1, 2-5 | ✓ | Generic ConfigPanel renders JSON Schemas auto-generated; per-namespace RBAC gates; no direct DB access; all changes logged. Shipped Foundation (commit ebae97e). |
| Magic-link invite | CC6 | A.9 | 8 | 2-1 | ✓ | Users v2 Wave B: 32-byte hex token, email delivery via tenant_config.notifications.smtp, token TTL from tenant_config.auth.magic_link_ttl_hours, anonymous /set-password handler, no plaintext password storage. Audit trail (USER_INVITED, PASSWORD_SET). |
| SoD enforcement | CC6 | A.9 | 7 | 2-1 | ✓ | Users v2 Wave B: PATCH /spa/api/users/:id rejects 400 sod_violation if role change creates forbidden pair (tenant_config.rbac.sod_forbidden_pairs). Enforced at server, not client. Audit trail (SOD_VIOLATION_BLOCKED). |
| ABAC visual editor | CC6 | A.9 | 7 | 2-1 | ✓ | Wave B: Closed-enum field paths (subject.role, resource.doc_type, context.stepup_valid, etc.), JSON-to-Rego compiler (scripts/abac-compile.js), atomic file write, fire-and-forget OPA push (non-fatal if OPA down, dms.rego untouched). Audit trail (ABAC_RULE_CHANGED). |
| PII reveal audit | CC6.1, CC7.2 | A.10, A.12.4 | 3.1 | 2-4, 2-8 | ✓ | Wave B Customer-360: phone/email/national-id/dob masked by default, click reveal → reason ≥20 chars → 60s TTL countdown → auto-remask. Audited to customer_pii_reveals table (who, what, when, how long). Audit trail (PII_REVEALED, PII_REMASKED). |
| Hash-chained config history | CC7.2 | A.12.4 | 6 | 2-8 | ✓ | Foundation CC1: tenant_config_history table, deterministic SHA-256 hash chain (version_hash = SHA256(prev_hash || namespace || canonical_json(data))), tampering breaks chain. Supports rollback to any point in history (Wave C). Audit trail (CONFIG_VERSION_HASH). |
| WORM extend-only | CC6.5, CC7.2 | A.8, A.12.4 | 3.4 | 2-7, 2-8 | ✓ | Wave B Retention admin: WORM lock can only extend, never shorten (POST /api/v1/documents/{id}/worm/extend validates new unlock_at ≥ current). Documents on WORM excluded from retention sweep. Audit trail (WORM_EXTENDED, WORM_EXTEND_REJECTED). |
| Step-up enforcement | CC6 | A.9 | 8 | 2-1 | ✓ | Wave A Workflows v2 + Wave B AML v2: Server REJECTS 403 step_up_required if threshold met but webauthn_assertion_id missing. **SOX debt**: assertion is stored but not cryptographically validated server-side (Wave C must proxy to POST /py/api/v1/stepup/verify). Audit trail (STEPUP_REQUIRED, STEPUP_COMPLETED). |

---

## 4. Threat model (STRIDE, at a glance)

We have `python-service/app/routers/stride.py` as a stub — the intent is to make threat modelling a **running artifact**, not a one-time document.

Current primary threats, by layer:

### 4.1 Spoofing

- **Tenant subdomain spoofing** — attacker crafts `nbe-phish.docmanager.io`. Mitigated by strict subdomain registration + WAF rules.
- **User identity spoofing** — session hijack, credential stuffing. Mitigated by MFA, device fingerprinting, impossible-travel detection.

### 4.2 Tampering

- **Document content tampering in transit** — TLS 1.3 + HMAC signed webhooks.
- **Database tampering** — write-ahead log + point-in-time recovery + immutable audit chain.
- **Model tampering (AI)** — signed model weights, SLSA provenance, cosign verification on deploy.

### 4.3 Repudiation

- **User denies action** — cryptographically chained audit log, signed by service identity (SPIFFE).
- **Tenant disputes a workflow decision** — full traceability: user → action → service → document → AI decision + citations.

### 4.4 Information disclosure

- **Cross-tenant data leakage** — the #1 risk we defend against. See [TARGET_ARCHITECTURE.md §4.2](./TARGET_ARCHITECTURE.md#42-enforcement-layers-defence-in-depth).
- **PII in logs / traces / errors** — strict logging policy + Presidio redaction at log aggregation.
- **AI model memorisation** — DP in training + no cross-tenant fine-tuning without opt-in + regular memorisation audits.
- **Side-channel via AI response latency** — out of scope for v1; revisit if we encounter motivated adversaries.

### 4.5 Denial of service

- **API DoS** — rate limiting + Cloudflare / WAF + circuit breakers.
- **AI GPU exhaustion** — per-tenant token/inference quotas + autoscaling + queue-based backpressure.
- **Storage fill** — per-tenant quota + alerting.

### 4.6 Elevation of privilege

- **Privilege escalation within tenant** — RBAC enforced server-side; ABAC via OPA for sensitive actions.
- **Support access abuse** — impersonation requires MFA re-auth + time-bounded token + full audit trail.

---

## 5. Identity & access

### 5.1 Authentication

- **End users:** JWT-in-HttpOnly-cookie (browser) + optional WebAuthn / passkeys.
- **MFA:** TOTP, WebAuthn, SMS fallback (discouraged; available for legacy customer demand).
- **Step-up:** high-risk actions (delete, bulk export, admin ops) require re-auth; we have `/routers/stepup.py`.
- **SSO:** SAML 2.0 + OIDC — native integrations with Azure AD, Okta, Ping, Google.
- **Device binding:** optional per-tenant — bind sessions to device fingerprints.

### 5.2 Authorisation

- **RBAC:** role-per-user with permission matrix mirrored at Node (`services/rbac.js`), Python (`app/services/auth.py`), SPA (`nav.ts#canAccess`), and OPA policy (`opa/policies/dms.rego`).
- **ABAC via OPA:** tenant, branch, risk band, after-hours, step-up-valid, data-residency-allowed attributes.
- **Service-to-service:** mTLS + SPIFFE identities; zero anonymous service calls.
- **Admin actions:** always require 4-eyes — one operator initiates, another approves.

### 5.3 User lifecycle

- **Provisioning:** SCIM 2.0 from customer's IdP → automatic user creation.
- **De-provisioning:** deletion event from IdP → immediate session termination + role revocation.
- **Periodic review:** quarterly report to tenant admin listing all users + last-active + role assignments.

---

## 6. Data protection

### 6.1 Encryption at rest

- **Postgres:** transparent encryption via cloud-native (RDS/Aurora/AKS) + application-level encryption for sensitive columns (customer PII, document metadata).
- **Object store (S3):** SSE-KMS with per-tenant CMK (BYOK); object-lock mode for WORM retention.
- **Backups:** same encryption as primary; cross-region replication remains encrypted.
- **Secrets:** Vault transit engine; no plaintext secrets on disk anywhere.

### 6.2 Encryption in transit

- **External:** TLS 1.3 minimum; TLS 1.2 only for legacy CBS adapters that can't upgrade.
- **Internal:** mTLS between services via service mesh (Linkerd or Istio).
- **Certificate management:** cert-manager + Let's Encrypt for public-facing; per-tenant ACME proxy where needed.

### 6.3 Key management

- **Per-tenant KEK:** customer-owned (BYOK) for tier-2+; each DEK wrapped by tenant KEK.
- **HSM-backed for tier-1:** Thales Luna, Entrust nShield, AWS CloudHSM.
- **Rotation:** 90-day KEK rotation with automated re-wrap; DEKs rotate on object write.
- **Deletion = cryptoshredding:** deleting a KEK renders all tenant data unrecoverable — DSAR "right to be forgotten" enforced cryptographically.

### 6.4 Data classification

| Class | Examples | Handling |
|---|---|---|
| **Confidential** | Customer PII, document contents, AI prompts | Encrypted everywhere, access audited, PII-redacted in logs |
| **Internal** | Workflow metadata, audit events, usage metrics | Tenant-scoped; encrypted at rest |
| **Public** | Documentation, marketing, open-source code | No restrictions |

Every data element is tagged; logging infrastructure enforces redaction by default for Confidential tags.

---

## 7. Audit & transparency

### 7.1 Audit log

- Append-only table (`audit_events`) per tenant.
- Each event: `{tenant_id, user_id, action, entity, entity_id, before, after, prev_hash, signature, timestamp}`.
- `prev_hash = SHA-256(prev_event)` → tamper detection.
- `signature = sign(event, service_identity_key)` → non-repudiation.
- Replicated to Kafka `tenant.*.audit` topic for real-time SIEM feeds.

### 7.2 Anchoring

- Every 1000 events (configurable), a Merkle root is computed and **anchored**:
  - Option 1: Customer's own Git repo (free, adequate).
  - Option 2: Public timestamp authority (eIDAS-compliant).
  - Option 3: Public blockchain (if customer contracts for it).
- We have `python-service/app/routers/anchor.py` as the stub.

### 7.3 Transparency logs

For regulator-inspection scenarios, we expose verifiable claim-logs via `/routers/transparency.py`. Regulator can subscribe to a tenant's transparency feed and independently verify event chain integrity.

### 7.4 DSAR automation

- Per-tenant privacy officer UI: "Subject request for customer CID X".
- Automated pipeline: find all documents, metadata, AI traces, audit events referencing the subject.
- Output: JSON + human-readable PDF bundle.
- Deletion request: cryptoshred (KEK revocation) + audit event logged.

Stub: `python-service/app/routers/dsar.py`.

---

## 8. Secure SDLC

### 8.1 Code gates

- **Code review:** mandatory, ≥ 1 reviewer, can't self-approve.
- **SAST:** Semgrep (open-source), CodeQL (GitHub) — blocks PR on high severity.
- **Secret scanning:** trufflehog or GitHub secret scanning.
- **Dependency scanning:** Snyk or Dependabot; CVSS ≥ 7 blocks merge.
- **Container scanning:** Trivy on every image; base images rebuilt weekly.
- **IaC scanning:** checkov on Terraform, kube-bench on Helm.

### 8.2 Supply chain

- **SLSA Level 3 provenance** on all releases.
- **SBOM:** CycloneDX per release, signed, published publicly.
- **Signed containers:** cosign + keyless OIDC.
- **Reproducible builds:** best-effort; deterministic where possible.
- **Pre-commit hooks:** format, lint, test, secret scan.
- We have `.github/workflows/supply-chain.yml` already stubbed.

### 8.3 Deploy gates

- Staging → prod via ArgoCD; prod requires 2-person approval.
- Canary: 5% → 25% → 100% with automatic rollback on metric regression.
- Feature flags: LaunchDarkly or OpenFeature + flagd (self-host option for on-prem).

### 8.4 Runtime

- **Admission control:** Kyverno / OPA Gatekeeper denies pods without signed images, missing labels, unsafe capabilities.
- **Runtime security:** Falco alerts on suspicious syscalls / process trees.
- **Network policies:** Calico / Cilium — default-deny, explicit-allow.

---

## 9. Vulnerability & patch management

- **Patching SLAs** (from CVE disclosure):
  - Critical (CVSS ≥ 9): ≤ 24 hours
  - High (7–8.9): ≤ 7 days
  - Medium (4–6.9): ≤ 30 days
  - Low (< 4): next release
- **External pen test:** semi-annual, rotating firms.
- **Bug bounty:** live by Q4 2027; HackerOne or Intigriti.
- **Zero-day response:** on-call security engineer, documented runbook.

---

## 10. Incident response

### 10.1 Classification

| Severity | Definition | Response SLO |
|---|---|---|
| **SEV1** | Customer data confidentiality, integrity, or availability compromised | < 15 min response, 24×7 |
| **SEV2** | Significant service degradation (> 10% users affected) or near-miss | < 1 hour response, 24×7 |
| **SEV3** | Minor degradation, single-tenant issue, workaround available | < 4 hours business-day response |
| **SEV4** | Low-impact, informational | Normal ticket flow |

### 10.2 Process

1. **Detect** — alerting, customer report, internal observation.
2. **Triage** — on-call classifies, opens incident channel.
3. **Contain** — stop the bleeding (isolate, rate-limit, disable feature flag).
4. **Investigate** — forensic analysis, root cause.
5. **Eradicate** — fix the cause, not just the symptom.
6. **Recover** — restore service, verify health.
7. **Postmortem** — blameless, within 5 business days, customer-visible for SEV1/2.

### 10.3 Communication

- **Status page:** status.docmanager.io, updated in real time.
- **Customer notification:** SEV1 within 30 minutes, SEV2 within 2 hours.
- **Regulatory notification:** where mandated (GDPR 72h, UAE PDPL, SAMA 4h for material incidents), executed by compliance team with template comms.

### 10.4 Drills

- **Quarterly incident drill** with scenarios rotated.
- **Annual tabletop** with exec team.
- **Annual red team exercise** (external).

---

## 11. Business continuity / DR

- **Backups:** Postgres continuous WAL, 35-day retention, encrypted cross-region.
- **Object storage:** cross-region replication, 30-day versioning.
- **RTO:** 1 hour (multi-region active-active failover from Q2 2027).
- **RPO:** 5 minutes.
- **DR drill cadence:** quarterly, documented, customer-visible for reference.
- **Tenant-specific restore:** any tenant can request their data be restored from backup to a specific point in time; SLA 24 hours.

---

## 12. Compliance operations (continuous)

We run a **continuous compliance program** rather than annual audit sprints:

- **Tooling:** Vanta or Drata to automate evidence collection.
- **Monthly reviews:** security champion from each pod + CISO.
- **Quarterly reviews:** exec + external advisor.
- **Annual audits:** full SOC 2 / ISO 27001 / regional renewals.
- **Continuous monitoring:** 200+ automated checks running nightly.

---

## 13. Data residency

- **Per-tenant region pinning:** at provisioning time, tenant selects a region; their data never leaves.
- **Available regions (GA):** EU (Frankfurt), ME (Bahrain or UAE), KSA (Riyadh), Africa (Cape Town).
- **Available regions (post-GA):** APAC (Singapore), India (Mumbai), US East.
- **Infra:** AWS primary; Azure for Azure-preferring customers; on-prem for tier-1.
- **Multi-cloud abstractions:** Terraform + Helm; cloud-specific bits are thin modules.

Customer contract clause: "Data processed exclusively in {Region}; sub-processors listed in Schedule X, none outside Region without 30-day notice."

---

## 14. Regulatory report templates

Pre-built, in-product:

| Jurisdiction | Regulator | Report | Surface |
|---|---|---|---|
| Egypt | CBE | Quarterly KYC compliance; document retention attestation | One-click from Compliance screen |
| KSA | SAMA | Monthly incident reporting; annual NCA ECC evidence | One-click; SAMA portal integration Q1 2027 |
| India | RBI | Cybersecurity framework attestation; doc retention | One-click; RBI Tantra integration Q2 2027 |
| UAE | CBUAE | Quarterly customer due diligence; PDPL compliance | One-click |
| EU | ECB / national | GDPR DSAR; DORA operational resilience | In-product + CDC out to customer reporting stack |

---

## 15. Vendor & sub-processor management

- Every sub-processor (AWS, Cloudflare, Anthropic for opt-in AI, Stripe for billing, LangSmith, etc.) documented in `SUB_PROCESSORS.md` with:
  - Purpose
  - Data accessed
  - Region
  - DPA / contract reference
- 30-day customer notification before adding a new sub-processor.
- Annual vendor risk assessment (ISO 27001 A.15 requirement).

---

## 16. Privacy principles

- **Data minimisation:** we collect only what's needed for the product to function.
- **Purpose limitation:** data is used only for the declared purpose; analytics are aggregate / anonymised.
- **Retention minimisation:** default retention policies + automated expiry.
- **User control:** DSAR self-service + export + deletion.
- **No data sales. Ever.**

---

## 17. Metrics we publicly commit to

| Metric | Target |
|---|---|
| Uptime | ≥ 99.9% (pooled), ≥ 99.95% (silo, dedicated) |
| P1 incident mean-time-to-resolve | ≤ 2 hours |
| P1 incident customer notification | ≤ 30 minutes |
| Critical CVE patch deployed | ≤ 24 hours |
| Certificates renewed on time | 100% |
| DSAR request completed | ≤ 30 days (GDPR) / ≤ 45 days (local) |
| Audit finding recurrence rate | 0 repeat findings year-over-year |
| Customer-reported security incident | Tracked; target 0/year post-GA |

---

## 18. SOX control gaps — closed in Wave C

Both material weaknesses documented in Wave A and Wave B have been closed. The section is retained for audit trail continuity.

### SOX-1: WebAuthn Assertion Cryptographic Validation

**Status: CLOSED in Wave C commit (see git log `docs/adr/0014-unified-workflow-audit.md`)**

**What was the gap:** webauthn_assertion_id was stored in `wf_actions` (Wave A Workflows v2) and AML suppressions (Wave B) for high-risk action approvals, but was NOT cryptographically validated server-side. A determined attacker could forge the assertion_id field.

**What was shipped:**
- `POST /api/v1/stepup/verify` endpoint added to `python-service/app/routers/stepup.py`.
- `python-service/app/services/stepup/verify.py` — validates assertion_id against `stepup_challenges` (challenge must be `kind='authenticate'`, `used=1`, within 5-minute TTL, owned by the calling user).
- `stepup_used_assertions` replay-prevention table (migration `0043_stepup_validation`): each assertion_id consumable exactly once.
- `services/stepup-verify.js` — Node proxy helper that calls Python `/verify` and surfaces 401 `step_up_invalid` on failure.
- `routes/spa-api/workflows.js` — both TODO(SOX) markers removed; verification called before every write (single-action and bulk handlers).
- `routes/spa-api/aml-screening.js` — suppress endpoint validates assertion when present.

**Evidence:** [ADR-0013 step-up enforcement](../adr/0013-stepup-enforcement-contract.md), [ADR-0014 unified workflow audit](../adr/0014-unified-workflow-audit.md), migration `0043_stepup_validation`, `python-service/tests/test_stepup_verify.py`.

### SOX-2: Workflow Audit Trail Bifurcation

**Status: CLOSED in Wave C commit (see git log `docs/adr/0014-unified-workflow-audit.md`)**

**What was the gap:** `wf_actions` (Node) and `workflow_steps` (Python) were written independently. Either side could fail silently, leaving diverged audit trails.

**What was shipped:**
- `POST /api/v1/workflow/{doc_id}/advance` endpoint added — Python now writes `workflow_steps` with full SOX context (reason_code, assertion_id) and returns `step_id`.
- Node writes `wf_actions` ONLY after Python `/advance` succeeds, storing `python_step_id` as the cross-reference FK.
- If Python fails, Node returns 502 and writes nothing — no divergence possible.
- `wf_actions.python_step_id` column added to Node `db/schema.sql` (migration 0032 comment block).
- `workflow_steps.reason_code` and `workflow_steps.assertion_id` columns added (migration `0044_workflow_audit_unification`).
- Failure mode verified in `python-service/tests/test_workflow_audit_unification.py`.

**Evidence:** [ADR-0014 unified workflow audit](../adr/0014-unified-workflow-audit.md), migrations `0043_stepup_validation` + `0044_workflow_audit_unification`, `python-service/tests/test_workflow_audit_unification.py`.

---

## 19. What we will NOT do

- **No security by obscurity.** Our architecture is documented; our code is reviewable (on-prem customers get full source access).
- **No skipping compliance because we're fast.** A missed cert blocks tier-1 deals — not worth the shortcut.
- **No vague "bank-grade security" marketing.** Every claim backed by a certificate, a control, or a benchmark.
- **No cross-tenant data features.** Nothing in the product that could ever leak across tenants, even intentionally.
- **No hardcoded secrets, anywhere.** Even dev environments.
