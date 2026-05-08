# Support Matrix
## DocManager — Bank of Bhutan Post-Go-Live Support Model

**Version:** 1.0 | **Date:** 18 April 2026 | **Status:** Ready for Commercial Review

---

## 1. Support Model Overview

DocManager support for Bank of Bhutan follows a structured three-phase approach:

### Phase 1: Warranty Period (Year 1, Days 1–365 post-go-live)
- **Vendor responsibility:** All defects in code, architecture, design, and integrations; all SLA-governed incidents; knowledge transfer and training refreshes.
- **BoB responsibility:** Infrastructure management, user access provisioning, business process definition, data quality oversight.
- **Cost:** Included in engagement fee (no additional support cost).

### Phase 2: Extended Support (Years 2+, via Annual Maintenance Contract)
- **Vendor responsibility:** Same as Phase 1, plus feature backlog prioritization, security patches, quarterly releases.
- **BoB responsibility:** Same as Phase 1, plus platform scaling, tuning, pilot new features on staging.
- **Cost:** <<FILL: Annual Maintenance Contract (AMC) fee, e.g., "15% of initial license cost per year" >>

### Phase 3: Premium / Professional Services (On-Demand)
- **Scope:** Custom integrations (new CBS adapter, ERP connector), custom workflows, migrations, training for new hires.
- **Cost:** <<FILL: Time & materials, e.g., "$250/hour; 40-hour minimum engagement" >>

---

## 2. Escalation Matrix & Named Contacts

### Vendor Support Chain

```
BoB User Issues
        ↓
L1: BoB Help Desk (email / phone)
        ↓ (escalate if unresolved in 30 min)
L2: Vendor Support Engineer (Slack / remote desktop)
        ↓ (escalate if unresolved in 1 hour for P1, 4 hours for P2)
L3: Vendor Product Engineering (on-call + code repo access)
        ↓ (escalate if blocking > 2 hours for P1)
L4: Vendor Executive (SVP Product / CTO) [rare; policy override only]
```

### Named Escalation Contacts

**Vendor Side (Primary):**

| Role | Name / Title | Email | Phone | Availability | Responsibility |
|------|--------------|-------|-------|--------------|-----------------|
| **L1 Help Desk Lead** | <<FILL: Name, Help Desk Manager >> | <<FILL: email >> | <<FILL: +1-xxx-xxx-xxxx >> | 24x7 | Route incidents, initial triage, customer comms |
| **L2 Support Manager** | <<FILL: Name, Support Manager >> | <<FILL: email >> | <<FILL: +1-xxx-xxx-xxxx >> | 08:00–18:00 / Weekday standby | Assign engineer, escalation authority, SLA owner |
| **L3 Product Lead** | <<FILL: Name, Senior/Staff Engineer >> | <<FILL: email >> | <<FILL: +1-xxx-xxx-xxxx >> | On-call rotation; weekends/nights for P1 | Root cause analysis, code fixes, architecture review |
| **Delivery Manager** | <<FILL: Name, Project Manager >> | <<FILL: email >> | <<FILL: +1-xxx-xxx-xxxx >> | 09:00–17:00 weekdays | Strategic issues (scope creep, roadmap alignment), quarterly business review |

**24x7 Emergency Hotline:** <<FILL: +1-800-VENDOR-24 >> (routes to on-call engineer)

---

**BoB Side (Primary):**

| Role | Name | Email | Phone | Availability |
|------|------|-------|-------|--------------|
| **Project Sponsor** | <<FILL: Name >> | <<FILL: email >> | <<FILL: +975-xxx-xxxx >> | 09:00–17:00 weekdays (with on-call escalation option) |
| **IT Operations Director** | <<FILL: Name >> | <<FILL: email >> | <<FILL: +975-xxx-xxxx >> | 09:00–17:00 weekdays |
| **Hypercare Coordinator** (Year 1 only) | <<FILL: Name >> | <<FILL: email >> | <<FILL: +975-xxx-xxxx >> | 08:00–18:00 weekdays; standby weekends (Days 1–90 post-go-live) |
| **Subject Matter Experts** | Rotating (CBS admin, OCR trainer, Audit lead) | TBD | TBD | On-call during incidents affecting their domain |

