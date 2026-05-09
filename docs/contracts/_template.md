# Contract — <feature>

> Single source of truth for one feature slice. Every engineer (SPA / Node / Python / DB / QA / Security)
> works against this file in parallel. Edit in place when wire shape drifts — never duplicate.
>
> Quality bar: **Fortune-500 / Silicon Valley**. Each section below is non-negotiable. A blank section
> means the author has not designed that aspect yet — fill it before code starts.
>
> Paired with [ENGINEERING_PRINCIPLES.md](../ENGINEERING_PRINCIPLES.md). The Ten Commandments apply.

## Header

| Field | Value |
| --- | --- |
| Feature | `<feature>` |
| Spec ID | `<BHU-XX>` (Bhutan req number, if applicable) |
| Owner | `<lead name / agent>` |
| Status | `draft` / `in-progress` / `shipped` / `deprecated` |
| Risk class | `low` / `medium` / `high` (high = touches money, PII, schema, RBAC) |
| Contract published | `YYYY-MM-DD` |
| Last updated | `YYYY-MM-DD` |
| Related ADR | `docs/adr/NNNN-<title>.md` (required for `risk = high`) |

---

## 1. Problem & user story

One paragraph: what concrete user pain does this solve, who feels it, and why now.

**Personas affected:**
- `Doc Admin` — …
- `Maker` — …
- `Checker` — …
- `Viewer` / `Auditor` — …
- `Branch Officer (mobile)` — …

**Out of scope** — list things this slice deliberately does not solve, so reviewers don't ask.

---

## 2. Acceptance criteria

Each criterion is testable and unambiguous. Use Given/When/Then. A passing E2E test must map to each one.

- **AC-1** — Given …, when …, then …
- **AC-2** — Given …, when …, then …
- **AC-3** — Given …, when …, then …

The QA engineer's Playwright spec must reference these IDs in `test.describe` titles.

---

## 3. End-to-end workflow

ASCII sequence (or mermaid in markdown) covering happy path. State machine if the feature has lifecycle.

```
[User on Capture]
    │ uploads file
    ▼
[Node /spa/api/<feature>] ── proxies ──▶ [Python /api/v1/<feature>]
    │                                              │
    │                                              ▼
    │                                        [Service layer]
    │                                              │
    │                                              ▼
    │                                        [DB write + audit_log]
    ◀──────────────── 200 + body ─────────────────┘
    │
    ▼
[SPA renders result + emits telemetry event]
```

State machine (if applicable):

```
pending ─▶ scanning ─▶ ready ─▶ approved ─▶ archived
              │           │
              ▼           ▼
            error      rejected
```

---

## 4. API contract — Python (`/api/v1/<feature>/*`)

Owner: `python-engineer`. Files: `python-service/app/routers/<feature>.py` + `python-service/app/services/<feature>.py`.

| Method | Path | Auth | Idempotent | Purpose |
| --- | --- | --- | --- | --- |
| `GET` | `/api/v1/<feature>/` | `require_api_key` | Y | List (paginated, default 50, max 200) |
| `GET` | `/api/v1/<feature>/{id}` | `require_api_key` | Y | Read |
| `POST` | `/api/v1/<feature>/` | `require_api_key` + JWT(role≥`maker`) | N (use `Idempotency-Key` header) | Create |
| `PATCH` | `/api/v1/<feature>/{id}` | `require_api_key` + JWT(role≥`maker`) | Y | Update |
| `DELETE` | `/api/v1/<feature>/{id}` | `require_api_key` + JWT(role≥`doc_admin`) | Y | Soft-delete (sets `deleted_at`) |

### Request / response shapes

```jsonc
// POST /api/v1/<feature>/  — request
{
  "name": "string",
  "notes": "string | null"
}

// POST /api/v1/<feature>/  — 201
{
  "id": "uuid",
  "name": "string",
  "notes": "string | null",
  "created_at": "ISO-8601",
  "tenant_id": "uuid"
}

// 4xx error envelope (consistent across services)
{
  "error": "validation_failed",
  "message": "human readable",
  "details": { "field": "reason" }
}
```

**Pagination contract** — `?cursor=<opaque>&limit=<1..200>`; response includes `next_cursor: string | null`.

---

## 5. API contract — Node SPA mirror (`/spa/api/<feature>/*`)

Owner: `node-engineer`. File: `routes/spa-api/<feature>.js`, mounted from `server.js`.

| Method | Path | Session auth | RBAC perm | Notes |
| --- | --- | --- | --- | --- |
| `GET` | `/spa/api/<feature>` | required | `<feature>:read` | Proxies list, injects branch scope from session |
| `POST` | `/spa/api/<feature>` | required | `<feature>:write` | Proxies create; injects `X-API-Key` server-side |

