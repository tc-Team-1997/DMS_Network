import type { Knex } from "knex";

/**
 * email_templates — admin-curated, formatted email bodies with merge tags.
 *
 * Templates are rendered (token substitution + HTML-escaping) at send time and
 * delivered as multipart HTML emails. Merge tags like {{doc.link}} expand to
 * absolute app deep-links (…/viewer?doc=<uuid>) so recipients click back into
 * the system. `key` is a stable slug used to bind a template to a send site.
 */
export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable("email_templates")) return;
  await knex.schema.createTable("email_templates", (t) => {
    t.string("id", 36).notNullable().primary();
    t.string("key", 120).notNullable().unique();      // slug, e.g. "kyc_expiry"
    t.string("name", 160).notNullable();              // human label
    t.string("category", 80);                         // grouping, e.g. "Compliance"
    t.string("description", 400);
    t.text("subject_template").notNullable();         // may contain {{tags}}
    t.text("html_body_template").notNullable();       // HTML with {{tags}}
    t.text("text_body_template");                     // optional plain-text fallback
    t.boolean("enabled").notNullable().defaultTo(true);
    t.string("created_by", 100);
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.timestamp("updated_at").defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("email_templates");
}
