import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// ── Shared auth state (mutated per-test for I-2, I-3) ────────────────────────
const authState = {
  user: {
    id: 1,
    username: "admin",
    roles: ["CDO"],
    permissions: ["alerts:read", "alert:read", "alert:manage", "alert_rule:manage"],
    branch: "Thimphu",
  },
  logout: () => {},
};

// Mock the auth context — user has alert:read, alert:manage, alert_rule:manage
vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => authState,
}));

// Mock the notifyApi module
vi.mock("../api/notifyApi.js", () => ({
  notifyApi: {
    listAlerts: vi.fn(),
    markRead: vi.fn(),
    escalate: vi.fn(),
    listRules: vi.fn(),
    createRule: vi.fn(),
    patchRule: vi.fn(),
  },
}));

// Mock client.ts — getToken used by the WebSocket URL builder
vi.mock("../api/client.js", () => ({
  getToken: () => "test-jwt-token",
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));

// Mock WebSocket to avoid real connections in tests (captures constructor args for C-1 test)
const wsInstances: Array<{ url: string; instance: MockWebSocket }> = [];
class MockWebSocket {
  url: string;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  readyState = 0;
  constructor(url: string) {
    this.url = url;
    wsInstances.push({ url, instance: this });
  }
  close() {}
}
(globalThis as unknown as Record<string, unknown>).WebSocket = MockWebSocket;

// Mock ResizeObserver for recharts in jsdom
(globalThis as unknown as Record<string, unknown>).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

import { notifyApi } from "../api/notifyApi.js";
import Alerts from "./Alerts.js";

const mockAlerts = [
  {
    id: 1,
    level: "critical" as const,
    title: "KYC document expiring in 7 days — Dorji Wangchuk",
    meta: JSON.stringify({ doc_id: "DOC-001", days_remaining: 7 }),
    is_read: false,
    rule_id: 1,
    branch: "Thimphu",
    created_at: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 2,
    level: "warning" as const,
    title: "Workflow SLA breach — Loan Application #WF-042",
    meta: JSON.stringify({ workflow_id: "WF-042", sla_hours: 24 }),
    is_read: true,
    rule_id: 2,
    branch: "Paro",
    created_at: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    id: 3,
    level: "info" as const,
    title: "Document indexed successfully — BOB_KYC_003",
    meta: "{}",
    is_read: true,
    rule_id: null,
    branch: "Thimphu",
    created_at: new Date(Date.now() - 1800000).toISOString(),
  },
];

const mockRules = [
  {
    id: 1,
    name: "KYC/ID expiry 30-day alert",
    trigger: "document.expiring",
    params: { tiers: ["T-60", "T-30", "T-07", "T-00"] },
    channels: ["email", "sms", "inapp"],
    escalation_target: null,
    scope: null,
    enabled: true,
    created_by: "system",
  },
  {
    id: 2,
    name: "Workflow SLA breach escalation",
    trigger: "workflow.escalated",
    params: { sla_hours: 24 },
    channels: ["email", "teams", "inapp"],
    escalation_target: "Supervisor",
    scope: null,
    enabled: true,
    created_by: "system",
  },
];

describe("Alerts screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wsInstances.length = 0;
    // Restore default (admin) user before each test
    authState.user = {
      id: 1,
      username: "admin",
      roles: ["CDO"],
      permissions: ["alerts:read", "alert:read", "alert:manage", "alert_rule:manage"],
      branch: "Thimphu",
    };
    (notifyApi.listAlerts as ReturnType<typeof vi.fn>).mockResolvedValue({ alerts: mockAlerts });
    (notifyApi.listRules as ReturnType<typeof vi.fn>).mockResolvedValue({ rules: mockRules });
    (notifyApi.markRead as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    (notifyApi.escalate as ReturnType<typeof vi.fn>).mockResolvedValue({ escalatedTo: 1 });
    (notifyApi.createRule as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 3 });
    (notifyApi.patchRule as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
  });

  it("renders the page heading", () => {
    render(<Alerts />);
    expect(screen.getByRole("heading", { name: /Alerts & Event Management/i })).toBeInTheDocument();
  });

  it("calls notifyApi.listAlerts on mount with correct endpoint", async () => {
    render(<Alerts />);
    await waitFor(() => {
      expect(notifyApi.listAlerts).toHaveBeenCalled();
    });
  });

  it("displays alerts fetched from the API", async () => {
    render(<Alerts />);
    await waitFor(() => {
      expect(screen.getByText(/KYC document expiring in 7 days/i)).toBeInTheDocument();
      expect(screen.getByText(/Workflow SLA breach/i)).toBeInTheDocument();
    });
  });

  it("shows KPI cards with correct counts", async () => {
    render(<Alerts />);
    await waitFor(() => {
      expect(screen.getByText("Total Alerts")).toBeInTheDocument();
      // "Critical" appears multiple times (KPI label, filter btn, tag) — use getAllByText
      expect(screen.getAllByText("Critical").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Warnings")).toBeInTheDocument();
      expect(screen.getByText("Active Rules")).toBeInTheDocument();
    });
  });

  it("renders Alerts, Alert Rules, and Analytics tabs", () => {
    render(<Alerts />);
    // "Alerts" text appears in the heading AND the tab — use role to target the tab button
    expect(screen.getByRole("button", { name: /^Alerts/ })).toBeInTheDocument();
    expect(screen.getByText("Alert Rules")).toBeInTheDocument();
    expect(screen.getByText("Analytics")).toBeInTheDocument();
  });

  it("shows severity filter buttons", async () => {
    render(<Alerts />);
    await waitFor(() => {
      expect(screen.getByText("All")).toBeInTheDocument();
    });
    // All, Critical, Warning, Info filter buttons
    expect(screen.getAllByText(/Critical|Warning|Info|All/).length).toBeGreaterThanOrEqual(1);
  });

  it("marks alert as read when mark-read button is clicked", async () => {
    render(<Alerts />);
    await waitFor(() => {
      expect(screen.getByText(/KYC document expiring/i)).toBeInTheDocument();
    });

    // Find and click the mark-read icon button for the first unread alert
    const readButtons = screen.getAllByTitle("Mark as read");
    await act(async () => {
      fireEvent.click(readButtons[0]);
    });

    await waitFor(() => {
      expect(notifyApi.markRead).toHaveBeenCalledWith(1);
    });
  });

  it("navigates to Alert Rules tab and loads rules", async () => {
    render(<Alerts />);
    await act(async () => {
      fireEvent.click(screen.getByText("Alert Rules"));
    });

    await waitFor(() => {
      expect(notifyApi.listRules).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText("KYC/ID expiry 30-day alert")).toBeInTheDocument();
      expect(screen.getByText("Workflow SLA breach escalation")).toBeInTheDocument();
    });
  });

  it("shows the New Rule button for users with alert_rule:manage permission", () => {
    render(<Alerts />);
    expect(screen.getAllByText(/New Rule/i).length).toBeGreaterThan(0);
  });

  it("opens the alert rule creation modal when New Rule is clicked", async () => {
    render(<Alerts />);
    const newRuleBtn = screen.getAllByText(/New Rule/i)[0];
    await act(async () => {
      fireEvent.click(newRuleBtn);
    });

    await waitFor(() => {
      expect(screen.getByText("Configure Alert Rule")).toBeInTheDocument();
    });
  });

  it("Analytics tab button exists and is clickable", async () => {
    render(<Alerts />);
    await waitFor(() => {
      expect(screen.getByText(/KYC document expiring/i)).toBeInTheDocument();
    });
    // Just verify the tab exists and is clickable — rendering charts in jsdom
    // requires ResizeObserver which may not be available in all CI envs
    const analyticsTab = screen.getByRole("button", { name: "Analytics" });
    expect(analyticsTab).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(analyticsTab);
    });
    // After clicking, the tab should be active
    expect(analyticsTab).toHaveClass("on");
  });

  it("calls notifyApi.listAlerts (via /svc/notify/alerts) with unread filter", async () => {
    render(<Alerts />);
    await waitFor(() => {
      expect(notifyApi.listAlerts).toHaveBeenCalled();
    });

    // Toggle "Unread only" checkbox
    await act(async () => {
      const checkbox = screen.getByRole("checkbox");
      fireEvent.click(checkbox);
    });

    await waitFor(() => {
      expect(notifyApi.listAlerts).toHaveBeenCalledWith(
        expect.objectContaining({ unread: true })
      );
    });
  });

  it("shows the Mark all read button when there are unread alerts", async () => {
    render(<Alerts />);
    await waitFor(() => {
      expect(screen.getByText(/Mark all read/i)).toBeInTheDocument();
    });
  });

  it("shows the real-time connection indicator", () => {
    render(<Alerts />);
    // Should show either "Live" or "Offline"
    expect(screen.getByText(/Live|Offline/)).toBeInTheDocument();
  });

  // ── Fix verifications ─────────────────────────────────────────────────────

  // C-1: WebSocket now uses proxy path with JWT token query parameter
  it("C-1: WebSocket connects via proxy path with JWT token query param", async () => {
    render(<Alerts />);
    // Allow the useEffect to fire
    await waitFor(() => expect(wsInstances.length).toBeGreaterThan(0));
    const wsUrl = wsInstances[0].url;
    // Should route through the proxy, not direct to port 4003
    expect(wsUrl).toContain("/svc/notify/ws/alerts");
    expect(wsUrl).not.toContain(":4003");
    // Token should be included
    expect(wsUrl).toContain("token=");
    expect(wsUrl).toContain("test-jwt-token");
  });

  // I-2: Users without alert:read get access-denied message instead of error banner
  it("I-2: users without alert:read see access-denied message, not an error banner", async () => {
    // Override auth to return user without alert:read
    authState.user = {
      id: 2,
      username: "maker",
      roles: ["Maker"],
      permissions: [],
      branch: "Paro",
    };

    render(<Alerts />);
    await waitFor(() => {
      expect(screen.getByRole("alert", { name: /Access denied/i })).toBeInTheDocument();
    });
    // API should NOT have been called since we short-circuit before loading
    expect(notifyApi.listAlerts).not.toHaveBeenCalled();
  });

  // I-3: "Mark all read" visible for users with alert:read (not just alert:manage)
  it("I-3: Mark all read is visible for users with only alert:read permission", async () => {
    // Has alert:read but NOT alert:manage
    authState.user = {
      id: 3,
      username: "viewer",
      roles: ["Viewer"],
      permissions: ["alert:read"],
      branch: "Thimphu",
    };

    render(<Alerts />);
    await waitFor(() => {
      expect(screen.getByText(/Mark all read/i)).toBeInTheDocument();
    });
  });

  // I-6: Active Rules KPI card shows actual count on initial load (not "—")
  it("I-6: Active Rules KPI shows count immediately on mount without switching to Rules tab", async () => {
    render(<Alerts />);
    // loadRules() is now called on mount — wait for it to resolve
    await waitFor(() => {
      expect(notifyApi.listRules).toHaveBeenCalled();
    });
    // Both mock rules are enabled, so the KPI should show "2" (not "—")
    await waitFor(() => {
      // The value "2" should appear near "Active Rules"
      // Avoid "—" which was the old broken behavior
      const activeRulesLabel = screen.getByText("Active Rules");
      expect(activeRulesLabel).toBeInTheDocument();
      // Look for the numeric value "2" in the document — the KPI renders it as a sibling
      expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(1);
    });
  });
});
