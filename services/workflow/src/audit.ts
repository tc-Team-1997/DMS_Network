import type { Knex } from "knex";
import { newId } from "@zordms/db";

export interface AuditEntry {
  actor_id?: string;
  actor_username?: string;
  action: string;
  entity?: string;
  entity_id?: string;
  details?: string;
}

export async function writeAudit(knex: Knex, e: AuditEntry): Promise<void> {
  await knex("workflow_audit").insert({ id: newId(), ...e });
}
