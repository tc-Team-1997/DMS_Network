# Contract — aml-screening

> Real AML watchlist screening pipeline that runs on every customer master change and flags matches. Replace the stub `aml.py` router with production screening, matching, workflow assignment, and compliance card integration.
>
> Paired with [ENGINEERING_PRINCIPLES.md](../ENGINEERING_PRINCIPLES.md). The Ten Commandments apply.

## Header

| Field | Value |
| --- | --- |
| Feature | `aml-screening` |
| Spec ID | `BHU-67` (AML compliance screening) |
| Owner | `python-engineer` + `db-migrator` |
| Status | `draft` |
| Risk class | `high` (regulatory, false positives impact customers, PII sensitivity) |
| Contract published | `2026-05-09` |
| Last updated | `2026-05-09` |
| Related ADR | `docs/adr/0011-aml-watchlist-matching-strategy.md` |

---

## 1. Problem & user story

**As a** compliance officer, **I want** every customer (on creation or update) to be screened against international watchlists (OFAC SDN, EU Consolidated, UN), **so that** we catch high-risk matches before documents flow through the system.

Today, the AML router is a stub. No actual screening happens. Compliance can't attest to watchlist coverage.

This slice adds:
- Multi-source watchlist support: load OFAC, EU, UN lists from CSV at boot (refreshable via admin endpoint)
- Matching algorithm: name normalization (lowercase, diacritics, token sort) + Levenshtein distance ≥ configurable threshold (default 0.85)
- Workflow integration: hits create workflow tasks assigned to compliance officers for human review
- SPA admin page: `/admin/aml` showing today's screenings, hit ratio chart, pending reviews
- Compliance card: `aml-screening` control queries last-24h screenings and computes pass/warn/fail
- Audit trail: every hit decision (cleared, escalated, blocked) logged with reviewer

**Personas affected:**
- `Doc Admin` — manages watchlist data, reviews config
- `Auditor` — runs compliance reports
- `Checker` (if workflow assigned) — may route flagged documents for escalation
- `Compliance Officer` (new implied role) — reviews AML matches

**Out of scope:**
- Real-time transaction screening (separate integration).
- SWIFT gpi screening or sanctions list hierarchy.
- Fuzzy matching on DOB or passport number (name-only v1).
- Machine learning confidence scoring (rule-based thresholds only).

---

## 2. Acceptance criteria

- **AC-1** — Given a customer is created with `customer_name="John Smith"` and `customer_cid="12345"`, when the customer is inserted, then a screening task is enqueued and run within 1 second.
- **AC-2** — Given a screening runs against OFAC SDN list, when a name in the system matches an OFAC entry with Levenshtein ≥ 0.85, then an `aml_hits` row is created with `status="open"` and the hit is assigned to a compliance officer workflow task.
- **AC-3** — Given a pending AML hit in the `aml_screening` workflow, when a compliance officer clicks "Clear match" or "Escalate to LAC", then the `aml_hits.status` is updated to `cleared` or `escalated`, `reviewed_by` is set, and an `audit_log` entry records the decision.
- **AC-4** — Given the Compliance card on the Dashboard queries AML status, when ≥ 1 hits are open in the last 24h, then the card shows `warn` status with count badge.
- **AC-5** — Given an admin visits `/admin/aml`, when the page loads, then a table of today's screenings is visible with columns: customer_name, screening_time, hit_count, status, and a detail link.
- **AC-6** — Given 10,000 customers in the system, when a bulk refresh is triggered via `POST /api/v1/aml/watchlists/refresh`, then all customers are re-screened within 5 minutes.

---

## 3. End-to-end workflow

```
[Customer created or updated]
    │ POST /api/v1/customers { name, cid, dob }
    ▼
[Python service enqueues screening task]
    │ TaskQueue.enqueue("aml_screen_customer", customer_id=42)
    ▼
[Worker picks up task]
    │ load aml_watchlists from DB
    │ normalize customer name: lowercase, strip diacritics, token sort
    ▼
[Match against each list]
    │ for each watchlist_entry:
    │   compute Levenshtein(norm_customer_name, norm_watchlist_name)
    │   if score >= threshold (0.85): create aml_hits row
    ▼
[If hits found]
    │ create aml_screenings row: { customer_cid, hit_count, status="pending_review" }
    │ create workflow task: { type="aml_review", assigned_to=compliance_officer, ... }
    │ emit event: "aml.hits_found" → triggers compliance dashboard update
    │ send alert (via notify service) to compliance officer
    ▼
[Compliance officer reviews in Workflow]
    │ sees hit detail: watchlist source, matched entry, score, original record
    │ clicks "Clear" or "Escalate"
    ▼
[Decision recorded]
    │ aml_hits.status = "cleared" | "escalated"
    │ aml_hits.reviewed_by = officer_id
    │ audit_log row: { action="aml_hit_decision", resource_id=hit_id, detail=... }
    ▼
[Compliance card reflects status]
    │ pass (no hits in 24h) or warn (hits exist)
```

