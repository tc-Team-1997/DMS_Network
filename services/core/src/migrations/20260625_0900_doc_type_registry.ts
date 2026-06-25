import type { Knex } from "knex";

/**
 * Migration: doc_type_registry table + extraction_status column on documents
 *
 * doc_type_registry — seeded with all known IDP types; can be extended at runtime
 * documents.extraction_status — tracks AI extraction pipeline state
 */
export async function up(knex: Knex): Promise<void> {
  // ── doc_type_registry ──────────────────────────────────────────────────────
  await knex.schema.createTable("doc_type_registry", (t) => {
    t.string("id", 36).notNullable().primary();
    t.string("code", 80).notNullable().unique();
    t.string("description", 255).notNullable();
    t.string("jurisdiction", 20).notNullable().defaultTo("ANY");
    t.string("issuer", 120).notNullable().defaultTo("Unknown");
    t.string("category", 80);          // catalog category hint
    t.boolean("system").notNullable().defaultTo(true);  // false = user-created
    // Per-type metadata field schemas — JSON arrays of field-objects { name, type?, mandatory }
    // Stored (not derived) so they are admin-editable; seeded from the derived maps.
    t.text("mandatory_fields");        // JSON array of field-objects
    t.text("optional_fields");         // JSON array of field-objects
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.timestamp("updated_at");
  });

  // ── extraction_status on documents ─────────────────────────────────────────
  const hasExtrStatus = await knex.schema.hasColumn("documents", "extraction_status");
  if (!hasExtrStatus) {
    await knex.schema.alterTable("documents", (t) => {
      // PENDING | RUNNING | DONE | FAILED | SKIPPED
      t.string("extraction_status", 20).defaultTo("PENDING");
      t.timestamp("extracted_at");
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("doc_type_registry");
}
