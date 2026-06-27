import type { Knex } from "knex";

/**
 * gateway_settings — key/value store for admin-managed gateway configuration
 * that must live in the gateway's own DB (e.g. the Active Directory / SSO
 * provider config). Lets operators enable + configure AD from the admin UI
 * without code/env changes. Env vars still take precedence for secrets.
 * Idempotent.
 */
export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable("gateway_settings")) return;
  await knex.schema.createTable("gateway_settings", (t) => {
    t.string("key", 120).notNullable().primary();
    t.text("value").notNullable().defaultTo("{}"); // JSON
    t.string("updated_by", 100);
    t.timestamp("updated_at").defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("gateway_settings");
}
