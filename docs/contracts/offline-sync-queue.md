# Contract — offline-sync-queue

> Complete the ServiceWorker → upload queue → background sync wiring so branch officers can capture documents offline and sync when connectivity returns. Every queued upload carries idempotency guarantees and conflict resolution.
>
> Paired with [ENGINEERING_PRINCIPLES.md](../ENGINEERING_PRINCIPLES.md). The Ten Commandments apply.

## Header

| Field | Value |
| --- | --- |
| Feature | `offline-sync-queue` |
| Spec ID | `BHU-57` (branch officer offline capture) |
| Owner | `node-engineer` + `spa-engineer` + `python-engineer` |
| Status | `shipped` |
| Risk class | `medium` (new IndexedDB schema, new ServiceWorker logic, replay safety) |
| Contract published | `2026-05-09` |
| Last updated | `2026-05-09` |
| Related ADR | `docs/adr/0010-idempotent-offline-replay.md` |

---

## 1. Problem & user story

**As a** branch officer working in a remote branch with spotty connectivity, **I want to** capture documents offline and have them automatically sync when I reconnect, **so that** I never lose work and don't have to manually retry uploads.

Today, if connectivity drops mid-upload, the document is lost. The SPA has no offline queue. When internet returns, the user has no way to recover.

This slice adds:
- IndexedDB `outbox` store for pending uploads with idempotency headers
- Service Worker `sync` event handler that replays queued uploads
- SPA offline indicator + queue count badge
- Idempotency deduplication server-side (24h TTL on `idempotency_keys` table)
- Conflict resolution: same key + different payload → reject with 409
- Test coverage: offline UX + sync replay + server dedup

**Personas affected:**
- `Branch Officer (mobile)` — primary beneficiary
- `Doc Admin` — sees offline queue metrics in audit
- `Maker` — may capture offline before handoff

**Out of scope:**
- Delta sync (partial state). Only full document re-uploads.
- Encrypted queue at rest (session-scoped only; no persistence across login).
- Offline search or read. Offline = capture + queue only.

---

## 2. Acceptance criteria

- **AC-1** — Given an offline SPA (Service Worker active, no connectivity), when a user submits `/spa/api/documents` POST, then the request is written to IndexedDB `outbox` store within 50ms and the form shows a "Pending sync" badge.
- **AC-2** — Given a queued upload in the outbox, when connectivity returns and a sync event fires, then the Service Worker replays the exact request payload (including the `Idempotency-Key` header) to the Node server.
- **AC-3** — Given a replayed upload with `Idempotency-Key=abc123`, when the server has already processed a request with the same key in the last 24h, then return the cached 201 response (same `document_id`) without double-creating.
- **AC-4** — Given a replayed upload with `Idempotency-Key=abc123` and a DIFFERENT payload than originally cached, then reject with 409 Conflict + message "Idempotency key collision: request body differs."
- **AC-5** — Given 3 queued uploads in the outbox, when sync completes, then IndexedDB outbox is cleared, a "Synced 3 documents" toast appears, and sync metadata is logged to `audit_log`.
- **AC-6** — Given an offline queue > 0 items, when the user views the SPA, then a small offline indicator badge shows the queue count (e.g., "3 pending") in the nav.

---

## 3. End-to-end workflow

```
[Branch Officer on Capture page]
    │ opens SPA (Service Worker registers)
    ▼
[Connection lost]
    │ tries to POST /spa/api/documents
    │ fetch rejects (offline)
    ▼
[SPA detects error, queues to IndexedDB]
    │ generates Idempotency-Key: uuid()
    │ writes to outbox store: { id, payload, idempotency_key, retry_count, queued_at }
    │ shows "Pending sync (1)" badge
    ▼
[Operator reconnects to internet]
    │ Service Worker fires 'sync' event
    │ (or user refreshes page)
    ▼
[Sync handler iterates outbox]
    │ for each queued item:
    │   POST /spa/api/documents with Idempotency-Key header
    │   on 201 → remove from outbox
    │   on 409 → log conflict, remove
    │   on 5xx → increment retry_count, re-queue
    ▼
[SPA renders result]
    │ outbox cleared → "Synced 3 documents" toast
    │ badge disappears
    │ audit_log row written with sync_replay action
```

State machine:

```
[online]
    │ form submit
    ▼
[queued] ──▶ [syncing] ──▶ [deduped|error|success]
```

---

## 4. API contract — Python (`/api/v1/*`)

No new Python endpoints. The existing `/api/v1/documents` POST (via `/spa/api/documents` mirror) receives and processes the idempotency header.

