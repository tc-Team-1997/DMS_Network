# ADR-0012: WORM Extend-Only Immutability Semantics

**Date**: 2026-05-10  
**Status**: Accepted (Wave B, commit 9bbae4a)  
**Deciders**: Compliance, Security  
**Affects**: Retention policy enforcement from Wave B onward

---

## Context

WORM (Write-Once-Read-Many) archival is a critical compliance control: once a document is locked, it cannot be modified, deleted, or shortened (retention period cannot decrease). The team evaluated:

1. **Immutable forever** — document locked once, can never be unlocked (too rigid; breaks disaster recovery, legal hold release)
2. **Extend-only** — WORM lock period can only increase, never decrease (balances compliance + operations)
3. **Free extension + early unlock** — admin can shorten period (loses compliance value)

---

## Decision

Implement **extend-only WORM semantics**:

- **WORM lock table** tracks document lock state:
  ```sql
  CREATE TABLE worm_locks (
    id BIGSERIAL PRIMARY KEY,
    document_id UUID NOT NULL UNIQUE REFERENCES documents(id),
    locked_at TIMESTAMP NOT NULL,
    unlock_at TIMESTAMP NOT NULL,      -- calculated: locked_at + period_days
    locked_by INTEGER NOT NULL REFERENCES users(id),
    extend_count INTEGER DEFAULT 0,
    extended_at TIMESTAMP,
    reason TEXT,
    FOREIGN KEY (document_id) REFERENCES documents(id)
  );
  ```

- **Lock enforcement** (Wave B Retention admin):
  - Documents with `worm_locks.unlock_at > NOW()` cannot be modified, deleted, or downloaded (403 Forbidden if attempted)
  - Retention scheduler respects WORM locks: excluded from purge
  - Legal-hold flag also blocks purge (orthogonal lock)

- **Extend-only contract**:
  - Admin can call `POST /api/v1/documents/{id}/worm/extend` with new `unlock_at` timestamp
  - Server validation: new unlock_at ≥ current unlock_at (REJECT if attempting to shorten)
  - Audit trail: every extend logged (extended_at, reason, extended_by)
  - Cannot UNLOCK early (no "release WORM" button; only legal hold release works)

- **Admin panel** (WORM admin):
  - List documents with WORM locks
  - Show unlock_at countdown + extend_count
  - Button: "Extend lock" (Modal: new date + reason)
  - No "Unlock now" button (intentional, for compliance)

---

## Consequences

### Positive

- **Compliance-grade** — documents cannot be shorted out of retention; audit regulators trust it
- **Flexible** — can extend if needed (e.g., legal hold discovered, need to keep longer)
- **Audit trail** — every extend is logged with reason
- **Operational safety** — documents can't be accidentally deleted mid-retention

### Negative

- **No early unlock** — if lock period was too long, admin must wait or involve legal (ops friction)
- **Storage burden** — locked documents count against storage quota; cleanup is delayed

### Risk

- **Chained locks** — if multiple extends, unlock_at keeps pushing; needs monitoring
  - Mitigated by alert: "Document X has been extended 5+ times; review" (TBD Wave C)

---

## Alternatives Considered

1. **Immutable forever** — rejected (breaks DR, legal hold release too complex)
2. **Free extend + early unlock** — rejected (loses compliance value)
3. **Judicial override** — rejected (administrative overhead, trust-breaking)

---

## Related

- [Commit 9bbae4a (Wave B Retention + WORM admin)](../../CHANGELOG.md#unreleased--commit-9bbae4a--2026-05-10)
- [PLATFORM_CONFIG.md § retention](../PLATFORM_CONFIG.md#17-retention)
- Services: `python-service/app/routers/retention.py`, `python-service/app/services/retention.py`
- Migration: 0036 (worm_locks table creation)
- Related ADRs: [ADR-0003 WORM Immutability Strategy](./0003-worm-immutability-strategy.md), [ADR-0004 PDF Redaction Irreversibility](./0004-pdf-redaction-irreversibility.md)