---

### Secondary Escalation (If Primary Unavailable)

| Level | Primary | Backup | Approval Authority |
|-------|---------|--------|-------------------|
| **L1** | Help Desk Lead | Senior Help Desk Tech | Help Desk Manager |
| **L2** | Support Manager | Senior Support Engineer | VP Support |
| **L3** | On-Call Engineer | Backup on-call | Product Manager |
| **BoB Sponsor** | Named sponsor | CFO (or CTO) | Board-level sign-off if escalation needed |

---

## 3. Change Management Process

### Request Categories

| Category | Trigger | Approval | Timeline | Cost |
|----------|---------|----------|----------|------|
| **Bug Fix (P1/P2)** | Defect in existing feature; impacts uptime | L2 Support Manager + L3 engineer | ASAP (within SLA) | Included in warranty |
| **Bug Fix (P3/P4)** | Non-critical defect; cosmetic or minor workflow | QA lead + Product Manager | Next quarterly release or hotfix (if bundled) | Included in warranty |
| **Configuration Change** | Admin setting (retention policy, user role, confidence threshold, integration parameter) | BoB IT Director + vendor L2 | 1 business day | Included in warranty |
| **Minor Enhancement** | Small UX improvement, API addition, performance optimization | Backlog prioritization; quarterly review | Quarterly release cycle | Included in AMC (post-warranty) |
| **Custom Integration** | New CBS adapter, ERP connector, custom workflow | Statement of Work (SOW) + formal scope | 30–60 days (estimate varies) | Professional Services rate (<<FILL: hourly >> or fixed-price SOW) |
| **Major Release Upgrade** | New major version (e.g., 1.0 → 2.0); breaking changes | Executive sign-off + 30-day notice | Quarterly release cycle | Included in AMC |

### Change Approval Workflow

```
Request Submission (email / ticketing system)
    ↓
Vendor L2 Triage (within 1 business day)
    ↓
[Decision Tree]
    ├─ Bug fix? → L3 assessment → Prioritized for next hotfix/release
    ├─ Config change? → 1-hour peer review → Deploy to staging → BoB approval → Deploy to prod
    ├─ Enhancement? → Product backlog → Quarterly planning → Roadmap alignment
    └─ Custom work? → SOW drafted → BoB signature → Work scheduled
```

### Change Control Board (CCB) Cadence

**Frequency:** Weekly during Year 1 (warranty period); monthly thereafter.

**Attendees:**
- Vendor: Release Manager, Product Manager, L2 Support Manager
- BoB: IT Director, Hypercare Coordinator (Year 1), Project Sponsor (as needed)

**Agenda:**
- Proposed changes (bugs, enhancements, integrations)
- Risk assessment (blast radius, rollback plan)
- Scheduling (which maintenance window or hotfix release)
- Dependencies (other teams, third-party systems)

**Decision:** Approved, defer to next window, or reject (with justification). Minutes sent to all stakeholders within 1 hour of CCB.

---

## 4. Patch & Release Cadence

### Regular Patch Cycles

| Release Type | Frequency | Contents | Deployment Window | BoB Preparation |
|--------------|-----------|----------|-------------------|-----------------|
| **Hotfix** | As needed (P1 bugs only) | 1–2 bug fixes (no features) | 2-hour window, coordinated with BoB ops | 4-hour advance notice; smoke test on staging |
| **Security Patch** | Monthly (or ASAP for 0-day) | CVE fixes, dependency updates | Monthly maintenance window or ASAP | 24-hour notice (if planned); 4-hour notice (if 0-day) |
| **Minor Release** | Quarterly (Q1, Q2, Q3, Q4) | Bug fixes (P3/P4), small features, performance improvements | Scheduled maintenance window (<<FILL: 2nd Saturday of each quarter, 02:00–06:00 UTC >>) | 2-week staging soak; BoB user acceptance test (UAT) required |
| **Major Release** | Annually or on-demand | Significant architecture changes, major features, breaking API changes | Planned 30+ days in advance; 4-hour window; parallel-run option available | 1-month staging period; full regression test suite; executive sign-off |

