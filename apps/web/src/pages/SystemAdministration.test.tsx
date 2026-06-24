import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { SystemAdministration } from "./SystemAdministration.js";

/* ─── ResizeObserver polyfill (recharts needs it in jsdom) ─── */
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe()    { /* noop */ }
      unobserve()  { /* noop */ }
      disconnect() { /* noop */ }
    } as unknown as typeof ResizeObserver;
  }
});

vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      username: "admin",
      roles: ["CDO"],
      permissions: ["admin:access"],
    },
    logout: () => {},
  }),
}));

const MOCK_HEALTH = [
  { service: "core", status: "Up", latency_ms: 2 },
  { service: "gateway", status: "Up", latency_ms: 5 },
  { service: "workflow", status: "Degraded", latency_ms: 847 },
  { service: "notify", status: "Up", latency_ms: 18 },
  { service: "search", status: "Up", latency_ms: 44 },
  { service: "ai", status: "Down", latency_ms: 0 },
];

const MOCK_DR = {
  primary_site: "Thimphu DC",
  dr_site: "DR Site (Phuentsholing)",
  rpo_minutes: 15,
  rto_minutes: 60,
  replication_lag_seconds: 5,
  last_failover_test: "2026-05-15",
};

const MOCK_SCHEDULES = [
  { name: "Full database backup", kind: "backup", cron: "0 2 * * *", last_run: "2026-06-22T02:00:00Z", next_run: "2026-06-23T02:00:00Z" },
  { name: "Index optimisation", kind: "maintenance", cron: "0 4 * * 6", last_run: "2026-06-21T04:00:00Z", next_run: "2026-06-28T04:00:00Z" },
];

function mockFetch(url: string) {
  const u = String(url);
  if (u.includes("/admin/health"))
    return Promise.resolve({ ok: true, json: async () => ({ health: MOCK_HEALTH }) });
  if (u.includes("/admin/dr"))
    return Promise.resolve({ ok: true, json: async () => ({ dr: MOCK_DR }) });
  if (u.includes("/admin/schedules"))
    return Promise.resolve({ ok: true, json: async () => ({ schedules: MOCK_SCHEDULES }) });
  return Promise.resolve({ ok: true, json: async () => ({}) });
}

describe("SystemAdministration screen", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(mockFetch) as any;
  });

  it("renders the page heading and subtitle", async () => {
    render(<SystemAdministration />);
    expect(screen.getByText("System Administration")).toBeInTheDocument();
    expect(screen.getByText(/Platform health/)).toBeInTheDocument();
  });

  it("renders the service health tab (default) with service names", async () => {
    render(<SystemAdministration />);
    // 'core' should appear in health tab
    await waitFor(() => {
      const coreItems = screen.getAllByText(/core/i);
      expect(coreItems.length).toBeGreaterThan(0);
    });
  });

  it("renders the RPO from DR posture in KPI cards", async () => {
    render(<SystemAdministration />);
    await waitFor(() => {
      expect(screen.getByText("15m RPO")).toBeInTheDocument();
    });
  });

  it("renders the services up KPI", async () => {
    render(<SystemAdministration />);
    await waitFor(() => {
      // upCount = 4, total = 6
      expect(screen.getByText(/4 \/ 6/)).toBeInTheDocument();
    });
  });

  it("shows the primary site in the DR tab", async () => {
    render(<SystemAdministration />);
    // Switch to DR tab
    await waitFor(() => screen.getByRole("button", { name: /disaster recovery/i }));
    fireEvent.click(screen.getByRole("button", { name: /disaster recovery/i }));
    await waitFor(() =>
      expect(screen.getByText("Thimphu DC")).toBeInTheDocument()
    );
  });

  it("renders the schedules tab button and schedule data loads", async () => {
    render(<SystemAdministration />);
    // Wait until data is loaded (health tab is default)
    await waitFor(() => expect(screen.getByText("15m RPO")).toBeInTheDocument());
    // Verify that the schedule tab button exists
    const allBtns = screen.getAllByRole("button");
    const schedTab = allBtns.find((b) => {
      const t = b.textContent ?? "";
      return t.includes("Backup") && t.includes("Maintenance");
    });
    expect(schedTab).toBeDefined();
    // Click the tab using fireEvent
    fireEvent.click(schedTab!);
    // After tab change, schedules section should render
    await waitFor(() => {
      // Look for the table structure — either the task name or the cron expression
      const cronMatches = screen.getAllByText(/0 2 \* \* \*/);
      expect(cronMatches.length).toBeGreaterThan(0);
    });
  });

  it("calls all three admin endpoints", async () => {
    render(<SystemAdministration />);
    await waitFor(() => {
      expect(screen.getByText("15m RPO")).toBeInTheDocument();
    });
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => String(c[0])
    );
    expect(calls.some((u) => u.includes("/admin/health"))).toBe(true);
    expect(calls.some((u) => u.includes("/admin/dr"))).toBe(true);
    expect(calls.some((u) => u.includes("/admin/schedules"))).toBe(true);
  });
});
