import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import WorkflowEngine from "./WorkflowEngine.js";

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
      username: "checker1",
      roles: ["Checker"],
      permissions: ["workflow:read", "workflow:act", "document:approve", "document:reject"],
    },
    logout: vi.fn(),
  }),
}));

const MOCK_WORKFLOWS = [
  {
    id: 7,
    ref_code: "WF-7",
    title: "KYC Review — Ahmed Hassan",
    stage: "Checker Approves",
    priority: "High",
    status: "Active",
    sla_due_at: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    assigned_to: "checker1",
    created_by: "maker1",
  },
  {
    id: 8,
    ref_code: "WF-8",
    title: "Loan App — Mohamed Farouk",
    stage: "Manager Review",
    priority: "Urgent",
    status: "Escalated",
    sla_due_at: null,
    assigned_to: "supervisor1",
    created_by: "maker2",
  },
];

const MOCK_TEMPLATES = [
  {
    id: 1,
    name: "KYC Approval",
    doc_type: "BT_CID_4G",
    steps_json: JSON.stringify([
      { name: "Maker submits", required_permissions: ["workflow:act"], sla_minutes: 60 },
      { name: "Checker approves", required_permissions: ["document:approve"], sla_minutes: 120 },
    ]),
    active: true,
  },
];

const MOCK_STEPS = [
  { id: 1, workflow_id: 7, seq: 1, name: "Maker submits", required_permissions: '["workflow:act"]', min_confidence: 0.9, status: "Approved", actor_id: 2, acted_at: new Date().toISOString(), sla_minutes: 60, due_at: null },
  { id: 2, workflow_id: 7, seq: 2, name: "Checker approves", required_permissions: '["document:approve"]', min_confidence: 0.9, status: "Pending", actor_id: null, acted_at: null, sla_minutes: 120, due_at: null },
];

describe("WorkflowEngine screen", () => {
  beforeEach(() => {
    // Reset fetch mock before each test
    vi.restoreAllMocks();
  });

  it("renders the page header and KPI cards", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workflows: MOCK_WORKFLOWS }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ templates: MOCK_TEMPLATES }) }) as any;

    render(<WorkflowEngine />);

    // Page title
    expect(screen.getByText("Workflow Engine")).toBeInTheDocument();

    // KPI labels — use getAllByText since "Active Workflows" appears both in KPI card
    // and in the card header "Active Workflows [6 requiring action]"
    await waitFor(() => {
      expect(screen.getAllByText(/Active Workflows/).length).toBeGreaterThan(0);
    });
    expect(screen.getByText("Approved This Session")).toBeInTheDocument();
    expect(screen.getByText("SLA Overdue")).toBeInTheDocument();
  });

  it("fetches and displays workflow rows with ref codes", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workflows: MOCK_WORKFLOWS }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ templates: MOCK_TEMPLATES }) }) as any;

    render(<WorkflowEngine />);

    await waitFor(() => {
      expect(screen.getByText("WF-7")).toBeInTheDocument();
    });
    expect(screen.getByText("WF-8")).toBeInTheDocument();
    expect(screen.getByText("KYC Review — Ahmed Hassan")).toBeInTheDocument();
  });

  it("calls GET /svc/workflow/workflows on mount", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workflows: MOCK_WORKFLOWS }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ templates: MOCK_TEMPLATES }) });
    globalThis.fetch = fetchMock as any;

    render(<WorkflowEngine />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const calls = fetchMock.mock.calls.map(([url]) => url as string);
    expect(calls.some((u) => u.includes("/workflows"))).toBe(true);
  });

  it("shows Tabs for filtering by status", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workflows: MOCK_WORKFLOWS }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ templates: MOCK_TEMPLATES }) }) as any;

    render(<WorkflowEngine />);

    await waitFor(() => expect(screen.getByText("WF-7")).toBeInTheDocument());

    // All tabs should be present
    expect(screen.getByRole("button", { name: "All Workflows" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Active" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Escalated" })).toBeInTheDocument();
  });

  it("clicking a row selects it and shows a Review button", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workflows: MOCK_WORKFLOWS }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ templates: MOCK_TEMPLATES }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workflow: MOCK_WORKFLOWS[0], steps: MOCK_STEPS }) }) as any;

    render(<WorkflowEngine />);

    await waitFor(() => expect(screen.getByText("WF-7")).toBeInTheDocument());

    // Click the Review button
    const reviewBtns = screen.getAllByRole("button", { name: "Review" });
    fireEvent.click(reviewBtns[0]);

    // The detail panel loads the workflow steps
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/workflows/7"),
        expect.any(Object),
      );
    });
  });

  it("calls the act endpoint with POST when Approve is clicked", async () => {
    const fetchMock = vi.fn()
      // initial list + templates
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workflows: MOCK_WORKFLOWS }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ templates: MOCK_TEMPLATES }) })
      // getWorkflow for panel (after row click)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workflow: MOCK_WORKFLOWS[0], steps: MOCK_STEPS }) })
      // act endpoint
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workflow: { ...MOCK_WORKFLOWS[0], stage: "Completed", status: "Approved" }, steps: MOCK_STEPS }) })
      // getWorkflow after act
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workflow: { ...MOCK_WORKFLOWS[0], status: "Approved" }, steps: MOCK_STEPS }) })
      // refresh list
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workflows: MOCK_WORKFLOWS }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ templates: MOCK_TEMPLATES }) });
    globalThis.fetch = fetchMock as any;

    render(<WorkflowEngine />);
    await waitFor(() => expect(screen.getByText("WF-7")).toBeInTheDocument());

    // Click Review on WF-7
    const reviewBtns = screen.getAllByRole("button", { name: "Review" });
    fireEvent.click(reviewBtns[0]);

    // Wait for detail panel + approve & forward button (specific text to avoid ambiguity)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /approve & forward/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /approve & forward/i }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map(([url, opts]: [string, RequestInit]) => ({ url, method: opts?.method }));
      expect(calls.some((c) => c.url.includes("/workflows/7/act") && c.method === "POST")).toBe(true);
    });
  });

  it("shows the + New Workflow button for users with workflow:act permission", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workflows: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ templates: MOCK_TEMPLATES }) }) as any;

    render(<WorkflowEngine />);
    await waitFor(() => expect(screen.getByRole("button", { name: /new workflow/i })).toBeInTheDocument());
  });
});
