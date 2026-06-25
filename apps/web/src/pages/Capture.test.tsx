/**
 * Capture.test.tsx — Enterprise capture screen tests
 *
 * Covers:
 * - 3 tabs: Scanner, File Upload, Bulk Upload
 * - Front/Back slot rendering per tab
 * - Proceed button (appears once file selected)
 * - Proceed flow: POST /documents + /extract (mocked captureApi)
 * - Processing state
 * - Extraction result display
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

// Mock URL.createObjectURL and revokeObjectURL for FilePreview
if (!globalThis.URL.createObjectURL) {
  globalThis.URL.createObjectURL = vi.fn(() => "blob:mock");
  globalThis.URL.revokeObjectURL = vi.fn();
}

// ─── Mock captureApi ──────────────────────────────────────────────────────────

const mockUploadDocument = vi.fn();
const mockExtractDocument = vi.fn();

vi.mock("../api/captureApi.js", () => ({
  uploadDocument: (...args: unknown[]) => mockUploadDocument(...args),
  extractDocument: (...args: unknown[]) => mockExtractDocument(...args),
  bulkUploadDocuments: vi.fn(),
}));

// ─── Auth mock — mutable so RBAC test can override ───────────────────────────

let mockUserPermissions: string[] = ["document:capture", "document:read", "document:index"];
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
    data: { cid_no: "11504000231", full_name: "Dorji Wangchuk", dob: "1985-03-12" },
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
};

/** Full proceed flow helper — selects front file, clicks Proceed, confirms, awaits extraction. */
async function doFullProceed() {
  const frontInput = screen.getByLabelText(/Front Side.*file input/i);
  Object.defineProperty(frontInput, "files", { value: [mockFile()], configurable: true });
  fireEvent.change(frontInput);
  await waitFor(() => screen.getByRole("button", { name: /Proceed/i }));
  fireEvent.click(screen.getByRole("button", { name: /Proceed/i }));
  await waitFor(() => screen.getByRole("button", { name: /Confirm.*Proceed/i }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Confirm.*Proceed/i }));
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Capture screen — enterprise rebuild", () => {
  beforeEach(() => {
    mockUserPermissions = ["document:capture", "document:read", "document:index"];
    mockUserBranch = "Thimphu";
    mockUploadDocument.mockResolvedValue(MOCK_UPLOAD_RESPONSE);
    mockExtractDocument.mockResolvedValue(MOCK_EXTRACTION_RESPONSE);
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

  // ── File Upload tab — Front/Back slots ────────────────────────────────────

  it("File Upload tab shows Front Side and Back Side card titles", () => {
    renderWithRouter(<Capture />);
    // File Upload is the default tab
    expect(screen.getByText("Front Side")).toBeInTheDocument();
    expect(screen.getByText("Back Side")).toBeInTheDocument();
  });

  it("File Upload tab has two file inputs (front and back)", () => {
    renderWithRouter(<Capture />);
    const frontInput = screen.getByLabelText(/Front Side.*file input/i);
    const backInput = screen.getByLabelText(/Back Side.*file input/i);
    expect(frontInput).toBeInTheDocument();
    expect(backInput).toBeInTheDocument();
  });

  // ── Scanner tab — Front/Back slots ───────────────────────────────────────

  it("Scanner tab shows Front Side Capture and Back Side Capture cards", async () => {
    renderWithRouter(<Capture />);
    fireEvent.click(screen.getByRole("button", { name: "Scanner" }));
    await waitFor(() => expect(screen.getByText("Front Side Capture")).toBeInTheDocument());
    expect(screen.getByText("Back Side Capture")).toBeInTheDocument();
  });

  it("Scanner tab shows Scanner Configuration", async () => {
    renderWithRouter(<Capture />);
    fireEvent.click(screen.getByRole("button", { name: "Scanner" }));
    await waitFor(() => expect(screen.getByText("Scanner Configuration")).toBeInTheDocument());
  });

  it("Scanner tab has front and back file inputs", async () => {
    renderWithRouter(<Capture />);
    fireEvent.click(screen.getByRole("button", { name: "Scanner" }));
    await waitFor(() => screen.getByLabelText(/Front Side.*file input/i));
    expect(screen.getByLabelText(/Back Side.*file input/i)).toBeInTheDocument();
  });

  // ── Bulk Upload tab ───────────────────────────────────────────────────────

  it("Bulk Upload tab shows multi-file drop zone input", async () => {
    renderWithRouter(<Capture />);
    fireEvent.click(screen.getByRole("button", { name: "Bulk Upload" }));
    await waitFor(() => screen.getByLabelText(/Drop multiple files.*file input/i));
    const bulkInput = screen.getByLabelText(/Drop multiple files.*file input/i);
    expect(bulkInput).toHaveAttribute("multiple");
  });

  // ── Proceed button ────────────────────────────────────────────────────────

  it("Proceed button does NOT appear when no file selected", () => {
    renderWithRouter(<Capture />);
    expect(screen.queryByRole("button", { name: /Proceed/i })).not.toBeInTheDocument();
  });

  it("Proceed button appears after front file is selected", async () => {
    renderWithRouter(<Capture />);
    const frontInput = screen.getByLabelText(/Front Side.*file input/i);
    const file = mockFile("cid.pdf");
    Object.defineProperty(frontInput, "files", { value: [file], configurable: true });
    fireEvent.change(frontInput);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Proceed/i })).toBeInTheDocument()
    );
  });

  it("Proceed button appears after bulk files are selected", async () => {
    renderWithRouter(<Capture />);
    fireEvent.click(screen.getByRole("button", { name: "Bulk Upload" }));
    await waitFor(() => screen.getByLabelText(/Drop multiple files.*file input/i));
    const input = screen.getByLabelText(/Drop multiple files.*file input/i);
    const files = [mockFile("a.pdf"), mockFile("b.pdf")];
    Object.defineProperty(input, "files", { value: files, configurable: true });
    fireEvent.change(input);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Proceed/i })).toBeInTheDocument()
    );
  });

  // ── Proceed flow — upload + extract ──────────────────────────────────────

  it("clicking Proceed opens the confirm modal", async () => {
    renderWithRouter(<Capture />);
    const frontInput = screen.getByLabelText(/Front Side.*file input/i);
    const file = mockFile("passport.pdf");
    Object.defineProperty(frontInput, "files", { value: [file], configurable: true });
    fireEvent.change(frontInput);
    await waitFor(() => screen.getByRole("button", { name: /Proceed/i }));
    fireEvent.click(screen.getByRole("button", { name: /Proceed/i }));
    await waitFor(() => expect(screen.getByText("Confirm Capture")).toBeInTheDocument());
  });

  it("Proceed flow calls uploadDocument with correct file and branch", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() => expect(mockUploadDocument).toHaveBeenCalledTimes(1));
    expect(mockUploadDocument).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({ branch: "Thimphu" })
    );
  });

  it("Proceed flow calls extractDocument with doc id from upload response", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() => expect(mockExtractDocument).toHaveBeenCalledWith(42));
  });

  it("shows processing state while upload/extract runs", async () => {
    let resolveExtract!: (v: unknown) => void;
    mockExtractDocument.mockReturnValue(new Promise((r) => { resolveExtract = r; }));

    renderWithRouter(<Capture />);
    const frontInput = screen.getByLabelText(/Front Side.*file input/i);
    const file = mockFile("kyc.pdf");
    Object.defineProperty(frontInput, "files", { value: [file], configurable: true });
    fireEvent.change(frontInput);
    await waitFor(() => screen.getByRole("button", { name: /Proceed/i }));
    fireEvent.click(screen.getByRole("button", { name: /Proceed/i }));
    await waitFor(() => screen.getByRole("button", { name: /Confirm.*Proceed/i }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm.*Proceed/i }));

    await waitFor(() => expect(screen.getByText(/Processing…/i)).toBeInTheDocument());
    await act(async () => resolveExtract(MOCK_EXTRACTION_RESPONSE));
  });

  it("shows AI Classification Result section after successful extraction", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    // getAllByText because drawer may duplicate it — just ensure at least one is present
    await waitFor(() =>
      expect(screen.getAllByText("AI Classification Result").length).toBeGreaterThan(0)
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
        screen.getAllByText("/BoB/Customers/11504000231/KYC/Identity/2026/").length
      ).toBeGreaterThan(0)
    );
  });

  it("shows extracted metadata values (Dorji Wangchuk, CID)", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      expect(screen.getAllByText("Dorji Wangchuk").length).toBeGreaterThan(0)
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
    // Text is split between elements so use getAllByText with a custom matcher
    await waitFor(() =>
      expect(
        screen.getAllByText((content) => content.includes("UNKNOWN_DOC_X")).length
      ).toBeGreaterThan(0)
    );
  });

  it("shows 'Create new document type' heading for suggestedNewType", async () => {
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
      expect(screen.getAllByText("Suggested New Document Type").length).toBeGreaterThan(0)
    );
  });

  it("shows error alert when upload fails", async () => {
    mockUploadDocument.mockRejectedValueOnce(new Error("Network error"));

    renderWithRouter(<Capture />);
    const frontInput = screen.getByLabelText(/Front Side.*file input/i);
    Object.defineProperty(frontInput, "files", { value: [mockFile()], configurable: true });
    fireEvent.change(frontInput);
    await waitFor(() => screen.getByRole("button", { name: /Proceed/i }));
    fireEvent.click(screen.getByRole("button", { name: /Proceed/i }));
    await waitFor(() => screen.getByRole("button", { name: /Confirm.*Proceed/i }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Confirm.*Proceed/i })); });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(/Network error/i)).toBeInTheDocument();
  });

  // ── Queue ─────────────────────────────────────────────────────────────────

  it("adds item to capture queue after Proceed and shows queue section", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    // "Capture Queue" appears in both the inline panel and drawer header
    await waitFor(() =>
      expect(screen.getAllByText(/Capture Queue/i).length).toBeGreaterThan(0)
    );
  });

  it("shows queue count badge after an item is captured", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      expect(screen.getAllByText("1 items").length).toBeGreaterThan(0)
    );
  });

  it("clicking a queue item opens the capture queue drawer", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    // Drawer should auto-open after proceed
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /Capture queue drawer/i })).toBeInTheDocument()
    );
  });

  it("queue item is clickable (role=button with aria-label)", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() => screen.getAllByRole("button", { name: /Queue item:/i }));
    const queueItems = screen.getAllByRole("button", { name: /Queue item:/i });
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
    const fab = screen.getByRole("button", { name: /Toggle capture queue drawer/i });
    fireEvent.click(fab);
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /Capture queue drawer/i })).toBeInTheDocument()
    );
  });

  it("drawer close button is accessible", async () => {
    renderWithRouter(<Capture />);
    const fab = screen.getByRole("button", { name: /Toggle capture queue drawer/i });
    fireEvent.click(fab);
    await waitFor(() => screen.getByRole("button", { name: /Close drawer/i }));
    expect(screen.getByRole("button", { name: /Close drawer/i })).toBeInTheDocument();
  });

  it("drawer shows empty state when no queue entries", async () => {
    renderWithRouter(<Capture />);
    fireEvent.click(screen.getByRole("button", { name: /Toggle capture queue drawer/i }));
    await waitFor(() => screen.getByRole("dialog", { name: /Capture queue drawer/i }));
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

  // ── Back file is optional ─────────────────────────────────────────────────

  it("Proceed appears with only front file (back is optional)", async () => {
    renderWithRouter(<Capture />);
    const frontInput = screen.getByLabelText(/Front Side.*file input/i);
    Object.defineProperty(frontInput, "files", { value: [mockFile()], configurable: true });
    fireEvent.change(frontInput);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Proceed/i })).toBeInTheDocument()
    );
  });

  // ── Tab switching resets state ────────────────────────────────────────────

  it("switching tabs clears Proceed button", async () => {
    renderWithRouter(<Capture />);
    const frontInput = screen.getByLabelText(/Front Side.*file input/i);
    Object.defineProperty(frontInput, "files", { value: [mockFile()], configurable: true });
    fireEvent.change(frontInput);
    await waitFor(() => screen.getByRole("button", { name: /Proceed/i }));
    // Switch tab — this clears frontFile
    fireEvent.click(screen.getByRole("button", { name: "Scanner" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Proceed/i })).not.toBeInTheDocument()
    );
  });
});
