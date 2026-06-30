import type { Knex } from "knex";

/**
 * Migration: dashboard_layouts (SC-01) — per-user saved dashboard configuration
 * (chart data-source/type choices, layout). One row per user. Idempotent.
 */
export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable("dashboard_layouts");
  if (!exists) {
    await knex.schema.createTable("dashboard_layouts", (t) => {
      t.string("user_id", 36).notNullable().primary();
      t.text("config_json").notNullable().defaultTo("{}");
      t.timestamp("updated_at").defaultTo(knex.fn.now());
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("dashboard_layouts");
}
