# ADR-0010: Hash-Chained Config History for Audit & Rollback

**Date**: 2026-05-09  
**Status**: Accepted (Foundation, commit ebae97e)  
**Deciders**: Security, Platform team  
**Affects**: tenant_config history tracking

---

## Context

Every admin configuration change must be auditable: who, what, when, why. The team considered audit approaches:

1. **Append-only log** — simple, but doesn't prevent tamper (admin edits the reason field after the fact)
2. **Signed audit log** — requires key management, slower writes
3. **Hash-chained history** (git-style) — each entry hashes the previous entry + current data; tampering breaks the chain

The platform already uses hash-chaining for the immutable document audit log (SHA-256 chain). Extending this to config history makes the entire system **tamper-evident** without requiring external signers.

---

## Decision

Implement `tenant_config_history` table with deterministic hash-chaining:

```sql
CREATE TABLE tenant_config_history (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  namespace TEXT NOT NULL,
  version_hash CHAR(64) NOT NULL UNIQUE, -- SHA-256 hex
  prev_hash CHAR(64),                     -- reference to parent entry
  data_json JSONB NOT NULL,               -- full namespace config snapshot
  reason TEXT NOT NULL,                   -- >=20 chars, required from admin
  updated_at TIMESTAMP NOT NULL,
  updated_by INTEGER NOT NULL REFERENCES users(id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
```

**Hashing algorithm** (deterministic):
```
version_hash = SHA256(prev_hash || namespace || canonical_json(data) || updated_at || updated_by)
```

**Canonical JSON** — fields sorted, no whitespace, ensures two identical configs hash identically.

**Every PUT `/spa/api/admin/config/:namespace`**:
1. Validate new data against schema
2. Read current `tenant_config` row for this (tenant, namespace)
3. Query latest `tenant_config_history` entry (get `prev_hash`)
4. Compute new `version_hash`
5. Write new history row (atomic with config row UPDATE)
6. Reason field stored as-is (>=20 chars enforced at API)

**Rollback** (Wave C): admin can `PUT /spa/api/admin/config/:namespace?version=<hash>` to roll back to a specific point in history. Data integrity verified by re-computing hash.

---

## Consequences

### Positive

- **Tamper-evident chain** — if admin edits old history row, hash changes, breaks chain; breaks detectable
- **Compliance-ready** — immutable audit trail suitable for SOC 2 / ISO 27001 audits
- **No external signers** — doesn't require PKI or external audit servers
- **Rollback support** — can restore config to any point in history
- **Audit export** — can dump full history for forensics: `SELECT * FROM tenant_config_history WHERE tenant_id = ? ORDER BY version_hash`

### Negative

- **Storage overhead** — every config change writes full snapshot (redundant if only one key changes), but JSONB compression mitigates
- **Compute cost** — SHA-256 on every write (negligible for config updates, which are infrequent)
- **Rollback complexity** — rolling back requires agreement on which version to go back to (TBD Wave C, might need voting / approval gate)

### Risk

- **Hash collision** — SHA-256 is cryptographically strong; collision risk is negligible (~1 in 2^128)
- **Clock skew** — if servers have different clocks, hash will differ; mitigated by server time sync (NTP)

---

## Alternatives Considered

1. **Append-only log without hash chain** — rejected (allows tampering; not compliance-grade)
2. **Blockchain external anchor** — rejected (overkill, adds latency, new dependency)
3. **Signature + timestamp** — rejected (requires key management; hash-chaining is simpler and sufficient)

---

## Related

- [Commit ebae97e (Foundation CC1)](../../CHANGELOG.md#unreleased--commit-ebae97e--2026-05-09)
- [ADR-0008: tenant_config spine](./0008-tenant-config-spine.md)
- [PLATFORM_CONFIG.md](../PLATFORM_CONFIG.md)
- Services: `db/tenant-config.js`, `python-service/app/services/tenant_config/service.py`
- Migration: 0027 (tenant_config_history table creation)
