import type { Knex } from "knex";
import { newId } from "@zordms/db";

/**
 * Migration: dedup_config table
 *
 * Stores a single-row persisted configuration for duplicate detection behaviour.
 * Idempotent — safe to run multiple times.
 */
export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable("dedup_config");
  if (!exists) {
    await knex.schema.createTable("dedup_config", (t) => {
      t.string("id", 36).notNullable().primary();
      t.boolean("enabled").notNullable().defaultTo(true);
      // JSON array of match strategies: ["hash","cid","doc_no"]
      t.text("match_by").notNullable().defaultTo('["hash","cid"]');
      // "flag" | "auto_version"
      t.string("action", 20).notNullable().defaultTo("flag");
      // 0-1 fuzzy threshold (reserved for future fuzzy matching)
      t.float("fuzzy_threshold").notNullable().defaultTo(1.0);
      t.timestamp("updated_at").defaultTo(knex.fn.now());
    });

    // Seed the single default row
    await knex("dedup_config").insert({
      id: newId(),
      enabled: true,
      match_by: JSON.stringify(["hash", "cid"]),
      action: "flag",
      fuzzy_threshold: 1.0,
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("dedup_config");
}
