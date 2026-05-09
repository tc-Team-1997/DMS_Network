# Contract — worm-retention-lock

> Filesystem-level Write-Once-Read-Many lock so documents under retention cannot be modified or deleted until expiry — local equivalent of S3 Object Lock. Core regulatory requirement for document immutability.
>
> Paired with [ENGINEERING_PRINCIPLES.md](../ENGINEERING_PRINCIPLES.md). The Ten Commandments apply.

## Header

| Field | Value |
| --- | --- |
| Feature | `worm-retention-lock` |
| Spec ID | `BHU-32` (document immutability under retention) |
| Owner | `python-engineer` + `db-migrator` |
| Status | `draft` |
| Risk class | `high` (data integrity, regulatory compliance, irreversibility) |
| Contract published | `2026-05-09` |
| Last updated | `2026-05-09` |
| Related ADR | `docs/adr/0009-worm-filesystem-immutability.md` |

---

## 1. Problem & user story

**As a** compliance officer, **I want** documents to be immutable once placed under retention, **so that** no one can accidentally (or maliciously) modify or delete them before their legal hold expires.

Today, documents are stored in `STORAGE_DIR` with no OS-level protection. An admin with filesystem access could unlink or truncate a document even if retention policy says it must persist for 7 years. This violates auditability.

This slice adds:
- OS-level immutable flag (`chflags uchg` on BSD/macOS, `chattr +i` on Linux) set when document committed to retention
- New `worm_locked_at`, `worm_unlock_after`, `worm_release_reason` columns on `documents` table
- Nightly verification cron that asserts locked files are still immutable on disk
- SHA-256 baseline stored at lock time; verification recomputes and alerts on mismatch
- API to unlock (requires reason + audit trail)
- Test coverage: lock/unlock ops, tampering detection, flag state verification

**Personas affected:**
- `Doc Admin` — manages retention policies
- `Auditor` — verifies lock state in audit reports
- `Viewer` — cannot access locked documents (soft restriction)

**Out of scope:**
- Cloud storage (S3 Object Lock, GCS hold). On-prem filesystem only.
- Hardware write-protect tabs or drive-level WORM.
- Encryption key rotation (separate from this contract).
- Windows NTFS ADS. Windows out of scope; macOS + Linux only.

---

## 2. Acceptance criteria

- **AC-1** — Given a document with an active retention policy (not expired), when the document is committed to `STORAGE_DIR`, then the file is immediately immutable on OS (verified via `lsattr` or `stat` depending on OS).
- **AC-2** — Given an immutable file on disk, when an attacker (or bad admin) tries to `rm` or `chmod` or overwrite it, then the operation fails with `Operation not permitted` (OS-enforced).
- **AC-3** — Given a document record with `worm_locked_at = 2026-05-09T10:00:00Z` and `worm_unlock_after = 2026-05-16T10:00:00Z`, when the nightly verification job runs after the unlock date, then the immutable flag is removed and `worm_locked_at` is cleared.
- **AC-4** — Given a locked document with baseline SHA-256 `abc123...`, when the nightly verification job detects the file has been tampered (SHA-256 now `def456...`), then an alert is logged and an `alert_records` row is created with level `critical`.
- **AC-5** — Given a locked document, when an admin calls `POST /api/v1/documents/{id}/worm/unlock` with `reason="legal_hold_released"` and appropriate audit context, then the immutable flag is removed, `worm_locked_at` is set to NULL, and `worm_release_reason` is recorded.
- **AC-6** — Given 10,000 documents with WORM flags, when the nightly verification runs, then all files are checked within 30 minutes (performance gate).

---

## 3. End-to-end workflow

```
[Doc Admin creates retention policy]
    │ "Invoices: 7 years"
    ▼
[Branch Officer uploads invoice]
    │ file written to STORAGE_DIR/<sha256>.pdf
    ▼
[Python storage service checks retention]
    │ policy applies → set OS immutable flag
    │ write documents.worm_locked_at, worm_unlock_after
    │ write documents.sha256_at_lock = current hash
    ▼
[File is now WORM]
    │ read: OK (customers can view)
    │ write/delete: FAILED (OS rejects)
    ▼
[Nightly verification cron]
    │ SELECT * FROM documents WHERE worm_locked_at IS NOT NULL
    │ for each: lstat → check immutable flag set
    │ recompute SHA-256 → compare to sha256_at_lock
    │ if mismatch: alert, audit_log entry
    ▼
[Unlock date reached (7 years)]
    │ cron detects worm_unlock_after <= now
    │ chflags -uchg file.pdf (remove flag)
    │ documents.worm_locked_at = NULL
    │ retention policy cleanup proceeds
    ▼
[File can now be deleted]
```