State machine (per screening):

```
[pending] ──▶ [running] ──▶ [completed_no_hits] → [pass]
                           │
                           ▼
                    [completed_with_hits]
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
          [cleared_all]         [escalated_some]
              │                         │
              ▼                         ▼
           [pass]                    [warn]
```

---

## 4. API contract — Python (`/api/v1/*`)

Owner: `python-engineer`. File: `python-service/app/routers/aml.py` (rewrite stub).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/v1/aml/screenings` | `require_api_key` + JWT(role=`auditor`) | List screenings (paginated, last 7d default) |
| `GET` | `/api/v1/aml/screenings/{screening_id}` | `require_api_key` + JWT(role=`auditor`) | Detail: hits, decisions, timeline |
| `GET` | `/api/v1/aml/hits` | `require_api_key` + JWT(role=`auditor`) | List open hits (for workflow intake) |
| `POST` | `/api/v1/aml/hits/{hit_id}/decide` | `require_api_key` + JWT(role=`auditor\|compliance`) | Clear or escalate (decision = cleared\|escalated\|blocked) |
| `GET` | `/api/v1/aml/watchlists` | `require_api_key` + JWT(role=`doc_admin`) | List loaded watchlists: count, last_updated, source_url |
| `POST` | `/api/v1/aml/watchlists/refresh` | `require_api_key` + JWT(role=`doc_admin`) | Download + reload watchlists; re-screen all customers (async) |
| `GET` | `/api/v1/aml/stats` | `require_api_key` + JWT(role=`auditor`) | Today's screening count, hit count, cleared count |

### Request / response shapes

```jsonc
// GET /api/v1/aml/screenings — response 200
{
  "items": [
    {
      "screening_id": 1,
      "customer_cid": "12345",
      "customer_name": "John Smith",
      "screened_at": "2026-05-09T10:00:00Z",
      "hit_count": 2,
      "status": "pending_review",
      "hits": [
        {
          "hit_id": 1,
          "watchlist_name": "OFAC SDN",
          "matched_name": "Jon Smith",
          "score": 0.89,
          "status": "open",
          "reviewed_by": null,
          "original_record": { "name": "Jon Smith", "dob": null, "country": "US" }
        }
      ]
    }
  ],
  "total": 150,
  "next_cursor": "opaque_token"
}

// POST /api/v1/aml/hits/{hit_id}/decide — request
{
  "decision": "cleared|escalated|blocked",
  "reviewer_notes": "Matched on phonetic similarity; verified via CBR"
}

// POST /api/v1/aml/hits/{hit_id}/decide — 200
{
  "hit_id": 1,
  "decision": "cleared",
  "reviewed_by": "ahmed.m",
  "reviewed_at": "2026-05-09T11:30:00Z",
  "notes": "Matched on phonetic similarity; verified via CBR"
}

// POST /api/v1/aml/watchlists/refresh — 202 Accepted
{
  "job_id": "task-uuid",
  "status": "queued",
  "message": "Watchlist refresh enqueued. Re-screening 1200 customers."
}

