import type { Knex } from "knex";

/**
 * P3: Capture→Workflow handoff.
 *
 * When /documents/:id/extract flags a document for review (low quality /
 * confidence, mandatory fields missing, or unknown/new type), core creates a
 * maker-checker workflow case in the WORKFLOW service over HTTP and records the
 * returned workflow id on the document so the UI can deep-link to the review.
 */
export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn("documents", "workflow_id");
  if (!has) {
    await knex.schema.alterTable("documents", (t) => {
      t.string("workflow_id", 36);
      t.index(["workflow_id"]);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn("documents", "workflow_id");
  if (has) {
    await knex.schema.alterTable("documents", (t) => {
      t.dropColumn("workflow_id");
    });
  }
}
