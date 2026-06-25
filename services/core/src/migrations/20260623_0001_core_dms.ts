import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("folders", (t) => {
    t.string("id", 36).notNullable().primary();
    t.string("parent_id", 36).references("id").inTable("folders").onDelete("CASCADE");
    t.string("name", 200).notNullable();
    t.string("path", 1000).notNullable();
    t.string("domain", 80);
    t.string("created_by", 100);
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.unique(["path"]);
    t.index(["parent_id"]);
  });

  await knex.schema.createTable("documents", (t) => {
    t.string("id", 36).notNullable().primary();
    t.string("folder_id", 36).references("id").inTable("folders").onDelete("SET NULL");
    t.string("title", 300).notNullable();
    t.string("original_filename", 300);
    t.string("mime_type", 150);
    t.integer("current_version").notNullable().defaultTo(1);
    t.string("file_hash_sha256", 64).notNullable();
    t.string("source_channel", 30).notNullable().defaultTo("UPLOAD");
    t.string("ingest_user_id", 100);
    t.integer("page_count").notNullable().defaultTo(1);
    t.integer("file_size_bytes").notNullable().defaultTo(0);
    t.string("ocr_engine", 60);
    t.integer("processing_ms");
    t.integer("retention_years");
    t.date("destruction_date");
    t.string("doc_type", 60);
    t.text("metadata");
    t.string("catalog_category", 80);
    t.boolean("review_flag").notNullable().defaultTo(false);
    t.float("confidence");
    t.string("branch", 120);
    t.string("status", 20).notNullable().defaultTo("Active");
    t.timestamp("ingest_timestamp").defaultTo(knex.fn.now());
    t.index(["folder_id"]);
    t.index(["branch"]);
    t.index(["doc_type"]);
  });

  await knex.schema.createTable("document_versions", (t) => {
    t.string("id", 36).notNullable().primary();
    t.string("document_id", 36).notNullable().references("id").inTable("documents").onDelete("CASCADE");
    t.integer("version_no").notNullable();
    t.string("storage_key", 255).notNullable();
    t.string("file_hash_sha256", 64).notNullable();
    t.integer("file_size_bytes").notNullable().defaultTo(0);
    t.string("mime_type", 150);
    t.string("created_by", 100);
    t.string("comment", 500);
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.unique(["document_id", "version_no"]);
    t.index(["document_id"]);
  });

  await knex.schema.createTable("annotations", (t) => {
    t.string("id", 36).notNullable().primary();
    t.string("document_id", 36).notNullable().references("id").inTable("documents").onDelete("CASCADE");
    t.integer("page").notNullable().defaultTo(1);
    t.string("kind", 20).notNullable();
    t.float("x").notNullable().defaultTo(0);
    t.float("y").notNullable().defaultTo(0);
    t.float("width").notNullable().defaultTo(0);
    t.float("height").notNullable().defaultTo(0);
    t.text("content");
    t.string("color", 20);
    t.string("created_by", 100);
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.index(["document_id"]);
  });

  await knex.schema.createTable("folder_acls", (t) => {
    t.string("id", 36).notNullable().primary();
    t.string("folder_id", 36).notNullable().references("id").inTable("folders").onDelete("CASCADE");
    t.string("role", 80).notNullable();
    t.string("access", 20).notNullable();
    t.boolean("inherited").notNullable().defaultTo(false);
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.unique(["folder_id", "role", "access"]);
    t.index(["folder_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  for (const t of ["folder_acls", "annotations", "document_versions", "documents", "folders"]) {
    await knex.schema.dropTableIfExists(t);
  }
}
