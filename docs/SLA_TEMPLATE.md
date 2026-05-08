# Service Level Agreement (SLA) Template
## DocManager — Bank of Bhutan Engagement

**Version:** 1.0 | **Date:** 18 April 2026 | **Status:** Ready for Commercial Review

---

## 1. Service Tiers & Scope

This SLA covers the hosted DocManager platform running on Bank of Bhutan's single-tenant production instance, including:
- Web SPA and REST APIs (`apps/web`, `python-service/app/routers/*`)
- Document storage and full-text search (`python-service/app/services/storage.py`, `search_backend.py`)
- AI/DocBrain services (classification, extraction, RAG; `python-service/app/services/docbrain/*`)
- Integration adapters (CBS, KYC, LOS, ERP stubs; `python-service/app/services/integrations/*`)
- Audit and compliance services (`python-service/app/services/audit.py`, `redaction.py`)

### Service Tiers

| Tier | Description | Support Hours | Response SLA | Included | Cost Model |
|------|-------------|----------------|--------------|----------|-----------|
| **L1 (First-Line)** | BoB help desk fields queries; escalates to vendor L2 if needed | 24x7, 365 days | 30 min (all severities) | Email, ticketing, knowledge base | Included in MSA |
| **L2 (Vendor Standard)** | Vendor support engineers diagnose and resolve bugs; access to staging | Standard hours (08:00–18:00 <<FILL: timezone>>), Mon–Fri | 1 hour (P1/P2), 4 hours (P3), 1 business day (P4) | Email, Slack, remote desktop, code patches | Included in MSA |
| **L3 (Product Engineering)** | Vendor development team for architecture issues, custom integrations, feature requests | Scheduled (72-hour advance notice) | 3 hours (during window) | Same as L2, plus source-code access, custom fixes | <<FILL: per-incident rate or annual retainer>> |

**Escalation path:** User → BoB L1 (email/phone) → Vendor L2 (Slack) → Vendor L3 (on-call engineer + product lead)

---

## 2. Severity Levels & Response / Resolution Targets

Each reported issue is triaged into one of four severity levels, with corresponding response and resolution SLAs:

### Severity Definitions

| Severity | Criteria | Business Impact | Example |
|----------|----------|-----------------|---------|
| **P1 (Critical)** | System completely unavailable; core business function blocked | ≥50% of users cannot work; revenue impact | DocManager API down; authentication broken; all documents inaccessible; CBS integration failed preventing account verification |
| **P2 (Major)** | Significant feature unavailable; major workflow degraded | ≥10% of users affected; workaround exists but slow | Search returns no results; OCR confidence consistently < 50%; approval workflow stuck (but can reassign); performance degraded (p95 > 10s) |
| **P3 (Minor)** | Non-critical feature degraded; isolated to specific user or workflow | <10% of users; workaround available | Export to PDF times out occasionally; email notification delayed 1 hour; one document type classifier needs retraining; UI button label incorrect |
| **P4 (Cosmetic)** | No business impact; documentation, UX polish, future enhancement | Zero impact on operations | Typo in help text; icon inconsistent with design system; tooltip wording improvement; feature request (low priority) |

### SLA Targets

| Severity | **Initial Response Time** | **Resolution Time** | **Escalation Trigger** |
|----------|---------------------------|-------------------|----------------------|
| **P1** | 15 minutes | 4 hours | If not resolved by 2 hours: escalate to product engineering (L3) |
| **P2** | 1 hour | 8 hours (same business day) | If not resolved by 4 hours: escalate to L3 |
| **P3** | 4 business hours | 2 business days | If not resolved by 1 business day: re-triage or escalate |
| **P4** | 1 business day | Next release (within 30 days) | No escalation; backlog priority |

### Uptime Guarantees

