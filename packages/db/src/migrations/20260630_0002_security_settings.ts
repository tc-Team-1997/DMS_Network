import type { Knex } from "knex";
import { newId } from "../id.js";

/**
 * Migration: security_settings (§4.12 Admin → Security).
 *
 * A single-row, audited security-policy config managed by the gateway (the auth
 * authority): password policy, MFA enforcement, session timeout, and login
 * lockout. Lives in the gateway's DB (packages/db migrations). Idempotent.
 */
export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable("security_settings");
  if (!exists) {
    await knex.schema.createTable("security_settings", (t) => {
      t.string("id", 36).notNullable().primary();
      t.integer("password_min_length").notNullable().defaultTo(8);
      t.boolean("password_require_complexity").notNullable().defaultTo(true);
      t.boolean("mfa_required").notNullable().defaultTo(false);
      t.integer("session_timeout_minutes").notNullable().defaultTo(30);
      t.integer("max_failed_logins").notNullable().defaultTo(5);
      t.integer("lockout_duration_minutes").notNullable().defaultTo(15);
      t.string("updated_by", 100);
      t.timestamp("updated_at").defaultTo(knex.fn.now());
    });

    await knex("security_settings").insert({ id: newId(), updated_by: "system" });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("security_settings");
}