// GET /api/v1/aml/stats — response 200
{
  "screenings_today": 42,
  "hits_found_today": 7,
  "hits_cleared_today": 3,
  "hits_escalated_today": 2,
  "hits_pending_today": 2,
  "highest_score": 0.92
}
```

---

## 5. API contract — Node SPA mirror (`/spa/api/*`)

Owner: `node-engineer`. File: `routes/spa-api/aml.js` (new, read-only proxy).

| Method | Path | Session auth | RBAC perm | Notes |
| --- | --- | --- | --- | --- |
| `GET` | `/spa/api/aml/screenings` | required | `aml:read` | Proxies list; injects session tenant + branch |
| `GET` | `/spa/api/aml/stats` | required | `aml:read` | Proxies stats for compliance card |

Divergence from Python: **none**. Node acts as transparent proxy + session injection.

---

## 6. SPA module

Owner: `spa-engineer`. Folder: `apps/web/src/modules/compliance/aml/`.

### 6.1 Files

- `AdminPage.tsx` — `/admin/aml` route: today's screenings, hit chart, refresh button
- `api.ts` — fetch wrappers for screenings, hits, stats
- `schemas.ts` — zod schemas for response shapes
- `components/ScreeningTable.tsx` — sortable, searchable list of screenings
- `components/HitDetail.tsx` — modal showing full hit record + decision buttons

### 6.2 Schemas

```ts
import { z } from "zod";

export const AmlHit = z.object({
  hit_id: z.number(),
  watchlist_name: z.string(),
  matched_name: z.string(),
  score: z.number().min(0).max(1),
  status: z.enum(["open", "cleared", "escalated", "blocked"]),
  reviewed_by: z.string().nullable(),
  reviewed_at: z.string().datetime().nullable(),
  original_record: z.record(z.unknown()),
});

export const AmlScreening = z.object({
  screening_id: z.number(),
  customer_cid: z.string(),
  customer_name: z.string(),
  screened_at: z.string().datetime(),
  hit_count: z.number(),
  status: z.enum(["pending_review", "cleared_all", "escalated_some"]),
  hits: z.array(AmlHit),
});
export type AmlScreening = z.infer<typeof AmlScreening>;
```

### 6.3 UI flow

- **AC-5**: AdminPage lists today's screenings in a sortable table. Clicking a row opens HitDetail modal.
- **AC-3**: Modal shows hit info + score + original watchlist entry + two buttons ("Clear" | "Escalate").
- **AC-4**: ComplianceCard on dashboard queries `/spa/api/aml/stats`; shows "X hits pending" with warn indicator if > 0.

### 6.4 Test IDs

`aml-admin-page`, `aml-screenings-table`, `aml-screening-row-{id}`, `aml-hit-detail-modal`, `aml-hit-decide-button-clear`, `aml-hit-decide-button-escalate`, `aml-compliance-card`, `aml-watchlist-refresh-button`.

---

## 7. Data model

Owner: `db-migrator`. Files: `db/schema.sql`, `python-service/app/models.py` + Alembic revision.

### Node SQLite

```sql
CREATE TABLE IF NOT EXISTS aml_watchlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_name TEXT NOT NULL UNIQUE,
  source_url TEXT,
  last_updated TEXT,
  entry_count INTEGER DEFAULT 0,
  tenant_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS aml_watchlist_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  watchlist_id INTEGER NOT NULL REFERENCES aml_watchlists(id),
  normalized_name TEXT NOT NULL,
  dob TEXT,
  country TEXT,
  original_record TEXT NOT NULL,
  tenant_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_aml_watchlist_entries_normalized
  ON aml_watchlist_entries(watchlist_id, normalized_name);

CREATE TABLE IF NOT EXISTS aml_screenings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_cid TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  screened_at TEXT NOT NULL DEFAULT (datetime('now')),
  hit_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending_review',
  tenant_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_aml_screenings_screened_at ON aml_screenings(screened_at);

CREATE TABLE IF NOT EXISTS aml_hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  screening_id INTEGER NOT NULL REFERENCES aml_screenings(id),
  watchlist_entry_id INTEGER REFERENCES aml_watchlist_entries(id),
  score REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  reviewed_by TEXT,
  reviewed_at TEXT,
  notes TEXT,
  tenant_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_aml_hits_status ON aml_hits(status);
```

### Python SQLAlchemy

```python
class AmlWatchlist(Base):
    __tablename__ = "aml_watchlists"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"))
    list_name: Mapped[str] = mapped_column(String(256), unique=True)
    source_url: Mapped[str | None] = mapped_column(String(512))
    last_updated: Mapped[datetime | None] = mapped_column(DateTime)
    entry_count: Mapped[int] = mapped_column(Integer, default=0)

class AmlWatchlistEntry(Base):
    __tablename__ = "aml_watchlist_entries"
    id: Mapped[int] = mapped_column(primary_key=True)
    watchlist_id: Mapped[int] = mapped_column(ForeignKey("aml_watchlists.id"))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"))
    normalized_name: Mapped[str] = mapped_column(String(512), index=True)
    dob: Mapped[str | None] = mapped_column(String(10))
    country: Mapped[str | None] = mapped_column(String(3))
    original_record: Mapped[dict[str, Any]] = mapped_column(JSON)

class AmlScreening(Base):
    __tablename__ = "aml_screenings"
    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"))
    customer_cid: Mapped[str] = mapped_column(String(36), index=True)
    customer_name: Mapped[str] = mapped_column(String(256))
    screened_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    hit_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(32), default="pending_review")

class AmlHit(Base):
    __tablename__ = "aml_hits"
    id: Mapped[int] = mapped_column(primary_key=True)
    screening_id: Mapped[int] = mapped_column(ForeignKey("aml_screenings.id"))
    watchlist_entry_id: Mapped[int] = mapped_column(ForeignKey("aml_watchlist_entries.id"))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"))
    score: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(32), default="open")
    reviewed_by: Mapped[str | None] = mapped_column(String(256))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime)
    notes: Mapped[str | None] = mapped_column(Text)
```

- **Tenant boundary**: every query filters by `tenant_id`.
- **Soft delete**: not applicable (screenings are historical records).
- **Seed**: load sample OFAC entries in seed job for demo.

---

## 8. Security & compliance

| Concern | Decision |
| --- | --- |
| RBAC | Read: `auditor`. Write (decide): `doc_admin` or new `compliance` role. Watchlist refresh: `doc_admin` only. |
| ABAC (OPA) | Branch scope applies; screenings filtered by branch if required. |
| Audit | Every hit decision writes to `audit_log` with action `AML_HIT_DECISION` + decision + reviewer. |
| Encryption at rest | Customer names in aml_screenings and original_record JSON inherit storage encryption. No PII-specific masking. |
| Encryption in transit | TLS 1.3. No HTTP. |
| PII / DSAR | Customer name + DOB are PII in aml_screenings table. DSAR erasure must soft-delete the row. |
| Retention | Screenings retained per retention_policy (typically 7y for regulatory). |
| Input validation | `decision` enum: `cleared / escalated / blocked`. Reject on invalid. `score` must be 0.0 to 1.0. |
| OWASP top 10 | Injection (parameterised), XSS (watchlist entry names escaped in UI), CSRF (session token), broken auth (role check). |
| Rate limit | Watchlist refresh: 1 per hour (prevent hammering). Decision POST: 100/min per user. |
| Threat model delta | New attack surface: OFAC watchlist data is public; no secrets. False positives → customer reputational harm. Mitigation: human review before blocking. |

A `security-reviewer` run is **mandatory** for this high-risk slice.

---

## 9. Performance & observability

### 9.1 Budget

| Layer | Budget |
| --- | --- |
| Single-customer screening | p99 ≤ 500 ms (includes Levenshtein against 5k entries) |
| Bulk refresh (10k customers) | ≤ 30 minutes |
| Screening query (list) | p99 ≤ 250 ms (indexed, paginated) |
| Hit decision (POST) | p99 ≤ 100 ms |
| Watchlist load into memory | ≤ 2 seconds (startup) |

### 9.2 Observability contract

- **Trace** — span `aml.screen_customer`, `aml.match_watchlist`, `aml.decide_hit` with `customer_cid`, `screening_id`, `tenant_id`.
- **Metric (counter)** — `aml_screenings_total{status="pending|cleared|escalated"}`, `aml_hits_total{decision="cleared|escalated|blocked"}`, `aml_match_score_buckets{score_range="0_25|25_50|50_75|75_100"}`.
- **Metric (histogram)** — `aml_screen_customer_duration_ms`, `aml_watchlist_refresh_duration_s`.
- **Log** — structured: `{level, ts, action: "aml_screen|aml_decide", customer_cid, hit_count, decision, score, tenant_id, duration_ms}`.
- **Audit log row** — `AML_SCREENING_INITIATED` + `{customer_cid, hit_count}`, `AML_HIT_DECISION` + `{hit_id, decision, reviewer, notes}`.

Grafana dashboard: screening volume, hit ratio, pending reviews count, decision timeline.

---

## 10. Accessibility & i18n

- **WCAG 2.1 AA** — hit detail modal keyboard-navigable; buttons focusable. Decision buttons have clear labels.
- **Screen reader** — hit score announced: "Score 89 percent". Decision recorded announcement: "Hit cleared."
- **Reduced motion** — no animations on modal or table.
- **i18n** — all strings via `t()`: "Screening", "Watchlist match", "Cleared", "Escalated" in `en.json` and `dz.json`.
- **RTL** — table and modal render cleanly with `dir="rtl"`.
- **Color contrast** — hit status badges: cleared = green, escalated = orange, open = gray; ≥ 4.5:1.

---

## 11. Error states & edge cases

| Case | Trigger | UX |
| --- | --- | --- |
| Watchlist not loaded | Refresh fails or network error | Screening skipped; alert to ops; customer not blocked (fail-open). |
| False positive | High score on legitimate name | Compliance officer clicks "Clear"; decision recorded (audit trail). |
| Bulk refresh in progress | Admin clicks refresh again | Show "Refresh in progress (8/1200 customers)" spinner. Prevent double-queuing. |
| Hit already decided | Stale UI tries to decide again | Return 409; show "Already reviewed by [officer] at [time]". |
| Customer deleted mid-screening | Race condition | Screening completes but customer gone; no error (screening is idempotent). |
| Normalization collision | Two different names normalize identically | Accept (low probability); audit review required if hit occurs. |
| Score exactly at threshold | Levenshtein = 0.85 | Accept as match (inclusive boundary). |

---

## 12. Rollout & rollback

- **Feature flag** — `FF_AML_LIVE` (env var). Default `off` for ≥ 1 release. When `off`, screenings are enqueued but no matching happens (dry-run mode).
- **Stages** — internal demo (manual test tenant) → 5% canary (low-volume branch) → 25% → 100%.
- **Kill switch** — flip `FF_AML_LIVE=off` → screenings become no-op; customers proceed without hold. No data loss (screening records persist).
- **Migration safety** — additive only. Existing customers unscreened until refresh triggered.
- **Rollback steps**:
  1. Flip `FF_AML_LIVE=off`.
  2. Revert deploy.
  3. Verify `aml_screenings_total` counter returns to baseline (0 matches).
  4. Retain screening history; manual audit if needed.

---

## 13. Test plan

| Layer | File | Owner | Coverage requirement |
| --- | --- | --- | --- |
| Unit (Python) | `python-service/tests/test_aml_match.py` | `python-engineer` | Levenshtein matching, name normalization, threshold logic |
| Unit (Python) | `python-service/tests/test_aml_service.py` | `python-engineer` | Screening task, hit creation, decision update |
| Integration (Python) | `python-service/tests/test_aml_integration.py` | `python-engineer` | End-to-end: customer created → screening enqueued → hit recorded |
| E2E happy | `apps/web/e2e/aml.spec.ts` | `qa-engineer` | AC-1 through AC-6 (admin refresh, hit review, compliance card) |
| E2E errors | `apps/web/e2e/aml.errors.spec.ts` | `qa-engineer` | Watchlist unavailable, false positive, stale UI |
| A11y | `apps/web/e2e/a11y.spec.ts` extended | `qa-engineer` | Hit modal keyboard nav, screen reader announcements |
| Load | `loadtest/k6.js` extended | `qa-engineer` | 50 concurrent users screening customers; verify p99 ≤ 500ms per screening |

---

## 14. Telemetry & success metrics

- **Adoption** — % of customer master changes screened within 24h. Target: 100%.
- **Match rate** — # hits / total screenings. Target: < 2% (too high suggests miscalibration).
- **Decision speed** — avg time from hit open to decision. Target: < 4 hours (SLA).
- **False positive rate** — cleared / total decisions. Target: > 90% (good tuning).
- **Regulatory compliance** — zero missed screenings per audit. Target: 100% coverage.

---

## 15. Definition of Done

- [ ] All sections above filled (no `…` placeholders)
- [ ] `cd python-service && pytest -q python-service/tests/test_aml*.py` green
- [ ] `cd python-service && mypy --strict app/routers/aml.py` clean
- [ ] Watchlist data loads successfully at startup (OFAC sample)
- [ ] Levenshtein matching verified: "John Smith" matches "Jon Smith" at ≥ 0.85
- [ ] Screening task enqueues and runs within 1 second per customer
- [ ] Hit decision updates `status`, `reviewed_by`, `reviewed_at` correctly
- [ ] Compliance card reflects "warn" when hits pending
- [ ] `npx playwright test e2e/aml.spec.ts` green against `./start.sh`
- [ ] `npx playwright test e2e/aml.errors.spec.ts` green
- [ ] `npx playwright test e2e/a11y.spec.ts` green (no new AA violations)
- [ ] Audit log entries land for `AML_SCREENING_INITIATED`, `AML_HIT_DECISION` (manual smoke)
- [ ] Metrics visible in Grafana (`aml_screenings_total`, `aml_hits_total`, `aml_screen_duration_ms`)
- [ ] Feature flag `FF_AML_LIVE` default = `off`; screening is dry-run when flag off
- [ ] `/admin/aml` page renders and lists today's screenings
- [ ] Watchlist refresh endpoint tested: loads OFAC, re-screens 100 customers in < 1 minute
- [ ] `docs/README.md` changelog entry: `2026-MM-DD — aml-screening — OFAC/EU/UN watchlist matching with compliance review workflow`
- [ ] ADR `docs/adr/0011-aml-watchlist-matching-strategy.md` approved
- [ ] `security-reviewer` agent run completed; no high-severity findings
