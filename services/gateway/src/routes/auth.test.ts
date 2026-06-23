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

describe("POST /auth/login", () => {
  it("logs in the bootstrap admin and returns a token + permissions", async () => {
    const res = await request(app).post("/auth/login").send({ username: "admin", password: "admin123" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.permissions).toContain("user:create");
  });
  it("rejects wrong password", async () => {
    const res = await request(app).post("/auth/login").send({ username: "admin", password: "wrong" });
    expect(res.status).toBe(401);
  });
  it("writes a LOGIN audit row on success", async () => {
    await request(app).post("/auth/login").send({ username: "admin", password: "admin123" });
    const row = await knex("audit_log").where({ action: "LOGIN" }).first();
    expect(row).toBeTruthy();
  });
});
