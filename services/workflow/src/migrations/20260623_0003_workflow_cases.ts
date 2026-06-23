import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("workflow_templates", (t) => {
    t.increments("id").primary();
    t.string("name", 160).notNullable();
    t.string("doc_type", 120);
    t.text("steps_json").notNullable().defaultTo("[]");
    t.boolean("active").notNullable().defaultTo(true);
    t.timestamp("created_at").defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("workflows", (t) => {
    t.increments("id").primary();
    t.string("ref_code", 60).notNullable().unique();
    t.string("title", 240).notNullable();
    t.string("doc_id", 80);
    t.integer("template_id").references("id").inTable("workflow_templates").onDelete("SET NULL");
    t.string("stage", 80).notNullable().defaultTo("intake");
    t.string("priority", 20).notNullable().defaultTo("Normal");
    t.string("status", 20).notNullable().defaultTo("Active");
    t.timestamp("sla_due_at");
    t.string("assigned_to", 100);
    t.string("created_by", 100);
    t.timestamp("created_at").defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("workflow_steps", (t) => {
    t.increments("id").primary();
    t.integer("workflow_id").notNullable().references("id").inTable("workflows").onDelete("CASCADE");
    t.integer("seq").notNullable();
    t.string("name", 160).notNullable();
    t.text("required_permissions").notNullable().defaultTo("[]");
    t.float("min_confidence").notNullable().defaultTo(0.9);
    t.string("status", 20).notNullable().defaultTo("Pending");
    t.integer("actor_id");
    t.timestamp("acted_at");
    t.integer("sla_minutes");
    t.timestamp("due_at");
  });

  await knex.schema.createTable("cases", (t) => {
    t.increments("id").primary();
    t.string("case_ref", 60).notNullable().unique();
    t.string("case_type", 30).notNullable();
    t.string("title", 240).notNullable();
    t.string("status", 20).notNullable().defaultTo("Open");
    t.string("assigned_to", 100);
    t.timestamp("due_at");
    t.integer("workflow_id").references("id").inTable("workflows").onDelete("SET NULL");
    t.string("resolution", 240);
    t.string("created_by", 100);
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.timestamp("resolved_at");
  });

  await knex.schema.createTable("case_documents", (t) => {
    t.increments("id").primary();
    t.integer("case_id").notNullable().references("id").inTable("cases").onDelete("CASCADE");
    t.string("doc_id", 80).notNullable();
    t.string("label", 160);
    t.timestamp("attached_at").defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("workflow_audit", (t) => {
    t.increments("id").primary();
    t.integer("actor_id");
    t.string("actor_username", 100);
    t.string("action", 80).notNullable();
    t.string("entity", 80);
    t.string("entity_id", 80);
    t.text("details");
    t.timestamp("created_at").defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  for (const t of ["workflow_audit", "case_documents", "cases", "workflow_steps", "workflows", "workflow_templates"]) {
    await knex.schema.dropTableIfExists(t);
  }
}
