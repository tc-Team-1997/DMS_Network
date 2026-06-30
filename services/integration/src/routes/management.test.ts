import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { buildServiceKnex, newId } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { signToken } from "@zordms/auth";
import { createApp } from "../app.js";

const migrationsDir = new URL("../migrations", import.meta.url).pathname;
const seedsDir = new URL("../seeds", import.meta.url).pathname;
const db = { client: "sqlite3" as const, host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "" };
const knex = buildServiceKnex({ migrationsDir, seedsDir, db });
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv) });
let adminToken = "";

beforeAll(async () => {
  await knex.migrate.latest(); await knex.seed.run();
  const admin = await knex("users").where({ username: "admin" }).first();
  adminToken = signToken({ sub: admin.id, username: "admin", roles: ["CDO"], permissions: ["integration:read", "integration:manage"] }, "t");
  await knex("integration_logs").insert([
    { id: newId(), system: "cbs", endpoint: "customer.lookup", method: "CALL", status: 200, latency_ms: 12, direction: "outbound", success: true },
    { id: newId(), system: "los", endpoint: "loan.status", method: "CALL", status: 503, latency_ms: 30, direction: "outbound", success: false, error: "http_503" },
  ]);
});
afterAll(async () => { await knex.destroy(); });

describe("integration management", () => {
  it("lists recent request logs", async () => {
    const res = await request(app).get("/integration/logs").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.logs.length).toBeGreaterThanOrEqual(2);
  });

  it("filters logs by system", async () => {
    const res = await request(app).get("/integration/logs?system=los").set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.logs.every((l: any) => l.system === "los")).toBe(true);
  });

  it("reports connected-system status (los down, cbs up, disabled flagged)", async () => {
    const res = await request(app).get("/integration/systems").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const bySystem = Object.fromEntries(res.body.systems.map((s: any) => [s.system, s]));
    expect(bySystem.cbs.status).toBe("up");
    expect(bySystem.los.status).toBe("down");
    expect(bySystem.los.recentErrors).toBeGreaterThanOrEqual(1);
  });

  it("seeded config now lists the previously config-only connectors", async () => {
    const res = await request(app).get("/integration/systems").set("Authorization", `Bearer ${adminToken}`);
    const names = res.body.systems.map((s: any) => s.system);
    for (const sys of ["mbob", "gobob", "internet_banking", "crm", "erp", "contact_center"]) {
      expect(names).toContain(sys);
    }
  });

  it("invokes a connector op (mock) and logs the call", async () => {
    const res = await request(app)
      .post("/integration/systems/mbob/call")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ op: "kyc.fetch", payload: { cid: "C2001" } });
    expect(res.status).toBe(200);
    expect(res.body.system).toBe("mbob");
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.data.channel).toBe("mBoB");

    // withLogging recorded the outbound call.
    const logs = await request(app).get("/integration/logs?system=mbob").set("Authorization", `Bearer ${adminToken}`);
    expect(logs.body.logs.length).toBeGreaterThanOrEqual(1);
  });

  it("works for all six newly-finished connectors", async () => {
    const ops: Record<string, string> = {
      mbob: "kyc.fetch", gobob: "ekyc.fetch", internet_banking: "statement.fetch",
      crm: "customer.view", erp: "document.fetch", contact_center: "document.push",
    };
    for (const [system, op] of Object.entries(ops)) {
      const res = await request(app)
        .post(`/integration/systems/${system}/call`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ op });
      expect(res.status, `${system}.${op}`).toBe(200);
      expect(res.body.result.ok).toBe(true);
    }
  });

  it("invokes the e-Signature connector (REST, mock)", async () => {
    const reqRes = await request(app)
      .post("/integration/systems/esign/call")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ op: "sign.request", payload: { docId: "doc-1", signers: ["maker@bob.bt"] } });
    expect(reqRes.status).toBe(200);
    expect(reqRes.body.result.data.status).toBe("SENT");

    const statusRes = await request(app)
      .post("/integration/systems/esign/call")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ op: "sign.status", payload: { envelopeId: "ENV-9001" } });
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.result.data.status).toBe("COMPLETED");
  });

  it("rejects an unknown op with 400", async () => {
    const res = await request(app)
      .post("/integration/systems/mbob/call")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ op: "no.such.op" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("unknown_op");
  });

  it("404 for an unknown system", async () => {
    const res = await request(app)
      .post("/integration/systems/nope/call")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ op: "ping" });
    expect(res.status).toBe(404);
  });

  it("rejects a malformed call body with 400 validation_error", async () => {
    const res = await request(app)
      .post("/integration/systems/mbob/call")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ payload: {} }); // missing required `op`
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });
});
