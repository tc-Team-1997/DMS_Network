import type { Knex } from "knex";
import { createHash } from "node:crypto";
import type { FrameworkRow, ComplianceScorecard, ChainVerification } from "@zordms/types";

export const REGULATORY_MATRIX: FrameworkRow[] = [
  { framework: "RMA Prudential", control: "Record retention schedule enforced", status: "Met", evidence: "retention_policies" },
  { framework: "RMA Prudential", control: "Customer KYC completeness monitored", status: "Met", evidence: "customer360" },
  { framework: "RAA Audit", control: "Tamper-evident audit trail", status: "Met", evidence: "audit_log hash-chain" },
  { framework: "RAA Audit", control: "Privileged-action logging", status: "Met", evidence: "writeAudit" },
  { framework: "FATF / AML", control: "Restricted ACL on AML documents", status: "Partial", evidence: "folder ACL" },
  { framework: "FATF / AML", control: "Suspicious-activity report capture", status: "Met", evidence: "SAR catalog" },
  { framework: "ISO 27001", control: "Encryption at rest (AES-256)", status: "Met", evidence: "object store" },
  { framework: "ISO 27001", control: "Disaster-recovery RPO/RTO tested", status: "Partial", evidence: "DR posture" },
  { framework: "ISO 27001", control: "Access governed solely by RBAC", status: "Met", evidence: "@zordms/auth" },
];

export function complianceScorecard(matrix: FrameworkRow[]): ComplianceScorecard {
  const byFramework = new Map<string, { met: number; total: number }>();
  for (const row of matrix) {
    const agg = byFramework.get(row.framework) ?? { met: 0, total: 0 };
    agg.total += 1;
    if (row.status === "Met") agg.met += 1;
    byFramework.set(row.framework, agg);
  }
  const frameworks = [...byFramework.entries()].map(([framework, v]) => ({ framework, met: v.met, total: v.total }));
  const totalMet = frameworks.reduce((s, f) => s + f.met, 0);
  const total = frameworks.reduce((s, f) => s + f.total, 0);
  const score = total === 0 ? 0 : Math.round((totalMet / total) * 100);
  return { score, frameworks };
}

export interface AuditQuery { action?: string; entity?: string; actor?: string; limit?: number; }

export async function queryAuditTrail(knex: Knex, q: AuditQuery): Promise<any[]> {
  let builder = knex("audit_log").select("*").orderBy("id", "desc").limit(q.limit ?? 100);
  if (q.action) builder = builder.where({ action: q.action });
  if (q.entity) builder = builder.where({ entity: q.entity });
  if (q.actor) builder = builder.where({ actor_username: q.actor });
  return builder;
}

/** Canonical string form of an audit row — the bytes hashed into the chain. */
export function canonicalAuditRow(row: Record<string, unknown>): string {
  return [row.actor_username ?? "", row.action ?? "", row.entity ?? "", row.entity_id ?? "", row.details ?? ""].join("|");
}

/** sha256(prev_hash + "|" + canonical(row)) — the chained hash stored on each row. */
export function chainHash(prevHash: string, row: Record<string, unknown>): string {
  return createHash("sha256").update(prevHash + "|" + canonicalAuditRow(row)).digest("hex");
}

export async function verifyAuditChain(knex: Knex): Promise<ChainVerification> {
  // Deterministic order: created_at then id (UUIDv7 — time-ordered, unique tiebreak).
  const rows = await knex("audit_log").select("*").orderBy([{ column: "created_at" }, { column: "id" }]);
  let prev = "";
  let brokenAt: number | null = null;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].id == null) { brokenAt = i; break; }
    const expected = chainHash(prev, rows[i]);
    // Rows written via writeAudit carry a stored row_hash — compare to detect
    // tampering. Legacy rows without a stored hash are tolerated (chain advances
    // on the recomputed value) so the trail stays verifiable across the upgrade.
    const stored = rows[i].row_hash as string | null | undefined;
    if (stored != null && stored !== expected) { brokenAt = i; break; }
    prev = stored ?? expected;
  }
  return { ok: brokenAt === null, checked: rows.length, brokenAt };
}
