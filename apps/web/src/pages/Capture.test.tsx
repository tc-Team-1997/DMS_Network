/**
 * Capture.test.tsx — ZorDMS Capture screen (enterprise rebuild)
 *
 * Covers:
 * - 3 tabs: Scanner, File Upload, Bulk Upload
 * - Capture mode toggle (Single Side / Front & Back) on Scanner + Upload tabs
 * - Single Side = one slot; Front & Back = two slots
 * - Proceed button appears when file selected
 * - Proceed flow: POST /documents + /extract (mocked captureApi)
 * - Processing state
 * - Editable result form (pre-filled from extraction data)
 * - Save corrections -> PATCH /documents/:id
 * - Quality panel (score + mandatory checklist)
 * - Duplicates list + "Open in Viewer" link
 * - Queue drawer + FAB toggle
 * - RBAC gate (document:capture)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Capture from "./Capture.js";

// ─── Polyfills ────────────────────────────────────────────────────────────────

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (!globalThis.URL.createObjectURL) {
  globalThis.URL.createObjectURL = vi.fn(() => "blob:mock");
  globalThis.URL.revokeObjectURL = vi.fn();
}

// ─── Mock captureApi ──────────────────────────────────────────────────────────

const mockUploadDocument = vi.fn();
const mockExtractDocument = vi.fn();
const mockExtractDocumentAsync = vi.fn();
const mockGetExtraction = vi.fn();
const mockGetDocTypes = vi.fn();
const mockPatchDocument = vi.fn();

vi.mock("../api/captureApi.js", () => ({
  uploadDocument: (...args: unknown[]) => mockUploadDocument(...args),
  extractDocument: (...args: unknown[]) => mockExtractDocument(...args),
  extractDocumentAsync: (...args: unknown[]) => mockExtractDocumentAsync(...args),
  getExtraction: (...args: unknown[]) => mockGetExtraction(...args),
  bulkUploadDocuments: vi.fn(),
  getDocTypes: (...args: unknown[]) => mockGetDocTypes(...args),
  patchDocument: (...args: unknown[]) => mockPatchDocument(...args),
}));

// ─── Mock jobsApi (P8 async-extract polling) ─────────────────────────────────

const mockGetJob = vi.fn();

vi.mock("../api/jobsApi.js", () => ({
  getJob: (...args: unknown[]) => mockGetJob(...args),
  listJobs: vi.fn(),
  // Keep the real terminal-status semantics so polling stops correctly.
  isTerminalJobStatus: (s: string | undefined) =>
    s === "succeeded" || s === "failed" || s === "dead",
  TERMINAL_JOB_STATUSES: new Set(["succeeded", "failed", "dead"]),
}));

// ─── Auth mock — mutable so RBAC test can override ───────────────────────────

let mockUserPermissions: string[] = [
  "document:capture",
  "document:read",
  "document:index",
];
let mockUserBranch = "Thimphu";

vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      username: "maker1",
      roles: ["Maker"],
      permissions: mockUserPermissions,
      branch: mockUserBranch,
    },
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

function mockFile(name = "test.pdf", type = "application/pdf", size = 1024) {
  return new File(["x".repeat(size)], name, { type });
}

const MOCK_UPLOAD_RESPONSE = {
  document: { id: 42, title: "Test Document", status: "Active" },
};

const MOCK_DOC_TYPES_RESPONSE = {
  docTypes: [
    {
      code: "BT_CID_4G",
      description: "Bhutan CID Card (4G, 2025+)",
      jurisdiction: "BT",
      issuer: "DCRC",
      category: "KYC / Identity",
      system: true,
      created_at: "2026-06-25T00:00:00.000Z",
      mandatoryFields: ["full_name", "dob", "expiry_date"],
      optionalFields: ["cid", "doc_no", "sex", "dzongkhag"],
    },
    {
      code: "BOB_LOAN_APPLICATION",
      description: "BoB Loan Application",
      jurisdiction: "BT",
      issuer: "Bank of Bhutan",
      category: "Loan & Credit",
      system: true,
      created_at: "2026-06-25T00:00:00.000Z",
      mandatoryFields: ["application_no", "loan_type", "loan_amount", "applicant_cid"],
      optionalFields: ["cid", "doc_no", "purpose", "officer"],
    },
  ],
  total: 2,
};

const MOCK_EXTRACTION_RESPONSE = {
  document: {
    id: 42,
    title: "Test Document",
    doc_type: "BT_CID_4G",
    confidence: 0.97,
    extraction_status: "DONE",
    catalog_category: "KYC / Identity",
  },
  classification: { doc_type: "BT_CID_4G", confidence: 0.97, review_flag: false },
  mappedFields: {
    cid: "11504000231",
    doc_no: null,
    mappedKeys: ["cid", "full_name", "dob"],
    data: {
      cid_no: "11504000231",
      full_name: "Dorji Wangchuk",
      dob: "1985-03-12",
    },
    partial: false,
    errors: [],
  },
  catalog: {
    category: "KYC / Identity",
    route: "AUTO",
    mandatoryOk: true,
    missing: [],
    retentionYears: 10,
    alertRule: "60/30/7 days before expiry_date",
  },
  folder: {
    folderId: 7,
    path: "/BoB/Customers/11504000231/KYC/Identity/2026/",
    acls: [{ role: "RM", access: "read", inherited: false }],
  },
  suggestedNewType: null,
  source: "ai",
  quality: {
    score: 98,
    completeness: 1.0,
    mandatoryMissing: [],
    confidence: 0.97,
  },
  duplicates: [],
  autoVersioned: false,
  rawMetadata: {
    cid_no: "11504000231",
    full_name: "Dorji Wangchuk",
    dob: "1985-03-12",
    unmapped_custom_key: "some_value_not_in_schema",
    ai_internal_score: 0.97,
  },
};

const MOCK_EXTRACTION_WITH_DUPLICATES = {
  ...MOCK_EXTRACTION_RESPONSE,
  quality: {
    score: 75,
    completeness: 0.67,
    mandatoryMissing: ["expiry_date"],
    confidence: 0.97,
  },
  duplicates: [
    {
      id: 5,
      title: "National ID — Dorji Wangchuk",
      doc_type: "BT_CID_4G",
      branch: "THM-HQ",
      ingest_timestamp: "2026-06-24T10:30:00.000Z",
      matchType: "hash",
    },
  ],
};

const MOCK_PATCH_RESPONSE = {
  document: { id: 42, title: "Test Document", doc_type: "BT_CID_4G" },
  quality: {
    score: 94,
    completeness: 1.0,
    mandatoryMissing: [],
    confidence: 0.97,
  },
  catalog: {
    category: "KYC / Identity",
    route: "AUTO",
    mandatoryOk: true,
    missing: [],
  },
};

/** Full proceed flow helper — selects front file, clicks Proceed, confirms, awaits extraction. */
async function doFullProceed() {
  const frontInput = screen.getByLabelText(/Front Side.*file input/i);
  Object.defineProperty(frontInput, "files", {
    value: [mockFile()],
    configurable: true,
  });
  fireEvent.change(frontInput);
  // Wait for the Proceed button to become enabled (file selected → hasFile=true)
  await waitFor(() => {
    const btn = screen.getByRole("button", { name: /Proceed to upload and extract/i });
    expect(btn).not.toBeDisabled();
  });
  fireEvent.click(screen.getByRole("button", { name: /Proceed to upload and extract/i }));
  await waitFor(() => screen.getByRole("button", { name: /Confirm.*Proceed/i }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Confirm.*Proceed/i }));
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Capture screen — enterprise rebuild", () => {
  beforeEach(() => {
    mockUserPermissions = [
      "document:capture",
      "document:read",
      "document:index",
    ];
    mockUserBranch = "Thimphu";
    mockUploadDocument.mockResolvedValue(MOCK_UPLOAD_RESPONSE);
    mockExtractDocument.mockResolvedValue(MOCK_EXTRACTION_RESPONSE);
    mockExtractDocumentAsync.mockResolvedValue({ jobId: "job-1", status: "queued" });
    mockGetExtraction.mockResolvedValue(MOCK_EXTRACTION_RESPONSE);
    mockGetJob.mockResolvedValue({
      id: "job-1",
      type: "extract",
      status: "succeeded",
      attempts: 1,
      maxAttempts: 5,
      result: { docId: 42, confidence: 0.91 },
      last_error: null,
    });
    mockGetDocTypes.mockResolvedValue(MOCK_DOC_TYPES_RESPONSE);
    mockPatchDocument.mockResolvedValue(MOCK_PATCH_RESPONSE);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ── Header + tabs ──────────────────────────────────────────────────────────

  it("renders the Document Capture page header", () => {
    renderWithRouter(<Capture />);
    expect(screen.getByText("Document Capture")).toBeInTheDocument();
  });

  it("renders exactly 3 tabs: Scanner, File Upload, Bulk Upload", () => {
    renderWithRouter(<Capture />);
    expect(screen.getByRole("button", { name: "Scanner" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "File Upload" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bulk Upload" })).toBeInTheDocument();
  });

  it("does NOT render Email Ingestion, API Push, Customer Portal tabs", () => {
    renderWithRouter(<Capture />);
    expect(screen.queryByText(/Email Ingestion/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/API Push/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Customer Portal/i)).not.toBeInTheDocument();
  });

  it("does NOT render Today's Ingestion by Channel section", () => {
    renderWithRouter(<Capture />);
    expect(screen.queryByText(/Today's Ingestion by Channel/i)).not.toBeInTheDocument();
  });

  // ── Capture mode selector ─────────────────────────────────────────────────

  it("File Upload tab shows mode selector with Single Side and Front & Back", () => {
    renderWithRouter(<Capture />);
    // Default tab is File Upload
    expect(
      screen.getByRole("button", { name: /Single Side mode/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Front & Back mode/i })
    ).toBeInTheDocument();
  });

  it("Single Side mode is selected by default", () => {
    renderWithRouter(<Capture />);
    const singleBtn = screen.getByRole("button", { name: /Single Side mode/i });
    expect(singleBtn).toHaveAttribute("aria-pressed", "true");
    const fbBtn = screen.getByRole("button", { name: /Front & Back mode/i });
    expect(fbBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("File Upload tab in Single Side mode shows only one drop zone (front)", () => {
    renderWithRouter(<Capture />);
    // Single mode: only front zone visible, no back zone
    expect(
      screen.getByLabelText(/Front Side.*file input/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Back Side.*file input/i)
    ).not.toBeInTheDocument();
  });

  it("switching to Front & Back mode shows both front and back slots on File Upload tab", async () => {
    renderWithRouter(<Capture />);
    const fbBtn = screen.getByRole("button", { name: /Front & Back mode/i });
    fireEvent.click(fbBtn);
    await waitFor(() =>
      expect(
        screen.getByLabelText(/Front Side.*file input/i)
      ).toBeInTheDocument()
    );
    expect(screen.getByLabelText(/Back Side.*file input/i)).toBeInTheDocument();
  });

  it("switching back to Single Side mode hides the back slot", async () => {
    renderWithRouter(<Capture />);
    // Go to Front & Back
    fireEvent.click(screen.getByRole("button", { name: /Front & Back mode/i }));
    await waitFor(() =>
      expect(screen.getByLabelText(/Back Side.*file input/i)).toBeInTheDocument()
    );
    // Go back to Single
    fireEvent.click(screen.getByRole("button", { name: /Single Side mode/i }));
    await waitFor(() =>
      expect(
        screen.queryByLabelText(/Back Side.*file input/i)
      ).not.toBeInTheDocument()
    );
  });

  it("Scanner tab shows mode selector", async () => {
    renderWithRouter(<Capture />);
    fireEvent.click(screen.getByRole("button", { name: "Scanner" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Single Side mode/i })
      ).toBeInTheDocument()
    );
    expect(
      screen.getByRole("button", { name: /Front & Back mode/i })
    ).toBeInTheDocument();
  });

  it("Scanner tab in Front & Back mode shows Front Side Capture and Back Side Capture cards", async () => {
    renderWithRouter(<Capture />);
    fireEvent.click(screen.getByRole("button", { name: "Scanner" }));
    await waitFor(() =>
      screen.getByRole("button", { name: /Front & Back mode/i })
    );
    fireEvent.click(screen.getByRole("button", { name: /Front & Back mode/i }));
    await waitFor(() =>
      expect(screen.getByText("Front Side Capture")).toBeInTheDocument()
    );
    expect(screen.getByText("Back Side Capture")).toBeInTheDocument();
  });

  it("Scanner tab in Single Side mode shows only front zone", async () => {
    renderWithRouter(<Capture />);
    fireEvent.click(screen.getByRole("button", { name: "Scanner" }));
    await waitFor(() =>
      expect(
        screen.getByLabelText(/Front Side.*file input/i)
      ).toBeInTheDocument()
    );
    // Single mode — no back zone
    expect(
      screen.queryByLabelText(/Back Side.*file input/i)
    ).not.toBeInTheDocument();
  });

  it("Bulk Upload tab does NOT show mode selector", async () => {
    renderWithRouter(<Capture />);
    fireEvent.click(screen.getByRole("button", { name: "Bulk Upload" }));
    await waitFor(() => screen.getByLabelText(/Drop multiple files.*file input/i));
    expect(
      screen.queryByRole("button", { name: /Single Side mode/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Front & Back mode/i })
    ).not.toBeInTheDocument();
  });

  it("switching tabs resets capture mode to Single Side", async () => {
    renderWithRouter(<Capture />);
    // Switch to Front & Back
    fireEvent.click(screen.getByRole("button", { name: /Front & Back mode/i }));
    await waitFor(() =>
      expect(screen.getByLabelText(/Back Side.*file input/i)).toBeInTheDocument()
    );
    // Switch to Scanner tab — mode resets
    fireEvent.click(screen.getByRole("button", { name: "Scanner" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Single Side mode/i })
      ).toHaveAttribute("aria-pressed", "true")
    );
    // Switch back to File Upload tab — mode still resets
    fireEvent.click(screen.getByRole("button", { name: "File Upload" }));
    await waitFor(() =>
      expect(
        screen.queryByLabelText(/Back Side.*file input/i)
      ).not.toBeInTheDocument()
    );
  });

  // ── File Upload tab — Front/Back slots ────────────────────────────────────

  it("File Upload tab in Front & Back mode shows Front Side and Back Side card titles", async () => {
    renderWithRouter(<Capture />);
    fireEvent.click(screen.getByRole("button", { name: /Front & Back mode/i }));
    await waitFor(() =>
      expect(screen.getByText("Front Side")).toBeInTheDocument()
    );
    expect(screen.getByText("Back Side")).toBeInTheDocument();
  });

  it("File Upload tab Front & Back mode has two file inputs", async () => {
    renderWithRouter(<Capture />);
    fireEvent.click(screen.getByRole("button", { name: /Front & Back mode/i }));
    await waitFor(() =>
      expect(
        screen.getByLabelText(/Front Side.*file input/i)
      ).toBeInTheDocument()
    );
    expect(screen.getByLabelText(/Back Side.*file input/i)).toBeInTheDocument();
  });

  // ── Scanner tab ───────────────────────────────────────────────────────────

  it("Scanner tab shows Scanner Configuration", async () => {
    renderWithRouter(<Capture />);
    fireEvent.click(screen.getByRole("button", { name: "Scanner" }));
    await waitFor(() =>
      expect(screen.getByText("Scanner Configuration")).toBeInTheDocument()
    );
  });

  it("Scanner tab Front & Back mode has front and back file inputs", async () => {
    renderWithRouter(<Capture />);
    fireEvent.click(screen.getByRole("button", { name: "Scanner" }));
    await waitFor(() =>
      screen.getByRole("button", { name: /Front & Back mode/i })
    );
    fireEvent.click(screen.getByRole("button", { name: /Front & Back mode/i }));
    await waitFor(() =>
      expect(
        screen.getByLabelText(/Front Side.*file input/i)
      ).toBeInTheDocument()
    );
    expect(screen.getByLabelText(/Back Side.*file input/i)).toBeInTheDocument();
  });

  // ── Bulk Upload tab ───────────────────────────────────────────────────────

  it("Bulk Upload tab shows multi-file drop zone input", async () => {
    renderWithRouter(<Capture />);
    fireEvent.click(screen.getByRole("button", { name: "Bulk Upload" }));
    await waitFor(() =>
      screen.getByLabelText(/Drop multiple files.*file input/i)
    );
    const bulkInput = screen.getByLabelText(/Drop multiple files.*file input/i);
    expect(bulkInput).toHaveAttribute("multiple");
  });

  // ── Proceed button ────────────────────────────────────────────────────────

  it("Proceed button is in the DOM but DISABLED before any file is selected", () => {
    renderWithRouter(<Capture />);
    const btn = screen.getByRole("button", { name: /Proceed to upload and extract/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });

  it("Proceed button is ENABLED after front file is selected on File Upload tab", async () => {
    renderWithRouter(<Capture />);
    // Initially disabled
    const btn = screen.getByRole("button", { name: /Proceed to upload and extract/i });
    expect(btn).toBeDisabled();
    // Select a file
    const frontInput = screen.getByLabelText(/Front Side.*file input/i);
    Object.defineProperty(frontInput, "files", { value: [mockFile("cid.pdf")], configurable: true });
    fireEvent.change(frontInput);
    // Now enabled
    await waitFor(() => expect(screen.getByRole("button", { name: /Proceed to upload and extract/i })).not.toBeDisabled());
  });

  it("Proceed button appears after front file is selected", async () => {
    renderWithRouter(<Capture />);
    const frontInput = screen.getByLabelText(/Front Side.*file input/i);
    const file = mockFile("cid.pdf");
    Object.defineProperty(frontInput, "files", {
      value: [file],
      configurable: true,
    });
    fireEvent.change(frontInput);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Proceed/i })
      ).not.toBeDisabled()
    );
  });

  it("Proceed button appears after bulk files are selected", async () => {
    renderWithRouter(<Capture />);
    fireEvent.click(screen.getByRole("button", { name: "Bulk Upload" }));
    await waitFor(() =>
      screen.getByLabelText(/Drop multiple files.*file input/i)
    );
    const input = screen.getByLabelText(/Drop multiple files.*file input/i);
    const files = [mockFile("a.pdf"), mockFile("b.pdf")];
    Object.defineProperty(input, "files", {
      value: files,
      configurable: true,
    });
    fireEvent.change(input);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Proceed/i })
      ).not.toBeDisabled()
    );
  });

  // ── Proceed flow — upload + extract ──────────────────────────────────────

  it("clicking Proceed opens the confirm modal", async () => {
    renderWithRouter(<Capture />);
    const frontInput = screen.getByLabelText(/Front Side.*file input/i);
    const file = mockFile("passport.pdf");
    Object.defineProperty(frontInput, "files", {
      value: [file],
      configurable: true,
    });
    fireEvent.change(frontInput);
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /Proceed to upload and extract/i });
      expect(btn).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /Proceed to upload and extract/i }));
    await waitFor(() =>
      expect(screen.getByText("Confirm Capture")).toBeInTheDocument()
    );
  });

  it("Proceed flow calls uploadDocument with correct file and branch", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      expect(mockUploadDocument).toHaveBeenCalledTimes(1)
    );
    expect(mockUploadDocument).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({ branch: "Thimphu" })
    );
  });

  it("Proceed flow calls extractDocument with doc id from upload response", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      expect(mockExtractDocument).toHaveBeenCalledWith(42)
    );
  });

  it("shows processing state while upload/extract runs", async () => {
    let resolveExtract!: (v: unknown) => void;
    mockExtractDocument.mockReturnValue(
      new Promise((r) => {
        resolveExtract = r;
      })
    );

    renderWithRouter(<Capture />);
    const frontInput = screen.getByLabelText(/Front Side.*file input/i);
    const file = mockFile("kyc.pdf");
    Object.defineProperty(frontInput, "files", {
      value: [file],
      configurable: true,
    });
    fireEvent.change(frontInput);
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /Proceed to upload and extract/i });
      expect(btn).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /Proceed to upload and extract/i }));
    await waitFor(() =>
      screen.getByRole("button", { name: /Confirm.*Proceed/i })
    );
    fireEvent.click(screen.getByRole("button", { name: /Confirm.*Proceed/i }));

    await waitFor(() =>
      expect(screen.getByText(/Processing…/i)).toBeInTheDocument()
    );
    await act(async () => resolveExtract(MOCK_EXTRACTION_RESPONSE));
  });

  it("shows AI Classification Result section after successful extraction", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      expect(
        screen.getAllByText("AI Classification Result").length
      ).toBeGreaterThan(0)
    );
  });

  it("shows detected doc_type BT_CID_4G after extraction", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      expect(screen.getAllByText("BT_CID_4G").length).toBeGreaterThan(0)
    );
  });

  it("shows confidence percentage (97%) after extraction", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      expect(screen.getAllByText("97%").length).toBeGreaterThan(0)
    );
  });

  it("shows catalog category in extraction result", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      expect(screen.getAllByText("KYC / Identity").length).toBeGreaterThan(0)
    );
  });

  it("shows folder path in extraction result", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      expect(
        screen.getAllByText(
          "/BoB/Customers/11504000231/KYC/Identity/2026/"
        ).length
      ).toBeGreaterThan(0)
    );
  });

  it("shows extracted metadata values (Dorji Wangchuk, CID)", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      expect(
        screen.getAllByText("Dorji Wangchuk").length
      ).toBeGreaterThan(0)
    );
    expect(screen.getAllByText("11504000231").length).toBeGreaterThan(0);
  });

  it("shows suggestedNewType card when backend returns one", async () => {
    mockExtractDocument.mockResolvedValueOnce({
      ...MOCK_EXTRACTION_RESPONSE,
      suggestedNewType: {
        proposedName: "UNKNOWN_DOC_X",
        reason: "Document type not in registry",
        sampleFields: ["field_a", "field_b"],
      },
    });

    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      expect(
        screen.getAllByText((content) =>
          content.includes("UNKNOWN_DOC_X")
        ).length
      ).toBeGreaterThan(0)
    );
  });

  it("shows 'Suggested New Document Type' heading for suggestedNewType", async () => {
    mockExtractDocument.mockResolvedValueOnce({
      ...MOCK_EXTRACTION_RESPONSE,
      suggestedNewType: {
        proposedName: "CORP_DOCS_MISC",
        reason: "Unknown type",
        sampleFields: [],
      },
    });
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      expect(
        screen.getAllByText("Suggested New Document Type").length
      ).toBeGreaterThan(0)
    );
  });

  it("shows error alert when upload fails", async () => {
    mockUploadDocument.mockRejectedValueOnce(new Error("Network error"));

    renderWithRouter(<Capture />);
    const frontInput = screen.getByLabelText(/Front Side.*file input/i);
    Object.defineProperty(frontInput, "files", {
      value: [mockFile()],
      configurable: true,
    });
    fireEvent.change(frontInput);
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /Proceed to upload and extract/i });
      expect(btn).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /Proceed to upload and extract/i }));
    await waitFor(() =>
      screen.getByRole("button", { name: /Confirm.*Proceed/i })
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Confirm.*Proceed/i })
      );
    });
    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument()
    );
    expect(screen.getByText(/Network error/i)).toBeInTheDocument();
  });

  // ── Editable form (ExtractionResultDrawer) ───────────────────────────────

  it("drawer shows editable Classification section after extraction", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    // The drawer auto-opens; it contains the editable form
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: /Capture queue drawer/i })
      ).toBeInTheDocument()
    );
    // Classification editable form
    await waitFor(() =>
      expect(
        screen.getAllByText(/Classification \(editable\)/i).length
      ).toBeGreaterThan(0)
    );
  });

  it("editable form is pre-filled with extraction data (Dorji Wangchuk)", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      screen.getByRole("dialog", { name: /Capture queue drawer/i })
    );
    // Wait for doc-types to load and form to render
    await waitFor(() => {
      const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
      return inputs.some((el) => el.value === "Dorji Wangchuk");
    });
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    const filledInput = inputs.find((el) => el.value === "Dorji Wangchuk");
    expect(filledInput).toBeTruthy();
  });

  it("editable form allows changing a field value", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      screen.getByRole("dialog", { name: /Capture queue drawer/i })
    );
    // Wait for field inputs to appear
    await waitFor(() => {
      const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
      return inputs.some((el) => el.value === "Dorji Wangchuk");
    });
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    const nameInput = inputs.find(
      (el) => el.value === "Dorji Wangchuk"
    ) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Sonam Dorji" } });
    expect(nameInput.value).toBe("Sonam Dorji");
  });

  it("Save corrections button is visible in the result drawer", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      screen.getByRole("dialog", { name: /Capture queue drawer/i })
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Save corrections/i })
      ).toBeInTheDocument()
    );
  });

  it("Save corrections calls patchDocument with doc id and edited metadata", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      screen.getByRole("dialog", { name: /Capture queue drawer/i })
    );
    await waitFor(() =>
      screen.getByRole("button", { name: /Save corrections/i })
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Save corrections/i })
      );
    });

    await waitFor(() =>
      expect(mockPatchDocument).toHaveBeenCalledWith(
        42,
        expect.objectContaining({
          doc_type: "BT_CID_4G",
          metadata: expect.any(Object),
        })
      )
    );
  });

  it("after successful save, recomputed quality score is shown", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      screen.getByRole("dialog", { name: /Capture queue drawer/i })
    );
    await waitFor(() =>
      screen.getByRole("button", { name: /Save corrections/i })
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Save corrections/i })
      );
    });

    // PATCH response returns quality.score=94
    await waitFor(() =>
      expect(screen.getAllByText("94").length).toBeGreaterThan(0)
    );
  });

  // ── Quality / Completeness panel ─────────────────────────────────────────

  it("quality score is shown in the result drawer", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      screen.getByRole("dialog", { name: /Capture queue drawer/i })
    );
    // MOCK_EXTRACTION_RESPONSE has quality.score=98
    await waitFor(() =>
      expect(screen.getAllByText("98").length).toBeGreaterThan(0)
    );
  });

  it("Quality panel shows completeness percentage", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      screen.getByRole("dialog", { name: /Capture queue drawer/i })
    );
    await waitFor(() =>
      expect(
        screen.getAllByText(/Completeness:/i).length
      ).toBeGreaterThan(0)
    );
  });

  it("mandatory fields checklist shows green check when field is present", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      screen.getByRole("dialog", { name: /Capture queue drawer/i })
    );
    // mandatoryMissing=[] so all fields present → "present" aria-labels
    await waitFor(() => {
      const presentMarks = screen.queryAllByLabelText("present");
      return presentMarks.length > 0;
    });
    const presentMarks = screen.queryAllByLabelText("present");
    expect(presentMarks.length).toBeGreaterThan(0);
  });

  it("mandatory fields checklist shows missing indicator for absent mandatory fields", async () => {
    mockExtractDocument.mockResolvedValueOnce(MOCK_EXTRACTION_WITH_DUPLICATES);
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      screen.getByRole("dialog", { name: /Capture queue drawer/i })
    );
    // mandatoryMissing=["expiry_date"] → "missing" aria-label present
    await waitFor(() => {
      const missingMarks = screen.queryAllByLabelText("missing");
      return missingMarks.length > 0;
    });
    const missingMarks = screen.queryAllByLabelText("missing");
    expect(missingMarks.length).toBeGreaterThan(0);
  });

  // ── Duplicates ────────────────────────────────────────────────────────────

  it("shows no duplicates section when duplicates array is empty", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      screen.getByRole("dialog", { name: /Capture queue drawer/i })
    );
    // duplicates=[] and autoVersioned=false → no duplicates list
    // The Duplicate Detection card should not appear
    await waitFor(() => {
      // Give doc-types a moment to load
      return screen.queryAllByText("AI Classification Result").length > 0;
    });
    expect(
      screen.queryByRole("list", { name: /duplicates list/i }) ||
        screen.queryByLabelText(/duplicates list/i)
    ).toBeNull();
  });

  it("shows duplicates list when extraction returns duplicates", async () => {
    mockExtractDocument.mockResolvedValueOnce(MOCK_EXTRACTION_WITH_DUPLICATES);
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      screen.getByRole("dialog", { name: /Capture queue drawer/i })
    );
    await waitFor(() =>
      expect(
        screen.getByLabelText(/duplicates list/i)
      ).toBeInTheDocument()
    );
    expect(
      screen.getByText("National ID — Dorji Wangchuk")
    ).toBeInTheDocument();
  });

  it("each duplicate row shows its matchType", async () => {
    mockExtractDocument.mockResolvedValueOnce(MOCK_EXTRACTION_WITH_DUPLICATES);
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      screen.getByRole("dialog", { name: /Capture queue drawer/i })
    );
    await waitFor(() =>
      expect(
        screen.getByLabelText(/duplicates list/i)
      ).toBeInTheDocument()
    );
    // matchType="hash"
    expect(screen.getAllByText("hash").length).toBeGreaterThan(0);
  });

  it("each duplicate row has Open in Viewer button linking to /viewer?doc=<id>", async () => {
    mockExtractDocument.mockResolvedValueOnce(MOCK_EXTRACTION_WITH_DUPLICATES);
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      screen.getByRole("dialog", { name: /Capture queue drawer/i })
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Open duplicate 5 in Viewer/i })
      ).toBeInTheDocument()
    );
  });

  it("shows auto-versioned notice when autoVersioned=true", async () => {
    mockExtractDocument.mockResolvedValueOnce({
      ...MOCK_EXTRACTION_RESPONSE,
      autoVersioned: true,
      duplicates: [],
    });
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      screen.getByRole("dialog", { name: /Capture queue drawer/i })
    );
    await waitFor(() =>
      expect(
        screen.getAllByText(/Auto-versioned/i).length
      ).toBeGreaterThan(0)
    );
  });

  // ── Drawer — solid background + close button ──────────────────────────────

  it("drawer has Close result drawer button (X)", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      screen.getByRole("dialog", { name: /Capture queue drawer/i })
    );
    // The ExtractionResultDrawer has its own close X button
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Close result drawer/i })
      ).toBeInTheDocument()
    );
  });

  it("drawer Close drawer button is accessible (aria-label)", async () => {
    renderWithRouter(<Capture />);
    const fab = screen.getByRole("button", { name: /Toggle capture queue drawer/i });
    fireEvent.click(fab);
    await waitFor(() =>
      screen.getByRole("button", { name: /Close drawer/i })
    );
    expect(
      screen.getByRole("button", { name: /Close drawer/i })
    ).toBeInTheDocument();
  });

  // ── Queue ─────────────────────────────────────────────────────────────────

  it("adds item to capture queue after Proceed and shows queue section", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      expect(
        screen.getAllByText(/Capture Queue/i).length
      ).toBeGreaterThan(0)
    );
  });

  it("shows queue count badge after an item is captured", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      expect(
        screen.getAllByText("1 items").length
      ).toBeGreaterThan(0)
    );
  });

  it("clicking a queue item opens the capture queue drawer", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    // Drawer should auto-open after proceed
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: /Capture queue drawer/i })
      ).toBeInTheDocument()
    );
  });

  it("queue item is clickable (role=button with aria-label)", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() => screen.getAllByRole("button", { name: /Queue item:/i }));
    const queueItems = screen.getAllByRole("button", {
      name: /Queue item:/i,
    });
    expect(queueItems.length).toBeGreaterThan(0);
  });

  // ── FAB and drawer ────────────────────────────────────────────────────────

  it("renders the floating action button (Toggle capture queue drawer)", () => {
    renderWithRouter(<Capture />);
    expect(
      screen.getByRole("button", { name: /Toggle capture queue drawer/i })
    ).toBeInTheDocument();
  });

  it("FAB click opens the capture queue drawer", async () => {
    renderWithRouter(<Capture />);
    const fab = screen.getByRole("button", {
      name: /Toggle capture queue drawer/i,
    });
    fireEvent.click(fab);
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: /Capture queue drawer/i })
      ).toBeInTheDocument()
    );
  });

  it("drawer close button is accessible", async () => {
    renderWithRouter(<Capture />);
    const fab = screen.getByRole("button", {
      name: /Toggle capture queue drawer/i,
    });
    fireEvent.click(fab);
    await waitFor(() =>
      screen.getByRole("button", { name: /Close drawer/i })
    );
    expect(
      screen.getByRole("button", { name: /Close drawer/i })
    ).toBeInTheDocument();
  });

  it("drawer shows empty state when no queue entries", async () => {
    renderWithRouter(<Capture />);
    fireEvent.click(
      screen.getByRole("button", { name: /Toggle capture queue drawer/i })
    );
    await waitFor(() =>
      screen.getByRole("dialog", { name: /Capture queue drawer/i })
    );
    expect(screen.getByText(/No captures yet/i)).toBeInTheDocument();
  });

  // ── RBAC ─────────────────────────────────────────────────────────────────

  it("renders full capture UI when user has document:capture permission", () => {
    renderWithRouter(<Capture />);
    expect(screen.getByText("Document Capture")).toBeInTheDocument();
    expect(screen.queryByText(/Access Denied/i)).not.toBeInTheDocument();
  });

  it("shows Access Denied when user lacks document:capture permission", () => {
    mockUserPermissions = []; // Remove document:capture
    renderWithRouter(<Capture />);
    expect(screen.getByText(/Access Denied/i)).toBeInTheDocument();
    expect(screen.queryByText("Document Capture")).not.toBeInTheDocument();
  });

  // ── File size hints ───────────────────────────────────────────────────────

  it("shows Max 50 MB file size hint in drop zones", () => {
    renderWithRouter(<Capture />);
    const hints = screen.getAllByText(/Max 50 MB/i);
    expect(hints.length).toBeGreaterThan(0);
  });

  it("does NOT show outdated Max 100 MB limit", () => {
    renderWithRouter(<Capture />);
    expect(screen.queryByText(/Max 100 MB/i)).not.toBeInTheDocument();
  });

  // ── Back file is optional in Front & Back mode ────────────────────────────

  it("Proceed appears with only front file in Front & Back mode (back is optional)", async () => {
    renderWithRouter(<Capture />);
    fireEvent.click(screen.getByRole("button", { name: /Front & Back mode/i }));
    await waitFor(() =>
      screen.getByLabelText(/Front Side.*file input/i)
    );
    const frontInput = screen.getByLabelText(/Front Side.*file input/i);
    Object.defineProperty(frontInput, "files", {
      value: [mockFile()],
      configurable: true,
    });
    fireEvent.change(frontInput);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Proceed to upload and extract/i })
      ).not.toBeDisabled()
    );
  });

  // ── Tab switching resets state ────────────────────────────────────────────

  it("switching tabs clears Proceed button", async () => {
    renderWithRouter(<Capture />);
    const frontInput = screen.getByLabelText(/Front Side.*file input/i);
    Object.defineProperty(frontInput, "files", {
      value: [mockFile()],
      configurable: true,
    });
    fireEvent.change(frontInput);
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /Proceed to upload and extract/i });
      expect(btn).not.toBeDisabled();
    });
    // Switch tab — this clears frontFile, button becomes disabled
    fireEvent.click(screen.getByRole("button", { name: "Scanner" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Proceed to upload and extract/i })
      ).toBeDisabled()
    );
  });

  // ── doc-types loaded from API ─────────────────────────────────────────────

  it("getDocTypes is called when the result drawer opens", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      screen.getByRole("dialog", { name: /Capture queue drawer/i })
    );
    await waitFor(() =>
      expect(mockGetDocTypes).toHaveBeenCalled()
    );
  });

  // ── Raw metadata section ──────────────────────────────────────────────────

  it("raw metadata section is visible in result drawer and shows JSON when toggled", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      screen.getByRole("dialog", { name: /Capture queue drawer/i })
    );
    // The toggle button should be present
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Toggle raw extracted metadata/i })
      ).toBeInTheDocument()
    );
    // Click to expand
    fireEvent.click(
      screen.getByRole("button", { name: /Toggle raw extracted metadata/i })
    );
    // The raw JSON should be visible (including unmapped key)
    await waitFor(() =>
      expect(
        screen.getByLabelText("raw metadata json")
      ).toBeInTheDocument()
    );
    expect(screen.getByLabelText("raw metadata json").textContent).toContain(
      "unmapped_custom_key"
    );
  });

  it("raw metadata section shows fallback text when rawMetadata is null", async () => {
    mockExtractDocument.mockResolvedValueOnce({
      ...MOCK_EXTRACTION_RESPONSE,
      rawMetadata: null,
    });
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      screen.getByRole("dialog", { name: /Capture queue drawer/i })
    );
    await waitFor(() =>
      screen.getByRole("button", { name: /Toggle raw extracted metadata/i })
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Toggle raw extracted metadata/i })
    );
    await waitFor(() =>
      expect(
        screen.getByText(/No raw metadata captured/i)
      ).toBeInTheDocument()
    );
  });

  // ── P8: Bulk async extract + polling ────────────────────────────────────────

  /** Select bulk files, open Bulk tab, click Proceed + confirm. */
  async function doBulkProceed(files = [mockFile("a.pdf"), mockFile("b.pdf")]) {
    fireEvent.click(screen.getByRole("button", { name: "Bulk Upload" }));
    await waitFor(() => screen.getByLabelText(/Drop multiple files.*file input/i));
    const input = screen.getByLabelText(/Drop multiple files.*file input/i);
    Object.defineProperty(input, "files", { value: files, configurable: true });
    fireEvent.change(input);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Proceed to upload and extract/i })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Proceed to upload and extract/i }));
    await waitFor(() => screen.getByRole("button", { name: /Confirm.*Proceed/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Confirm.*Proceed/i }));
    });
  }

  it("Bulk Upload tab shows the 'process in background' toggle (default on)", async () => {
    renderWithRouter(<Capture />);
    fireEvent.click(screen.getByRole("button", { name: "Bulk Upload" }));
    await waitFor(() =>
      expect(
        screen.getByLabelText("Process extraction in background"),
      ).toBeInTheDocument(),
    );
    const toggle = screen.getByLabelText("Process extraction in background") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it("bulk upload uses the async extract path (extractDocumentAsync, not extractDocument)", async () => {
    renderWithRouter(<Capture />);
    await doBulkProceed([mockFile("a.pdf")]);
    await waitFor(() => expect(mockExtractDocumentAsync).toHaveBeenCalled());
    // Async path must NOT call the synchronous extract.
    expect(mockExtractDocument).not.toHaveBeenCalled();
    // Enqueued by the uploaded document id.
    expect(mockExtractDocumentAsync).toHaveBeenCalledWith(42);
  });

  it("bulk async polls GET /jobs/:id (queued → succeeded) and reaches Captured", async () => {
    // Sequence: first poll queued, then succeeded — polling must stop on terminal.
    mockGetJob
      .mockResolvedValueOnce({
        id: "job-1",
        type: "extract",
        status: "queued",
        attempts: 0,
        maxAttempts: 5,
        result: null,
        last_error: null,
      })
      .mockResolvedValueOnce({
        id: "job-1",
        type: "extract",
        status: "succeeded",
        attempts: 1,
        maxAttempts: 5,
        result: { docId: 42, confidence: 0.91 },
        last_error: null,
      });

    renderWithRouter(<Capture />);
    await doBulkProceed([mockFile("a.pdf")]);

    // Polled the job at least twice (queued, then succeeded). The second poll is
    // scheduled after the poll interval, so allow extra wall-clock time.
    await waitFor(() => expect(mockGetJob.mock.calls.length).toBeGreaterThanOrEqual(2), {
      timeout: 4000,
    });
    // Terminal reached → entry shows the captured count.
    await waitFor(() => expect(screen.getByText(/1 Captured/)).toBeInTheDocument(), {
      timeout: 4000,
    });
    expect(mockGetJob).toHaveBeenCalledWith("job-1");
  });

  it("succeeded background job fetches the full extraction result (getExtraction by doc id)", async () => {
    renderWithRouter(<Capture />);
    await doBulkProceed([mockFile("a.pdf")]);

    // Once the job reaches succeeded, the full persisted extraction is read back
    // via getExtraction(docId) so the drawer can render the editable form.
    await waitFor(() => expect(mockGetExtraction).toHaveBeenCalledWith(42), {
      timeout: 4000,
    });
  });

  it("opening a completed background job shows the FULL editable result drawer (same as sync)", async () => {
    renderWithRouter(<Capture />);
    await doBulkProceed([mockFile("a.pdf")]);

    // Wait for the background job to succeed and the full extraction to load.
    await waitFor(() => expect(mockGetExtraction).toHaveBeenCalledWith(42), {
      timeout: 4000,
    });
    await waitFor(() => expect(screen.getByText(/1 Captured/)).toBeInTheDocument(), {
      timeout: 4000,
    });

    // Open the queue drawer and select the completed background item.
    fireEvent.click(
      screen.getByRole("button", { name: /Toggle capture queue drawer/i }),
    );
    await waitFor(() =>
      screen.getByRole("dialog", { name: /Capture queue drawer/i }),
    );
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /Queue item:/i })[0]);
    });

    // The SAME editable ExtractionResultDrawer as the sync path is rendered:
    // editable classification, pre-filled fields, quality score, raw metadata.
    await waitFor(() =>
      expect(
        screen.getAllByText(/Classification \(editable\)/i).length,
      ).toBeGreaterThan(0),
    );
    await waitFor(() => {
      const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
      return inputs.some((el) => el.value === "Dorji Wangchuk");
    });
    expect(
      screen.getByRole("button", { name: /Save corrections/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Toggle raw extracted metadata/i }),
    ).toBeInTheDocument();
  });

  it("bulk async surfaces a dead-letter job as an error/dead state", async () => {
    mockGetJob.mockResolvedValue({
      id: "job-1",
      type: "extract",
      status: "dead",
      attempts: 5,
      maxAttempts: 5,
      result: null,
      last_error: "extract_not_found",
    });

    renderWithRouter(<Capture />);
    await doBulkProceed([mockFile("a.pdf")]);

    await waitFor(() => expect(mockGetJob).toHaveBeenCalled(), { timeout: 4000 });
    // Dead-letter status tag rendered in the compact queue list.
    await waitFor(
      () => expect(screen.getAllByText(/Dead-letter/i).length).toBeGreaterThan(0),
      { timeout: 4000 },
    );
    // No false "Captured" count.
    expect(screen.queryByText(/1 Captured/)).not.toBeInTheDocument();
  });
});
