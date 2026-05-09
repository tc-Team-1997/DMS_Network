# ADR-0008: Tenant Config as Universal Configuration Spine

**Date**: 2026-05-09  
**Status**: Accepted (Foundation, commit ebae97e)  
**Deciders**: Platform team  
**Affects**: All modules from Wave A onward

---

## Context

Before Foundation, configuration was scattered: environment variables in `.env`, hardcoded literals in module code, per-table columns in the database (e.g., `documents.dedup_threshold`), and per-module settings tables (e.g., legacy `dedup_settings` table).

This fragmentation made it impossible to:
- Change a threshold and have it take effect immediately without redeployment
- Audit who changed what configuration, when, and why
- Export/import configuration across tenants
- Gate configuration changes to specific roles (Doc Admin vs Maker)
- Build a unified admin UI for all settings

The team evaluated:
1. **Environment variables only** — restart required for every change; no audit trail; not tenant-scoped.
2. **Per-module settings tables** — what we had; fragmented, hard to reason about consistency.
3. **Unified key-value JSON store with hash-chained history** — what we chose.

---

## Decision

Implement `tenant_config` as a **universal configuration spine**:

- Single table: `tenant_config(tenant_id, namespace, key, value_json, updated_at, updated_by)`
- Immutable audit trail: `tenant_config_history(tenant_id, namespace, version_hash, prev_hash, data_json, reason, updated_at, updated_by)`
- Hash-chained: each entry's `version_hash = SHA256(prev_hash || namespace || data_json)` (deterministic, tamper-evident)
- 16 namespaces, each with published JSON Schema (additionalProperties:false) for validation
- Endpoints: GET `/spa/api/admin/config/:namespace`, PUT (updates + writes hash-chained history)
- Service layers: `db/tenant-config.js` (Node) + `python-service/app/services/tenant_config/service.py` (Python)
- Admin UI: ConfigPanel (generic form renderer from JSON Schema) + namespace-specific panels
- Every config write requires reason ≥20 chars + RBAC permission `requireNamespacePermJson('<ns>')`

Migrate all scattered settings into namespaces:
- dedup thresholds → `capture` namespace
- session TTL → `rbac` namespace
- workflow SLA targets → `workflows` namespace
- etc.

---

## Consequences

### Positive

- **Single source of truth** — all business configuration lives in one place, queryable
- **Tenant-scoped** — different tenants can have different thresholds without redeployment
- **Audit trail** — hash-chained history shows who changed what, when, why (immutable for compliance)
- **Live updates** — no server restart required; ConfigPanel pushes changes into Zustand store
- **Admin UI auto-generation** — generic ConfigPanel renders forms from JSON Schema, reduces boilerplate
- **RBAC gateable** — per-namespace permissions (Doc Admin can change workflows, Maker can read-only query)
- **Extensible** — adding a new namespace is 6 steps (schema + RBAC + panel + route + service + docs)

### Negative

- **More queries** — service layers now do `tenant_config.get()` on every request (mitigated by module-level cache + per-(tenant,kind,provider) instance cache)
- **Schema drift risk** — old code reading old namespace keys; requires careful deprecation (versioning TBD in Wave C)
- **Complex migrations** — existing per-table settings must be migrated row-by-row (dedup_settings cleanup in migration 0036)

### Risk

- **Hash collision in history** — SHA-256 is cryptographically strong; risk is negligible
- **Concurrent writes** — two admins change config simultaneously; current design is last-write-wins (optimistic locking TBD Wave C)

---

## Alternatives Considered

1. **Environment variables + restart** — rejected (no audit, not tenant-scoped, downtime required)
2. **Per-module settings tables** — rejected (what we had; fragmented, hard to unify)
3. **Consul / etcd service mesh** — rejected (adds new operational dependency, overkill for local-first platform)
4. **Redis-backed config** — rejected (not persistent, no audit trail, tenant isolation harder)

---

## Related

- [Commit ebae97e (Foundation CC1)](../../CHANGELOG.md#unreleased--commit-ebae97e--2026-05-09)
- [PLATFORM_CONFIG.md](../PLATFORM_CONFIG.md) — catalog of all 16 namespaces
- Services: `db/tenant-config.js`, `python-service/app/services/tenant_config/service.py`
- Schemas: `schemas/tenant-config/*.json`
