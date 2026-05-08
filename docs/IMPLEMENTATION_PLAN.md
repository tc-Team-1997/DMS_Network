# DocManager Implementation Plan — Bank of Bhutan
## 90-Day Rollout (May–July 2026)

**Version:** 1.0 | **Date:** 18 April 2026 | **Status:** Ready for Bid Submission

---

## Executive Summary

DocManager will be deployed at Bank of Bhutan as a single-tenant production instance supporting 40 branch users across 5 locations within 90 calendar days of contract signature. The implementation follows a phased approach: discovery and architecture (Days 1–10), infrastructure and integration build-out (Days 11–40), user acceptance testing (Days 41–70), and hypercare go-live (Days 71–90).

**Success gates:**
- UAT pass rate ≥95% (all critical workflows, all document types)
- Training completion ≥90% across 4 cohorts (admin, maker, checker, viewer)
- Go-live P1 incidents ≤2
- 30-day post-go-live mean time to resolution (MTTR) ≤4 hours

This plan assumes a vendor-led (BoB) staffed delivery model with embedded customer resources. Commercial inputs on rates and FTE allocation are flagged below.

---

## Phase 1: Discovery & Kickoff (Days 1–10)

### Objectives
Align on architecture, inventory existing systems, scope data migration, identify risks.

### Activities

**Stakeholder Alignment**
- Kickoff workshop with BoB executive sponsor, IT director, branch operations, compliance, and audit (Day 1, 4 hours).
- Agree on single point of authority for design decisions (Project Sponsor).
- Establish change-control board (sponsor, IT lead, compliance rep).

**Systems Inventory & Integration Scoping**
Confirm all documented touchpoints and plan integration stubs. For each system, capture API docs, sandbox credentials, data-refresh cadence, and criticality for Day 1:

| System | Role | Status | Criticality | Integration Gate |
|--------|------|--------|-------------|-----------------|
| **TCS BaNCS (CBS)** | Core banking | Existing | P0 | Account lookup; customer master sync |
| **TCS GBP** | Global Banking | Existing | P2 | Cross-border doc indexing (post-go-live) |
| **mBoB / goBoB** | Mobile banking | Existing | P1 | Document link-back from mobile capture |
| **IB (Investment Banking)** | Trade finance | Existing | P1 | Loan doc versioning; covenant monitoring |
| **KYC/CIF (Customer Info File)** | Onboarding | Existing | P0 | Customer risk band; OFAC screening |
| **LOS (Loan Origination System)** | Lending | Existing | P1 | Loan application doc attach; status sync |
| **Digital Banking** | Web/mobile portal | Existing | P1 | Document download; capture redirect |
| **ERP (Finance)** | Back-office | Existing | P2 | Accounts payable; GL posting |
| **CRM** | Customer relationship | Existing | P2 | Case file attachments |
| **Contact Center** | Call center | Existing | P2 | Ticket attachment (post-go-live) |

Outcome: Integration roadmap with adapter stubs, sandbox credentials, and go-live exclusions documented.

**Data Migration Scoping**
- Identify legacy document repositories (file servers, SharePoint, old DMS).
- Estimate volume (documents, versions, metadata).
- Plan sampling strategy: 10% pre-launch validation, 100% migration during cutover week.
- Confirm retention policy alignment with BoB's compliance hold calendar.

**Risk Register**
Document top-10 risks with owners and mitigation (see §7).

### Deliverables
- Stakeholder register + RACI matrix
- Systems integration matrix (table above)
- Data migration plan (volume, timeline, rollback strategy)
- Risk register v1.0

### Team
- **Vendor:** Project Manager (lead), Solution Architect (1 FTE), DevOps lead (0.5 FTE)
- **BoB:** Project sponsor (named), IT liaison (1 FTE), branch champion (0.5 FTE)

**Effort:** 15 person-days (vendor) + 10 person-days (BoB)

---

## Phase 2: Environment & Integration (Days 11–40)

### Objectives
Provision production-ready infrastructure, build adapter stubs, validate connectivity, launch pilot.

### Activities

**Infrastructure Provisioning**
- Provision cloud compute (target: <<FILL: AWS/Azure/GCP region>>), 3-tier network (web, app, data).
- Deploy base stack: PostgreSQL 15+ with automated backups, Redis (session + cache), MinIO S3 (or cloud-native equivalent), Kafka topic stream for document events.
- Install monitoring: Prometheus + Grafana for metrics, Loki for logs, Temporal (tracing).
- Set up CI/CD pipeline: GitHub Actions → staging environment auto-deploy on branch push.
- Helm chart deployment: validate all components spin up in < 5 minutes.

