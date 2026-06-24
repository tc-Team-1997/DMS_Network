import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import CaseManagement from "./CaseManagement.js";

// jsdom does not implement ResizeObserver (used by recharts).
// Provide a no-op shim so chart components mount without crashing.
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    (globalThis as any).ResizeObserver = class ResizeObserver {
      observe()   { /* no-op */ }
      unobserve() { /* no-op */ }
      disconnect(){ /* no-op */ }
    };
  }
});

// Mock AuthContext
vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      username: "supervisor1",
      roles: ["Supervisor"],
      permissions: ["case:read", "case:create", "case:manage", "workflow:read"],
    },
    logout: vi.fn(),
  }),
}));

const MOCK_CASES: any[] = [
  {
    id: 1,
    case_ref: "CASE-KYC-1",
    case_type: "KYC",
    title: "KYC Annual Review — Ahmed Hassan Ibrahim",
    status: "Open",
    assigned_to: "checker1",
    due_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    workflow_id: 7,
    created_by: "maker1",
    created_at: new Date().toISOString(),
    resolved_at: null,
    resolution: null,
  },
  {
    id: 2,
    case_ref: "CASE-Loan-1",
    case_type: "Loan",
    title: "Mortgage Application — Mohamed Farouk Aly",
    status: "InReview",
    assigned_to: "checker2",
    due_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    workflow_id: null,
    created_by: "maker2",
    created_at: new Date().toISOString(),
    resolved_at: null,
    resolution: null,
  },
  {
    id: 3,
    case_ref: "CASE-AML-1",
    case_type: "AML",
    title: "AML Compliance Review — Nour Khaled Rashid",
    status: "Resolved",
    assigned_to: null,
    due_at: null,
    workflow_id: null,
    created_by: "supervisor1",
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    resolved_at: new Date().toISOString(),
    resolution: "AML check cleared",
  },
];

const MOCK_METRICS = {
  total: 3,
  open: 2,
  resolved: 1,
  by_type: { KYC: 1, Loan: 1, AML: 1 },
  avg_resolution_minutes: 2880,
};

const MOCK_TEMPLATES = [
  { id: 1, name: "KYC Approval", doc_type: "BT_CID_4G", steps_json: "[]", active: true },
];

