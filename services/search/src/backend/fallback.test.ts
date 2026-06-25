import { describe, it, expect, vi } from "vitest";
import { loadConfig } from "@zordms/config";
import { selectBackend, selectBackendWithFallback } from "./index.js";

// A stand-in knex — selectBackend* only stores the reference for the SQL backend.
const fakeKnex = {} as any;

describe("selectBackend (sync)", () => {
  it("returns the SQL backend by default", () => {
    const config = loadConfig({ JWT_SECRET: "t", SEARCH_BACKEND: "sql" } as NodeJS.ProcessEnv);
    const be = selectBackend(config, fakeKnex);
    expect(be.name).toBe("sql");
  });

  it("returns the ES backend when SEARCH_BACKEND=elasticsearch", () => {
    const config = loadConfig({ JWT_SECRET: "t", SEARCH_BACKEND: "elasticsearch" } as NodeJS.ProcessEnv);
    const be = selectBackend(config, fakeKnex);
    expect(be.name).toBe("es");
  });

  it("accepts the 'es' alias", () => {
    const config = loadConfig({ JWT_SECRET: "t", SEARCH_BACKEND: "es" } as NodeJS.ProcessEnv);
    const be = selectBackend(config, fakeKnex);
    expect(be.name).toBe("es");
  });
});

describe("selectBackendWithFallback (boot-time)", () => {
  it("stays on SQL when SQL is selected (no ES ping attempted)", async () => {
    const config = loadConfig({ JWT_SECRET: "t", SEARCH_BACKEND: "sql" } as NodeJS.ProcessEnv);
    const be = await selectBackendWithFallback(config, fakeKnex, () => {});
    expect(be.name).toBe("sql");
  });

  it("falls back to SQL and warns when ES is UNREACHABLE at boot", async () => {
    // Point at a closed/unroutable port so the ping fails fast.
    const config = loadConfig({
      JWT_SECRET: "t",
      SEARCH_BACKEND: "elasticsearch",
      ELASTICSEARCH_NODE: "http://127.0.0.1:1",
    } as NodeJS.ProcessEnv);
    const log = vi.fn();
    const be = await selectBackendWithFallback(config, fakeKnex, log);
    expect(be.name).toBe("sql");
    expect(log).toHaveBeenCalled();
    const msg = String(log.mock.calls.map((c) => c[0]).join(" "));
    expect(msg).toMatch(/UNREACHABLE/i);
    expect(msg).toMatch(/Falling back to SQL/i);
  }, 15000);
});
