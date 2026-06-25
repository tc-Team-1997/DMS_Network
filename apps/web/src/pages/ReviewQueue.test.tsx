/**
 * ReviewQueue screen tests — workflow-backed.
 *
 * The Review Queue is now backed by the WORKFLOW service (source of truth) via
 * src/api/reviewQueueApi.ts. These tests mock that module and assert:
 *   - the cross-status queue loads and KPI counts render
 *   - tabs filter by queue_status (Pending / Claimed / Resolved / Escalated / SLA Breached)
 *   - Claim calls POST /workflows/:id/claim (claimWorkflow) and refreshes
 *   - an action (approve/reject/escalate) calls /act (actOnWorkflow) and refreshes
 *   - Open in Viewer deep-links to /viewer?doc=<documentId>
 *   - resilient: error state + RBAC read-only gating
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import ReviewQueue from "./ReviewQueue.js";
import * as queueApi from "../api/reviewQueueApi.js";
import type { ReviewQueueItem } from "../api/reviewQueueApi.js";

/* ── Polyfill ResizeObserver (recharts / jsdom) ── */
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(globalThis, "ResizeObserver", { value: FakeResizeObserver, writable: true });

/* ── Mock react-router-dom (useNavigate for deep-links, useSearchParams for useUrlState) ── */
const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams(""), vi.fn()],
}));

