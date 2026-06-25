import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import knexLib from "knex";
import { buildKnexConfig, newId } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { hashPassword } from "@zordms/auth";
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
    expect(res.body.error).toBe("invalid_credentials");
  });

  it("writes a LOGIN audit row on success", async () => {
    await request(app).post("/auth/login").send({ username: "admin", password: "admin123" });
    const row = await knex("audit_log").where({ action: "LOGIN" }).first();
    expect(row).toBeTruthy();
  });

  // Fix 1: locked account oracle test
  it("returns 403 for a locked user with CORRECT password (no oracle leak)", async () => {
    // Insert a locked user with a known password
    const lockedId = newId();
    await knex("users").insert({
      id: lockedId,
      username: "locked_user",
      password_hash: await hashPassword("correct_password"),
      status: "Locked",
    });

    // Correct password + locked → 403 account_locked
    const res = await request(app).post("/auth/login").send({ username: "locked_user", password: "correct_password" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("account_locked");

    // Cleanup
    await knex("users").where({ id: lockedId }).del();
  });

  it("returns 401 for wrong password on an active user (not 403)", async () => {
    const res = await request(app).post("/auth/login").send({ username: "admin", password: "wrong_password" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_credentials");
  });

  // Fix 5: null mfa_secret guard
  it("returns 401 mfa_required when mfa_enabled but mfa_secret is null", async () => {
    const mfaId = newId();
    await knex("users").insert({
      id: mfaId,
      username: "mfa_no_secret",
      password_hash: await hashPassword("pw123456"),
      status: "Active",
      mfa_enabled: 1,
      mfa_secret: null,
    });

    const res = await request(app).post("/auth/login").send({ username: "mfa_no_secret", password: "pw123456" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("mfa_required");
    expect(res.body.mfaRequired).toBe(true);

    await knex("users").where({ id: mfaId }).del();
  });
});