State machine:

```
[committed to retention]
    │ apply retention policy
    ▼
[worm_locked] ──▶ [unlock_date_reached] ──▶ [worm_unlocked] ──▶ [eligible_for_purge]
                   │
                   └──▶ [tampering_detected] → [alert_critical]
```

---

## 4. API contract — Python (`/api/v1/*`)

Owner: `python-engineer`. File: `python-service/app/routers/worm.py` (new).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/v1/documents/{id}/worm/lock` | `require_api_key` + JWT(role=`doc_admin`) | Manually lock a document (for non-policy-based hold) |
| `POST` | `/api/v1/documents/{id}/worm/unlock` | `require_api_key` + JWT(role=`doc_admin`) | Unlock (removes OS flag, records reason) |
| `GET` | `/api/v1/documents/{id}/worm/status` | `require_api_key` + JWT(role≥`viewer`) | Query lock status + hash baseline |
| `POST` | `/api/v1/worm/verify-batch` | `require_api_key` + JWT(role=`doc_admin`) | Trigger on-demand verification (admin tool) |

### Request / response shapes

```jsonc
// POST /api/v1/documents/{id}/worm/lock — request
{
  "unlock_after_days": 365,
  "reason": "retention_policy_applied"
}

// POST /api/v1/documents/{id}/worm/lock — 200
{
  "document_id": 42,
  "locked_at": "2026-05-09T10:00:00Z",
  "unlock_after": "2027-05-09T10:00:00Z",
  "sha256_baseline": "abc123...",
  "status": "locked"
}

// POST /api/v1/documents/{id}/worm/unlock — request
{
  "reason": "legal_hold_released|retention_expired|error_correction",
  "approver_notes": "Case ABC closed"
}

// POST /api/v1/documents/{id}/worm/unlock — 200
{
  "document_id": 42,
  "unlocked_at": "2026-05-16T14:30:00Z",
  "unlock_reason": "legal_hold_released",
  "status": "unlocked"
}

