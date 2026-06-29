import type { Knex } from "knex";
import { newId } from "@zordms/db";
import { chainHash } from "./compliance.js";

export interface AuditEntry {
  actorId?: string | null;
  actorUsername?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  details?: string | null;
}

/**
 * Append a tamper-evident row to audit_log.
 *
 * Reads the most recent row's row_hash, computes
 * row_hash = sha256(prev_hash + "|" + canonical(row)), and stores both — so
 * verifyAuditChain() can recompute and compare to detect any later edit/delete.
 *
 * Accepts a Knex or a transaction; within a transaction the "previous" row
 * reflects earlier inserts in the same transaction, keeping the chain contiguous.
 */
export async function writeAudit(knex: Knex, entry: AuditEntry): Promise<void> {
  const last = await knex("audit_log")
    .select("row_hash")
    .orderBy([{ column: "created_at", order: "desc" }, { column: "id", order: "desc" }])
    .first();
  const prevHash = (last?.row_hash as string | undefined) ?? "";

  const row: Record<string, unknown> = {
    actor_id: entry.actorId ?? null,
    actor_username: entry.actorUsername ?? null,
    action: entry.action,
    entity: entry.entity ?? null,
    entity_id: entry.entityId ?? null,
    details: entry.details ?? null,
  };

  await knex("audit_log").insert({
    id: newId(),
    ...row,
    prev_hash: prevHash,
    row_hash: chainHash(prevHash, row),
  });
}