The idempotency check is transparent to the caller — the header is carried through the Node → Python proxy layer as-is.

---

## 5. API contract — Node SPA mirror (`/spa/api/*`)

Owner: `node-engineer`. File: `routes/spa-api/documents.js` (extend existing).

| Method | Path | Session auth | RBAC perm | Notes |
| --- | --- | --- | --- | --- |
| `POST` | `/spa/api/documents` | required | `documents:write` | Accepts `Idempotency-Key` header; stores in DB for 24h |

### Request

```jsonc
// POST /spa/api/documents — same shape as today
{
  "original_name": "scan.pdf",
  "doc_type": "receipt",
  "customer_cid": "12345",
  "metadata_json": "{}",
  "notes": "offline capture"
  // plus file multipart
}

// HTTP header required
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
```

### Response

```jsonc
// 201 Created (new or deduplicated)
{
  "id": "doc-uuid",
  "status": "Valid",
  "idempotency_key": "550e8400-e29b-41d4-a716-446655440000"
}

// 409 Conflict (same key, different body)
{
  "error": "idempotency_conflict",
  "message": "Idempotency-Key already used with different request body"
}
```

---

## 6. SPA module

Owner: `spa-engineer`. Folder: `apps/web/src/modules/capture/` (extend existing with offline logic).

### 6.1 Files

- `offline/queue.ts` — IndexedDB outbox store + read/write ops
- `offline/sync.ts` — Service Worker sync handler registration
- `hooks/useOfflineQueue.ts` — React hook: watch queue size, subscribe to sync events
- `components/OfflineIndicator.tsx` — nav badge showing pending count

### 6.2 Schemas

```ts
import { z } from "zod";

export const QueuedUpload = z.object({
  id: z.string().uuid(),
  payload: z.object({
    original_name: z.string(),
    doc_type: z.string().nullable(),
    customer_cid: z.string().nullable(),
    metadata_json: z.string().nullable(),
    notes: z.string().nullable(),
  }),
  idempotency_key: z.string().uuid(),
  retry_count: z.number().int().min(0).max(5),
  queued_at: z.string().datetime(),
  file_blob: z.instanceof(Blob),
});
export type QueuedUpload = z.infer<typeof QueuedUpload>;

export const SyncResult = z.object({
  success: z.number(),
  failed: z.number(),
  deduped: z.number(),
});
```

### 6.3 UI flow

- **AC-1**: When POST fails (offline), intercept and queue. Show inline "Pending sync (N)" badge below form.
- **AC-2/3**: Service Worker replays on reconnect or user refresh. Transparent to user.
- **AC-5**: On sync complete, toast "Synced 3 documents" disappears after 4s.
- **AC-6**: OfflineIndicator in nav shows queue count. Click → detail modal (pending uploads table).

### 6.4 Test IDs

Canonical test IDs as shipped (updated 2026-05-09 by spa-engineer):

| Test ID | Element | File |
| --- | --- | --- |
| `offline-indicator` | Outer pill wrapper (only rendered when visible) | `src/components/OfflineIndicator.tsx` |
| `offline-indicator-count` | Count badge `<span>` | `src/components/OfflineIndicator.tsx` |
| `offline-indicator-trigger-sync` | Trigger sync `<button>` | `src/components/OfflineIndicator.tsx` |
| `sync-status-card` | Root wrapper `<div>` around SyncStatusCard | `src/modules/admin/components/SyncStatusCard.tsx` |
| `sync-status-replayed` | Replayed count value `<span>` | `src/modules/admin/components/SyncStatusCard.tsx` |
| `sync-status-deduped` | Deduped count value `<span>` | `src/modules/admin/components/SyncStatusCard.tsx` |
| `sync-status-failed` | Failed count value `<span>` | `src/modules/admin/components/SyncStatusCard.tsx` |
| `capture-offline-toast` | Offline-saved toast (`role="status"`) | `src/modules/capture/CapturePage.tsx` |
| `capture-dropzone` | Drag-and-drop zone (pre-existing) | `src/modules/capture/CapturePage.tsx` |
| `capture-file-input` | Hidden file input (pre-existing) | `src/modules/capture/CapturePage.tsx` |

> Note: `offline-queue-badge` and `offline-queue-detail-modal` from the original draft are superseded by `offline-indicator-count` and the `offline-indicator` pill itself. The detail modal is deferred to a future iteration.

---

## 7. Data model

Owner: `db-migrator`. Files: `db/schema.sql` (Node SQLite), `python-service/app/models.py` + Alembic revision.

