import type { Knex } from "knex";

/**
 * Enterprise Depth migration — Plan 8
 * - Adds doc_no and cid columns to documents (for Customer 360 linkage)
 * - Creates branches + branch_access tables
 * - Creates retention_policies, legal_holds, disposal_queue tables
 * - Creates versions table alias (document_versions already exists; versions is a read view alias via query)
 */
export async function up(knex: Knex): Promise<void> {
  // Add doc_no and cid to documents if not present
  const hasCid = await knex.schema.hasColumn("documents", "cid");
  if (!hasCid) {
    await knex.schema.alterTable("documents", (t) => {
      t.string("cid", 80);
      t.string("doc_no", 80);
    });
  }

  // Branch network
  await knex.schema.createTable("branches", (t) => {
    t.increments("id").primary();
    t.string("code", 40).notNullable().unique();
    t.string("name", 200).notNullable();
    t.string("region", 120);
    t.string("replication_mode", 30).notNullable().defaultTo("async");
    t.string("status", 20).notNullable().defaultTo("Active");
    t.timestamp("created_at").defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("branch_access", (t) => {
    t.increments("id").primary();
    t.string("source_branch", 40).notNullable();
    t.string("target_branch", 40).notNullable();
    t.string("policy", 10).notNullable().defaultTo("read");
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.unique(["source_branch", "target_branch"]);
  });

  // Records management
  await knex.schema.createTable("retention_policies", (t) => {
    t.increments("id").primary();
    t.string("doc_class", 120).notNullable().unique();
    t.integer("retention_years").notNullable().defaultTo(7);
    t.string("trigger", 60).notNullable().defaultTo("ingest");
    t.string("regulation", 120);
  });

  await knex.schema.createTable("legal_holds", (t) => {
    t.increments("id").primary();
    t.string("ref", 80).notNullable().unique();
    t.string("scope", 200).notNullable();
    t.string("status", 20).notNullable().defaultTo("Active");
    t.integer("doc_count").notNullable().defaultTo(0);
    t.string("placed_by", 100);
    t.timestamp("placed_at").defaultTo(knex.fn.now());
    t.timestamp("released_at");
  });

  await knex.schema.createTable("disposal_queue", (t) => {
    t.increments("id").primary();
    t.integer("document_id").notNullable();
    t.date("destruction_date");
    t.boolean("disposed").notNullable().defaultTo(false);
    t.timestamp("disposed_at");
    t.string("certificate", 120);
  });

  // Versions table (lightweight alias separate from document_versions for lifecycle/test use)
  await knex.schema.createTable("versions", (t) => {
    t.increments("id").primary();
    t.integer("document_id").notNullable();
    t.integer("version_no").notNullable().defaultTo(1);
    t.string("file_hash_sha256", 64).notNullable();
    t.string("created_by", 100);
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.index(["document_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("versions");
  await knex.schema.dropTableIfExists("disposal_queue");
  await knex.schema.dropTableIfExists("legal_holds");
  await knex.schema.dropTableIfExists("retention_policies");
  await knex.schema.dropTableIfExists("branch_access");
  await knex.schema.dropTableIfExists("branches");
}