| Period | Target | Calculation | Credit |
|--------|--------|-----------|--------|
| **Business Hours (08:00–18:00, Mon–Fri)** | 99.8% | (Total mins − Downtime mins) / Total mins | <<FILL: % refund if <99.8% >> |
| **Overall (24/7)** | 99.5% | (Total mins − Downtime mins) / Total mins | <<FILL: % refund if <99.5% >> |

**Excluded:** Planned maintenance windows (up to 2 hours/month, announced 7 days prior); customer-caused outages (see §4).

---

## 3. Incident Lifecycle

### Reporting & Acknowledgement

**Channels:**
1. Email: <<FILL: incidents@vendor-support.com >>
2. Phone: <<FILL: +1-800-VENDOR-24 >> (24/7 emergency hotline)
3. Slack: Dedicated #docmanager-incidents channel (available for L1/L2 partners)
4. Web portal: Self-service ticket creation at <<FILL: vendor portal URL >>

**Acknowledgement SLA:**
- L1 team acknowledges within 15 minutes of report (P1) / 30 minutes (P2/P3) / 1 business day (P4).
- Acknowledgement includes: ticket number, assigned engineer name, estimated timeline, escalation path if needed.

### Status Updates

| Severity | Update Cadence |
|----------|-----------------|
| **P1** | Every 30 minutes until resolution |
| **P2** | Every 1 hour until resolution |
| **P3** | Daily (or every 2 business days) |
| **P4** | Weekly or in next status report |

**Status communication:** Email to BoB ticket owner + Slack #docmanager-incidents (if applicable).

### Root Cause Analysis (RCA)

**RCA Timeline:**
- **P1 incidents:** RCA initiated within 24 hours of resolution; report due within 3 business days.
- **P2 incidents:** RCA initiated within 2 business days; report due within 5 business days.
- **P3/P4 incidents:** RCA on-request; report within 10 business days.