### Node SQLite

```sql
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  tenant_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_body TEXT NOT NULL,
  response_body TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_key_user
  ON idempotency_keys(tenant_id, user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires_at ON idempotency_keys(expires_at);
```

### Python SQLAlchemy

```python
class IdempotencyKey(Base):
    __tablename__ = "idempotency_keys"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    request_body: Mapped[str] = mapped_column(Text)
    response_body: Mapped[str] = mapped_column(Text)
    response_status: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
```

- **Tenant boundary**: every query filters by `tenant_id` + `user_id`.
- **TTL**: `expires_at = now + 24h`. Cron job cleans expired rows daily.
- **Soft delete**: not applicable; these are transient cache rows.
- **Seed**: none.

---

## 8. Security & compliance

| Concern | Decision |
| --- | --- |
| RBAC | Only `doc_admin`, `maker`, `checker` roles can submit. Default deny. |
| ABAC (OPA) | After-hours check applies; branch scope from session injected. |
| Audit | Every successful replay writes to `audit_log` with action `OFFLINE_SYNC_REPLAY` + dedup status. |
| Encryption at rest | Queue is browser-local (IndexedDB, same-origin). Sensitive fields (CID, doc_number) are NOT encrypted at rest in IndexedDB (in scope for AC-3, may upgrade in future). |
| Encryption in transit | TLS 1.3 on all hops. Service Worker ↔ Node uses same TLS as browser. |
| PII / DSAR | IndexedDB outbox is per-user (origin-scoped); cleared on logout. Idempotency key table purges on 24h expiry. |
| Retention | Idempotency keys: 24h. IndexedDB: cleared on logout. |
| Input validation | Node validates `Idempotency-Key` format (UUID). Request body validated by existing document upload schema. |
| OWASP top 10 | Checked: injection (parameterised), XSS (no user input in sync handler), CSRF (session token on POST), SSRF (n/a), broken auth (session required), insecure deserialisation (zod validation). |
| Rate limit | Sync replays are NOT rate-limited (belong to same request batch). Initial POST subject to existing 5 requests/min per user. |
| Threat model delta | New attack surface: IndexedDB compromise → attacker reads queued upload payloads. Mitigation: IndexedDB is same-origin; user must be logged in. |

A `security-reviewer` run is **recommended** (not mandatory for medium risk).

---

## 9. Performance & observability

### 9.1 Budget

| Layer | Budget |
| --- | --- |
| Queue write latency | < 50 ms (IndexedDB transaction) |
| Sync replay per upload | < 1s (includes network round-trip) |
| Sync drain rate | ≥ 5 uploads/sec (sequential, no parallelism yet) |
| SPA bundle delta | < 5 KB gzipped (offline module) |
| IndexedDB store size | < 50 MB per user (soft limit; warn at 80%) |
| Memory footprint | < 10 MB for 100 queued items |

### 9.2 Observability contract

- **Trace** — span `offline.queue_write` + `offline.sync_replay` with `tenant_id`, `user_id`, `queue_size`.
- **Metric (counter)** — `offline_queue_write_total{status="ok|offline"}`, `offline_sync_replay_total{status="ok|deduped|conflict|error"}`, `offline_sync_drain_count{status="success|failed"}`.
- **Metric (histogram)** — `offline_queue_write_duration_ms`, `offline_sync_replay_duration_ms`.
- **Log** — one structured line per sync tick: `{level, ts, action: "offline_sync", queue_size, drained, failed, duration_ms, tenant_id, user_id}`.
- **Audit log row** — `OFFLINE_SYNC_REPLAY` with details: `{ dedup_status, retry_count, idempotency_key (first 8 chars) }`.

Grafana dashboard: one row per tenant showing queue size over time + sync success rate.

---

## 10. Accessibility & i18n

- **WCAG 2.1 AA** — offline indicator is keyboard-focusable; nav badge has `aria-label="N pending uploads"`.
- **Screen reader** — OfflineIndicator announces "Offline queue has 3 pending uploads" when queue changes.
- **Reduced motion** — sync toast uses fade-in only; no slide animations.
- **i18n** — all strings via `t()`: "Pending sync", "Synced N documents", "Queue full (50+ items)" in `apps/web/src/i18n/en.json` and `dz.json` (Dzongkha).
- **RTL** — offline badge floats correctly when `dir="rtl"`.
- **Color contrast** — badge uses outline style, ≥ 4.5:1.

---

## 11. Error states & edge cases

