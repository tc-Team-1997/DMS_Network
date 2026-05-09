# ADR-0011: ABAC Visual Editor with Closed-Enum Field Paths

**Date**: 2026-05-10  
**Status**: Accepted (Wave B, commit 9bbae4a)  
**Deciders**: Security, Platform team  
**Affects**: Authorization policy authoring from Wave B onward

---

## Context

The platform uses OPA (Open Policy Agent) for ABAC (Attribute-Based Access Control) — enforcing rules like "Doc Admin can approve workflows in Low risk band, after hours is blocked, only from sanctioned branches." Previously, admins had to edit dms.rego directly (text file, no validation, no UI).

Options:
1. **Free-form Rego authoring** — powerful but error-prone (typos break silent, result is allow=false)
2. **Constraint-based builder** — drag-drop conditions, rigid UX, limits expressiveness
3. **Closed-enum field paths with visual rule builder** — flexible but safe

---

## Decision

Implement ABAC visual editor with **closed-enum field paths**:

- **Allowed field paths** (hardcoded in schema, validated at edit-time):
  - Subject attributes: `subject.role`, `subject.branch`, `subject.tenant_id`
  - Resource attributes: `resource.doc_type`, `resource.risk_band`, `resource.customer_id`
  - Context: `context.time_of_day`, `context.stepup_valid`, `context.is_after_hours`
  - (Other paths are REJECTED at schema validation)
- **Rule builder UI** (AbacPanel in Wave B):
  - Visual form: select effect (allow/deny), priority (int), resource, actions (array), then N conditions
  - Each condition: closed-enum field + closed-enum operator (eq / gt / gte / lt / lte / in / neq) + value
  - No free-text Rego; no typo'd field names
- **JSON-to-Rego compiler** (`scripts/abac-compile.js`):
  - Reads rules array from tenant_config.abac namespace
  - Compiles to dms.rego, rules sorted by priority descending
  - Atomic file write: `writeFileSync + renameSync`
  - Non-fatal failure: if compile() throws, dms.rego untouched, OPA never contacted
- **OPA push** (HTTP-driven):
  - `PUT {OPA_URL}/v1/policies/dms_authz` with Rego body
  - Fire-and-forget with 3s timeout
  - Compile result includes `opa_push_status: "ok" | "timeout" | "error"`
- **Test-policy panel**:
  - Admins can test a rule before deploying
  - Proxies to Python's `POST /api/v1/abac/check` with test context
  - Returns decision trace (which rule matched, why)

---

## Consequences

### Positive

- **Defense in depth** — closed-enum paths prevent silent allow=false from typo'd field names
- **Admin-friendly** — no Rego syntax knowledge required; visual builder is accessible
- **Audit trail** — all rule changes stored in tenant_config_history (hash-chained)
- **Non-fatal OPA errors** — if OPA is down, dms.rego is unchanged; allows graceful degradation
- **Test panel** — admins can validate rules before deploying to production

### Negative

- **Limited expressiveness** — no complex Rego logic (e.g., regex patterns, custom functions)
- **Maintenance burden** — closed enum must be updated as new attributes are introduced
- **Rego abstraction leak** — if rules get complex, admins eventually ask for raw Rego access

### Risk

- **OPA push failure** — rule compiles correctly but OPA doesn't accept it (e.g., Rego syntax error)
  - Mitigated by test panel; compile step validates before pushing

---

## Alternatives Considered

1. **Free-form Rego UI** — rejected (typos are silent, hard to catch; not admin-friendly)
2. **Constraint-based builder only** — rejected (too rigid; ABAC rules need expressive power)
3. **No UI, hand-edit dms.rego** — rejected (what we had; not sustainable, no audit trail)

---

## Related

- [Commit 9bbae4a (Wave B ABAC editor)](../../CHANGELOG.md#unreleased--commit-9bbae4a--2026-05-10)
- [PLATFORM_CONFIG.md § abac](../PLATFORM_CONFIG.md#16-abac)
- Compiler: `scripts/abac-compile.js`
- UI: `apps/web/src/modules/admin/settings/panels/AbacPanel.tsx`
- Services: `python-service/app/services/abac.py`
- OPA policy: `opa/policies/dms.rego`
