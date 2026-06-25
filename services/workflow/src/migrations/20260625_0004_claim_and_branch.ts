import type { Knex } from "knex";

/**
 * P3: Unify the review queue on the WORKFLOW service.
 *
 *  - workflow_steps gains claimed_by / claimed_at so a Pending step can be
 *    claimed by a maker/checker before they /act on it.
 *  - workflows gains a `branch` column so the cross-status review queue can be
 *    branch-scoped (the Capture→Workflow handoff forwards the document branch).
 */
export async function up(knex: Knex): Promise<void> {
  const hasClaimedBy = await knex.schema.hasColumn("workflow_steps", "claimed_by");
  if (!hasClaimedBy) {
    await knex.schema.alterTable("workflow_steps", (t) => {
      t.string("claimed_by", 100);
      t.timestamp("claimed_at");
    });
  }

  const hasBranch = await knex.schema.hasColumn("workflows", "branch");
  if (!hasBranch) {
    await knex.schema.alterTable("workflows", (t) => {
      t.string("branch", 120);
      t.index(["branch"]);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasClaimedBy = await knex.schema.hasColumn("workflow_steps", "claimed_by");
  if (hasClaimedBy) {
    await knex.schema.alterTable("workflow_steps", (t) => {
      t.dropColumn("claimed_by");
      t.dropColumn("claimed_at");
    });
  }
  const hasBranch = await knex.schema.hasColumn("workflows", "branch");
  if (hasBranch) {
    await knex.schema.alterTable("workflows", (t) => {
      t.dropColumn("branch");
    });
  }
}
