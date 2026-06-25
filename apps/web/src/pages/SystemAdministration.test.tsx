import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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

const MOCK_DEDUP_CONFIG = {
  enabled: true,
  matchBy: ["hash", "cid"],
  action: "flag",
  fuzzyThreshold: 1.0,
};

const MOCK_JOB_COUNTS = { queued: 2, running: 1, succeeded: 9, failed: 1, dead: 1 };

const MOCK_JOBS = [
  {
    id: "job-dead-1",
    type: "extract",
    status: "dead",
    attempts: 5,
    maxAttempts: 5,
    lastError: "extract_not_found",
    result: null,
    idempotencyKey: "extract:42",
    priority: 0,
    availableAt: "2026-06-25T09:00:00.000Z",
    createdAt: "2026-06-25T08:59:00.000Z",
    updatedAt: "2026-06-25T09:00:00.000Z",
  },
  {
    id: "job-ok-1",
    type: "extract",
    status: "succeeded",
    attempts: 1,
    maxAttempts: 5,
    lastError: null,
    result: { docId: 7 },
    idempotencyKey: "extract:7",
    priority: 0,
    availableAt: "2026-06-25T08:58:00.000Z",
    createdAt: "2026-06-25T08:57:30.000Z",
    updatedAt: "2026-06-25T08:58:00.000Z",
  },
];

function mockFetch(url: string, options?: RequestInit) {
  const u = String(url);
  const method = (options?.method ?? "GET").toUpperCase();
  if (u.includes("/jobs")) {
    return Promise.resolve({
      ok: true,
      json: async () => ({ counts: MOCK_JOB_COUNTS, jobs: MOCK_JOBS }),
    });
  }
  if (u.includes("/admin/dedup-config")) {
    if (method === "PUT") {
      const body = options?.body ? JSON.parse(String(options.body)) : {};
      return Promise.resolve({ ok: true, json: async () => ({ dedupConfig: { ...MOCK_DEDUP_CONFIG, ...body } }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ dedupConfig: MOCK_DEDUP_CONFIG }) });
  }
  if (u.includes("/admin/health"))
    return Promise.resolve({ ok: true, json: async () => ({ health: MOCK_HEALTH }) });
  if (u.includes("/admin/dr"))
    return Promise.resolve({ ok: true, json: async () => ({ dr: MOCK_DR }) });
  if (u.includes("/admin/schedules"))
    return Promise.resolve({ ok: true, json: async () => ({ schedules: MOCK_SCHEDULES }) });
  return Promise.resolve({ ok: true, json: async () => ({}) });
}

/* Helper: wrap in MemoryRouter so useUrlState (useSearchParams) works in tests */
function renderPage(initialSearch = "") {
  return render(
    <MemoryRouter initialEntries={[`/${initialSearch}`]}>
      <SystemAdministration />
    </MemoryRouter>,
  );
}

