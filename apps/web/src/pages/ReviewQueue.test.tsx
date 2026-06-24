/**
 * ReviewQueue screen tests — mock fetch, assert table renders and claim/resolve calls correct endpoints.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ReviewQueue from "./ReviewQueue.js";
import * as aiApi from "../api/aiEngine.js";

/* ── Polyfill ResizeObserver (recharts uses it in jsdom) ── */
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(globalThis, "ResizeObserver", { value: FakeResizeObserver, writable: true });

/* ── Stub AuthContext ── */
vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      username: "reviewer1",
      roles: ["Checker"],
      permissions: ["review:read", "review:write"],
    },
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

const PENDING_ROW: aiApi.ReviewRow = {
  id: 1,
  doc_id: "DOC-20260623-001",
  doc_type: "BT_CID_4G",
  confidence: 0.60,
  band: "0.50-0.69",
  sla_hours: 24,
  sla_deadline: new Date(Date.now() + 20 * 3_600_000).toISOString(), // 20h from now
  status: "PENDING",
};

const CLAIMED_ROW: aiApi.ReviewRow = {
  id: 2,
  doc_id: "DOC-20260623-002",
  doc_type: "BT_PASSPORT",
  confidence: 0.75,
  band: "0.70-0.84",
  sla_hours: 48,
  sla_deadline: new Date(Date.now() + 40 * 3_600_000).toISOString(),
  status: "CLAIMED",
};

const RESOLVED_ROW: aiApi.ReviewRow = {
  id: 3,
  doc_id: "DOC-20260623-003",
  doc_type: "BOB_LOAN_APPLICATION",
  confidence: 0.80,
  band: "0.70-0.84",
  sla_hours: 48,
  sla_deadline: null,
  status: "RESOLVED",
};

