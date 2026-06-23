import { describe, it, expect, beforeAll, afterAll } from "vitest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { resolveUserAuthz, can, canAll } from "./rbac.js";
const knex = knexLib(buildKnexConfig({
    client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
beforeAll(async () => { await knex.migrate.latest(); await knex.seed.run(); });
afterAll(async () => { await knex.destroy(); });
describe("rbac engine", () => {
    it("resolves the bootstrap admin (CDO) permissions including user:create", async () => {
        const admin = await knex("users").where({ username: "admin" }).first();
        const authz = await resolveUserAuthz(knex, admin.id);
        expect(authz.roles).toContain("CDO");
        expect(can(authz, "user:create")).toBe(true);
        expect(canAll(authz, ["user:create", "document:approve"])).toBe(true);
    });
    it("denies a permission the user does not have", async () => {
        const authz = { permissions: ["document:read"] };
        expect(can(authz, "user:create")).toBe(false);
    });
    it("denies when required permissions array is empty (fail-closed)", () => {
        const authz = { permissions: ["document:read"] };
        expect(canAll(authz, [])).toBe(false);
    });
});
