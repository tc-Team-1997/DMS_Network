import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import RecordsManagement from "./RecordsManagement.js";

/* ─── ResizeObserver polyfill (recharts needs it in jsdom) ─── */
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// Mock AuthContext with all records-related permissions
vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      username: "admin",
      roles: ["CDO"],
      permissions: ["compliance:read", "legal_hold:place", "document:delete", "admin:access"],
    },
    logout: () => {},
  }),
}));

// Mock the API module
vi.mock("../api/recordsManagement.js", () => ({
  fetchFilePlan: vi.fn().mockResolvedValue([
    { id: 1, doc_class: "GENERAL_LETTER",          retention_years: 7,  trigger: "ingest",  regulation: "Default" },
    { id: 2, doc_class: "KYC_IDENTITY_DOCUMENTS",  retention_years: 10, trigger: "closure", regulation: "CBE Reg 2/2020" },
    { id: 3, doc_class: "BOB_LOAN_APPLICATION",    retention_years: 7,  trigger: "closure", regulation: "CBE Circular 21" },
    { id: 4, doc_class: "AML_SCREENING_RECORDS",   retention_years: 10, trigger: "ingest",  regulation: "FATF / AML Law 80" },
    { id: 5, doc_class: "GDPR_PERSONAL_DATA",      retention_years: 5,  trigger: "closure", regulation: "GDPR Art.17" },
  ]),
  fetchLegalHolds: vi.fn().mockResolvedValue([
    { id: 1, ref: "LH-1",     scope: "branch:THI001",          status: "Active",   doc_count: 3,     placed_by: "admin", placed_at: "2026-01-01" },
    { id: 2, ref: "LH-CBE-1", scope: "doc_type:SAR_REPORT",    status: "Active",   doc_count: 14827, placed_by: "admin", placed_at: "2024-01-01" },
    { id: 3, ref: "LH-OLD-1", scope: "branch:LUX003",          status: "Released", doc_count: 500,   placed_by: "admin", placed_at: "2023-01-01", released_at: "2023-06-01" },
  ]),
  fetchDisposalCandidates: vi.fn().mockResolvedValue([
    { document_id: 9,  doc_no: "D9",  doc_type: "GENERAL_LETTER",     destruction_date: "2026-01-01", on_hold: false },
    { document_id: 10, doc_no: "D10", doc_type: "BOB_LOAN_APPLICATION", destruction_date: "2025-06-01", on_hold: true },
  ]),
  placeLegalHold: vi.fn().mockResolvedValue({ id: 4, ref: "LH-NEW", scope: "branch:THI001", status: "Active", doc_count: 5 }),
  releaseLegalHold: vi.fn().mockResolvedValue({ id: 1, ref: "LH-1", status: "Released", doc_count: 3 }),
  certifyDisposal: vi.fn().mockResolvedValue({ certificate: "DISPOSAL-abc-123" }),
}));

