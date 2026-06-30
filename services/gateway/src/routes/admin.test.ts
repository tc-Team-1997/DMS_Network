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

describe("AD / bulk user import (/admin/ad-import)", () => {
  it("requires auth", async () => {
    expect((await request(app).post("/admin/ad-import").send({ users: [] })).status).toBe(401);
  });

  it("rejects an empty users array (400)", async () => {
    const res = await request(app).post("/admin/ad-import").set(auth()).send({ users: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("provisions new users with the default role + assigns it", async () => {
    const res = await request(app).post("/admin/ad-import").set(auth()).send({
      users: [
        { username: "dorji.w", email: "dorji.w@bobl.bt", displayName: "Dorji W" },
        { email: "pema.l@bobl.bt", displayName: "Pema L" },
        { displayName: "no identity" }, // neither username nor email → failed
      ],
      defaultRole: "Viewer",
    });
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ found: 3, created: 2, skipped: 0, failed: 1, dryRun: false });

    const u = await knex("users").where({ email: "dorji.w@bobl.bt" }).first();
    expect(u).toBeTruthy();
    expect(u.password_hash).toBe("!SSO-NOLOGIN");
    const roleNames = await knex("user_roles as ur").join("roles as r", "r.id", "ur.role_id").where("ur.user_id", u.id).pluck("r.name");
    expect(roleNames).toContain("Viewer");
  });

  it("is idempotent — re-importing the same users skips them", async () => {
    const body = { users: [{ username: "dorji.w", email: "dorji.w@bobl.bt" }], defaultRole: "Viewer" };
    const res = await request(app).post("/admin/ad-import").set(auth()).send(body);
    expect(res.body.summary).toMatchObject({ found: 1, created: 0, skipped: 1 });
  });

  it("dry-run reports would-create without writing", async () => {
    const before = Number((await knex("users").count<{ c: number }[]>("id as c"))[0].c);
    const res = await request(app).post("/admin/ad-import").set(auth()).send({
      users: [{ username: "ghost", email: "ghost@bobl.bt" }],
      dryRun: true,
    });
    expect(res.body.summary).toMatchObject({ created: 1, dryRun: true });
    const after = Number((await knex("users").count<{ c: number }[]>("id as c"))[0].c);
    expect(after).toBe(before); // nothing persisted
  });

  it("writes an AD_IMPORT audit row", async () => {
    await request(app).post("/admin/ad-import").set(auth()).send({ users: [{ username: "audit.check" }] });
    const rows = await knex("audit_log").where({ action: "AD_IMPORT" });
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