// GET /api/v1/documents/{id}/worm/status — 200
{
  "document_id": 42,
  "worm_locked": true,
  "locked_at": "2026-05-09T10:00:00Z",
  "unlock_after": "2027-05-09T10:00:00Z",
  "sha256_baseline": "abc123...",
  "sha256_current": "abc123...",
  "tampered": false,
  "os_flag_set": true
}
```

---

## 5. API contract — Node SPA mirror (`/spa/api/*`)

No new Node endpoints. WORM status is read-only; admin unlock via Python service.

---

## 6. SPA module

Owner: `spa-engineer`. Folder: `apps/web/src/modules/repository/` (extend existing with WORM indicators).

### 6.1 Files

- `components/WormBadge.tsx` — read-only indicator showing lock status
- `hooks/useWormStatus.ts` — fetch + poll lock status

### 6.2 Schemas

```ts
import { z } from "zod";

export const WormStatus = z.object({
  document_id: z.number(),
  worm_locked: z.boolean(),
  locked_at: z.string().datetime().nullable(),
  unlock_after: z.string().datetime().nullable(),
  tampered: z.boolean(),
  os_flag_set: z.boolean(),
});
export type WormStatus = z.infer<typeof WormStatus>;
```

### 6.3 UI flow

- Document row in list shows lock icon (padlock) if `worm_locked = true`.
- Hover → tooltip "Immutable until 2027-05-09" + hash mismatch warning if tampered.
- No inline unlock UI in the SPA (unlock is admin API only, done via Node admin panel or CLI).

### 6.4 Test IDs

`document-row-{id}`, `worm-badge-locked`, `worm-badge-unlocked`, `worm-tamper-alert`.

---

## 7. Data model

Owner: `db-migrator`. Files: `db/schema.sql` (Node SQLite), `python-service/app/models.py` + Alembic revision.

### Node SQLite

```sql
ALTER TABLE documents ADD COLUMN IF NOT EXISTS worm_locked_at TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS worm_unlock_after TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS worm_release_reason TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS sha256_at_lock TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_worm_locked_at ON documents(worm_locked_at);
CREATE INDEX IF NOT EXISTS idx_documents_worm_unlock_after ON documents(worm_unlock_after);
```

### Python SQLAlchemy

```python
class Document(Base):
    __tablename__ = "documents"
    
    # ... existing fields ...
    worm_locked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    worm_unlock_after: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    worm_release_reason: Mapped[str | None] = mapped_column(String(128), nullable=True)
    sha256_at_lock: Mapped[str | None] = mapped_column(String(64), nullable=True)
```

- **Tenant boundary**: every query filters by `tenant_id`.
- **Soft delete**: WORM flag persists after soft-delete; files cannot be deleted (hard-deleted) until flag is removed.
- **Seed**: none (WORM is retention-policy driven).
- **Migration**: Alembic revision adds the 4 columns + indexes.

---

## 8. Security & compliance

| Concern | Decision |
| --- | --- |
| RBAC | Only `doc_admin` role can lock/unlock. `viewer` can read status (transparency). Default deny. |
| ABAC (OPA) | Unlock requires additional approval context (PEP checks `unlock_reason` enum). |
| Audit | Every lock operation writes to `audit_log` with action `WORM_LOCK` + details. Every unlock writes `WORM_UNLOCK` + reason + approver. |
| Encryption at rest | WORM is complementary to AES-256 encryption. Immutable flag + encryption = defense in depth. |
| Encryption in transit | TLS 1.3. No HTTP. |
| PII / DSAR | If a PII-containing document is under WORM, DSAR erasure is blocked until unlock. Compliance tracks this. |
| Retention | Documents under WORM inherit retention_policy lifecycle. Unlock happens automatically on policy expiry. |
| Input validation | `unlock_reason` enum: `legal_hold_released / retention_expired / error_correction`. Reject on invalid. |
| OWASP top 10 | Injection (parameterised), XSS (no user input in lock operations), CSRF (session token), broken auth (role check). |
| Rate limit | Unlock is not rate-limited (admin action, audit trail present). |
| Threat model delta | New attack surface: OS-level compromise (root privilege). If attacker gains filesystem access, immutable flag can be bypassed with elevated privileges. Mitigation: OS hardening (SELinux, AppArmor), filesystem auditing. This is infrastructure-level. |

A `security-reviewer` run is **mandatory** for this high-risk slice.

---

## 9. Performance & observability

### 9.1 Budget

| Layer | Budget |
| --- | --- |
| Lock operation | < 100 ms (includes SHA-256 compute + OS flag set) |
| Unlock operation | < 50 ms (OS flag removal only) |
| Nightly verification (10k docs) | ≤ 30 minutes total (parallel lstat + hash checks) |
| Verification per file | < 200 ms (lstat + SHA-256) |
| API p99 latency | < 250 ms |
| DB query cost | Indexed on `worm_locked_at`, `worm_unlock_after` |

### 9.2 Observability contract

- **Trace** — span `worm.lock`, `worm.unlock`, `worm.verify_batch` with `document_id`, `tenant_id`, `sha256_baseline`.
- **Metric (counter)** — `worm_lock_total{status="ok|error"}`, `worm_unlock_total{status="ok|error"}`, `worm_verify_total{status="ok|tampering"}`, `worm_tampering_detected_total`.
- **Metric (histogram)** — `worm_lock_duration_ms`, `worm_verify_duration_ms`.
- **Log** — structured: `{level, ts, action: "worm_lock|worm_unlock|worm_verify", document_id, tenant_id, sha256_baseline, tampered, duration_ms}`.
- **Audit log row** — `WORM_LOCK` + `{unlock_after, reason}`, `WORM_UNLOCK` + `{release_reason, approver}`, `WORM_TAMPERING_DETECTED` + `{document_id, expected_sha256, actual_sha256}`.

Grafana dashboard: WORM lock count over time, tampering incidents, unlock rate.

---

## 10. Accessibility & i18n

- **WCAG 2.1 AA** — WORM badge is not interactive; icon has `aria-label="Document locked until 2027-05-09"`.
- **Screen reader** — WormBadge announces "This document is immutable and cannot be modified or deleted."
- **Reduced motion** — no animations on badge.
- **i18n** — all strings via `t()`: "Immutable until", "Tampered", "Document locked" in `en.json` and `dz.json`.
- **RTL** — badge floats correctly.
- **Color contrast** — padlock icon ≥ 3:1 against background.

---

## 11. Error states & edge cases

| Case | Trigger | UX |
| --- | --- | --- |
| OS flag not set | `chattr +i` fails (permissions, filesystem type) | Log error; alert to ops; fail the lock operation (don't half-succeed). |
| File already locked | Double lock attempt | Idempotent; return current lock status (no error). |
| Unlock non-existent file | File deleted out-of-band | Alert critical; audit log entry; manual ops review needed. |
| Tampering detected | SHA-256 mismatch | Alert critical; block further operations; require forensics. |
| Verification job timeout | > 30 min for 10k docs | Log warning; continue from checkpoint; schedule re-run. |
| DSAR on locked doc | Erasure request for PII under WORM | Reject with 409; inform user "Cannot erase locked document. Await unlock." |
| Unlock during grace period | Admin unlock before policy expiry | Allowed with reason; audit trail; no enforcement block. |
| FS read-only | Verification cannot write unlock timestamp | Log error; alert; don't unset flag (safer to stay locked). |

---

## 12. Rollout & rollback

- **Feature flag** — `FF_WORM` (env var). Default `off` for ≥ 1 release.
- **Stages** — internal demo (test tenant only) → 10% canary tenant (compliance-heavy) → 50% → 100%.
- **Kill switch** — flip `FF_WORM=off` → new locks not set, but existing locks persist (safe). Documents cannot be purged until manual unlock.
- **Migration safety** — additive only. No destructive changes. Existing documents without WORM continue unchanged.
- **Rollback steps**:
  1. Flip `FF_WORM=off`.
  2. Revert deploy.
  3. Verify new lock operations cease (check metrics).
  4. Retain existing locked files; manual unlock via database edit if emergency (audit logged).

---

## 13. Test plan

| Layer | File | Owner | Coverage requirement |
| --- | --- | --- | --- |
| Unit (Python) | `python-service/tests/test_worm.py` | `python-engineer` | Lock/unlock ops, tampering detection, hash baseline |
| Unit (Node) | `routes/spa-api/__tests__/documents.test.js` | `node-engineer` | RBAC on unlock endpoint (if applicable) |
| Integration | `python-service/tests/test_worm_integration.py` | `python-engineer` | End-to-end: file locked on disk, flag verified, tampering simulated |
| E2E | `apps/web/e2e/worm.spec.ts` | `qa-engineer` | AC-1 through AC-4 (viewing locked status, unlock workflow) |
| Verification job | `python-service/tests/test_worm_verify_job.py` | `python-engineer` | Cron runs, detects tamper, alerts on 10k doc sample |
| A11y | `apps/web/e2e/a11y.spec.ts` extended | `qa-engineer` | WormBadge label clarity |
| Load | `loadtest/k6.js` extended | `qa-engineer` | 50 concurrent users querying lock status; verify p99 < 250ms |

---

## 14. Telemetry & success metrics

- **Lock coverage** — % of documents under active retention that have WORM flag set. Target: 100%.
- **Tampering rate** — # tampering alerts / total locked documents. Target: 0 (any finding triggers forensics).
- **Verification completion** — % of nightly verification jobs that complete within SLA. Target: 100%.
- **Unlock latency** — p99 time from unlock API call to flag removed. Target: < 100ms.
- **Regulatory compliance** — zero documents lost or modified under retention (audit attestation).

---

## 15. Definition of Done

- [ ] All sections above filled (no `…` placeholders)
- [ ] `cd python-service && pytest -q python-service/tests/test_worm*.py` green
- [ ] `cd python-service && mypy --strict app/routers/worm.py` clean
- [ ] OS immutable flag verified to persist on disk (manual test: `stat` / `lsattr` after lock)
- [ ] Tampering detection works (hash mismatch triggers alert)
- [ ] Nightly verification cron tested on sample of 1000+ docs; runs within 30min SLA
- [ ] Unlock operation idempotent (can call multiple times safely)
- [ ] `npx playwright test e2e/worm.spec.ts` green against `./start.sh`
- [ ] Audit log entries land for `WORM_LOCK`, `WORM_UNLOCK`, `WORM_TAMPERING_DETECTED` (manual smoke)
- [ ] Metrics visible in Grafana (`worm_*` counters + tampering alert)
- [ ] Feature flag `FF_WORM` default = `off`; toggles correctly
- [ ] `docs/README.md` changelog entry: `2026-MM-DD — worm-retention-lock — OS-level immutability for documents under retention`
- [ ] ADR `docs/adr/0009-worm-filesystem-immutability.md` approved by security team
- [ ] `security-reviewer` agent run completed; no high-severity findings
