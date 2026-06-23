import { describe, it, expect, afterAll } from "vitest";
import knexLib from "knex";
import { buildKnexConfig } from "../knexConfig.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));

afterAll(async () => { await knex.destroy(); });

describe("identity_rbac migration", () => {
  it("creates all RBAC tables", async () => {
    await knex.migrate.latest();
    for (const t of ["users", "roles", "permissions", "role_permissions", "user_roles", "audit_log"]) {
      expect(await knex.schema.hasTable(t)).toBe(true);
    }
  });

  it("seeds default roles, permissions, and a bootstrap admin", async () => {
    await knex.seed.run();
    const roles = await knex("roles").pluck("name");
    expect(roles).toEqual(expect.arrayContaining(["CDO", "Supervisor", "Maker", "Checker", "Viewer", "Auditor"]));
    const admin = await knex("users").where({ username: "admin" }).first();
    expect(admin).toBeTruthy();
    const perms = await knex("permissions").pluck("key");
    expect(perms).toEqual(expect.arrayContaining(["user:create", "document:approve"]));
  });
});
