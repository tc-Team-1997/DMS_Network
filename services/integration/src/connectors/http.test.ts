import { describe, it, expect, vi } from "vitest";
import { HttpConnector } from "./http.js";

describe("HttpConnector", () => {
  it("maps an op to method+path and returns parsed JSON on 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200, ok: true, json: async () => ({ cid: "C1", name: "Dorji" }),
    }) as unknown as typeof fetch;
    const c = new HttpConnector({
      system: "cbs",
      baseUrl: "http://bancs.local",
      opMap: { "customer.lookup": { method: "POST", path: "/customers/lookup" } },
      fetchImpl,
    });
    const res = await c.call("customer.lookup", { cid: "C1" });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect((res.data as any).name).toBe("Dorji");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://bancs.local/customers/lookup",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns ok=false for an unmapped op", async () => {
    const c = new HttpConnector({ system: "cbs", baseUrl: "http://x", opMap: {}, fetchImpl: vi.fn() as any });
    const res = await c.call("nope", {});
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });

  it("surfaces a non-2xx status as ok=false", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 503, ok: false, json: async () => ({ message: "down" }),
    }) as unknown as typeof fetch;
    const c = new HttpConnector({
      system: "los", baseUrl: "http://los", opMap: { "loan.status": { method: "GET", path: "/loan" } }, fetchImpl,
    });
    const res = await c.call("loan.status", {});
    expect(res.ok).toBe(false);
    expect(res.status).toBe(503);
  });
});
