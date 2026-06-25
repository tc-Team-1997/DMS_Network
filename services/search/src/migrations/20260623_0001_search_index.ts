import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("search_index", (t) => {
    t.string("id", 36).notNullable().primary();
    t.string("doc_id", 120).notNullable().unique();
    t.text("ocr_text");
    t.text("metadata_text");
    t.string("doc_type", 120).notNullable();
    t.string("branch", 120).notNullable();
    t.string("status", 40).notNullable();
    t.string("risk_band", 20).notNullable().defaultTo("low");
    t.boolean("legal_hold").notNullable().defaultTo(false);
    t.string("expiry_status", 20).notNullable().defaultTo("none");
    t.string("uploaded_by", 120);
    t.text("tokens");
    t.timestamp("indexed_at").defaultTo(knex.fn.now());
    t.index(["doc_type"], "idx_search_doc_type");
    t.index(["branch"], "idx_search_branch");
    t.index(["status"], "idx_search_status");
  });

  await knex.schema.createTable("saved_searches", (t) => {
    t.string("id", 36).notNullable().primary();
    t.string("user_id", 36).notNullable();
    t.string("name", 200).notNullable();
    t.text("query_json").notNullable();
    t.string("visibility", 20).notNullable().defaultTo("private");
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.index(["user_id"], "idx_saved_user");
  });

  // Postgres-only FTS acceleration; skipped on sqlite/oracle.
  if ((knex as any).client?.config?.client === "pg") {
    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_search_tsv ON search_index USING GIN (to_tsvector('simple', coalesce(tokens, '')))"
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("saved_searches");
  await knex.schema.dropTableIfExists("search_index");
}