**Release Notes:** Published 7 days before each release; include upgrade path, breaking changes (if any), new feature docs, deprecation warnings.

**Rollback Plan:** Every release has documented rollback procedure (revert code, Postgres migration rollback, Kafka schema migration). Rollback tested on staging before deployment. Target rollback time: <30 minutes.

---

## 5. Knowledge Transfer & Training

### Year 1 (Warranty Period) Training

**Objective:** BoB becomes self-sufficient on routine operations, basic troubleshooting, and change requests.

#### Initial Onboarding (Go-Live, Days 1–90)

| Course | Duration | Audience | Timing | Delivery | Certification |
|--------|----------|----------|--------|----------|---------------|
| **System Administration** | 2 days (4 half-day modules) | 2 BoB IT operations staff | Days 41–42 (pre-UAT) | Instructor-led + labs | BoB admin can reset user passwords, manage retention policies, review audit logs |
| **Troubleshooting & Diagnostics** | 1 day | 3 BoB support staff | Day 85 (post-go-live) | Instructor-led + scenario practice | BoB can diagnose common issues (API errors, search latency, CBS integration failures) and escalate appropriately |
| **Backup & Disaster Recovery** | 0.5 day | 2 BoB DBAs / SREs | Day 90 (end of hypercare) | Instructor-led + runbook walkthrough | BoB can execute Postgres backup, restore from snapshot, test RTO/RPO |
| **Integration Customization** | 1 day (optional) | 2 BoB integration engineers | Day 88 | Instructor-led + walkthrough of CBS adapter code | BoB can add new CBS endpoints or modify data-mapping rules (with vendor review) |

**Materials Delivered:**
- Admin runbook (30 pages): step-by-step procedures for every routine operation.
- Troubleshooting guide (20 pages): decision tree for common issues (search broken, OCR low confidence, user locked out).
- Architecture guide (15 pages): system components, data flow, failure modes, recovery procedures.
- API reference (auto-generated): Swagger docs + integration examples for CBS, KYC, LOS adapters.
- Video recordings: all training sessions (for playback, new-hire onboarding).

#### Quarterly Refresher Training (Year 1)

- **Q2 (Month 3–4):** Recap of admin tasks; review of incidents + lessons learned.
- **Q3 (Month 6–7):** Preview of next quarterly release; hands-on upgrade on staging.
- **Q4 (Month 9–10):** Year-2 renewal planning; advanced topics (custom workflows, performance tuning).

**Format:** Half-day virtual; combined with monthly SLA review call (see SLA Template §11).

### Ongoing Support (Year 2+)

**Vendor Provides:**
- Release notes with upgrade guidance (7 days before each quarterly release).
- Video walkthrough of major features (recorded + shared on Slack).
- Quarterly "office hours" (1-hour Slack session) for Q&A on new features.
- Annual in-person refresher training (1 day, optional but recommended).

**BoB Responsibility:**
- Nominate training participants (ideally same person each year for continuity).
- Schedule refresher in their annual training budget.
- Cascade training to new hires (vendor provides slides, recorded videos, and sandbox for practice).

---

## 6. Handover Artifacts (Year 1 Deliverables)

By Day 90 of the warranty period, vendor delivers these documents to BoB's IT operations team:

### Operational Runbooks (Digital + Printed)

1. **Daily Operations**
   - How to create users, reset passwords
   - How to unlock a locked-out user
   - How to check system health (uptime dashboard, log review)
   - How to monitor for common errors (search latency, CBS timeout, OCR confidence)

2. **Weekly Tasks**
   - Backup verification (test restore on staging)
   - Review of support tickets + incident trends
   - Performance tuning checkpoints (slow queries, cache hit rate)
   - Data quality spot-checks (20 random documents, verify OCR accuracy)

