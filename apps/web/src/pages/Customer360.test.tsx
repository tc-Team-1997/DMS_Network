import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import Customer360 from "./Customer360.js";

/* ─── ResizeObserver polyfill (recharts needs it in jsdom) ─── */
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// Mock react-router-dom useParams
vi.mock("react-router-dom", () => ({
  useParams: () => ({ cid: "20098765432" }),
}));

// Mock AuthContext
vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      username: "admin",
      roles: ["CDO"],
      permissions: ["document:read"],
    },
    logout: () => {},
  }),
}));

// Mock the api module
vi.mock("../api/customer360.js", () => ({
  fetchCustomerProfile: vi.fn().mockResolvedValue({
    cid: "20098765432",
    documents: [
      { id: 1, doc_no: "D9", doc_type: "BT_CID_4G",     status: "Indexed",  created_at: "2026-01-15" },
      { id: 2, doc_no: "D10", doc_type: "BT_PASSPORT",  status: "Archived", created_at: "2025-09-01" },
    ],
    kyc: {
      requirements: [
        { key: "identity", label: "Identity (CID / Passport)", satisfied: true },
        { key: "account",  label: "Account / Address proof",   satisfied: false },
        { key: "photo",    label: "Photograph",                satisfied: false },
        { key: "signature", label: "Specimen signature",       satisfied: false },
      ],
      completeness: 0.25,
      status: "Partial",
      escalated: true,
    },
    portfolio: [
      { doc_type: "BT_CID_4G",  count: 1 },
      { doc_type: "BT_PASSPORT", count: 1 },
    ],
    timeline: [
      { ts: "2026-06-01T09:00:00Z", action: "INDEXED",   entity_id: "1", details: "Auto-indexed" },
      { ts: "2025-09-01T14:00:00Z", action: "CAPTURED",  entity_id: "2", details: "Scanner WIA"  },
    ],
  }),
}));

describe("Customer360 screen", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("renders the page header", async () => {
    render(<Customer360 />);
    await waitFor(() =>
      expect(screen.getByText(/Customer 360°/i)).toBeInTheDocument()
    );
  });

  it("shows the customer CID in the profile", async () => {
    render(<Customer360 />);
    await waitFor(() =>
      expect(screen.getByText(/20098765432/)).toBeInTheDocument()
    );
  });

  it("shows KYC completeness percentage", async () => {
    render(<Customer360 />);
    await waitFor(() =>
      expect(screen.getAllByText(/25%/).length).toBeGreaterThanOrEqual(1)
    );
  });

  it("renders KYC requirement labels", async () => {
    render(<Customer360 />);
    await waitFor(() =>
      expect(screen.getByText(/Identity \(CID \/ Passport\)/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/Account \/ Address proof/i)).toBeInTheDocument();
    expect(screen.getByText(/Photograph/i)).toBeInTheDocument();
    expect(screen.getByText(/Specimen signature/i)).toBeInTheDocument();
  });

  it("shows the escalated warning badge when kyc.escalated is true", async () => {
    render(<Customer360 />);
    await waitFor(() =>
      expect(screen.getByText(/Escalated/i)).toBeInTheDocument()
    );
  });

  it("renders timeline events", async () => {
    render(<Customer360 />);
    await waitFor(() =>
      expect(screen.getByText("INDEXED")).toBeInTheDocument()
    );
    expect(screen.getByText("CAPTURED")).toBeInTheDocument();
  });

  it("shows portfolio doc types", async () => {
    render(<Customer360 />);
    // Portfolio items replace underscores with spaces, so BT_CID_4G becomes "BT CID 4G"
    await waitFor(() =>
      expect(screen.getAllByText(/BT CID 4G/i).length).toBeGreaterThanOrEqual(1)
    );
  });

  it("renders tabs for overview, documents, KYC and timeline", async () => {
    render(<Customer360 />);
    await waitFor(() =>
      expect(screen.getByText("Overview")).toBeInTheDocument()
    );
    expect(screen.getAllByText(/Documents/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("KYC Status")).toBeInTheDocument();
    // "Activity Timeline" appears both as tab label and card title
    expect(screen.getAllByText("Activity Timeline").length).toBeGreaterThanOrEqual(1);
  });

  it("calls fetchCustomerProfile with the cid from route params", async () => {
    const { fetchCustomerProfile } = await import("../api/customer360.js");
    render(<Customer360 />);
    await waitFor(() =>
      expect(fetchCustomerProfile).toHaveBeenCalledWith("20098765432")
    );
  });

  // M-1: timeline items use stable keys (ts_action), not array index
  it("M-1: timeline events render correctly (stable-key pattern)", async () => {
    render(<Customer360 />);
    await waitFor(() =>
      expect(screen.getByText("INDEXED")).toBeInTheDocument()
    );
    // Both timeline events visible — if keys were unstable and caused re-render
    // ordering issues these would fail or duplicate. Both should be present once.
    expect(screen.getByText("INDEXED")).toBeInTheDocument();
    expect(screen.getByText("CAPTURED")).toBeInTheDocument();
  });

  // M-1: duplicate timestamps with different actions do not collide
  it("M-1: two timeline events at same timestamp but different actions both render", async () => {
    const { fetchCustomerProfile } = await import("../api/customer360.js");
    (fetchCustomerProfile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      cid: "20098765432",
      documents: [],
      kyc: {
        requirements: [],
        completeness: 1,
        status: "Complete",
        escalated: false,
      },
      portfolio: [],
      timeline: [
        { ts: "2026-06-01T09:00:00Z", action: "INDEXED",   entity_id: "1", details: "Doc A" },
        { ts: "2026-06-01T09:00:00Z", action: "CAPTURED",  entity_id: "2", details: "Doc B" },
      ],
    });
    render(<Customer360 />);
    await waitFor(() => expect(screen.getByText("INDEXED")).toBeInTheDocument());
    expect(screen.getByText("CAPTURED")).toBeInTheDocument();
  });
});