Divergence from Python shape (if any): **none** by default. Note deviations here. The SPA mirror MUST never expose the upstream `X-API-Key` to the browser.

---

## 6. SPA module

Owner: `spa-engineer`. Folder: `apps/web/src/modules/<feature>/`.

### 6.1 Files
- `Page.tsx` — main route component
- `api.ts` — fetch wrappers + zod validation (every response goes through `lib/http.ts`)
- `schemas.ts` — zod schemas
- `components/` — feature-private components (do NOT import from other modules)

### 6.2 Schemas

```ts
import { z } from "zod";

export const <Feature>Item = z.object({
  id: z.string().uuid(),
  name: z.string(),
  notes: z.string().nullable(),
  created_at: z.string(),
});
export type <Feature>Item = z.infer<typeof <Feature>Item>;
```

### 6.3 UI flow

Reference each AC by ID. List the screens, key components, and any new design tokens used.

### 6.4 Test IDs (for Playwright)

`<feature>-page`, `<feature>-row-{id}`, `<feature>-create-button`, `<feature>-form-name`, `<feature>-empty-state`.

---

## 7. Data model

Owner: `db-migrator`. Files: `db/schema.sql` (Node SQLite), `python-service/app/models.py` + a new Alembic revision.

```sql
CREATE TABLE IF NOT EXISTS <feature> (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  notes TEXT,
  branch TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_<feature>_tenant_branch ON <feature>(tenant_id, branch);
CREATE INDEX IF NOT EXISTS idx_<feature>_created_at    ON <feature>(created_at);
```

