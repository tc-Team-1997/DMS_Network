# ADR 0003 — WORM Retention Lock Strategy

**Date:** 2026-05-09  
**Status:** Accepted  
**Date accepted:** 2026-05-09  
**Deciders:** Python Engineer, DB Migrator, Security Team  
**Related:** `docs/contracts/worm-retention-lock.md` (BHU-32)

---

## Context

The National Bank of Egypt and Bhutan regulatory frameworks (Bhutan F#32, bidding §74) mandate that documents placed under legal hold or retention cannot be modified or deleted until the hold expires. Application-layer access controls alone are insufficient—an admin or attacker with filesystem access can unlink or truncate files directly. This violates auditability and compliance requirements.

Current state: documents stored in `STORAGE_DIR` with no OS-level protection. Retention policies exist but are not enforced at the filesystem boundary.

---

## Decision

We implement OS-level immutable flags (`chflags uchg` on macOS, `chattr +i` on Linux) applied at lock time, combined with:

1. **Immutable flag application** — When a document is committed to retention, the file in `STORAGE_DIR/<sha256>` is immediately marked immutable by the OS.
2. **SHA-256 baseline verification** — At lock time, the file's SHA-256 hash is recorded as `sha256_at_lock`. Nightly cron recomputes the hash and compares.
3. **Nightly verification scan** — A background job iterates all locked documents (indexed by `worm_locked_at IS NOT NULL`), checking:
   - OS immutable flag still set via `lstat` / `stat`
   - Current SHA-256 matches baseline
   - If either check fails, alert critical + log to audit_log
4. **Unlock enforcement** — Only explicit unlock (via API with reason recorded) removes the immutable flag and clears `worm_locked_at`. Automated unlock on policy expiry also removes the flag.

**Alternatives considered:**

- **App-layer access control only** — Rejected. Can be bypassed by filesystem access or privilege escalation.
- **S3 Object Lock** — Rejected. Violates local-first deployment mandate; adds cloud dependency.
- **Write-only NFS mount** — Rejected. Operational complexity, single point of failure.
- **Hardware write-protect** — Out of scope; requires infrastructure investment beyond software mandate.

---

## Consequences

### Positive
- **OS-enforced immutability** — Even `root` cannot delete or modify a file with immutable flag set without explicitly removing it first (logged operation).
- **Audit trail completeness** — Every lock and unlock is recorded in audit_log with reason and approver context.
- **Regulatory attestation** — Auditors can verify: "Documents under retention were locked on disk at [date], verified daily, unlocked only on [date] with reason [X]."
- **Zero false positives** — Hash drift immediately surfaces tampering; no ambiguity.

### Operating Costs
- **Requires sudo/root on production** — Lock/unlock operations need elevated privileges to set OS flags.
- **Windows out of scope** — NTFS ADS and Windows immutability APIs not implemented; Linux + macOS only in v1.
- **Verification scan budget** — 10,000 documents × ~200ms (lstat + SHA-256) = 30-minute SLA required nightly. Requires parallel scanning or background workers.
- **Legal-hold unlock requires explicit approval** — Cannot auto-unlock; must be manual with recorded reason.

### Limitations (v1)
- **Soft-delete aware** — WORM locks persist even if document is soft-deleted. Hard-delete blocked until flag removed.
- **No encrypted locks** — Immutable flag does not encrypt the file; AES-256 storage layer is complementary.
- **Timezone handling** — `worm_unlock_after` must account for tenant timezone; cron job uses UTC (potential off-by-one edge case if tenant straddles date line).

---

## Status

**Accepted** (2026-05-09). Implementation shipped: OS immutable flags, SHA-256 verification, nightly cron, audit trail for unlock operations.

---

## Related Decisions

- **ADR 0005 (Biometric data handling)** — Tenant isolation patterns for sensitive PII apply equally to retention metadata.
- **Engineering Principles § Commandment 1** — Tenant boundaries enforced on all worm_* queries.
- **Security Threat Model** — This ADR closes the "document tampering under retention" threat; residual risk is OS-level compromise (root privilege required).