beforeEach(() => {
  vi.spyOn(aiApi, "listPendingReviews").mockResolvedValue([PENDING_ROW, CLAIMED_ROW, RESOLVED_ROW]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ════════════════════════════════════════════════
   ReviewQueue screen tests
═════════════════════════════════════════════════= */
describe("ReviewQueue screen", () => {
  it("renders the page header and KPI cards", async () => {
    render(<ReviewQueue />);
    await waitFor(() => {
      expect(screen.getByText("Human-Review Queue")).toBeInTheDocument();
    });
    expect(screen.getByText("Pending Review")).toBeInTheDocument();
    expect(screen.getByText("Claimed / In-Progress")).toBeInTheDocument();
    expect(screen.getByText("SLA Breached")).toBeInTheDocument();
    expect(screen.getByText("Resolved (queue)")).toBeInTheDocument();
  });

  it("calls listPendingReviews on mount and hits the /idp/review/pending endpoint", async () => {
    render(<ReviewQueue />);
    await waitFor(() => {
      expect(aiApi.listPendingReviews).toHaveBeenCalled();
    });
  });

  it("renders pending doc_id in the table", async () => {
    render(<ReviewQueue />);
    await waitFor(() => {
      expect(screen.getByText("DOC-20260623-001")).toBeInTheDocument();
    });
  });

  it("shows claim button (aria-label=claim) for pending items", async () => {
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByText("DOC-20260623-001")).toBeInTheDocument());

    // Use aria-label to disambiguate from the "Claimed (1)" tab
    expect(screen.getByRole("button", { name: "claim" })).toBeInTheDocument();
  });

  it("calls claimReview with the item id and current user when claim is clicked", async () => {
    const claimSpy = vi.spyOn(aiApi, "claimReview").mockResolvedValue({
      ...PENDING_ROW,
      status: "CLAIMED",
    });
    vi.spyOn(aiApi, "listPendingReviews")
      .mockResolvedValueOnce([PENDING_ROW, CLAIMED_ROW, RESOLVED_ROW])
      .mockResolvedValueOnce([{ ...PENDING_ROW, status: "CLAIMED" }, CLAIMED_ROW, RESOLVED_ROW]);

    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByRole("button", { name: "claim" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "claim" }));

    await waitFor(() => {
      expect(claimSpy).toHaveBeenCalledWith(1, expect.any(String));
    });
  });

  it("switches to Claimed tab and shows approve/reject buttons", async () => {
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByText("Human-Review Queue")).toBeInTheDocument());

    // Switch to Claimed tab — use the tab button with "Claimed" text
    const tabs = screen.getAllByRole("button");
    const claimedTab = tabs.find((b) => /^claimed/i.test(b.textContent ?? ""));
    expect(claimedTab).toBeDefined();
    fireEvent.click(claimedTab!);

    await waitFor(() => {
      expect(screen.getByText("DOC-20260623-002")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "reject" })).toBeInTheDocument();
  });

  it("opens a confirmation modal when approve is clicked", async () => {
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByText("Human-Review Queue")).toBeInTheDocument());

    // Switch to Claimed tab
    const tabs = screen.getAllByRole("button");
    const claimedTab = tabs.find((b) => /^claimed/i.test(b.textContent ?? ""));
    fireEvent.click(claimedTab!);
    await waitFor(() => expect(screen.getByRole("button", { name: "approve" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "approve" }));

    await waitFor(() => {
      expect(screen.getByText("Confirm Approval")).toBeInTheDocument();
    });
  });

  it("calls resolveReview with APPROVED when confirm approve is clicked", async () => {
    const resolveSpy = vi.spyOn(aiApi, "resolveReview").mockResolvedValue({
      ...CLAIMED_ROW,
      status: "RESOLVED",
      resolution: "APPROVED",
    } as aiApi.ReviewRow);
    vi.spyOn(aiApi, "listPendingReviews")
      .mockResolvedValueOnce([PENDING_ROW, CLAIMED_ROW, RESOLVED_ROW])
      .mockResolvedValueOnce([PENDING_ROW, { ...CLAIMED_ROW, status: "RESOLVED" }, RESOLVED_ROW]);

    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByText("Human-Review Queue")).toBeInTheDocument());

    const tabs = screen.getAllByRole("button");
    const claimedTab = tabs.find((b) => /^claimed/i.test(b.textContent ?? ""));
    fireEvent.click(claimedTab!);
    await waitFor(() => expect(screen.getByRole("button", { name: "approve" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "approve" }));

    await waitFor(() => expect(screen.getByText("Confirm Approval")).toBeInTheDocument());

    const confirmBtn = screen.getByRole("button", { name: /confirm approve/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(resolveSpy).toHaveBeenCalledWith(2, "APPROVED");
    });
  });

  it("calls resolveReview with REJECTED when reject confirm is clicked", async () => {
    const resolveSpy = vi.spyOn(aiApi, "resolveReview").mockResolvedValue({
      ...CLAIMED_ROW,
      status: "RESOLVED",
      resolution: "REJECTED",
    } as aiApi.ReviewRow);
    vi.spyOn(aiApi, "listPendingReviews")
      .mockResolvedValueOnce([PENDING_ROW, CLAIMED_ROW, RESOLVED_ROW])
      .mockResolvedValueOnce([PENDING_ROW, { ...CLAIMED_ROW, status: "RESOLVED" }, RESOLVED_ROW]);

    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByText("Human-Review Queue")).toBeInTheDocument());

    const tabs = screen.getAllByRole("button");
    const claimedTab = tabs.find((b) => /^claimed/i.test(b.textContent ?? ""));
    fireEvent.click(claimedTab!);
    await waitFor(() => expect(screen.getByRole("button", { name: "reject" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "reject" }));

    await waitFor(() => expect(screen.getByText("Confirm Rejection")).toBeInTheDocument());

    const confirmBtn = screen.getByRole("button", { name: /confirm reject/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(resolveSpy).toHaveBeenCalledWith(2, "REJECTED");
    });
  });

  it("shows resolved items in the Resolved tab", async () => {
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByText("Human-Review Queue")).toBeInTheDocument());

    const tabs = screen.getAllByRole("button");
    const resolvedTab = tabs.find((b) => /^resolved/i.test(b.textContent ?? ""));
    fireEvent.click(resolvedTab!);

    await waitFor(() => {
      expect(screen.getByText("DOC-20260623-003")).toBeInTheDocument();
    });
  });

  it("shows a detail side panel when a row is clicked", async () => {
    render(<ReviewQueue />);
    await waitFor(() => expect(screen.getByText("DOC-20260623-001")).toBeInTheDocument());

    fireEvent.click(screen.getByText("DOC-20260623-001"));

    await waitFor(() => {
      expect(screen.getByText("Review Detail —")).toBeInTheDocument();
    });
  });

  it("shows error state when listPendingReviews fails", async () => {
    vi.spyOn(aiApi, "listPendingReviews").mockRejectedValue(new Error("Network error"));

    render(<ReviewQueue />);
    await waitFor(() => {
      expect(screen.getByText(/Network error/i)).toBeInTheDocument();
    });
  });
});
