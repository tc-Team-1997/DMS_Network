import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Create RBAC tables if they don't exist (for standalone notify service usage)
  if (!(await knex.schema.hasTable("users"))) {
    await knex.schema.createTable("users", (t) => {
      t.string("id", 36).notNullable().primary();
      t.string("username", 100).notNullable().unique();
      t.string("password_hash", 255).notNullable();
      t.string("full_name", 200);
      t.string("email", 200);
      t.string("branch", 120);
      t.string("region", 120);
      t.boolean("mfa_enabled").notNullable().defaultTo(false);
      t.string("mfa_secret", 120);
      t.string("status", 20).notNullable().defaultTo("Active");
      t.string("created_by", 100);
      t.timestamp("created_at").defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable("roles"))) {
    await knex.schema.createTable("roles", (t) => {
      t.string("id", 36).notNullable().primary();
      t.string("name", 80).notNullable().unique();
      t.string("description", 255);
      t.boolean("system").notNullable().defaultTo(false);
    });
  }

  if (!(await knex.schema.hasTable("permissions"))) {
    await knex.schema.createTable("permissions", (t) => {
      t.string("id", 36).notNullable().primary();
      t.string("key", 120).notNullable().unique();
      t.string("description", 255);
    });
  }

  if (!(await knex.schema.hasTable("role_permissions"))) {
    await knex.schema.createTable("role_permissions", (t) => {
      t.string("role_id", 36).notNullable().references("id").inTable("roles").onDelete("CASCADE");
      t.string("permission_id", 36).notNullable().references("id").inTable("permissions").onDelete("CASCADE");
      t.primary(["role_id", "permission_id"]);
    });
  }

  if (!(await knex.schema.hasTable("user_roles"))) {
    await knex.schema.createTable("user_roles", (t) => {
      t.string("user_id", 36).notNullable().references("id").inTable("users").onDelete("CASCADE");
      t.string("role_id", 36).notNullable().references("id").inTable("roles").onDelete("CASCADE");
      t.primary(["user_id", "role_id"]);
    });
  }

  await knex.schema.createTable("alert_rules", (t) => {
    t.string("id", 36).notNullable().primary();
    t.string("name", 160).notNullable();
    t.string("trigger", 80).notNullable();
    t.text("params_json").notNullable().defaultTo("{}");
    t.text("channels").notNullable().defaultTo("[]");
    t.string("escalation_target", 80);
    t.string("scope", 160);
    t.boolean("enabled").notNullable().defaultTo(true);
    t.string("created_by", 100);
    t.timestamp("created_at").defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("alerts", (t) => {
    t.string("id", 36).notNullable().primary();
    t.string("level", 20).notNullable().defaultTo("info");
    t.string("title", 240).notNullable();
    t.text("meta").notNullable().defaultTo("{}");
    t.boolean("is_read").notNullable().defaultTo(false);
    t.string("rule_id", 36).references("id").inTable("alert_rules").onDelete("SET NULL");
    t.string("branch", 120);
    t.timestamp("created_at").defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("notifications", (t) => {
    t.string("id", 36).notNullable().primary();
    t.string("alert_id", 36).references("id").inTable("alerts").onDelete("CASCADE");
    t.string("user_id", 36);
    t.string("channel", 30).notNullable();
    t.string("recipient", 240).notNullable();
    t.string("subject", 240);
    t.text("body");
    t.string("status", 20).notNullable().defaultTo("pending");
    t.text("error");
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.timestamp("sent_at");
  });

  await knex.schema.createTable("alert_schedule", (t) => {
    t.string("id", 36).notNullable().primary();
    t.string("doc_id", 80).notNullable();
    t.string("tier", 10).notNullable();
    t.date("fire_date").notNullable();
    t.boolean("fired").notNullable().defaultTo(false);
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.unique(["doc_id", "tier"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  for (const t of ["alert_schedule", "notifications", "alerts", "alert_rules"]) {
    await knex.schema.dropTableIfExists(t);
  }
}