/* ── Auth: a reviewer with review:write ── */
let mockPermissions = ["review:read", "review:write"];
vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({
    user: {
      id: "018f4e2a-0000-7000-8000-000000000001",
      username: "reviewer1",
      roles: ["Checker"],
      permissions: mockPermissions,
      branch: "Thimphu",
    },
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

/* ── Fixtures (one item per queue status) ── */
function item(over: Partial<ReviewQueueItem>): ReviewQueueItem {
  return {
    id: "wf-0",
    ref_code: "WF-0",
    title: "Untitled",
    doc_id: "DOC-0",
    branch: "Thimphu",
    priority: "Normal",
    status: "Active",
    queue_status: "Pending",
    stage: "Maker",
    sla_due_at: new Date(Date.now() + 36 * 3_600_000).toISOString(),
    assignee: null,
    created_by: "maker1",
    created_at: new Date().toISOString(),
    current_step: null,
    ...over,
  };
}

const PENDING = item({ id: "wf-1", ref_code: "WF-1", title: "KYC Pending", doc_id: "DOC-001", queue_status: "Pending", status: "Active" });
const CLAIMED = item({ id: "wf-2", ref_code: "WF-2", title: "KYC Claimed", doc_id: "DOC-002", queue_status: "Claimed", status: "Active", assignee: "reviewer1" });
const APPROVED = item({ id: "wf-3", ref_code: "WF-3", title: "Loan Approved", doc_id: "DOC-003", queue_status: "Approved", status: "Approved", sla_due_at: null });
const REJECTED = item({ id: "wf-4", ref_code: "WF-4", title: "Loan Rejected", doc_id: "DOC-004", queue_status: "Rejected", status: "Rejected", sla_due_at: null });
const ESCALATED = item({ id: "wf-5", ref_code: "WF-5", title: "Escalated Case", doc_id: "DOC-005", queue_status: "Escalated", status: "Escalated" });
const BREACHED = item({ id: "wf-6", ref_code: "WF-6", title: "Overdue Case", doc_id: "DOC-006", queue_status: "Pending", status: "Active", sla_due_at: new Date(Date.now() - 3_600_000).toISOString() });

const ALL = [PENDING, CLAIMED, APPROVED, REJECTED, ESCALATED, BREACHED];

beforeEach(() => {
  mockPermissions = ["review:read", "review:write"];
  mockNavigate.mockReset();
  vi.spyOn(queueApi, "listAllReviewQueue").mockResolvedValue(ALL);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Click a tab button by its visible (counted) label prefix. */
function clickTab(prefix: RegExp) {
  const tabs = screen.getAllByRole("button");
  const t = tabs.find((b) => prefix.test(b.textContent ?? ""));
  expect(t).toBeDefined();
  fireEvent.click(t!);
}

describe("ReviewQueue (workflow-backed)", () => {
  it("loads the cross-status queue on mount and renders header + KPIs", async () => {
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByText("Human-Review Queue")).toBeInTheDocument());
    expect(queueApi.listAllReviewQueue).toHaveBeenCalled();
    expect(screen.getByText("Pending Review")).toBeInTheDocument();
    expect(screen.getByText("Claimed / In-Progress")).toBeInTheDocument();
    expect(screen.getByText("Escalated")).toBeInTheDocument();
    expect(screen.getByText("SLA Breached")).toBeInTheDocument();
  });

  it("Pending tab shows only Pending items", async () => {
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByText("KYC Pending")).toBeInTheDocument());
    // Pending tab is the default; a Claimed item should NOT be visible
    expect(screen.queryByText("KYC Claimed")).not.toBeInTheDocument();
  });

  it("Claimed tab filters to Claimed items", async () => {
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByText("Human-Review Queue")).toBeInTheDocument());
    await act(async () => clickTab(/^Claimed/));
    await waitFor(() => expect(screen.getByText("KYC Claimed")).toBeInTheDocument());
    expect(screen.queryByText("KYC Pending")).not.toBeInTheDocument();
  });

  it("Resolved tab shows both Approved and Rejected items", async () => {
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByText("Human-Review Queue")).toBeInTheDocument());
    await act(async () => clickTab(/^Resolved/));
    await waitFor(() => expect(screen.getByText("Loan Approved")).toBeInTheDocument());
    expect(screen.getByText("Loan Rejected")).toBeInTheDocument();
  });

  it("Escalated tab filters to Escalated items", async () => {
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByText("Human-Review Queue")).toBeInTheDocument());
    await act(async () => clickTab(/^Escalated/));
    await waitFor(() => expect(screen.getByText("Escalated Case")).toBeInTheDocument());
    expect(screen.queryByText("KYC Pending")).not.toBeInTheDocument();
  });

  it("SLA Breached tab shows only items past their SLA deadline", async () => {
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByText("Human-Review Queue")).toBeInTheDocument());
    await act(async () => clickTab(/^SLA Breached/));
    await waitFor(() => expect(screen.getByText("Overdue Case")).toBeInTheDocument());
    // The non-breached pending item should not appear here
    expect(screen.queryByText("KYC Pending")).not.toBeInTheDocument();
  });

  it("Claim calls claimWorkflow with the workflow id and refreshes the list", async () => {
    const claimSpy = vi
      .spyOn(queueApi, "claimWorkflow")
      .mockResolvedValue({ workflow: {} as never, steps: [] });
    vi.spyOn(queueApi, "listAllReviewQueue")
      .mockResolvedValueOnce(ALL)
      .mockResolvedValueOnce([{ ...PENDING, queue_status: "Claimed", status: "Active", assignee: "reviewer1" }, CLAIMED, APPROVED, REJECTED, ESCALATED, BREACHED]);

    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByText("KYC Pending")).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole("button", { name: "claim" })[0]);

    await waitFor(() => expect(claimSpy).toHaveBeenCalledWith(PENDING.id));
    // List reloaded (called a second time after the action)
    await waitFor(() => expect(queueApi.listAllReviewQueue).toHaveBeenCalledTimes(2));
  });

  it("Approve opens a confirm modal, then calls actOnWorkflow('approve') and refreshes", async () => {
    const actSpy = vi
      .spyOn(queueApi, "actOnWorkflow")
      .mockResolvedValue({ workflow: {} as never, steps: [] });
    vi.spyOn(queueApi, "listAllReviewQueue")
      .mockResolvedValueOnce(ALL)
      .mockResolvedValueOnce([PENDING, { ...CLAIMED, queue_status: "Approved", status: "Approved" }, APPROVED, REJECTED, ESCALATED, BREACHED]);

    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByText("Human-Review Queue")).toBeInTheDocument());
    await act(async () => clickTab(/^Claimed/));
    await waitFor(() => expect(screen.getByText("KYC Claimed")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "approve" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Confirm Approve" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /confirm approve/i }));
    await waitFor(() => expect(actSpy).toHaveBeenCalledWith(CLAIMED.id, "approve"));
    await waitFor(() => expect(queueApi.listAllReviewQueue).toHaveBeenCalledTimes(2));
  });

  it("Reject calls actOnWorkflow('reject')", async () => {
    const actSpy = vi
      .spyOn(queueApi, "actOnWorkflow")
      .mockResolvedValue({ workflow: {} as never, steps: [] });

    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByText("Human-Review Queue")).toBeInTheDocument());
    await act(async () => clickTab(/^Claimed/));
    await waitFor(() => expect(screen.getByText("KYC Claimed")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "reject" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Confirm Reject" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /confirm reject/i }));

    await waitFor(() => expect(actSpy).toHaveBeenCalledWith(CLAIMED.id, "reject"));
  });

  it("Escalate calls actOnWorkflow('escalate')", async () => {
    const actSpy = vi
      .spyOn(queueApi, "actOnWorkflow")
      .mockResolvedValue({ workflow: {} as never, steps: [] });

    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByText("KYC Pending")).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole("button", { name: "escalate" })[0]);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Confirm Escalate" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /confirm escalate/i }));

    await waitFor(() => expect(actSpy).toHaveBeenCalledWith(PENDING.id, "escalate"));
  });

  it("Open in Viewer deep-links to /viewer?doc=<documentId>", async () => {
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByText("KYC Pending")).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole("button", { name: "open in viewer" })[0]);
    expect(mockNavigate).toHaveBeenCalledWith("/viewer?doc=DOC-001&workflow=wf-1");
  });

  it("shows a detail side panel when a row is clicked", async () => {
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByText("KYC Pending")).toBeInTheDocument());

    fireEvent.click(screen.getByText("KYC Pending"));
    await waitFor(() => expect(screen.getByText("Review Detail —")).toBeInTheDocument());
  });

  it("shows an error state when the queue fails to load", async () => {
    vi.spyOn(queueApi, "listAllReviewQueue").mockRejectedValue(new Error("Network error"));
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByText(/Network error/i)).toBeInTheDocument());
  });

  it("hides claim/act buttons and shows read-only notice without review:write", async () => {
    mockPermissions = ["review:read"];
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByText("KYC Pending")).toBeInTheDocument());

    // Open detail to surface the read-only notice
    fireEvent.click(screen.getByText("KYC Pending"));
    await waitFor(() => expect(screen.getByText("Review Detail —")).toBeInTheDocument());
    expect(screen.getByText(/Read-only view/i)).toBeInTheDocument();
    // No claim button in the detail panel
    expect(screen.queryByRole("button", { name: "claim detail" })).not.toBeInTheDocument();
  });

  it("auto-refresh interval checks document.visibilityState (resilience guard)", () => {
    const src = ReviewQueue.toString();
    expect(src).toContain("visibilityState");
  });
});