describe("CaseManagement screen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the page header", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ cases: MOCK_CASES }) })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_METRICS })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ templates: MOCK_TEMPLATES }) }) as any;

    render(<CaseManagement />);
    expect(screen.getByText("Case Management")).toBeInTheDocument();
  });

  it("fetches cases and metrics from /svc/workflow/cases and /svc/workflow/cases/metrics", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ cases: MOCK_CASES }) })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_METRICS })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ templates: MOCK_TEMPLATES }) });
    globalThis.fetch = fetchMock as any;

    render(<CaseManagement />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const urls = fetchMock.mock.calls.map(([url]: [string]) => url);
    expect(urls.some((u) => u.includes("/cases/metrics"))).toBe(true);
    expect(urls.some((u) => {
      // matches /cases but NOT /cases/metrics
      return u.includes("/cases") && !u.includes("/metrics");
    })).toBe(true);
  });

  it("shows case ref codes and titles in the table", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ cases: MOCK_CASES }) })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_METRICS })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ templates: MOCK_TEMPLATES }) }) as any;

    render(<CaseManagement />);

    await waitFor(() => {
      expect(screen.getByText("CASE-KYC-1")).toBeInTheDocument();
    });
    expect(screen.getByText("CASE-Loan-1")).toBeInTheDocument();
    expect(screen.getByText("CASE-AML-1")).toBeInTheDocument();
    expect(screen.getByText("KYC Annual Review — Ahmed Hassan Ibrahim")).toBeInTheDocument();
  });

  it("renders KPI cards with metrics data", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ cases: MOCK_CASES }) })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_METRICS })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ templates: MOCK_TEMPLATES }) }) as any;

    render(<CaseManagement />);

    await waitFor(() => {
      expect(screen.getByText("Active Cases")).toBeInTheDocument();
    });
    expect(screen.getByText("Closed This Month")).toBeInTheDocument();
    expect(screen.getByText("Overdue Cases")).toBeInTheDocument();
    expect(screen.getByText("Avg Resolution")).toBeInTheDocument();
  });

  it("renders Resolved tag for resolved cases", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ cases: MOCK_CASES }) })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_METRICS })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ templates: MOCK_TEMPLATES }) }) as any;

    render(<CaseManagement />);

    await waitFor(() => expect(screen.getByText("CASE-AML-1")).toBeInTheDocument());

    // Should show Resolved tag (appears at least once in the table)
    const resolvedBadges = screen.getAllByText("Resolved");
    expect(resolvedBadges.length).toBeGreaterThan(0);
  });

  it("type tabs filter correctly — clicking KYC shows only KYC cases", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ cases: MOCK_CASES }) })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_METRICS })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ templates: MOCK_TEMPLATES }) }) as any;

    render(<CaseManagement />);

    await waitFor(() => expect(screen.getByText("CASE-KYC-1")).toBeInTheDocument());

    // Click the KYC Onboarding tab
    fireEvent.click(screen.getByRole("button", { name: "KYC Onboarding" }));

    // KYC case should still be visible
    expect(screen.getByText("CASE-KYC-1")).toBeInTheDocument();
    // Loan case should no longer be visible
    expect(screen.queryByText("CASE-Loan-1")).not.toBeInTheDocument();
  });

  it("shows + New Case button for users with case:create permission", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ cases: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...MOCK_METRICS, total: 0, open: 0 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ templates: MOCK_TEMPLATES }) }) as any;

    render(<CaseManagement />);

    await waitFor(() => {
      const newCaseBtns = screen.getAllByRole("button", { name: /new case/i });
      expect(newCaseBtns.length).toBeGreaterThan(0);
    });
  });

  it("opens the New Case modal when + New Case is clicked", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ cases: MOCK_CASES }) })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_METRICS })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ templates: MOCK_TEMPLATES }) }) as any;

    render(<CaseManagement />);

    await waitFor(() => expect(screen.getByText("CASE-KYC-1")).toBeInTheDocument());

    // Click the header + New Case button
    const btns = screen.getAllByRole("button", { name: /new case/i });
    fireEvent.click(btns[0]);

    // Modal should open
    await waitFor(() => expect(screen.getByText("New Case")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /create case/i })).toBeInTheDocument();
  });

  it("calls POST /svc/workflow/cases when the new case form is submitted", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ cases: MOCK_CASES }) })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_METRICS })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ templates: MOCK_TEMPLATES }) })
      // POST /cases
      .mockResolvedValueOnce({ ok: true, json: async () => ({ case: { ...MOCK_CASES[0], id: 99, case_ref: "CASE-AML-2" } }) })
      // refresh after create
      .mockResolvedValueOnce({ ok: true, json: async () => ({ cases: MOCK_CASES }) })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_METRICS })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ templates: MOCK_TEMPLATES }) });
    globalThis.fetch = fetchMock as any;

    render(<CaseManagement />);
    await waitFor(() => expect(screen.getByText("CASE-KYC-1")).toBeInTheDocument());

    // Open modal
    const btns = screen.getAllByRole("button", { name: /new case/i });
    fireEvent.click(btns[0]);
    await waitFor(() => expect(screen.getByText("New Case")).toBeInTheDocument());

    // Fill in the title
    const titleInput = screen.getByPlaceholderText(/kyc annual review/i);
    fireEvent.change(titleInput, { target: { value: "AML Review — Test Case" } });

    // Submit
    fireEvent.click(screen.getByRole("button", { name: /create case/i }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map(([url, opts]: [string, RequestInit]) => ({ url, method: opts?.method }));
      expect(calls.some((c) => c.url.includes("/cases") && !c.url.includes("/metrics") && c.method === "POST")).toBe(true);
    });
  });

  it("displays the donut chart and breakdown table when metrics have by_type data", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ cases: MOCK_CASES }) })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_METRICS })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ templates: MOCK_TEMPLATES }) }) as any;

    render(<CaseManagement />);

    await waitFor(() => expect(screen.getByText("Cases by Type")).toBeInTheDocument());
    expect(screen.getByText("Case Type Breakdown")).toBeInTheDocument();
  });
});
