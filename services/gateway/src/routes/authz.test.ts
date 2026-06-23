import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { createApp } from "../app.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv) });

beforeAll(async () => { await knex.migrate.latest(); await knex.seed.run(); });
afterAll(async () => { await knex.destroy(); });

describe("POST /authz/check", () => {
  it("confirms admin may approve documents", async () => {
    const admin = await knex("users").where({ username: "admin" }).first();
    const res = await request(app).post("/authz/check").send({ userId: admin.id, permissions: ["document:approve"] });
    expect(res.status).toBe(200);
    expect(res.body.allowed).toBe(true);
    expect(res.body.missing).toEqual([]);
  });
});
