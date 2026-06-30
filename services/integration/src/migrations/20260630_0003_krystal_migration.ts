import type { Knex } from "knex";

/**
 * Migration: migration_jobs + migration_records (§6.15 Krystal legacy migration).
 *
 * A source-format-agnostic ETL staging framework. The legacy export format and
 * file transport are Krystal-specific and still unconfirmed (blueprint §9.6), so
 * the actual format lives behind a pluggable SourceAdapter; this layer tracks
 * jobs + per-record outcomes (idempotent by external_id), supports dry-run, and
 * stages mapped records for import into core. Idempotent.
 */
export async function up(knex: Knex): Promise<void> {
  const hasJobs = await knex.schema.hasTable("migration_jobs");
  if (!hasJobs) {
    await knex.schema.createTable("migration_jobs", (t) => {
      t.string("id", 36).notNullable().primary();
      t.string("source", 60).notNullable().defaultTo("krystal");
      t.string("status", 20).notNullable().defaultTo("running"); // running | completed | failed
      t.integer("total").notNullable().defaultTo(0);
      t.integer("staged").notNullable().defaultTo(0);
      t.integer("skipped").notNullable().defaultTo(0);
      t.integer("failed").notNullable().defaultTo(0);
      t.boolean("dry_run").notNullable().defaultTo(false);
      t.timestamp("started_at").defaultTo(knex.fn.now());
      t.timestamp("finished_at");
    });
  }

  const hasRecords = await knex.schema.hasTable("migration_records");
  if (!hasRecords) {
    await knex.schema.createTable("migration_records", (t) => {
      t.string("id", 36).notNullable().primary();
      t.string("job_id", 36).notNullable().index();
      t.string("external_id", 200).notNullable().index();
      // previewed (dry-run) | staged (mapped, ready for core import) | skipped | failed
      t.string("status", 20).notNullable();
      t.string("mapped_doc_id", 36);
      t.text("error");
      t.timestamp("created_at").defaultTo(knex.fn.now());
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("migration_records");
  await knex.schema.dropTableIfExists("migration_jobs");
}
