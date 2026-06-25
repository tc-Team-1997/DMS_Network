import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { buildServiceKnex, newId } from "@zordms/db";
import { dispatchEvent } from "./dispatch.js";
import { verifySignature } from "./hmac.js";

const migrationsDir = new URL("../migrations", import.meta.url).pathname;
const db = { client: "sqlite3" as const, host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "" };
const knex = buildServiceKnex({ migrationsDir, db });

beforeAll(async () => {
  await knex.migrate.latest();
  await knex("outbound_webhooks").insert({
    id: newId(), url: "http://consumer.local/hook", events: "cbs.customer.updated,kyc.result",
    auth_method: "hmac", secret: "out_secret", enabled: true,
  });
});
afterAll(async () => { await knex.destroy(); });

describe("dispatchEvent", () => {
  it("signs the body and delivers to subscribers of the event", async () => {
    let seenSig: string | undefined; let seenBody: string | undefined;
    const fetchImpl = vi.fn(async (_url: string, init: any) => {
      seenSig = init.headers["X-ZorDMS-Signature"]; seenBody = init.body;
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;

    const report = await dispatchEvent({ knex, fetchImpl }, "cbs.customer.updated", { cid: "C1" });
    expect(report.delivered).toBe(1);
    expect(report.failed).toBe(0);
    expect(verifySignature(seenBody!, "out_secret", seenSig)).toBe(true); // valid HMAC over the exact sent body
  });

  it("retries up to maxAttempts then logs a failure", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    const report = await dispatchEvent({ knex, fetchImpl, maxAttempts: 3 }, "kyc.result", { ok: true });
    expect(report.delivered).toBe(0);
    expect(report.failed).toBe(1);
    expect((fetchImpl as any).mock.calls.length).toBe(3);
    const row = await knex("integration_logs").where({ system: "outbound", endpoint: "kyc.result", success: false }).first();
    expect(row).toBeTruthy();
  });

  it("delivers nothing for an event with no subscribers", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const report = await dispatchEvent({ knex, fetchImpl }, "los.loan.created", {});
    expect(report.delivered + report.failed).toBe(0);
    expect((fetchImpl as any).mock.calls.length).toBe(0);
  });
});