describe("RecordsManagement screen", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("renders the page header", async () => {
    render(<RecordsManagement />);
    await waitFor(() =>
      expect(screen.getByText(/Records Management/i)).toBeInTheDocument()
    );
  });

  it("shows KPI cards: managed records, legal holds, disposal, retention policies", async () => {
    render(<RecordsManagement />);
    await waitFor(() =>
      expect(screen.getByText("Legal Holds Active")).toBeInTheDocument()
    );
    expect(screen.getByText("Eligible for Disposal")).toBeInTheDocument();
    expect(screen.getByText("Retention Policies")).toBeInTheDocument();
  });

  it("renders the retention file-plan tab with doc classes", async () => {
    render(<RecordsManagement />);
    await waitFor(() =>
      expect(screen.getByText("GENERAL_LETTER")).toBeInTheDocument()
    );
    expect(screen.getByText("KYC_IDENTITY_DOCUMENTS")).toBeInTheDocument();
    expect(screen.getByText("AML_SCREENING_RECORDS")).toBeInTheDocument();
  });

  it("shows regulations in the retention table", async () => {
    render(<RecordsManagement />);
    await waitFor(() =>
      expect(screen.getByText("CBE Reg 2/2020")).toBeInTheDocument()
    );
    expect(screen.getByText("GDPR Art.17")).toBeInTheDocument();
  });

  it("renders the tabs for file-plan, holds, disposal and analytics", async () => {
    render(<RecordsManagement />);
    await waitFor(() =>
      expect(screen.getByText("Retention File Plan")).toBeInTheDocument()
    );
    // "Legal Holds" appears as tab label and possibly card title — use getAllByText
    expect(screen.getAllByText(/Legal Holds/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Disposal Queue/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Analytics")).toBeInTheDocument();
  });

  it("shows the Place Legal Hold button when user has legal_hold:place", async () => {
    render(<RecordsManagement />);
    await waitFor(() =>
      expect(screen.getByText("Place Legal Hold")).toBeInTheDocument()
    );
  });

  it("calls fetchFilePlan, fetchLegalHolds, and fetchDisposalCandidates on mount", async () => {
    const { fetchFilePlan, fetchLegalHolds, fetchDisposalCandidates } = await import("../api/recordsManagement.js");
    render(<RecordsManagement />);
    await waitFor(() =>
      expect(fetchFilePlan).toHaveBeenCalledTimes(1)
    );
    expect(fetchLegalHolds).toHaveBeenCalledTimes(1);
    expect(fetchDisposalCandidates).toHaveBeenCalledTimes(1);
  });

  // I-2: handlePlaceHold — placeLegalHold rejection shows error banner
  it("I-2: shows error banner when placeLegalHold rejects", async () => {
    const { placeLegalHold } = await import("../api/recordsManagement.js");
    (placeLegalHold as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Duplicate hold ref"));

    render(<RecordsManagement />);
    await waitFor(() => expect(screen.getByText("Place Legal Hold")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Place Legal Hold"));
    await waitFor(() => expect(screen.getByText("Place Hold")).toBeInTheDocument());

    // Fill in required fields
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "LH-ERR-01" } });
    fireEvent.change(inputs[1], { target: { value: "branch:THI001" } });

    fireEvent.click(screen.getByRole("button", { name: "Place Hold" }));

    await waitFor(() =>
      expect(screen.getByText(/Failed to place legal hold/i)).toBeInTheDocument()
    );
  });

  // I-2: handleReleaseHold — releaseLegalHold rejection shows error banner
  it("I-2: shows error banner when releaseLegalHold rejects", async () => {
    const { releaseLegalHold } = await import("../api/recordsManagement.js");
    (releaseLegalHold as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Network error"));

    render(<RecordsManagement />);
    await waitFor(() => expect(screen.getByText("GENERAL_LETTER")).toBeInTheDocument());

    // Switch to Legal Holds tab (use tab button specifically)
    const tabButtons = screen.getAllByText(/Legal Holds/);
    // Click the tab button (the one that contains "active" in the label)
    const holdTab = tabButtons.find(el => el.tagName === "BUTTON" && el.textContent?.includes("active"));
    fireEvent.click(holdTab!);
    await waitFor(() => expect(screen.getAllByText(/Release/).length).toBeGreaterThanOrEqual(1));

    // Click Release on the first active hold
    const releaseButtons = screen.getAllByText("Release");
    fireEvent.click(releaseButtons[0]);

    await waitFor(() =>
      expect(screen.getByText(/Failed to release legal hold/i)).toBeInTheDocument()
    );
  });

  // I-3: "Run Hold Check & Dispose All" and "Schedule 03:00" buttons are disabled
  it("I-3: disposal bulk action buttons are disabled (not yet implemented)", async () => {
    render(<RecordsManagement />);
    await waitFor(() => expect(screen.getByText("GENERAL_LETTER")).toBeInTheDocument());

    fireEvent.click(screen.getByText(/Disposal Queue/));
    await waitFor(() =>
      expect(screen.getByText(/Run Hold Check/i)).toBeInTheDocument()
    );

    const disposeAllBtn = screen.getByRole("button", { name: /Run Hold Check/i });
    expect(disposeAllBtn).toBeDisabled();

    const scheduleBtn = screen.getByRole("button", { name: /Schedule 03:00/i });
    expect(scheduleBtn).toBeDisabled();
  });

  // I-4: "New Retention Rule" is gated on admin:access and is disabled (not yet implemented)
  it("I-4: New Retention Rule button is visible to admin users but disabled", async () => {
    render(<RecordsManagement />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /New Retention Rule/i })).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: /New Retention Rule/i })).toBeDisabled();
  });

  // M-2: "Managed Records" KPI shows "—" not a fabricated value
  it("M-2: Managed Records KPI shows — not a fabricated computed value", async () => {
    render(<RecordsManagement />);
    await waitFor(() => expect(screen.getByText("Managed Records")).toBeInTheDocument());
    // The value should be "—" not "6M" (plan.length=5, 5*1.2=6)
    const kpiValues = screen.getAllByText("—");
    expect(kpiValues.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("6M")).not.toBeInTheDocument();
  });
});
