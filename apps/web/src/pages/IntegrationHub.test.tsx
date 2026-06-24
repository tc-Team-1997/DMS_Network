import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import IntegrationHub from "./IntegrationHub.js";

/* ─── ResizeObserver polyfill (recharts needs it in jsdom) ─── */
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe()   { /* noop */ }
      unobserve() { /* noop */ }
      disconnect(){ /* noop */ }
    } as unknown as typeof ResizeObserver;
  }
});

/* ─── Mock auth context ─── */
vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      username: "admin",
      roles: ["CDO"],
      permissions: ["integration:read", "integration:manage"],
    },
    logout: () => {},
  }),
}));

/* ─── Mock the API module ─── */
vi.mock("../api/integrationHub.js", () => ({
  integrationHubApi: {
    getSystems: vi.fn().mockResolvedValue({
      systems: [
        { system: "cbs", base_url: "http://bancs.local", enabled: true, status: "up", lastCallAt: "2026-06-23T10:00:00Z", recentErrors: 0 },
        { system: "los", base_url: "http://los.local",   enabled: true, status: "up", lastCallAt: "2026-06-23T09:45:00Z", recentErrors: 1 },
        { system: "kyc", base_url: null,                 enabled: false, status: "disabled", lastCallAt: null, recentErrors: 0 },
      ],
    }),
    getLogs: vi.fn().mockResolvedValue({
      logs: [
        { id: 1, system: "cbs", endpoint: "customer.lookup", method: "CALL", status: 200, latency_ms: 42, direction: "outbound", success: true, created_at: "2026-06-23T10:00:00Z" },
        { id: 2, system: "los", endpoint: "loan.push",        method: "CALL", status: 201, latency_ms: 88, direction: "outbound", success: true, created_at: "2026-06-23T09:45:00Z" },
        { id: 3, system: "kyc", endpoint: "verify",           method: "CALL", status: 501, latency_ms: 5,  direction: "outbound", success: false, error: "unhandled_mock_op", created_at: "2026-06-23T09:30:00Z" },
      ],
    }),
    getWebhooks: vi.fn().mockResolvedValue({
      webhooks: [
        { id: 1, url: "https://erp.bank.bt/webhook", events: ["cbs.customer.updated"], auth_method: "hmac", enabled: true },
      ],
    }),
    createWebhook: vi.fn(),
    testWebhook: vi.fn(),
  },
}));

describe("IntegrationHub screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the page heading", async () => {
    render(<IntegrationHub />);
    expect(screen.getByText("Integration Hub")).toBeInTheDocument();
  });

  it("renders the page sub-heading with service list", () => {
    render(<IntegrationHub />);
    // Multiple CBS matches expected; check the heading paragraph specifically
    const heading = screen.getByText(/CBS · LOS · KYC Engine/);
    expect(heading).toBeInTheDocument();
  });

  it("renders all four KPI cards", () => {
    render(<IntegrationHub />);
    expect(screen.getByText("Active Integrations")).toBeInTheDocument();
    expect(screen.getByText("API Calls Today")).toBeInTheDocument();
    expect(screen.getByText("Avg Latency")).toBeInTheDocument();
    expect(screen.getByText("Failed Calls (24h)")).toBeInTheDocument();
  });

  it("renders all tab labels", () => {
    render(<IntegrationHub />);
    // Tab buttons are in the .tabs div; use getAllByText and check at least one
    const connectedItems = screen.getAllByText("Connected Systems");
    expect(connectedItems.length).toBeGreaterThan(0);
    expect(screen.getByText("Request Logs")).toBeInTheDocument();
    expect(screen.getByText("Outbound Webhooks")).toBeInTheDocument();
    expect(screen.getByText("Analytics")).toBeInTheDocument();
  });

  it("calls getSystems on mount", async () => {
    const { integrationHubApi } = await import("../api/integrationHub.js");
    render(<IntegrationHub />);
    await waitFor(() => expect(integrationHubApi.getSystems).toHaveBeenCalledTimes(1));
  });

  it("calls getLogs on mount", async () => {
    const { integrationHubApi } = await import("../api/integrationHub.js");
    render(<IntegrationHub />);
    await waitFor(() => expect(integrationHubApi.getLogs).toHaveBeenCalledTimes(1));
  });

  it("calls getWebhooks on mount", async () => {
    const { integrationHubApi } = await import("../api/integrationHub.js");
    render(<IntegrationHub />);
    await waitFor(() => expect(integrationHubApi.getWebhooks).toHaveBeenCalledTimes(1));
  });

  it("shows CBS system in the connected systems list", async () => {
    render(<IntegrationHub />);
    await waitFor(() => expect(screen.getByText(/Core Banking System \(CBS\)/)).toBeInTheDocument());
  });

  it("shows LOS system in the connected systems list", async () => {
    render(<IntegrationHub />);
    await waitFor(() => expect(screen.getByText(/Loan Origination System \(LOS\)/)).toBeInTheDocument());
  });

  it("shows HMAC webhook endpoints card", async () => {
    render(<IntegrationHub />);
    await waitFor(() => expect(screen.getByText("HMAC Webhook Endpoints")).toBeInTheDocument());
  });

  it("shows the Add Integration button for users with integration:manage", () => {
    render(<IntegrationHub />);
    expect(screen.getByText("+ Add Integration")).toBeInTheDocument();
  });

  it("shows the Test Webhook button", () => {
    render(<IntegrationHub />);
    expect(screen.getByText("Test Webhook")).toBeInTheDocument();
  });

  it("shows the Integration Health Summary card", async () => {
    render(<IntegrationHub />);
    await waitFor(() => expect(screen.getByText("Integration Health Summary")).toBeInTheDocument());
  });

  it("shows inbound webhook paths in HMAC Webhook Endpoints", async () => {
    render(<IntegrationHub />);
    await waitFor(() => expect(screen.getByText(/cbs\/customer-updated/)).toBeInTheDocument());
  });
});
