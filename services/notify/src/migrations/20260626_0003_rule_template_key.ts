import type { Knex } from "knex";

/**
 * Bind an alert rule to an email template (Phase 2). When a rule has a
 * `template_key`, matching alerts render their email through that curated
 * template (formatted HTML + merge tags / document deep-links) instead of the
 * plain decision title. Nullable — null keeps the previous plain-text behaviour.
 */
export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn("alert_rules", "template_key");
  if (has) return;
  await knex.schema.alterTable("alert_rules", (t) => {
    t.string("template_key", 120);
  });
}

export async function down(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn("alert_rules", "template_key");
  if (!has) return;
  await knex.schema.alterTable("alert_rules", (t) => {
    t.dropColumn("template_key");
  });
}
