import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { signToken } from "@zordms/auth";
import { createApp } from "../app.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv) });
let adminToken = "";

beforeAll(async () => {
  await knex.migrate.latest();
  await knex.seed.run();
  const admin = await knex("users").where({ username: "admin" }).first();
  adminToken = signToken({ sub: admin.id, username: "admin" }, "t");
});
afterAll(async () => { await knex.destroy(); });

const auth = () => ({ Authorization: `Bearer ${adminToken}` });

describe("Security settings (/security-settings)", () => {
  it("requires auth", async () => {
    expect((await request(app).get("/security-settings")).status).toBe(401);
  });

  it("returns the seeded defaults", async () => {
    const res = await request(app).get("/security-settings").set(auth());
    expect(res.status).toBe(200);
    expect(res.body.securitySettings).toMatchObject({
      passwordMinLength: 8,
      passwordRequireComplexity: true,
      mfaRequired: false,
      sessionTimeoutMinutes: 30,
      maxFailedLogins: 5,
    });
  });

  it("updates a subset and persists, recording updatedBy", async () => {
    const res = await request(app)
      .put("/security-settings").set(auth())
      .send({ mfa_required: true, session_timeout_minutes: 15, password_min_length: 12 });
    expect(res.status).toBe(200);
    expect(res.body.securitySettings).toMatchObject({
      mfaRequired: true, sessionTimeoutMinutes: 15, passwordMinLength: 12,
      passwordRequireComplexity: true, // untouched field preserved
    });
    expect(res.body.securitySettings.updatedBy).toBe("admin");

    const again = await request(app).get("/security-settings").set(auth());
    expect(again.body.securitySettings.mfaRequired).toBe(true);
  });

  it("writes an audit row on update", async () => {
    await request(app).put("/security-settings").set(auth()).send({ max_failed_logins: 3 });
    const rows = await knex("audit_log").where({ action: "SECURITY_SETTINGS_UPDATE" });
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects out-of-range values with 400 validation_error", async () => {
    const res = await request(app).put("/security-settings").set(auth()).send({ password_min_length: 2 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });
});
