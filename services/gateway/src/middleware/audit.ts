import type { Knex } from "knex";

export interface AuditEntry {
  actor_id?: number; actor_username?: string; action: string;
  entity?: string; entity_id?: string; details?: string;
}

export async function writeAudit(knex: Knex, e: AuditEntry): Promise<void> {
  await knex("audit_log").insert(e);
}