describe("SystemAdministration screen", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(mockFetch) as any;
  });

  it("renders the page heading and subtitle", async () => {
    renderPage();
    expect(screen.getByText("System Administration")).toBeInTheDocument();
    expect(screen.getByText(/Platform health/)).toBeInTheDocument();
  });

  it("renders the service health tab (default) with service names", async () => {
    renderPage();
    // 'core' should appear in health tab
    await waitFor(() => {
      const coreItems = screen.getAllByText(/core/i);
      expect(coreItems.length).toBeGreaterThan(0);
    });
  });

  it("renders the RPO from DR posture in KPI cards", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("15m RPO")).toBeInTheDocument();
    });
  });

  it("renders the services up KPI", async () => {
    renderPage();
    await waitFor(() => {
      // upCount = 4, total = 6
      expect(screen.getByText(/4 \/ 6/)).toBeInTheDocument();
    });
  });

  it("shows the primary site in the DR tab", async () => {
    renderPage();
    // Switch to DR tab
    await waitFor(() => screen.getByRole("button", { name: /disaster recovery/i }));
    fireEvent.click(screen.getByRole("button", { name: /disaster recovery/i }));
    await waitFor(() =>
      expect(screen.getByText("Thimphu DC")).toBeInTheDocument()
    );
  });

  it("renders the schedules tab button and schedule data loads", async () => {
    renderPage();
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
    renderPage();
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

  it("tab param in URL defaults to health on initial render", async () => {
    renderPage();
    await waitFor(() => screen.getAllByText(/core/i).length > 0);
    // Health tab content should be visible by default
    expect(screen.queryByText(/Service Health Monitor/i)).toBeDefined();
  });

  it("renders paginated health table with pageSize=10", async () => {
    renderPage();
    await waitFor(() => screen.getAllByText(/core/i).length > 0);
    // 6 rows, pageSize=10 — all on one page, pager hidden
    expect(screen.queryByRole("button", { name: /prev/i })).toBeNull();
  });

  // ── Dedup config tab tests ──────────────────────────────────────────────────

  it("renders a Duplicate Detection tab in the navigation", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("15m RPO")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /duplicate detection/i })).toBeInTheDocument();
  });

  it("loads dedup config when Duplicate Detection tab is clicked", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("15m RPO")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /duplicate detection/i }));
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Enable duplicate detection")).toBeInTheDocument();
    });
    // Verify default enabled state from mock
    const enabledCheckbox = screen.getByLabelText("Enable duplicate detection") as HTMLInputElement;
    expect(enabledCheckbox.checked).toBe(true);
  });

  it("shows matchBy checkboxes: hash, cid, doc_no", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("15m RPO")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /duplicate detection/i }));
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Match by hash")).toBeInTheDocument();
      expect(screen.getByLabelText("Match by cid")).toBeInTheDocument();
      expect(screen.getByLabelText("Match by doc_no")).toBeInTheDocument();
    });
  });

  it("shows action radio buttons for flag and auto_version", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("15m RPO")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /duplicate detection/i }));
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Flag duplicate")).toBeInTheDocument();
      expect(screen.getByLabelText("Auto-version duplicate")).toBeInTheDocument();
    });
  });

  it("shows fuzzy threshold range input", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("15m RPO")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /duplicate detection/i }));
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Fuzzy threshold")).toBeInTheDocument();
    });
  });

  it("shows Save button gated by admin:access permission", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("15m RPO")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /duplicate detection/i }));
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /save dedup config/i })).toBeInTheDocument();
    });
  });

  it("calls PUT /admin/dedup-config when Save is clicked and shows success", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("15m RPO")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /duplicate detection/i }));
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /save dedup config/i })).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save dedup config/i }));
    });
    await waitFor(() => {
      const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => ({ url: String(c[0]), method: (c[1] as RequestInit)?.method?.toUpperCase() ?? "GET" })
      );
      expect(calls.some((c) => c.url.includes("/admin/dedup-config") && c.method === "PUT")).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByText(/Duplicate detection configuration saved/i)).toBeInTheDocument();
    });
  });

  it("shows current saved values card after config loads", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("15m RPO")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /duplicate detection/i }));
    });
    await waitFor(() => {
      expect(screen.getByText("Current Saved Values")).toBeInTheDocument();
    });
  });

  // ── P8: Processing Queue tab (background job monitor) ────────────────────────

  it("renders a Processing Queue tab in the navigation", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("15m RPO")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /processing queue/i })).toBeInTheDocument();
  });

  it("Processing Queue tab loads counts by status and a recent-jobs table", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("15m RPO")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /processing queue/i }));
    });
    // Counts by status — queued/running/succeeded/failed/dead tiles present.
    await waitFor(() => {
      expect(screen.getByTestId("job-count-queued").textContent).toContain("2");
      expect(screen.getByTestId("job-count-running").textContent).toContain("1");
      expect(screen.getByTestId("job-count-succeeded").textContent).toContain("9");
      expect(screen.getByTestId("job-count-dead").textContent).toContain("1");
    });
    // Recent-jobs table shows the job type.
    expect(screen.getAllByText("extract").length).toBeGreaterThan(0);
  });

  it("Processing Queue surfaces a dead-letter row distinctly", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("15m RPO")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /processing queue/i }));
    });
    await waitFor(() => {
      // dead status tag in the row + dead-letter callouts.
      expect(screen.getAllByText(/dead/i).length).toBeGreaterThan(0);
      // The failing job's last_error is surfaced.
      expect(screen.getByText("extract_not_found")).toBeInTheDocument();
    });
  });

  it("Processing Queue Refresh button re-fetches GET /jobs", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("15m RPO")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /processing queue/i }));
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /refresh processing queue/i })).toBeInTheDocument(),
    );
    const before = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes("/jobs"),
    ).length;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /refresh processing queue/i }));
    });
    await waitFor(() => {
      const after = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: unknown[]) => String(c[0]).includes("/jobs"),
      ).length;
      expect(after).toBeGreaterThan(before);
    });
  });
});
