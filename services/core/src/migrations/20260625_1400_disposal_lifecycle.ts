import type { Knex } from "knex";

/**
 * P9: Records lifecycle / compliance.
 *
 * Adds a `disposal_status` marker on documents so the scheduled disposal-scan
 * job can flag records whose retention has lapsed (destruction_date <= now) and
 * that are NOT under an active legal hold as ELIGIBLE for disposal — WITHOUT
 * hard-deleting anything. A human must still explicitly certify disposal.
 *
 * Values:
 *   null        — not yet evaluated / still within retention
 *   "Eligible"  — over-retention + hold-free; awaiting human certification
 *   "Disposed"  — certified + disposed (terminal)
 */
export async function up(knex: Knex): Promise<void> {
  const hasCol = await knex.schema.hasColumn("documents", "disposal_status");
  if (!hasCol) {
    await knex.schema.alterTable("documents", (t) => {
      t.string("disposal_status", 20);
      t.timestamp("disposal_eligible_at");
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasCol = await knex.schema.hasColumn("documents", "disposal_status");
  if (hasCol) {
    await knex.schema.alterTable("documents", (t) => {
      t.dropColumn("disposal_status");
      t.dropColumn("disposal_eligible_at");
    });
  }
}