**RCA Report Contents:**
1. Executive summary (impact, duration, # of users affected).
2. Root cause (technical analysis, contributing factors).
3. Immediate remediation (what was done to stop the incident).
4. Preventive measures (code change, monitoring alert, runbook update).
5. Lessons learned (process improvement, training need, architecture change).

**Corrective Action Plan (CAP):** For P1 incidents, vendor proposes CAP (with timeline) within RCA report. BoB approves or requests changes within 3 business days.

---

## 4. Exclusions & Limitations

### Downtime Not Covered by SLA

- **Planned maintenance:** <<FILL: 2 hours/month, scheduled weekends or <<FILL: BoB maintenance window >> >>, announced 7 days prior.
- **Force majeure:** Natural disaster, war, terrorism, government action, ISP backbone outages.
- **Customer-caused outages:**
  - Misconfiguration of customer-provided integrations (CBS, LDAP, S3) — vendor provides support but SLA clock stops until customer fixes.
  - Denial-of-service attack from customer network (not vendor's infrastructure).
  - Exceeding API rate limits (see Rate Limits §2.1 below).
  - Incompatible third-party software (e.g., custom Apache module breaking SPA).
- **Customer data loss due to misuse:** Accidental deletion of documents without backup; customer failure to perform recommended backups.

### Not Covered by This SLA

- Custom development or feature requests (see Support Matrix §3).
- Third-party integrations beyond the scope of the platform (e.g., vendor's responsibility to test customer's CBS instance).
- Performance optimization beyond documented limits (e.g., system tuned for 500 concurrent users; customer requests 2000).
- Compliance audits or training delivery (covered under separate Statement of Work).

### Rate Limits

To ensure fair-use, DocManager applies per-tenant API rate limits:

| Endpoint Category | Limit | Window | Handling |
|-------------------|-------|--------|----------|
| **Document uploads** | 500 docs / hour | Rolling hour | Return 429; retry after 60s |
| **Search queries** | 100 QPS (queries/sec) | Real-time | Queue after limit; p99 latency capped at 10s |
| **CBS adapter calls** | 50 calls / minute | Rolling minute | Backoff & retry (exponential, max 3) |
| **AI/OCR processing** | 20 concurrent jobs | Per-tenant | Queue additional jobs; process when slot free |

Customers exceeding limits consistently may be required to upgrade to a higher-tier plan or purchase additional capacity (<<FILL: pricing model>>).

---

## 5. Service Credits & Remedies

### Service Credit Calculation

If DocManager uptime falls below SLA targets, BoB receives service credits as follows:

**Business Hours Uptime (08:00–18:00, Mon–Fri):**

| Uptime Achieved | Service Credit |
|-----------------|----------------|
| 99.0%–99.8% | 5% of monthly fee |
| 98.0%–99.0% | 10% of monthly fee |
| 95.0%–98.0% | 25% of monthly fee |
| < 95.0% | 50% of monthly fee |

**Overall Uptime (24/7):**

| Uptime Achieved | Service Credit |
|-----------------|----------------|
| 99.0%–99.5% | 3% of monthly fee |
| 98.0%–99.0% | 7% of monthly fee |
| < 98.0% | 15% of monthly fee |

**Claims Process:**
1. BoB notifies vendor within 30 days of end of month if outage occurred.
2. Vendor verifies outage via monitoring logs (Prometheus, Grafana, Loki).
3. Credit issued as reduction on next month's invoice (or refund if no renewal).
4. Credits are BoB's sole remedy for SLA breach; no additional damages claimed.

**Limitation:** Service credits cap at 50% of annual fees in any 12-month period. If incidents are chronic (≥3 P1s in 90 days), parties meet for remediation discussion (possible outcomes: reduced scope, service improvement plan, contract termination).

---

## 6. Maintenance Windows

### Scheduled Maintenance

**Frequency & Duration:**
- <<FILL: 1–2 windows per month>>
- <<FILL: Up to 2 hours each>>
- **Typical timing:** <<FILL: Saturday 02:00–04:00 UTC >> (off-peak for BoB operations)

**Advance Notice:** 7 calendar days before window (email + Slack notification).

**During Maintenance:**
- Platform unavailable (end-user impact expected).
- No SLA credit if outage extends < 1 hour beyond announced window.
- If outage extends > 1 hour beyond window, credit issued per §5 formula.

### Emergency Patches

Critical security patches (e.g., 0-day vulnerability, supply-chain incident) may be deployed outside scheduled windows with <<FILL: 4-hour >> notice. SLA does not apply; only best-efforts support.

### Notification Channel

Maintenance notifications sent via:
1. Email (project stakeholders registered in support portal)
2. Slack #docmanager-incidents
3. In-app banner (7 days before)
4. Status page: <<FILL: status.vendor-platform.com >>

---

## 7. Monitoring & Metrics

### Monitoring Stack

Vendor monitors DocManager health continuously via:
- **Metrics:** Prometheus (CPU, memory, disk, network, request latency, error rates)
- **Logs:** Loki (application logs, audit trail, security events)
- **Traces:** Temporal (request flow, service dependencies, bottlenecks)
- **Alerts:** PagerDuty (on-call escalation for P1/P2)
- **Status dashboard:** Grafana (internal + limited external view for BoB)

**BoB Access:** Read-only access to Grafana dashboard showing:
- Real-time uptime % (24h rolling)
- Request latency (p50, p95, p99)
- Error rates by endpoint
- Search index health
- CBS adapter response times
- Top slow queries

**Dashboard URL:** <<FILL: https://grafana.vendor.com/d/docmanager-bob >>  
**Credentials:** BoB IT Operations team (provided at go-live)

### Metrics Definitions

| Metric | Definition | Collection | Reporting |
|--------|-----------|-----------|-----------|
| **Availability** | (Total minutes − Downtime minutes) / Total minutes, measured at service boundary (API gateway) | Prometheus probe every 30s | Monthly report + dashboard |
| **Mean Time To Recovery (MTTR)** | Time from incident detection to full resolution, across all P1/P2 incidents | Incident log | Monthly report |
| **Mean Time Between Failures (MTBF)** | Average time between unplanned outages (excludes planned maintenance) | Incident log | Quarterly report |
| **Error rate** | % of API requests returning 5xx error | Application logs | Daily dashboard, monthly report |
| **API latency (p95)** | 95th percentile response time across all endpoints | Traces | Hourly dashboard, monthly report |
| **Search query latency (p95)** | 95th percentile time to return full-text search results | Traces | Daily dashboard |

---

## 8. Change Management

### Change Advisory Board (CAB)

All changes to production DocManager infrastructure or data schema (that may affect availability) are reviewed by a Change Advisory Board:

**Members:**
- Vendor Product Manager
- Vendor Release Manager
- BoB IT Operations representative (as observer)
- Vendor DevOps Lead

**Review criteria:**
- Risk assessment (high/medium/low impact on uptime)
- Rollback plan (time-to-rollback, blast radius)
- Monitoring plan (new alerts, dashboards)
- Scheduled window (if production change)

**Approval Process:**
1. Change request submitted 5 business days before planned deployment.
2. CAB reviews within 2 business days; approves, requests info, or defers.
3. If approved: change proceeds on agreed date + time (coordinate with BoB operations).
4. Change owner monitors for 24 hours post-deployment; rolls back if critical issue detected.

### Patch Cycles

| Type | Frequency | Window | Downtime | Testing |
|------|-----------|--------|----------|---------|
| **Security patches** | As needed (0-day: <4h; regular: next monthly window) | Out-of-band or scheduled | ≤1 hour | Tested on staging; severity >= P2 requires smoke test on prod replica |
| **Bug fixes (P1/P2)** | Weekly hotfix if needed | Next scheduled window or emergency window | ≤30 min | Regression test on staging; monitor for 4h post-deploy |
| **Minor updates (features, P3 fixes)** | Monthly or quarterly | Monthly maintenance window | ≤2 hours | Full regression suite; performance benchmark |
| **Major releases (version bump)** | Quarterly | Planned, announced 30 days prior | ≤4 hours (with parallel-run option) | 2-week staging soak; customer acceptance test |

---

## 9. Compliance & Audit

### Compliance Scope

DocManager operates under the following regulatory frameworks (for BoB's compliance):
- **IFRS 9** (financial reporting): audit trail captures all document classification and risk decisions.
- **Know Your Customer (KYC):** CIF integration logs all customer document touches.
- **AML / Sanctions:** watchlist checks logged; trace to teller transaction.
- **Data Protection:** GDPR-ready PII redaction (`python-service/app/services/redaction.py`); DSAR workflow (`python-service/app/routers/dsar.py`).
- **Central Bank Compliance:** Immutable audit log (SHA-256 chain); export-ready for regulator inspection.

Detailed compliance mapping available in `docs/bob-compliance-matrix.csv`.

### Audit Rights

BoB (and its external auditors) have the right to:
- Review audit logs (via secure export) during business hours.
- Schedule quarterly security audits (penetration test, source-code review, dependency scan) with 15 days notice.
- Inspect infrastructure and disaster-recovery procedures annually.
- Request RCA reports for any P1 incident.

### Data Residency

All BoB data (documents, metadata, logs) is stored in <<FILL: specific cloud region (e.g., "ap-south-1 / AWS Bangalore") >> and **never exported outside** that region without explicit BoB approval. Exceptions:
- Vendor disaster-recovery replica (in <<FILL: DR region, e.g., "eu-west-1" >>) — encrypted with BoB-held key.
- Backup tapes (if applicable) — encrypted; stored per <<FILL: retention policy, e.g., "6-month retention, 3 offline copies" >>.

---

## 10. Termination & Wind-Down

### Termination for Cause (Vendor Default)

If vendor fails to meet SLA for 3 consecutive months (>5% cumulative downtime in each month), or a single P1 incident exceeds 24-hour MTTR, BoB may:
1. Demand corrective action plan within 5 business days.
2. If CAP not approved or breached, terminate SLA with 30 days notice.
3. Vendor must export all BoB data in standard formats (CSV, PDF, JSON) within 10 business days of termination.

### Planned Termination

If either party terminates the underlying Service Agreement, this SLA terminates concurrently. Vendor continues to operate the service at full SLA terms until contract end date (or transition date if BoB moves to a new vendor).

### Transition & Knowledge Transfer

During final 30 days:
- Vendor provides read-only data exports daily.
- Vendor assists BoB's IT team with system runbooks, architecture docs, and integration guides.
- Vendor dedicates 1 engineer for 2 weeks post-termination (at <<FILL: hourly rate >>) to support migration.

---

## 11. Governance & Reviews

### Monthly SLA Review

On the <<FILL: 5th>> of each month, vendor and BoB meet to review:
- Uptime % for prior month
- All incidents (P1/P2/P3): description, duration, RCA status
- Service credit calculation (if any)
- Top 3 issues from BoB perspective
- Upcoming maintenance windows
- Performance trends (API latency, search performance, AI classifier accuracy)

**Attendees:** BoB IT Director, Vendor Support Manager, Vendor Product Manager, BoB Compliance Officer (quarterly).

### Annual SLA Reset

Each contract anniversary, parties review and update:
- Uptime targets (adjust if technology/capacity changes)
- Severity definitions (refine based on BoB's prioritization)
- Service credits (adjust if financial model changes)
- Response time targets (may improve with scale or new tooling)

Changes require written amendment signed by both parties.

---

## 12. Contact Information

### Vendor Support Escalation

| Level | Contact | Availability |
|-------|---------|--------------|
| **L1 Help Desk** | <<FILL: support@vendor.com >> | 24x7 |
| **Emergency Hotline** | <<FILL: +1-800-VENDOR-24 >> | 24x7 |
| **L2 Slack Channel** | #docmanager-incidents (BoB invited) | Weekdays 08:00–18:00 |
| **L3 On-Call** | <<FILL: pagerduty-docmanager-escalation >> | Weekdays 18:00–08:00 + weekends (P1 only) |

### BoB Primary Contacts

| Role | Name | Email | Phone |
|------|------|-------|-------|
| **Project Sponsor** | <<FILL: Name >> | <<FILL: email >> | <<FILL: phone >> |
| **IT Director** | <<FILL: Name >> | <<FILL: email >> | <<FILL: phone >> |
| **Hypercare Coordinator** | <<FILL: Name >> | <<FILL: email >> | <<FILL: phone >> |

---

## Annex A: Service Credit Request Form

To claim a service credit, BoB submits this form within 30 days of the month in which downtime occurred:

```
FROM:      [BoB Project Sponsor / IT Director]
TO:        [Vendor Support Manager]
DATE:      [Month of claim]
SUBJECT:   SLA Service Credit Request

OUTAGE DETAILS:
  Incident Date(s): _______________
  Affected Service(s): _______________
  Duration (minutes): _______________
  # of Users Impacted: _______________
  RCA Ticket #: _______________

CALCULATION:
  Uptime %: _______________
  Monthly Fee: $_______________
  Service Credit Rate: _________%
  Credit Amount: $_______________

APPROVAL:
  Sponsor Name: _________________
  Signature: _________________
  Date: _________________
```

---

**SLA Effective Date:** <<FILL: Contract start date >>  
**Contract Version:** Bank of Bhutan Single-Tenant, 1-Year Warranty + Renewal  
**Next Review Date:** <<FILL: Contract anniversary + 30 days >>

---

## Sign-Off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| **BoB Project Sponsor** | <<FILL: Name >> | _________________ | ________ |
| **BoB IT Director** | <<FILL: Name >> | _________________ | ________ |
| **Vendor General Manager** | <<FILL: Name >> | _________________ | ________ |
| **Vendor Legal / Contracts** | <<FILL: Name >> | _________________ | ________ |
