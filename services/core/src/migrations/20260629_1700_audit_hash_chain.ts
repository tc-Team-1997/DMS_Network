import type { Knex } from "knex";

/**
 * Migration: persist a tamper-evident hash chain on audit_log.
 *
 * Previously verifyAuditChain() only *recomputed* a running hash over the ordered
 * rows — it never stored or compared anything, so tampering went undetected. This
 * adds two columns written at insert time (via writeAudit):
 *   - prev_hash: the row_hash of the immediately preceding audit row ("" for the first)
 *   - row_hash : sha256(prev_hash + "|" + canonical(row))
 * verifyAuditChain() now recomputes each expected hash and compares it to the
 * stored row_hash, reporting the first mismatch. Idempotent + nullable so any
 * pre-existing rows remain valid (they're skipped by the comparison).
 */
export async function up(knex: Knex): Promise<void> {
  const hasPrev = await knex.schema.hasColumn("audit_log", "prev_hash");
  if (!hasPrev) {
    await knex.schema.alterTable("audit_log", (t) => {
      t.string("prev_hash", 64);
    });
  }
  const hasRow = await knex.schema.hasColumn("audit_log", "row_hash");
  if (!hasRow) {
    await knex.schema.alterTable("audit_log", (t) => {
      t.string("row_hash", 64);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasRow = await knex.schema.hasColumn("audit_log", "row_hash");
  if (hasRow) await knex.schema.alterTable("audit_log", (t) => t.dropColumn("row_hash"));
  const hasPrev = await knex.schema.hasColumn("audit_log", "prev_hash");
  if (hasPrev) await knex.schema.alterTable("audit_log", (t) => t.dropColumn("prev_hash"));
}
