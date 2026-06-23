import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServiceKnex } from "@zordms/db";
import { ChannelRegistry } from "../channels/registry.js";
import { FakeAdapter } from "../channels/fake.js";
import { RealtimeHub } from "../realtime/hub.js";
import { InMemoryBus } from "../bus/fake.js";
import { attachConsumer } from "./consumer.js";

const migrationsDir = new URL("../migrations", import.meta.url).pathname;
const seedsDir = new URL("../seeds", import.meta.url).pathname;
const db = { client: "sqlite3" as const, host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "" };
const knex = buildServiceKnex({ migrationsDir, seedsDir, db });

beforeAll(async () => { await knex.migrate.latest(); await knex.seed.run(); });
afterAll(async () => { await knex.destroy(); });

describe("attachConsumer", () => {
  it("turns a document.expiring event into a persisted alert via the seeded rule", async () => {
    const email = new FakeAdapter("email");
    const registry = new ChannelRegistry(); registry.register(email);
    registry.register(new FakeAdapter("sms")); registry.register(new FakeAdapter("whatsapp")); registry.register(new FakeAdapter("inapp"));
    const bus = new InMemoryBus();
    const hub = new RealtimeHub();

    attachConsumer({ knex, registry, hub, bus });
    await bus.publish({ type: "document.expiring", payload: { docId: "D9", docType: "BT_CID_4G", daysToExpiry: 5, branchManager: "Supervisor" } });

    const alert = await knex("alerts").where({ title: "BT_CID_4G expiring in 5 day(s)" }).first();
    expect(alert).toBeTruthy();
    expect(alert.level).toBe("critical");
  });
});
