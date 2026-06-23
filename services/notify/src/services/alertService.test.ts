import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServiceKnex } from "@zordms/db";
import { ChannelRegistry } from "../channels/registry.js";
import { FakeAdapter } from "../channels/fake.js";
import { RealtimeHub } from "../realtime/hub.js";
import { InMemoryBus } from "../bus/fake.js";
import { raiseAlert } from "./alertService.js";

const migrationsDir = new URL("../migrations", import.meta.url).pathname;
const seedsDir = new URL("../seeds", import.meta.url).pathname;
const db = { client: "sqlite3" as const, host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "" };
const knex = buildServiceKnex({ migrationsDir, seedsDir, db });

beforeAll(async () => { await knex.migrate.latest(); await knex.seed.run(); });
afterAll(async () => { await knex.destroy(); });

describe("raiseAlert", () => {
  it("persists an alert, dispatches notifications, broadcasts and emits alert.raised", async () => {
    const email = new FakeAdapter("email");
    const sms = new FakeAdapter("sms");
    const registry = new ChannelRegistry();
    registry.register(email); registry.register(sms);

    const hub = new RealtimeHub();
    const broadcasts: string[] = [];
    hub.add({ send: (d: string) => broadcasts.push(d), readyState: 1 });

    const bus = new InMemoryBus();
    const emitted: string[] = [];
    bus.subscribe("alert.raised", (e) => { emitted.push((e.payload as any).title); });

    const out = await raiseAlert(
      { knex, registry, hub, bus },
      {
        decision: {
          fire: true, level: "critical", channels: ["email", "sms"],
          recipients: [{ kind: "external", value: "+97517123456" }],
          title: "CID expiring in 5 day(s)", reason: "expiry_match",
        },
        branch: "Thimphu",
        meta: { docId: "D1" },
      },
    );

    expect(out.alertId).toBeGreaterThan(0);
    const alert = await knex("alerts").where({ id: out.alertId }).first();
    expect(alert.level).toBe("critical");
    expect(alert.title).toBe("CID expiring in 5 day(s)");

    const notifs = await knex("notifications").where({ alert_id: out.alertId });
    expect(notifs.length).toBe(2); // email + sms for the one external recipient
    expect(notifs.every((n: any) => n.status === "sent")).toBe(true);

    expect(email.sent[0].recipient).toBe("+97517123456");
    expect(broadcasts.some((b) => JSON.parse(b).type === "alert.raised")).toBe(true);
    expect(emitted).toContain("CID expiring in 5 day(s)");
  });
});
