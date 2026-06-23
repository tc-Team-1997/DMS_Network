import { describe, it, expect } from "vitest";
import { MockConnector } from "./mock.js";

describe("MockConnector", () => {
  it("returns the canned response for a known op and flags mock", async () => {
    const c = new MockConnector("cbs", {
      "customer.lookup": { ok: true, status: 200, data: { cid: "C1", name: "Dorji" } },
    });
    const res = await c.call("customer.lookup", { cid: "C1" });
    expect(res.ok).toBe(true);
    expect(res.mock).toBe(true);
    expect((res.data as any).name).toBe("Dorji");
  });

  it("returns 501 for an unhandled op", async () => {
    const c = new MockConnector("cbs", {});
    const res = await c.call("nope", {});
    expect(res.ok).toBe(false);
    expect(res.status).toBe(501);
    expect(res.error).toBe("unhandled_mock_op");
  });
});
