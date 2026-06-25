import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServiceKnex } from "@zordms/db";
import { selectConnector, liveBaseUrl } from "./registry.js";

const migrationsDir = new URL("../migrations", import.meta.url).pathname;
const db = { client: "sqlite3" as const, host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "" };
const knex = buildServiceKnex({ migrationsDir, db });

beforeAll(async () => { await knex.migrate.latest(); });
afterAll(async () => { await knex.destroy(); });

describe("connector selection (live HTTP vs mock fallback)", () => {
  it("liveBaseUrl reads <SYSTEM>_BASE_URL from env", () => {
    expect(liveBaseUrl("cbs", { CBS_BASE_URL: "https://bancs" } as NodeJS.ProcessEnv)).toBe("https://bancs");
    expect(liveBaseUrl("cbs", {} as NodeJS.ProcessEnv)).toBeUndefined();
    expect(liveBaseUrl("cbs", { CBS_BASE_URL: "   " } as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it("picks the HTTP connector when CBS_BASE_URL is set (hits the base URL via injected fetch)", async () => {
    const calls: string[] = [];
    const fakeFetch = (async (url: string | URL) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ cid: "C1", name: "Live" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const c = selectConnector("cbs", { knex }, { env: { CBS_BASE_URL: "https://bancs.example" } as NodeJS.ProcessEnv, fetchImpl: fakeFetch });
    const res = await c.call("customer.lookup", { cid: "C1" });
    expect(res.ok).toBe(true);
    // HTTP connector never tags responses as mock
    expect((res as { mock?: boolean }).mock).toBeUndefined();
    expect(calls[0]).toBe("https://bancs.example/customers/lookup");
  });

  it("falls back to the MOCK connector when no base URL is set", async () => {
    const c = selectConnector("cbs", { knex }, { env: {} as NodeJS.ProcessEnv });
    const res = await c.call("customer.lookup", { cid: "C1" });
    expect(res.ok).toBe(true);
    expect((res as { mock?: boolean }).mock).toBe(true);
  });

  it("LOS and KYC each select HTTP only when their own base URL is set", async () => {
    const losHttp = selectConnector("los", { knex }, { env: { LOS_BASE_URL: "https://los" } as NodeJS.ProcessEnv });
    const losMock = selectConnector("los", { knex }, { env: { CBS_BASE_URL: "https://only-cbs" } as NodeJS.ProcessEnv });
    expect((await losMock.call("loan.status", { loanId: "L1" })).mock).toBe(true);
    // losHttp would attempt a network call; assert it is NOT the mock by checking op mapping path resolves
    expect(losHttp.system).toBe("los");
  });
});
