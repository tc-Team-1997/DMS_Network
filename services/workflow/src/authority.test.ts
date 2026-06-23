import { describe, it, expect, vi } from "vitest";
import { createAuthorityClient } from "./authority.js";

describe("authority client", () => {
  it("POSTs to /authz/check and returns allowed/missing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ allowed: true, missing: [] }),
    });
    const client = createAuthorityClient({
      gatewayUrl: "http://gw:4000",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const res = await client.check(7, ["document:approve", "workflow:act"]);

    expect(res.allowed).toBe(true);
    expect(res.missing).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://gw:4000/authz/check",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: 7, permissions: ["document:approve", "workflow:act"] }),
      }),
    );
  });

  it("reports missing permissions when the gateway denies", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ allowed: false, missing: ["document:approve"] }),
    });
    const client = createAuthorityClient({
      gatewayUrl: "http://gw:4000",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const res = await client.check(9, ["document:approve"]);
    expect(res.allowed).toBe(false);
    expect(res.missing).toEqual(["document:approve"]);
  });

  it("throws when the gateway returns a non-2xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    const client = createAuthorityClient({
      gatewayUrl: "http://gw:4000",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.check(1, ["workflow:act"])).rejects.toThrow(/authz_check_failed/);
  });
});
