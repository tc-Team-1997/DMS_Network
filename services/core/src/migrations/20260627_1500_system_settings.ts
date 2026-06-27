import type { Knex } from "knex";

/**
 * Migration: system_settings — a generic key/value store for admin-editable,
 * dynamic platform configuration (retention defaults, branch list, AI
 * thresholds, …). Values are JSON. This lets operators tune the system from the
 * Administration screen instead of editing code/env. Idempotent.
 */
export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable("system_settings");
  if (!exists) {
    await knex.schema.createTable("system_settings", (t) => {
      t.string("key", 120).notNullable().primary();
      t.text("value").notNullable().defaultTo("{}"); // JSON
      t.string("updated_by", 100);
      t.timestamp("updated_at").defaultTo(knex.fn.now());
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("system_settings");
}