3. **Monthly Tasks**
   - Security audit log review (export, spot-check for anomalies)
   - Retention policy execution (auto-archive triggered documents)
   - User role review (audit for orphaned accounts, role changes)
   - Capacity planning (document volume growth, storage utilization)

4. **Quarterly Tasks**
   - Release upgrade (staging test, UAT, production deployment)
   - Disaster-recovery drill (restore from backup, verify RTO/RPO)
   - Performance baseline (compare p95 latency quarter-over-quarter)
   - Compliance review (audit log export, DSAR fulfillment)

5. **Emergency Procedures**
   - P1 incident response (who to call, initial diagnostics, escalation path)
   - Database rollback (Postgres point-in-time recovery, manual steps)
   - Service restart (Kubernetes pod restart, service health check)
   - Data breach response (containment, audit log preservation, customer notification)

### Architecture & Design Documentation

- **System architecture diagram** (VPC, microservices, databases, caches, queues, monitoring stack)
- **Data flow diagrams** (document upload → OCR → classification → search indexing → archival)
- **Integration architecture** (CBS adapter protocol, data sync, error handling)
- **Security architecture** (encryption, authentication, RBAC, audit logging, PII redaction)
- **Disaster recovery architecture** (backup strategy, failover, RTO/RPO targets)

### Configuration Reference

- **Environment variables** (all configurable settings, defaults, production values)
- **Database schema** (table definitions, indexes, constraints; ERD diagram)
- **API endpoints** (every REST endpoint, request/response schema, rate limits, authentication requirements)
- **Integration endpoints** (CBS, KYC, LOS endpoints, certificate management, IP whitelisting)
- **Monitoring & alerting rules** (Prometheus queries, alert thresholds, escalation logic)

### Troubleshooting Decision Trees

- **Document upload fails** → Check CBS connection → Check storage capacity → Check OCR queue
- **Search returns no results** → Check FTS5 index health → Check search syntax → Check permissions
- **User cannot log in** → Check AD sync → Check MFA enrollment → Check account lock status
- **Slow performance** → Check database query latency → Check search index size → Check API rate limiting
- **Integration failure** → Check CBS credentials → Check network connectivity → Check data format

### Incident Response Plan

- **War room setup** (Slack channel, call bridge, decision log)
- **Escalation checklist** (who to notify, communication templates)
- **Incident types & responses** (P1 outage, P1 data loss, P1 security breach, with step-by-step actions)
- **Contact list** (vendor support, BoB stakeholders, external partners like CBS team)
- **Communication templates** (customer notification, executive summary, RCA report)

### Compliance & Audit Artifacts

- **Audit log export templates** (SQL queries, scheduled export, format options)
- **Data subject access request (DSAR) procedure** (how to query, export, mask PII)
- **Retention policy configuration** (hold calendars, auto-purge rules, legal hold)
- **Compliance attestation examples** (KYC, AML, IFRS9, governance)

---

## 7. Support Metrics & Reporting

### Monthly Support Report

Delivered by the 5th of each month, covering prior month:

| Metric | Definition | Target | Report Format |
|--------|-----------|--------|----------------|
| **Ticket volume** | # of support tickets (P1/P2/P3/P4) | Trending (compare YoY) | Table: P1, P2, P3, P4 count |
| **MTTR (P1/P2)** | Mean time to resolution for critical/major incidents | P1 avg <4h, P2 avg <8h | Average + range + trend chart |
| **First-response time** | Time from ticket creation to L1 acknowledgement | 30 min (P1), 1h (P2), 4h (P3) | Average + % meeting SLA |
| **Escalation rate** | % of tickets escalated from L1 to L2 | <20% (healthy) | % + common escalation reasons |
| **Customer satisfaction (CSAT)** | Post-resolution survey: 1–5 scale | ≥4.0 / 5.0 | Average score + open feedback |
| **Change success rate** | % of deployed changes with zero rollbacks | 98%+ | Count: successful / total |
| **System uptime** | Availability % (business hours + overall) | ≥99.8% (biz hours), ≥99.5% (overall) | Uptime %, service credits (if any) |

