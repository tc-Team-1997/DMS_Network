import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
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

  await knex.schema.createTable("roles", (t) => {
    t.string("id", 36).notNullable().primary();
    t.string("name", 80).notNullable().unique();
    t.string("description", 255);
    t.boolean("system").notNullable().defaultTo(false);
  });

  await knex.schema.createTable("permissions", (t) => {
    t.string("id", 36).notNullable().primary();
    t.string("key", 120).notNullable().unique();
    t.string("description", 255);
  });

  await knex.schema.createTable("role_permissions", (t) => {
    t.string("role_id", 36).notNullable().references("id").inTable("roles").onDelete("CASCADE");
    t.string("permission_id", 36).notNullable().references("id").inTable("permissions").onDelete("CASCADE");
    t.primary(["role_id", "permission_id"]);
  });

  await knex.schema.createTable("user_roles", (t) => {
    t.string("user_id", 36).notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.string("role_id", 36).notNullable().references("id").inTable("roles").onDelete("CASCADE");
    t.primary(["user_id", "role_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  for (const t of ["user_roles", "role_permissions", "permissions", "roles", "users"]) {
    await knex.schema.dropTableIfExists(t);
  }
}