| Case | Trigger | UX |
| --- | --- | --- |
| Queue full | > 100 items | "Queue is full. Clear old items?" button to open modal. |
| IndexedDB unavailable | Browser not supporting IDB | Log warning; disable offline mode. |
| Sync 409 conflict | Same key, different body | Log conflict; remove from queue; emit analytics event. |
| Sync 5xx retry | Server error | Increment retry_count; re-queue (max 5 retries). |
| Sync partially fails | 2 succeed, 1 fails | Toast "Synced 2 of 3. Retry pending?" with button. |
| Network unstable (flapping) | Reconnect → disconnect → reconnect | Coalesce sync events; no duplicate replays. |
| User logs out | Logout while queue has items | Clear IndexedDB outbox. Alert: "N pending documents discarded." |
| Large file queued | > 20 MB | Warn "Large file may not sync over mobile." Queue anyway. |
| Offline mode disabled (FF) | Feature flag off | Service Worker unregistered; POST goes live (fail fast if offline). |

---

## 12. Rollout & rollback

- **Feature flag** — `FF_OFFLINE_SYNC` (env var). Default `off` for ≥ 1 release.
- **Stages** — internal demo (manual) → 10% canary tenant (branch-heavy) → 50% → 100%.
- **Kill switch** — flip `FF_OFFLINE_SYNC=off` → Service Worker unregistered on next page load; all POST goes live (no queue). No data loss (outbox persists, can be manually recovered).
- **Migration safety** — additive only. No schema breaking changes.
- **Rollback steps**:
  1. Flip `FF_OFFLINE_SYNC=off` in config.
  2. Revert deploy.
  3. Verify `offline_sync_*` metrics return to baseline (0 queue activity).
  4. Retain outbox data for 7 days (manual recovery if needed).

---

## 13. Test plan

| Layer | File | Owner | Coverage requirement |
| --- | --- | --- | --- |
| Unit (Node) | `routes/spa-api/__tests__/documents.test.js` | `node-engineer` | Idempotency key dedup + 409 conflict |
| Unit (SPA) | `apps/web/src/modules/capture/__tests__/queue.test.ts` | `spa-engineer` | IndexedDB CRUD, sync replay logic |
| Integration (Python) | `python-service/tests/test_idempotency.py` | `python-engineer` | End-to-end dedup via proxy |
| E2E happy | `apps/web/e2e/offline.spec.ts` | `qa-engineer` | AC-1 through AC-6 (each in separate test) |
| E2E errors | `apps/web/e2e/offline.errors.spec.ts` | `qa-engineer` | Queue full, 409 conflict, 5xx retry, logout |
| A11y | `apps/web/e2e/a11y.spec.ts` extended | `qa-engineer` | OfflineIndicator badge keyboard nav + screen reader |
| Load | `loadtest/k6.js` extended | `qa-engineer` | 50 concurrent users, 3 queued items each, sync rate ≥ 5/sec |

---

## 14. Telemetry & success metrics

- **Adoption** — % of branch officers with Service Worker registered (check via metrics). Target: 60% week 1.
- **Queue utilisation** — avg queue size at sync time. Target: < 3 items (most syncs complete within minutes).
- **Dedup ratio** — idempotency_key hits / total replays. Target: < 2% (retries should be rare).
- **Sync success rate** — successful syncs / total sync events. Target: > 98%.
- **Latency** — p99 sync replay time. Target: < 1s per item.
- **Business KPI** — "Zero documents lost due to offline upload" confirmed by audit log review.

---

## 15. Definition of Done

- [ ] All sections above filled (no `…` placeholders)
- [ ] `cd python-service && pytest -q` green (idempotency test included)
- [ ] `cd apps/web && npm run typecheck` green
- [ ] `cd apps/web && npx playwright test e2e/offline.spec.ts` green against `./start.sh`
- [ ] `cd apps/web && npx playwright test e2e/offline.errors.spec.ts` green
- [ ] Service Worker registers correctly; sync event fires on reconnect
- [ ] `npx playwright test e2e/a11y.spec.ts` green (no new AA violations)
- [ ] Audit log entries land for every `OFFLINE_SYNC_REPLAY` (manual smoke test)
- [ ] Metrics visible in local Grafana (`offline_sync_*` counters + histograms)
- [ ] Feature flag `FF_OFFLINE_SYNC` default = `off`; feature toggles correctly
- [ ] `docs/README.md` changelog entry: `2026-MM-DD — offline-sync-queue — queue uploads offline, replay on reconnect with idempotency`
- [ ] Optional: security-reviewer sign-off (medium risk, optional but recommended)
