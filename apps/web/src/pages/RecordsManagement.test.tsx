import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
      permissions: ["compliance:read", "legal_hold:place", "document:delete"],
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
});
