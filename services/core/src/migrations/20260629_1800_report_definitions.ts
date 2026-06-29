import type { Knex } from "knex";
import { newId } from "@zordms/db";

/**
 * Migration: report_definitions (§4.10 Reports module).
 *
 * Saved report specs for the report builder: a whitelisted data source plus
 * group-by columns + measures (JSON), runnable on demand or exportable to CSV.
 * Aggregation runs only over core-owned tables (documents / jobs / customers) —
 * cases live in the workflow service's own database (DB-per-service). Idempotent.
 */
const SEED: Array<{ name: string; description: string; source: string; group_by: string[]; measures: unknown[] }> = [
  { name: "Documents by type", description: "Count of documents grouped by doc type.", source: "documents", group_by: ["doc_type"], measures: [{ fn: "count", alias: "count" }] },
  { name: "Documents by branch & status", description: "Document counts per branch and status.", source: "documents", group_by: ["branch", "status"], measures: [{ fn: "count", alias: "count" }] },
];

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable("report_definitions");
  if (!exists) {
    await knex.schema.createTable("report_definitions", (t) => {
      t.string("id", 36).notNullable().primary();
      t.string("name", 200).notNullable();
      t.text("description");
      t.string("source", 40).notNullable();
      t.text("group_by").notNullable().defaultTo("[]"); // JSON array of columns
      t.text("measures").notNullable().defaultTo("[]"); // JSON array of {fn,field,alias}
      t.text("filters").notNullable().defaultTo("{}"); // JSON object of equality filters
      t.string("created_by", 100);
      t.timestamp("created_at").defaultTo(knex.fn.now());
    });

    for (const r of SEED) {
      await knex("report_definitions").insert({
        id: newId(),
        name: r.name,
        description: r.description,
        source: r.source,
        group_by: JSON.stringify(r.group_by),
        measures: JSON.stringify(r.measures),
        filters: "{}",
        created_by: "system",
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("report_definitions");
}
