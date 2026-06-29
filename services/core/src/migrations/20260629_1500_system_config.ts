import type { Knex } from "knex";
import { newId } from "@zordms/db";

/**
 * Migration: system_config table (§4.13 Config module).
 *
 * A small, audited key/value store for runtime-tunable settings — AI thresholds,
 * upload limits, allowed formats — so operators can adjust them without a redeploy
 * (previously these lived only in env vars). `value` holds a JSON-encoded payload
 * so a config entry can be a number, boolean, string, array or object.
 *
 * Idempotent — safe to run multiple times. Defaults are seeded only on first run.
 */
const DEFAULTS: Array<{ key: string; value: unknown; category: string; description: string }> = [
  { key: "ai.classification_threshold", value: 0.92, category: "ai", description: "Min confidence to auto-accept a classified doc type." },
  { key: "ai.extraction_min_confidence", value: 0.7, category: "ai", description: "Min confidence below which extraction routes to human review." },
  { key: "upload.max_file_mb", value: 50, category: "upload", description: "Maximum single-file upload size in megabytes." },
  { key: "upload.allowed_formats", value: ["pdf", "png", "jpg", "jpeg", "tiff"], category: "upload", description: "Permitted upload file extensions." },
];

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable("system_config");
  if (!exists) {
    await knex.schema.createTable("system_config", (t) => {
      t.string("id", 36).notNullable().primary();
      t.string("key", 120).notNullable().unique();
      // JSON-encoded value (number/boolean/string/array/object).
      t.text("value").notNullable();
      t.string("category", 60);
      t.text("description");
      t.string("updated_by", 100);
      t.timestamp("updated_at").defaultTo(knex.fn.now());
    });

    for (const d of DEFAULTS) {
      await knex("system_config").insert({
        id: newId(),
        key: d.key,
        value: JSON.stringify(d.value),
        category: d.category,
        description: d.description,
        updated_by: "system",
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("system_config");
}
