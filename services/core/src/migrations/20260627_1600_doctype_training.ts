import type { Knex } from "knex";

/**
 * Migration: doc-type "training" columns + document AI summary (Group C).
 *
 * doc_type_registry gains admin-curated, per-type intelligence:
 *   - prompt_classify / prompt_extract : optional prompts the AI uses for this
 *     type (falls back to the model default when null).
 *   - folder_path_template            : e.g. "/BoB/Customers/{cid}/KYC/{year}/"
 *     — {tokens} are substituted from extracted fields at capture time.
 *   - sample_doc_storage_key          : a saved sample document the admin can
 *     re-infer fields from.
 * documents gains a `summary` column for the AI-generated plain-language summary
 * surfaced in indexing / discovery. All idempotent.
 */
export async function up(knex: Knex): Promise<void> {
  const addCol = async (table: string, col: string, build: (t: Knex.CreateTableBuilder) => void) => {
    if (!(await knex.schema.hasColumn(table, col))) {
      await knex.schema.alterTable(table, (t) => build(t));
    }
  };

  await addCol("doc_type_registry", "prompt_classify", (t) => t.text("prompt_classify"));
  await addCol("doc_type_registry", "prompt_extract", (t) => t.text("prompt_extract"));
  await addCol("doc_type_registry", "folder_path_template", (t) => t.string("folder_path_template", 500));
  await addCol("doc_type_registry", "sample_doc_storage_key", (t) => t.string("sample_doc_storage_key", 255));
  await addCol("documents", "summary", (t) => t.text("summary"));
}

export async function down(knex: Knex): Promise<void> {
  const dropCol = async (table: string, col: string) => {
    if (await knex.schema.hasColumn(table, col)) {
      await knex.schema.alterTable(table, (t) => t.dropColumn(col));
    }
  };
  await dropCol("doc_type_registry", "prompt_classify");
  await dropCol("doc_type_registry", "prompt_extract");
  await dropCol("doc_type_registry", "folder_path_template");
  await dropCol("doc_type_registry", "sample_doc_storage_key");
  await dropCol("documents", "summary");
}
