# ADR-0014: Unified Workflow Audit Trail — Two-Phase Commit Model

**Date**: 2026-05-10
**Status**: Accepted (Wave C SOX-2 closure)
**Deciders**: Security, Architecture, Engineering
**Supersedes**: The interim bifurcated model described in ADR-0013 §Known Issues

---

## Context

When a workflow is advanced (approve / reject / escalate), two parallel write paths existed:

1. **Node `wf_actions` table** — SOX audit trail: reason_code, comment, actor, webauthn_assertion_id, tenant_id, attachment_id.
2. **Python `workflow_steps` table** — operational state machine journal: stage, actor, action, comment.

These were written independently: Node wrote `wf_actions` first, then optionally called Python. If either side crashed mid-flight, the two tables would diverge. A regulator auditing a workflow decision would find evidence in two disconnected stores with no guaranteed cross-reference.

This was documented as SOX-2 (see docs/SECURITY_COMPLIANCE.md §18) and carried forward from Wave A.

---

## Decision

Promote Python as the **canonical first write** and establish a strict two-phase commit protocol:

```
Client Request
     │
     ▼
Node Route Handler
     │
     ├─ 1. [Optional] SOX-1: verify assertion via POST /py/api/v1/stepup/verify
     │       Reject with 401 step_up_invalid if verification fails.
     │
     ├─ 2. Call Python POST /api/v1/workflow/{doc_id}/advance
     │       Python atomically:
     │         a. Inserts WorkflowStep (stage, actor, action, comment,
     │            reason_code, assertion_id)
     │         b. Updates Document.status
     │         c. Emits workflow.advance event
     │         d. Records provenance event
     │         e. Returns {step_id, ...}
     │       If Python fails → Node returns 502 and writes NOTHING.
     │
     └─ 3. On Python success: Node commits wf_actions within a SQLite transaction
               - workflow_id, user_id, action, reason_code, comment,
                 webauthn_assertion_id, attachment_id, tenant_id
               - python_step_id = step_id returned from Python  ← cross-reference FK
           If Node TX fails → surface 500. Python row exists without a Node FK.
           Recovery: Node reconciler can query orphaned python_step_ids.
```

### New column: `wf_actions.python_step_id`

Added in Node `db/schema.sql` migration 0032. Integer, nullable. `NULL` means the row was written by the pre-Wave-C path (acceptable for historical data). Non-null means the row is cross-referenced to `workflow_steps.id` in the Python DB.

### New columns: `workflow_steps.reason_code`, `workflow_steps.assertion_id`

Added in Python Alembic migration `0044_workflow_audit_unification`. These columns bring the Python operational log up to SOX audit quality — a regulator can read a single `workflow_steps` row and see the full context of the decision.

---

## Consequences

### Positive

- **Single source of truth per decision**: Python `workflow_steps` is always written first. If it exists, the decision happened. Node `wf_actions` provides the Node-side SOX audit trail with `python_step_id` as the durable cross-reference.
- **No silent drift**: If Python is unreachable, Node returns 502 immediately — no partial write, no orphaned wf_actions row without a corresponding Python step.
- **Auditor experience**: A single JOIN between `wf_actions.python_step_id` and `workflow_steps.id` (across DBs, or via a read replica) gives the complete SOX audit trace.
- **Forward-compatible**: `python_step_id` is the hook for a future Temporal/Zeebe event-sourcing migration — the Temporal workflow run ID would replace it.

### Negative

- **Python is now on the critical path for every workflow action.** If Python is down, all workflow approvals fail with 502. This is an acceptable trade-off: previously Python being down silently left an incomplete audit trail, which is worse.
- **Extra network round-trip** per action (~5–15ms for a local Python call). Acceptable given workflow actions are human-initiated.
- **Asymmetric failure mode**: If Python succeeds but Node crashes between steps 2 and 3, Python has a `workflow_steps` row with no `wf_actions` counterpart. This is the recoverable direction — a reconciler job can detect `python_step_ids` with no matching `wf_actions` row and alert ops. Implementing the reconciler is deferred to Wave D (low probability event: SQLite crash in the Node process).

---

## Alternatives Considered

### A. Temporal / Camunda Zeebe event sourcing

Mentioned in the original SOX-2 debt comment. Collapses both stores into a single durable workflow log. Rejected for Wave C: 3–6 month infrastructure investment; out of scope for a SOX closure sprint. This ADR leaves the `python_step_id` column as a migration hook so this path remains open.

### B. Prepared-row-with-FK-update (two-phase on Node side only)

Node inserts a `wf_actions` row with `committed=0`, calls Python, then flips `committed=1`. Rejected: SQLite does not expose row-level locks across connections; "uncommitted" rows are invisible to other readers until committed, making the pattern equivalent to calling Python first anyway — but with more code and no Python cross-reference.

### C. Message queue (Kafka/SQS) between Node and Python

Eventual consistency via events. Rejected: introduces lag in the audit trail (regulator sees a gap between action time and audit write time), and adds infrastructure complexity. The synchronous two-phase approach is simpler and provides immediate consistency.

---

## Related

- [ADR-0013 Step-Up Enforcement Server-Side REJECTION Contract](0013-stepup-enforcement-contract.md) — SOX-1
- [docs/SECURITY_COMPLIANCE.md §18](../SECURITY_COMPLIANCE.md#18-carried-forward-sox-control-gaps-wave-c)
- Migration `0043_stepup_validation` — replay prevention table
- Migration `0044_workflow_audit_unification` — workflow_steps SOX columns
- Node schema migration 0032 — `wf_actions.python_step_id`
- `python-service/app/routers/workflow.py` — `/advance` endpoint
- `python-service/app/routers/stepup.py` — `/verify` endpoint
- `python-service/app/services/stepup/verify.py` — verification logic
- `services/stepup-verify.js` — Node proxy helper
- `routes/spa-api/workflows.js` — Node two-phase commit consumer