### Quarterly Business Review (QBR)

Held on <<FILL: first Tuesday of quarter >> (or as agreed). Attendees: BoB sponsor, IT director, Vendor GM, Support Manager, Product Manager.

**Agenda (2-hour session):**
1. Quarterly metrics review (uptime, MTTR, CSAT, feature adoption)
2. Incident retrospective (top 3 issues, why they happened, prevention)
3. Roadmap update (delivered features, upcoming features, BoB priorities)
4. Capacity planning (user growth, document volume, infrastructure scaling needed)
5. Training needs assessment (new hires, skill gaps, certification path)
6. Budget & renewal planning (Year-2 AMC terms, if applicable)

**Deliverables:** QBR report (10 pages), sent within 1 week; captured in contract renewal discussion.

---

## 8. Support Contacts & Channels

### Preferred Communication Channels

| Severity | Channel | SLA Response | Backup Channel |
|----------|---------|--------------|-----------------|
| **P1 (Critical)** | Phone: <<FILL: +1-800-VENDOR-24 >> | 15 min | Email + Slack (#docmanager-incidents) |
| **P2 (Major)** | Slack: #docmanager-incidents | 1 hour | Email (during off-hours) |
| **P3 (Minor)** | Email: <<FILL: support@vendor.com >> | 4 hours | Slack (next business day) |
| **P4 (Cosmetic)** | Ticketing system (self-service): <<FILL: portal.vendor.com >> | 1 business day | Email (optional) |

### Support Portal Access

**URL:** <<FILL: https://support.vendor.com/docmanager-bob >>

**Features:**
- Ticket creation + status tracking
- Knowledge base (400+ articles; searchable)
- Incident status page (real-time uptime, maintenance schedule)
- Training library (recorded videos, documentation, labs)
- Billing & licensing (AMC renewal, service credit claims)

**BoB Admin Account:** Pre-configured with 5 named users (IT Director, Hypercare Coordinator, +3). Additional users: $0 per seat (included in support contract).

---

## 9. Year-2+ Renewal & Transition

### Annual Maintenance Contract (AMC)

At the end of the warranty year (Day 365), parties negotiate an AMC for Year 2+. AMC includes:
- **Same SLA coverage** (uptime, MTTR, response time)
- **Quarterly releases** (features, bug fixes, security patches)
- **Support tiers** (L1/L2/L3 escalation, same contact matrix)
- **Training & documentation** updates (quarterly refresher, new-feature training)
- **Cost:** <<FILL: pricing model (e.g., "15% of license cost annually", or "$<<FILL: flat annual amount >>") >>

**Renewal Timeline:**
- Day 330: Vendor sends AMC renewal proposal
- Day 345: BoB decision deadline (accept, negotiate, or decline)
- Day 355: Final contract signature (or service discontinuation notice)
- Day 365: Warranty expires; AMC begins (or service ends if declined)

**If BoB Declines Renewal:**
- Vendor provides 90-day wind-down support (P1/P2 only, no new features).
- Day 365–395: Data export, migration support (<<FILL: rate >>).
- Day 395: Full access removed; data archived per retention policy.

---

## 10. Professional Services (Optional, Year 1+)

Available for custom work outside the standard support scope:

| Service | Duration | Cost | Use Case |
|---------|----------|------|----------|
| **Custom integration build** | 20–80 hours | <<FILL: hourly rate >> | New CBS endpoint, ERP connector, custom data transformation |
| **Custom workflow design** | 15–40 hours | <<FILL: hourly rate >> | Domain-specific approval chain, compliance workflow, audit automation |
| **Data migration (large batch)** | 10–30 hours | <<FILL: hourly rate >> | Legacy document import (>100k docs), schema transformation, metadata mapping |
| **Training for new hires** | 1–2 days | <<FILL: hourly rate >> | Onboarding new admin, new branch team, quarterly skill refresh |
| **Performance optimization** | 20–60 hours | <<FILL: hourly rate >> | Database tuning, search index optimization, API caching strategy |
| **Security audit & hardening** | 20–40 hours | <<FILL: hourly rate >> | Penetration test debrief, remediation planning, configuration review |

**Engagement Model:** Time & materials (hourly billing, weekly invoicing) or fixed-price Statement of Work (SOW). Minimum 40-hour engagement. 2-week lead time for availability. Billed separately from support contract.

**Approval:** Requires BoB IT Director + Project Sponsor sign-off (via SOW) before work begins.

---

## 11. Sunset & Archival

### End-of-Life (EOL) Support

For major versions reaching EOL (typically 2–3 years after release):

| Status | Duration | Support | Cost |
|--------|----------|---------|------|
| **Mainstream support** | 2 years | Full SLA coverage | Included in AMC |
| **Extended support** | 1 year (optional) | P1/P2 only; no new features | <<FILL: 50% of AMC fee >> |
| **Archive mode** | 1 year (optional) | P1 data-loss issues only; no response SLA | <<FILL: 20% of AMC fee >> |
| **End-of-life (EOL)** | After 4 years | No support; migrate to new version required | — |

**Migration Path:** BoB has 12 months to upgrade from EOL version before support terminates. Vendor provides migration guide and professional-services assistance (charged per §10).

---

## 12. Governance & Escalation

### Steering Committee

Annual steering committee (in addition to monthly/quarterly reviews) for strategic alignment:

**Attendees:**
- BoB: CFO (or CIO), Project Sponsor, IT Director
- Vendor: VP / Chief Customer Officer, Product Manager, Delivery Manager

**Agenda (2 hours, annual):**
- Renewal decision (continue, expand scope, or transition)
- BoB's 3-year roadmap (integration priorities, scale expectations)
- Vendor's product roadmap (new features, deprecations)
- Cost & value discussion (ROI analysis, optimization opportunities)
- Risk review (cybersecurity, compliance, third-party dependencies)

---

## Contact Sheet (Tear-Off)

```
╔════════════════════════════════════════════════════════════════╗
║        DocManager Support — Quick Reference Card              ║
║             Bank of Bhutan Implementation                      ║
╚════════════════════════════════════════════════════════════════╝

EMERGENCY (P1 — System Down)
  Phone: +1-800-VENDOR-24 (24x7)
  Response Time: 15 minutes
  Escalation: Automatic to L3 if not resolved in 2 hours

URGENT (P2 — Major Feature Broken)
  Slack: #docmanager-incidents
  Email: support@vendor.com
  Response Time: 1 hour
  Escalation: Automatic to L3 if not resolved in 4 hours

STANDARD (P3/P4 — Minor Issues)
  Email: support@vendor.com
  Portal: https://support.vendor.com/docmanager-bob
  Response Time: 4 hours (P3), 1 business day (P4)

PRIMARY CONTACTS
  Vendor Support Manager: <<FILL: Name, phone, email >>
  BoB IT Director: <<FILL: Name, phone, email >>
  BoB Sponsor: <<FILL: Name, phone, email >>

MONTHLY MEETINGS
  SLA Review: 1st Friday, 14:00 UTC
  CCB Meeting: Every Wednesday, 10:00 UTC

TRAINING & ONBOARDING
  Admin Runbook: https://support.vendor.com/kb/admin-runbook
  Video Library: https://support.vendor.com/learning
  Troubleshooting: https://support.vendor.com/kb/troubleshoot

SLA GUARANTEE
  Uptime Target: 99.5% overall, 99.8% business hours
  P1 Resolution: 4 hours
  Data Residency: <<FILL: cloud region >> only
```

---

**Document prepared for:** Bank of Bhutan DMS Tender 000/BoB/Tender/2026/009  
**Bid submission deadline:** 28 April 2026  
**Warranty period:** Year 1 post-go-live (approximately May 2026 – May 2027)  
**AMC renewal:** Day 330–355 of warranty period (February 2027)
