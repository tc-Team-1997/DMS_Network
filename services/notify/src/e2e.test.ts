import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { buildServiceKnex } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { signToken } from "@zordms/auth";
import { ChannelRegistry } from "./channels/registry.js";
import { FakeAdapter } from "./channels/fake.js";
import { RealtimeHub } from "./realtime/hub.js";
import { InMemoryBus } from "./bus/fake.js";
import { attachConsumer } from "./services/consumer.js";
import { runExpiryScan } from "./jobs/expiryScan.js";
import { createApp } from "./app.js";

const migrationsDir = new URL("./migrations", import.meta.url).pathname;
const seedsDir = new URL("./seeds", import.meta.url).pathname;
const db = { client: "sqlite3" as const, host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "" };
const knex = buildServiceKnex({ migrationsDir, seedsDir, db });
const registry = new ChannelRegistry();
for (const c of ["email", "sms", "whatsapp", "teams", "inapp"] as const) registry.register(new FakeAdapter(c));
const hub = new RealtimeHub();
const bus = new InMemoryBus();
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv), registry, bus, hub });

const CDO_PERMISSIONS = [
  "user:create", "user:update", "user:read", "role:assign",
  "document:capture", "document:index", "document:read", "document:approve",
  "document:reject", "document:delete", "workflow:act", "legal_hold:place",
  "compliance:read", "admin:access", "crossbranch:read",
  "alert:read", "alert:manage", "alert_rule:manage",
];

let adminToken = "";
beforeAll(async () => {
  await knex.migrate.latest(); await knex.seed.run();
  attachConsumer({ knex, registry, hub, bus });
  const admin = await knex("users").where({ username: "admin" }).first();
  adminToken = signToken({ sub: admin.id, username: "admin", roles: ["CDO"], permissions: CDO_PERMISSIONS, branch: "HQ" }, "t");
});
afterAll(async () => { await knex.destroy(); });

describe("notify end-to-end", () => {
  it("expiry scan -> document.expiring -> rule fires -> alert visible over HTTP", async () => {
    // today == T-07 of a 2026-12-31 expiry
    const scan = await runExpiryScan({ knex, bus, today: "2026-12-24" }, [
      { docId: "CID-100", docType: "BT_CID_4G", expiryDate: "2026-12-31", branch: "Thimphu" },
    ]);
    expect(scan.scheduled).toBe(1);

    const res = await request(app).get("/alerts?level=critical").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.alerts.some((a: any) => a.title.includes("BT_CID_4G"))).toBe(true);
  });
});
