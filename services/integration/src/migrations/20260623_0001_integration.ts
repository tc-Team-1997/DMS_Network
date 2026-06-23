import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // identity + RBAC tables (needed for auth in integration service)
  const hasUsers = await knex.schema.hasTable("users");
  if (!hasUsers) {
    await knex.schema.createTable("users", (t) => {
      t.increments("id").primary();
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

  const hasRoles = await knex.schema.hasTable("roles");
  if (!hasRoles) {
    await knex.schema.createTable("roles", (t) => {
      t.increments("id").primary();
      t.string("name", 80).notNullable().unique();
      t.string("description", 255);
      t.boolean("system").notNullable().defaultTo(false);
    });
  }

  const hasPermissions = await knex.schema.hasTable("permissions");
  if (!hasPermissions) {
    await knex.schema.createTable("permissions", (t) => {
      t.increments("id").primary();
      t.string("key", 120).notNullable().unique();
      t.string("description", 255);
    });
  }

  const hasRolePerms = await knex.schema.hasTable("role_permissions");
  if (!hasRolePerms) {
    await knex.schema.createTable("role_permissions", (t) => {
      t.integer("role_id").notNullable().references("id").inTable("roles").onDelete("CASCADE");
      t.integer("permission_id").notNullable().references("id").inTable("permissions").onDelete("CASCADE");
      t.primary(["role_id", "permission_id"]);
    });
  }

  const hasUserRoles = await knex.schema.hasTable("user_roles");
  if (!hasUserRoles) {
    await knex.schema.createTable("user_roles", (t) => {
      t.integer("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
      t.integer("role_id").notNullable().references("id").inTable("roles").onDelete("CASCADE");
      t.primary(["user_id", "role_id"]);
    });
  }

  // Integration-specific tables
  await knex.schema.createTable("integration_logs", (t) => {
    t.increments("id").primary();
    t.string("system", 60).notNullable();
    t.string("endpoint", 255).notNullable();
    t.string("method", 16).notNullable();
    t.integer("status").notNullable().defaultTo(0);
    t.integer("latency_ms").notNullable().defaultTo(0);
    t.string("direction", 16).notNullable().defaultTo("outbound"); // outbound | inbound
    t.boolean("success").notNullable().defaultTo(true);
    t.text("error");
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.index(["system", "created_at"], "idx_intlogs_system_time");
  });

  await knex.schema.createTable("integration_config", (t) => {
    t.increments("id").primary();
    t.string("system", 60).notNullable().unique();
    t.string("base_url", 255);
    t.string("auth_type", 20).notNullable().defaultTo("none"); // none | bearer | hmac | basic
    t.string("secret", 255);
    t.boolean("enabled").notNullable().defaultTo(true);
    t.timestamp("created_at").defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("outbound_webhooks", (t) => {
    t.increments("id").primary();
    t.string("url", 500).notNullable();
    t.text("events").notNullable();          // comma-joined event names
    t.string("auth_method", 20).notNullable().defaultTo("hmac"); // hmac | none
    t.string("secret", 255);
    t.boolean("enabled").notNullable().defaultTo(true);
    t.timestamp("created_at").defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  for (const t of ["outbound_webhooks", "integration_config", "integration_logs",
    "user_roles", "role_permissions", "permissions", "roles", "users"]) {
    await knex.schema.dropTableIfExists(t);
  }
}