- **Tenant boundary** — every query MUST filter by `tenant_id`. No exceptions (Commandment #1).
- **Soft delete** — set `deleted_at`; do not hard-delete. Auditor can still read.
- **FTS5** — list searchable columns to add to `documents_fts` (and the matching `AFTER INSERT/UPDATE/DELETE` triggers): _none_ unless specified.
- **Seed** — extend `db/seed.js` with ≥1 realistic row so a fresh clone renders something.
- **Migration** — `addColumnIfMissing` for additive changes; full Alembic revision for destructive ones.

---

## 8. Security & compliance

| Concern | Decision |
| --- | --- |
| RBAC | Roles allowed: `…`. Default deny. |
| ABAC (OPA) | Branch / risk-band / after-hours rules: … |
| Audit | Every state change writes to `audit_log` with action `<FEATURE>_<VERB>` + details JSON |
| Encryption at rest | Inherited from storage layer (AES-256). PII columns flagged: … |
| Encryption in transit | TLS 1.3 on all hops. No HTTP. |
| PII / DSAR | Columns containing PII: … . Erasure path: … . |
| Retention | Retention class: `<7y / 10y / indefinite>`. Linked to `retention_policies` table. |
| Input validation | Server-side zod / pydantic. Never trust client. Reject on first bad field. |
| OWASP top 10 | Checked: injection (parameterised), XSS (escaped), CSRF (session token), SSRF (no user URLs), broken auth (covered by session), insecure deserialisation (n/a), … |
| Rate limit | `<N/min per user>` on `POST` endpoints. Use existing `rate_limit` middleware. |
| Threat model delta | New attack surface: … . Mitigations: … . |

A `security-reviewer` agent run is **mandatory** for `risk = high` slices before merge.

---

## 9. Performance & observability

### 9.1 Budget

| Layer | Budget |
| --- | --- |
| API p99 latency | `< 250 ms` (or specify) |
| DB query cost | every query has an index; no `SELECT *` on tables > 100k rows |
| SPA bundle delta | `< 10 KB gzipped` on the main chunk |
| Payload size | `< 100 KB` per response (paginate beyond that) |
| Memory delta | document any `> 50 MB` working set |

### 9.2 Observability contract

Each handler ships:

- **Trace** — span `<feature>.<verb>` with attributes `tenant_id`, `branch`, `id`
- **Metric (counter)** — `<feature>_<verb>_total{status="ok|error"}` (Prometheus)
- **Metric (histogram)** — `<feature>_<verb>_duration_seconds`
- **Log** — one structured line per request: `{level, ts, feature, action, tenant, branch, duration_ms, status}`
- **Audit log row** — for every mutation

Add a Grafana dashboard tile (or extend existing) showing the metric pair.

---

## 10. Accessibility & i18n

- **WCAG 2.1 AA** — keyboard-only navigation works end-to-end; visible focus rings; no color-only signal.
- **Screen reader** — every interactive element has an accessible name; live regions for status updates.
- **Reduced motion** — respect `prefers-reduced-motion`; gate animations behind `motion-safe:`.
- **i18n** — all strings via `t()`; no hardcoded copy. Add keys to `apps/web/src/i18n/<locale>.json` for `en` and `dz` (Dzongkha).
- **RTL** — verify the layout renders cleanly when `dir="rtl"` is set (Arabic locale).
- **Color contrast** — text ≥ 4.5:1 against background; icons ≥ 3:1.

---

## 11. Error states & edge cases

Every code path the user can hit. For each, the SPA must render a useful state.

| Case | Trigger | UX |
| --- | --- | --- |
| Empty | No rows | Empty-state panel with primary CTA |
| Loading | Initial fetch | Skeleton (≤ 3s) or spinner (> 3s) |
| Network failure | fetch reject | Inline retry banner + toast |
| 4xx validation | Bad input | Field-level error + form re-focus |
| 4xx unauthorised | Session expired | Redirect to login, preserve intent |
| 4xx forbidden | RBAC denied | Inline "Not allowed" with role hint |
| 5xx | Server crash | Generic apology + ticket id from header |
| Slow upstream | > 10s | Cancellable, surface progress |
| Concurrent edit | 409 conflict | "Someone updated this — refresh" |
| Offline | Service worker | Queue write, replay on reconnect |

---

## 12. Rollout & rollback

- **Feature flag** — `FF_<FEATURE>` (env var or settings table). Default `off` for ≥ 1 release.
- **Stages** — internal demo → 10% canary tenant → 100% — promote on green dashboards.
- **Kill switch** — flipping the flag off must restore previous behaviour with no data loss.
- **Migration safety** — additive only on first ship; no destructive change before `100%` for ≥ 2 weeks.
- **Rollback steps** — explicit, runbook-style: [1] flip flag off, [2] revert deploy, [3] verify metric X returned to baseline.

---

## 13. Test plan

| Layer | File | Owner | Coverage requirement |
| --- | --- | --- | --- |
| Unit (Python) | `python-service/tests/test_<feature>.py` | `python-engineer` | Service logic + every error branch |
| Unit (Node) | `routes/spa-api/__tests__/<feature>.test.js` (if applicable) | `node-engineer` | RBAC + proxy injection |
| Schema (zod) | colocated with `schemas.ts` | `spa-engineer` | Round-trip parse |
| E2E happy | `apps/web/e2e/<feature>.spec.ts` | `qa-engineer` | One test per AC, against live `./start.sh` |
| E2E errors | `apps/web/e2e/<feature>.errors.spec.ts` | `qa-engineer` | Each row in §11 |
| A11y | `apps/web/e2e/a11y.spec.ts` extended | `qa-engineer` | axe-core scan, no AA violations |
| Visual | `apps/web/e2e/visual.spec.ts` extended | `qa-engineer` | Screenshot diffs gated to ±0.1% |
| Load (smoke) | `loadtest/k6.js` extended | `qa-engineer` | 50 concurrent users, p99 within budget |

---

## 14. Telemetry & success metrics

Define how we'll know the feature works in production. Numeric, not vibes.

- **Adoption** — `<N>%` of `<persona>` use the feature in week 1
- **Latency** — `p99 < <X> ms` measured for 7 days
- **Error rate** — `< 0.5%` 5xx and `< 2%` 4xx
- **Business KPI** — e.g. "auto-routed documents in workflow approval = 80% accepted without re-routing"

These metrics live in the feature's Grafana row.

---

## 15. Definition of Done

A reviewer is allowed to merge only when every box is checked.

- [ ] All sections above filled (no `…` placeholders left)
- [ ] `cd python-service && pytest -q` green
- [ ] `cd apps/web && npm run typecheck` green
- [ ] `cd apps/web && npx playwright test e2e/<feature>.spec.ts` green against live `./start.sh`
- [ ] `cd apps/web && npx playwright test e2e/<feature>.errors.spec.ts` green
- [ ] `npx playwright test e2e/a11y.spec.ts` green (no new AA violations)
- [ ] Audit log entries land for every mutation (manual smoke)
- [ ] Metrics + traces visible in local Grafana / Jaeger
- [ ] Feature flag default = `off` and verified
- [ ] `docs/README.md` changelog entry: `YYYY-MM-DD — <feature> — <one-line summary>`
- [ ] If `risk = high`: `security-reviewer` agent run posted (no high-severity findings)
- [ ] If schema changed: ADR landed in `docs/adr/`
