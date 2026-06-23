import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServiceKnex } from "@zordms/db";
import { InMemoryBus } from "../bus/fake.js";
import { runExpiryScan } from "./expiryScan.js";

const migrationsDir = new URL("../migrations", import.meta.url).pathname;
const db = { client: "sqlite3" as const, host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "" };
const knex = buildServiceKnex({ migrationsDir, db });

beforeAll(async () => { await knex.migrate.latest(); });
afterAll(async () => { await knex.destroy(); });

describe("runExpiryScan", () => {
  it("publishes document.expiring for milestones due today and records the schedule", async () => {
    const bus = new InMemoryBus();
    const fired: number[] = [];
    bus.subscribe("document.expiring", (e) => { fired.push(Number((e.payload as any).daysToExpiry)); });

    // today is exactly 7 days before expiry -> the T-07 milestone fires
    const out = await runExpiryScan(
      { knex, bus, today: "2026-12-24" },
      [{ docId: "D1", docType: "BT_CID_4G", expiryDate: "2026-12-31", branch: "Thimphu" }],
    );

    expect(out.scheduled).toBe(1);
    expect(fired).toContain(7);
    const rows = await knex("alert_schedule").where({ doc_id: "D1" });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((r: any) => r.tier === "T-07" && r.fired)).toBe(true);
  });

  it("is idempotent: re-running the same day does not double-fire", async () => {
    const bus = new InMemoryBus();
    let count = 0;
    bus.subscribe("document.expiring", () => { count++; });
    await runExpiryScan({ knex, bus, today: "2026-12-24" }, [{ docId: "D1", docType: "BT_CID_4G", expiryDate: "2026-12-31" }]);
    expect(count).toBe(0); // already fired in the previous test
  });
});
