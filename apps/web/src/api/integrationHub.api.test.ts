/**
 * Unit tests for integrationHubApi URL paths (C1 fix verification).
 * Separate from the component test file to avoid vi.mock hoisting conflicts.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

// Mock client.ts before importing so getToken() returns null (no auth header needed)
vi.mock("./client.js", () => ({ getToken: () => null, handleUnauthorized: () => {} }));

// Import the real (un-mocked) API module
import { integrationHubApi } from "./integrationHub.js";

describe("integrationHubApi URL paths — C1 fix", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getLogs calls /svc/integrate/integration/logs", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ logs: [] }),
    } as Response);

    await integrationHubApi.getLogs();

    const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("/svc/integrate/integration/logs");
    // Verify the OLD broken path is gone
    expect(calledUrl).not.toMatch(/^\/svc\/integrate\/logs/);
  });

  it("getSystems calls /svc/integrate/integration/systems", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ systems: [] }),
    } as Response);

    await integrationHubApi.getSystems();

    const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("/svc/integrate/integration/systems");
    expect(calledUrl).not.toMatch(/^\/svc\/integrate\/systems/);
  });

  it("getWebhooks calls /svc/integrate/outbound (not /webhooks)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ webhooks: [] }),
    } as Response);

    await integrationHubApi.getWebhooks();

    const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("/svc/integrate/outbound");
    // Old broken path check
    expect(calledUrl).not.toContain("/svc/integrate/webhooks");
  });

  it("createWebhook POSTs to /svc/integrate/outbound", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ webhook: {} }),
    } as Response);

    await integrationHubApi.createWebhook({
      url: "https://example.com/hook",
      events: ["cbs.customer.updated"],
    });

    const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("/svc/integrate/outbound");
    expect(calledUrl).not.toContain("/svc/integrate/webhooks");
  });

  it("testWebhook POSTs to /svc/integrate/outbound/test", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ report: {} }),
    } as Response);

    await integrationHubApi.testWebhook("cbs.customer.updated");

    const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("/svc/integrate/outbound/test");
    expect(calledUrl).not.toContain("/svc/integrate/webhooks/test");
  });
});