**SSO & Active Directory Integration**
- Integrate with BoB's Active Directory (LDAP/SAML). Document schema mapping (cn, mail, department, branch, role).
- Configure user provisioning: SCIM 2.0 sync (create/update/suspend users daily).
- Test MFA: TOTP (Google Authenticator) and WebAuthn (FIDO2) enrolment flows.
- Baseline: 40 test users seeded from AD pilot OU.

**CBS Adapter Build-Out**
Implement the TCS BaNCS adapter skeleton per the pattern in `python-service/app/services/integrations/base.py`:

| Endpoint | Use Case | Stub Start | MVP Gate | Testing |
|----------|----------|----------|----------|---------|
| Account lookup (CIF#) | Verify customer exists, fetch balance | Day 12 | Day 25 | Mock sandbox |
| Customer master pull | Name, address, risk band, compliance status | Day 13 | Day 28 | Recorded response |
| Document link-back to teller | Reverse link from teller to DocManager | Day 15 | Day 32 | Integration test |
| GL posting (payment clearing) | Post cleared document to G/L | Day 18 | Post-go-live | UAT-gate |

Each adapter implementation includes:
- Connection pooling + retry logic (exponential backoff, max 3 retries).
- Request/response logging to audit trail (no PII in logs).
- Fallback to cached data (TTL 15 minutes) if CBS unavailable.
- Contract-test coverage in pytest (mock vs sandbox vs production modes).

See `python-service/app/services/integrations/temenos_t24.py` for reference implementation.

**Pilot Branch Setup**
- Select 1 pilot branch (recommendation: HQ branch with >= 5 power users).
- Install scanner hardware (WIA/TWAIN compatible) + test with 10 sample documents.
- Configure document types via LearnWizard (`apps/web/src/modules/document-types/LearnWizard.tsx`): upload 5 samples per type, train classifier, validate ≥95% accuracy on 20-doc hold-out set.
- Train 3 pilot-branch super-users (1 admin, 1 maker, 1 checker).

**Sandbox & Staging Validation**
- Spin up staging clone of production schema, load 1000 sample documents via batch API.
- Run load test: 50 concurrent users, 200 document uploads/hour, validate p95 < 2 seconds on all SPA routes (using `loadtest/k6.js`).
- Verify failover: kill random service, confirm graceful degradation, no data loss.

### Deliverables
- Infrastructure diagram (VPC, RDS, Redis, S3, Kafka, monitoring stack)
- CBS adapter implementation (4 endpoints, mock + sandbox test suites)
- DocType schema for BoB (KYC, loans, trade finance, compliance docs — ≥10 types)
- Pilot branch readiness report

### Team
- **Vendor:** DevOps (1 FTE), Backend engineer (1 FTE), QA automation (0.5 FTE), Solutions architect (0.5 FTE)
- **BoB:** IT infrastructure (1 FTE), CBS system owner (1 FTE), scanner/hardware tech (0.5 FTE)

**Effort:** 50 person-days (vendor) + 30 person-days (BoB)

---

## Phase 3: UAT & Training (Days 41–70)

### Objectives
Validate all workflows under realistic load, train users, close defects.

### Activities

**UAT Environment Launch**
- Clone production data (redacted: mask PAN, CID, sensitive fields via `python-service/app/services/redaction.py`).
- Provision UAT database with 5,000 documents across all document types.
- Publish UAT runbook: how to log in, create test account, upload doc, approve workflow, search.

**UAT Test Execution**
- **Coverage:** Critical workflows (capture, index, approve, reject, escalate, search, audit export).
- **Scripts:** 50+ test cases per workflow, covering happy path + edge cases (missing metadata, confidence < threshold, duplicate detection, after-hours rules).
- **Pass criteria:** ≥95% first-pass (≤5% defects that slip to P3/P4).
- **Defect SLA:** P1 (blocking) fixed in 24h, P2 in 5 business days, P3 backlog.

Test data set composition (5,000 docs):
- 40% KYC documents (CID, passport, utility bill, salary cert)
- 25% Loan documents (offer letter, insurance, appraisal)
- 20% Trade finance (L/C, bill of exchange, invoice)
- 10% Compliance (AML screening result, sanction check, covenant)
- 5% Miscellaneous (correspondence, supporting docs)

**RBAC Mapping to BoB Org Chart**
Map DocManager roles to BoB branches and functions:

| Role | Count | Responsibilities | Branch Assignment |
|------|-------|------------------|------------------|
| **Doc Admin** | 2 | System config, user mgmt, retention policy, audit review | HQ (1), Regional hub (1) |
| **Maker** | 15 | Capture, classify, index, create workflow request | Branch: 3 each (5 branches) |
| **Checker** | 15 | Review, approve/reject, escalate, add notes | Branch: 3 each (5 branches) |
| **Viewer** | 8 | Search, download, report export (read-only) | Branch: 1–2 each |

Validate each role's access matrix at UAT gates (see below).

**Training Program**
- **Audience:** 40 branch users in 4 cohorts (10 users per cohort).
- **Duration:** 2 days per cohort (4 half-day sessions).
- **Instructor:** Vendor-led with BoB co-trainer (2 per cohort).
- **Content:**
  - Day 1: System overview (15 min), admin setup (1 hour), capture workflow (1.5 hours), demo sandbox (30 min).
  - Day 2: Indexing & approval (1 hour), search & reporting (1 hour), troubleshooting & edge cases (1 hour), lab: end-to-end capture → approval (2 hours).
- **Materials:** Printed quick-start guides (A5), video recordings (branch-playback on no-internet scenarios), in-app contextual help (tooltips + guided tours via in-app nudges).
- **Assessment:** Post-training quiz (≥70% pass) + observed task completion (capture → approve a sample document).
- **Training schedule:**
  - Cohort 1 (admin + super-users): Day 41–42
  - Cohort 2–4 (makers, checkers, viewers): Days 43–65
  - Train-the-trainer session (3 BoB staff): Day 66 (prep for hypercare escalation)

**UAT Exit Gates**
- [ ] 95%+ test cases pass (≤5% P3/P4 defects).
- [ ] RBAC validation: each role type demos 2 workflows end-to-end.
- [ ] Load test: 40 concurrent users + 200 docs/hour for 4 hours, p95 < 2s, zero data loss.
- [ ] All critical CBS integrations respond within SLA (Account lookup <500ms, risk band <1s).
- [ ] Training completion: ≥90% (36 of 40) users pass post-training assessment.
- [ ] Data migration dry-run: legacy data → DocManager in < 2 hours, spot-check ≥50 records for accuracy.

### Deliverables
- UAT test plan + 50+ test scripts (in TestRail or Jira)
- RBAC access-control matrix signed by sponsor
- Training curriculum (slides, videos, labs, assessments)
- Defect log (categorized P1/P2/P3/P4, closure evidence)
- UAT sign-off report (exit gates ✓/✗)

### Team
- **Vendor:** QA lead (1 FTE), Backend test engineer (0.5 FTE), Trainer (1 FTE), Solutions architect (0.5 FTE)
- **BoB:** UAT coordinator (1 FTE), Test team (3 FTE), Training co-lead (1 FTE)

**Effort:** 60 person-days (vendor) + 40 person-days (BoB)

---

## Phase 4: Go-Live & Hypercare (Days 71–90)

### Objectives
Execute cutover with zero user-visible downtime, deliver 24/7 support for 2 weeks post-go-live.

### Activities

**Phased Rollout**
Go-live in 3 waves to limit blast radius:

**Wave 1 (Day 71, pilot branch, 5 users):**
- Cutover window: 20:00–22:00 (after business hours).
- Rollback trigger: P1 bug in core workflow; estimated rollback time <30 minutes (via Postgres point-in-time recovery).
- Success criteria: all 5 users can capture 1 document, approve 1 workflow, search, export audit log.

**Wave 2 (Day 76, HQ + 2 branches, 20 users):**
- Lesson learned from Wave 1 applied.
- Parallel running: legacy system stays live for 3 days (read-only); users file 2 paths (new and old) during transition.
- Success: zero P1 incidents, ≥95% user adoption (users returning for 2+ transactions).

**Wave 3 (Day 83, remaining 3 branches, 15 users):**
- Decommission legacy system after Wave 3.
- Confirm no cross-system data gaps.

**Cutover Runbook**
Pre-prepared, tested on staging (Day 68). Covers:
1. Data freeze (10 minutes): legacy system stops accepting uploads.
2. Export & validate (15 minutes): export final batch of legacy docs, validate row counts.
3. Import (30 minutes): stream into DocManager via Python service batch API (chunked, resumable).
4. Health checks (20 minutes): query 100 random documents, verify metadata, search index populated.
5. Rollback plan (if needed): restore Postgres from backup, revert Kafka topic offset.

**Hypercare Support Model**
- **L1 on-call (24x7):** BoB help desk routes issues to dedicated hotline.
- **L2 on-site escalation:** Vendor engineer on-site at HQ during Days 71–76; remote standby Days 77–85.
- **L3 product support:** Vendor dev team (Python + Node stack) on Slack channel, 30-minute response for P1.
- **Daily standup:** 15:00 local time (vendor, BoB ops, branch liaisons); issue review, adoption metrics, rollout readiness.
- **Incident SLA during hypercare:** P1 response <15 minutes (Days 71–85), <1 hour after (Days 86–90).

**Success Metrics Tracking**
- Daily adoption: % of trained users logging in.
- Daily incident tally: P1/P2/P3 count, MTTR, backlog closure rate.
- Weekly NPS survey (3-question: usability, performance, support satisfaction).
- Data quality spot-checks: 50 random documents weekly, verify OCR confidence, metadata completeness.

**Handover to Steady-State Support**
On Day 85:
- Vendor on-site team departs; L2 transitions to remote.
- BoB internal support team trained on runbooks, KB articles, escalation path.
- SLA transitions to standard support (see `docs/SLA_TEMPLATE.md`).
- Weekly sync cadence established (instead of daily) for product feedback.

### Deliverables
- Cutover runbook (tested on staging, signed off)
- Hypercare escalation tree + hotline contact card
- Training runbook for BoB internal support (30-page, step-by-step troubleshooting)
- Go-live report (per-wave metrics, incident log, decisions, retrospective)

### Team
- **Vendor:** On-site delivery lead (1 FTE Days 71–76, remote thereafter), Backend support (1 FTE), DevOps on-call (0.5 FTE Days 71–90)
- **BoB:** Hypercare coordinator (1 FTE), Ops team (2 FTE Days 71–85), Branch liaisons (5 × 0.2 FTE)

**Effort:** 40 person-days (vendor) + 25 person-days (BoB)

---

## Resource Plan

### Vendor Staffing (Total 165 person-days)

| Role | Seniority | FTE | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Notes |
|------|-----------|-----|--------|---------|---------|---------|-------|
| **Project Manager** | Senior | 1.0 | 100% | 100% | 100% | 100% | Lead delivery, stakeholder mgmt, risk owner |
| **Solution Architect** | Senior | 0.5 | 50% | 50% | 50% | 50% | Design, integration pattern, UAT coaching |
| **Backend Engineer** | Mid | 1.0 | 50% | 100% | 50% | 50% | CBS adapter, API, testing |
| **DevOps / Infrastructure** | Mid | 1.0 | 50% | 100% | 0% | 50% | Infra build, CI/CD, monitoring, cutover |
| **QA Automation** | Mid | 1.0 | 20% | 50% | 100% | 50% | Test scripts, defect triage, UAT execution |
| **Trainer / CS** | Senior | 0.5 | 0% | 0% | 100% | 100% | Training delivery, knowledge transfer, support ramp |
| **Data Migration Lead** | Senior | 0.5 | 50% | 50% | 50% | 100% | Legacy data strategy, cutover data validation |

**Effort estimate:** <<FILL: $rate per FTE per month>> × 3 months = <<FILL: total cost>>
Assumes: all vendor staff on engagement days (no part-time); BoB provides named counterpart for each vendor role; travel budget for on-site Phase 4 (<<FILL: flights + accommodation>>).

### BoB Staffing (Total 105 person-days)

| Role | Count | FTE | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Notes |
|------|-------|-----|--------|---------|---------|---------|-------|
| **Project Sponsor** | 1 | 0.3 | 100% | 50% | 30% | 20% | Executive alignment, risk escalation |
| **IT Director / Liaison** | 1 | 1.0 | 50% | 100% | 50% | 50% | Infrastructure owner, AD integration |
| **CBS System Owner** | 1 | 0.5 | 100% | 100% | 50% | 50% | API docs, sandbox credentials, support |
| **Branch Champions** | 5 | 0.2 | 10% | 10% | 30% | 50% | Local training, pilot feedback, adoption drive |
| **UAT Test Team** | 3 | 1.0 | 0% | 0% | 100% | 0% | Execute test scripts, log defects, sign-off |
| **Training Co-Lead** | 1 | 1.0 | 0% | 10% | 100% | 50% | Curriculum prep, trainer co-facilitation |
| **Hypercare Coordinator** | 1 | 1.0 | 0% | 0% | 0% | 100% | Incident triage, metrics tracking, escalation |

**Assumptions:**
- BoB provides named single point of contact (Project Sponsor) for all decisions.
- IT infrastructure team has access to AD, CBS sandbox, network provisioning (no delays expected).
- Branch users available for UAT + training during business hours; no reallocation penalty assumed.

---

## Dependencies & Assumptions

### External Dependencies (Risk Mitigation)

| Dependency | Risk | Mitigation |
|------------|------|-----------|
| **BoB Active Directory domain** | Delay if domain policy prevents LDAP/SAML | Provide LDAP test tenant (Days 11–20); pre-test schema mapping |
| **TCS BaNCS sandbox access** | Restricted credentials; CBS team slow to respond | Establish named CBS liaison (Day 1); request sandbox creds during kickoff |
| **Scanner hardware delivery** | Procurement delays; WIA/TWAIN driver availability | Confirm hardware spec (model) pre-contract; vendor provides driver test harness |
| **Network bandwidth (5 branches)** | Slow uploads; lag on slow links | Recommend ≥5 Mbps per branch; provide offline-queue feature for low-connectivity branches (fallback sync when online) |
| **BoB freeze periods (religious/national holidays)** | Unavailable staff during critical phases | Map BoB holiday calendar in Phase 1; avoid UAT/go-live around major holidays; scope Phase 4 for <<FILL: dates BoB provides>> |
| **Executive sign-off delays** | Sponsor unavailable for UAT gate; scope creep | Establish weekly sponsor sync (30 min) fixed-time; gate all changes via change-control board |

### Assumptions

- **One-vendor model:** This plan assumes vendor provides all delivery roles. If BoB prefers co-sourcing (e.g., BoB IT does infra provisioning), re-baseline effort and dependencies.
- **Cloud infrastructure:** Plan assumes cloud-hosted (AWS/Azure) with auto-scaling. On-premise or hybrid deployments require additional network/security design (add 2–5 days Phase 2).
- **No custom development:** DocManager ships as-is; no bespoke workflows or integrations outside the roadmap. Custom work post-go-live is separately scoped.
- **Pilot branch has power users:** Assumes HQ branch has ≥5 users with training bandwidth and authority to provide feedback.
- **Parallel running window:** 3-day parallel run during Wave 2/3 (legacy + new system) requires manual reconciliation; if BoB cannot support parallel operations, cutover is instantaneous (higher risk, recommended 24-hour rollback window).

---

## Success Metrics

### Go-Live Quality Gates

| Metric | Target | Measurement | Owner |
|--------|--------|-------------|-------|
| **UAT pass rate** | ≥95% test cases | Test case count: passed / (passed + failed) | QA lead |
| **Training completion** | ≥90% (36 of 40 users) | Post-training assessments scored ≥70% | Trainer |
| **Go-live P1 incidents** | ≤2 during Days 71–85 | Incident severity triage log | On-site delivery lead |
| **Data migration accuracy** | ≥99.5% spot-check | 50-doc sample: metadata integrity, OCR match | Data migration lead |
| **System uptime (Week 1)** | ≥99.5% (business hours) | Monitoring: downtime / total time | DevOps |

### 30-Day Post-Go-Live Metrics

| Metric | Target | Measurement | Owner |
|--------|--------|-------------|-------|
| **User adoption** | ≥80% active users (2+ logins/week) | Audit log login count per user | Analytics |
| **Mean time to resolution (MTTR)** | ≤4 hours (P1/P2) | Incident log: discovery → closure time | Support manager |
| **System uptime** | 99.5% overall, 99.8% business hours | Monitoring dashboard | SRE |
| **Customer NPS** | ≥7 / 10 (3-question survey) | Weekly pulse survey score | CS |
| **P1 incident count** | ≤1 per week | Weekly incident report | Support manager |

---

## Gantt-Style Timeline (Weeks W1–W13)

```
W1   W2   W3   W4   W5   W6   W7   W8   W9   W10  W11  W12  W13
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PHASE 1: DISCOVERY & KICKOFF (Days 1–10)
[██] Stakeholder alignment
     [██] Systems inventory & integration scoping
          [██] Data migration scoping
               [██] Risk register v1.0

PHASE 2: ENVIRONMENT & INTEGRATION (Days 11–40)
     [████████████████] Infra provisioning + SSO setup
     [████████████████] CBS adapter build-out (4 endpoints)
                    [████████████] DocType schema + pilot setup
                         [████████████] Sandbox validation

PHASE 3: UAT & TRAINING (Days 41–70)
                              [████████████████████] UAT execution (50+ test scripts)
                                     [████████████████████] Training program (4 cohorts)
                                            [████████████] Training completion & UAT sign-off

PHASE 4: GO-LIVE & HYPERCARE (Days 71–90)
                                                 [██] Wave 1 (pilot)
                                                    [██] Wave 2 (HQ + 2 branches)
                                                       [████████] Wave 3 + hypercare

WORKSTREAMS (parallel):
PM + Stakeholder Mgmt    [████████████████████████████████████████]
Infra + DevOps          [██████████████████████████████]
Backend (CBS adapter)   [████████████████████████]
QA + Testing            [████████████████████████████████████]
Training + Docs         [████████████████████████████████]
```

---

## Change Management & Approval

All changes to this plan require sign-off from the Change Control Board (Sponsor, IT Director, Vendor PM). Minor scope adjustments (≤2 day impact) are flagged in weekly standup; major changes (>5 day impact) require RFC with 5-business-day review window.

**Current plan baseline:** 90 calendar days, signed-off <<FILL: sponsor name + date>>.

---

## Appendices

### A. Detailed Activity List (Micro-Schedule)

Full task breakdown available in project-management system (<<FILL: Asana/Jira project>>). Includes:
- Sub-tasks with 1–2 day duration
- Resource calendar (vendor + BoB staff availability)
- Dependency graph (critical path highlighted)
- Milestone gates (gates locked until dependencies complete)

### B. Data Migration Strategy

- **Legacy source:** <<FILL: source system name, volume, data dictionary>>
- **Transformation:** Custom ETL in Python (source → Parquet → DocManager staging table → import)
- **Validation:** Row counts, checksum validation, 50-doc manual spot-check
- **Rollback:** Keep legacy system read-only for 2 weeks post-go-live in case of dispute

### C. Risk Register (Extended)

Top 10 risks with owners and mitigation plans; updated weekly in Phase 3–4.

| # | Risk | Owner | Probability | Impact | Mitigation | Contingency |
|---|------|-------|------------|--------|-----------|------------|
| R1 | CBS integration API blocked by security policy | IT Director | Medium | High | Pre-test in sandbox; escalate to CBS VP if needed | Delay CBS features to post-go-live; launch with mock |
| R2 | UAT finds critical OCR accuracy issue (< 80%) | QA lead | Low | Critical | Run pilot DocType training in Phase 2; validate F1 ≥ 95% before UAT | Reduce document types in Wave 1; train on more samples |
| R3 | Network bandwidth insufficient at branch | IT ops | Medium | Medium | Bandwidth audit in Phase 2; recommend ≥5 Mbps | Deploy offline-queue feature (capture queue, sync when online) |
| R4 | Executive sponsor becomes unavailable | PM | Low | High | Name backup sponsor (Day 1); require weekly sign-off | Escalate to CFO/CTO; reduce scope to MVP |
| R5 | Go-live P1 bug unfixed by cutover | QA lead | Low | Critical | UAT gate: zero P1 escapes; if found, delay rollout | Rollback plan: restore Postgres, revert to legacy system (2-hour RTO) |
| R6 | Hypercare staffing gap (support team overwhelmed) | PM | Medium | High | Train BoB internal support in Phase 3; vendor on-call ramp | Extend on-site phase 1 additional week (Days 86–92) |
| R7 | Data migration job fails during cutover | Data migration lead | Low | High | Dry run on staging (Day 68); pre-validate row counts | Rollback and re-attempt; escalate to vendor CTO |
| R8 | BoB freeze period coincides with critical phase | PM | Medium | Medium | Map BoB holidays (Phase 1); avoid UAT/go-live during freeze | Extend timeline by 2 weeks if unavoidable |
| R9 | Performance degradation under load (p95 > 5s) | Backend | Low | Medium | Load test in Phase 2 (50 users, 200 docs/hour); scale infra if needed | Add caching layer; defer complex features to M2 |
| R10 | Third-party service outage (Kafka, Redis, S3) | DevOps | Low | Medium | Implement circuit breakers + fallback; 15-min SLA | Manual failover documented; test weekly on staging |

---

**Document prepared for:** Bank of Bhutan DMS Tender 000/BoB/Tender/2026/009  
**Bid submission deadline:** 28 April 2026  
**Contract signature assumed:** ~2 May 2026 | **Implementation start:** ~12 May 2026
