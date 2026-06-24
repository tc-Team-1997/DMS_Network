import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Indexing from "./Indexing.js";

// Polyfill ResizeObserver for recharts in jsdom
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Mock AuthContext
vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      username: "indexer1",
      roles: ["Indexer"],
      permissions: ["document:index", "document:read", "document:catalog"],
      branch: "Thimphu",
    },
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

function renderWithRouter(ui: React.ReactElement, initialPath = "/indexing") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/indexing" element={ui} />
        <Route path="/indexing/:id" element={ui} />
      </Routes>
    </MemoryRouter>,
  );
}

const MOCK_DOCUMENTS = [
  {
    id: 5,
    title: "Passport — Tenzin Wangchuk",
    branch: "Thimphu",
    status: "Active",
    doc_type: null,
    review_flag: false,
    catalog_category: null,
    mime_type: "application/pdf",
    original_filename: "passport_001.pdf",
  },
  {
    id: 6,
    title: "CID Card — Dema Lhamo",
    branch: "Phuentsholing",
    status: "Active",
    doc_type: "BT_CID_4G",
    review_flag: true,
    catalog_category: "KYC / Identity",
    mime_type: "image/jpeg",
    original_filename: "cid_002.jpg",
  },
];

describe("Indexing screen", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, opts?: RequestInit) => {
      if (typeof url === "string" && url.includes("/documents") && (!opts || opts.method !== "POST")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ documents: MOCK_DOCUMENTS }),
        } as unknown as Response;
      }
      if (typeof url === "string" && url.includes("/index/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ document: { ...MOCK_DOCUMENTS[0], doc_type: "BT_PASSPORT" } }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    });
  });

  it("renders the Indexing & QA page header", () => {
    renderWithRouter(<Indexing />);
    expect(screen.getByText("Indexing & QA")).toBeInTheDocument();
  });

  it("calls GET /svc/core/documents on mount to load the queue", async () => {
    renderWithRouter(<Indexing />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/documents"),
      expect.anything(),
    ));
  });

  it("renders KPI cards including Pending Indexing and AI Accuracy", async () => {
    renderWithRouter(<Indexing />);
    await waitFor(() => expect(screen.getByText(/Pending Indexing/i)).toBeInTheDocument());
    expect(screen.getByText(/AI Accuracy/i)).toBeInTheDocument();
  });

  it("shows the Metadata Form, Indexing Queue, and QA Checklist tabs", () => {
    renderWithRouter(<Indexing />);
    // Tabs renders these as button elements; use getAllByText to avoid duplicates
    const formTabs = screen.getAllByText("Metadata Form");
    expect(formTabs.length).toBeGreaterThan(0);
    const queueTabs = screen.getAllByText("Indexing Queue");
    expect(queueTabs.length).toBeGreaterThan(0);
    const qaTabs = screen.getAllByText("QA Checklist");
    expect(qaTabs.length).toBeGreaterThan(0);
  });

  it("renders BT_CID_4G fields including cid_no by default", () => {
    renderWithRouter(<Indexing />);
    // FormField labels are not `for`-associated; check for label text instead
    expect(screen.getByText(/CID Number \*/i)).toBeInTheDocument();
  });

  it("shows Document Type select with BT_CID_4G option", () => {
    renderWithRouter(<Indexing />);
    const allBtCid = screen.getAllByText(/BT CID 4G/i);
    // There may be multiple (option text duplicated in select), just assert at least one
    expect(allBtCid.length).toBeGreaterThan(0);
  });

  it("shows BT_PASSPORT fields when Passport type is selected", async () => {
    renderWithRouter(<Indexing />);
    // Find the Document Type select by its label text in the DOM
    const docTypeLabel = screen.getByText(/Document Type \*/i);
    const select = docTypeLabel.closest("div")?.querySelector("select");
    if (select) fireEvent.change(select, { target: { value: "BT_PASSPORT" } });
    await waitFor(() => expect(screen.getByText(/Passport Number \*/i)).toBeInTheDocument());
  });

  it("shows BOB_LOAN_APPLICATION fields when Loan type is selected", async () => {
    renderWithRouter(<Indexing />);
    const docTypeLabel = screen.getByText(/Document Type \*/i);
    const select = docTypeLabel.closest("div")?.querySelector("select");
    if (select) fireEvent.change(select, { target: { value: "BOB_LOAN_APPLICATION" } });
    await waitFor(() => expect(screen.getByText(/Application Number \*/i)).toBeInTheDocument());
  });

  it("surfaces validation errors from a 422 response", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, opts?: RequestInit) => {
      if (typeof url === "string" && url.includes("/documents")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ documents: MOCK_DOCUMENTS }),
        } as unknown as Response;
      }
      if (typeof url === "string" && url.includes("/index/")) {
        return {
          ok: false,
          status: 422,
          json: async () => ({
            errors: ["cid_no: does not match ^[0-9]{11}$"],
            missing: ["expiry_date"],
          }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    });

    renderWithRouter(<Indexing />);
    // Wait for documents to load
    await waitFor(() => screen.getAllByText("Metadata Form").length > 0);

    // Wait for queue picker to appear (only shows when docs exist and no doc selected)
    await waitFor(() => expect(screen.queryByText(/Choose document/i)).toBeInTheDocument());

    // Find the queue picker option select and select document #5
    const queuePicker = screen.getByText(/Choose document/i).closest("select");
    if (queuePicker) {
      fireEvent.change(queuePicker, { target: { value: "5" } });
    }

    // Click Save Index button
    const saveBtn = screen.getByRole("button", { name: /Save Index/i });
    fireEvent.click(saveBtn);

    await waitFor(() => expect(screen.getByText(/expiry_date/)).toBeInTheDocument());
    expect(screen.getByText(/cid_no: does not match/)).toBeInTheDocument();
  });

  it("switches to Indexing Queue tab and shows queued documents", async () => {
    renderWithRouter(<Indexing />);
    const queueTab = screen.getByText("Indexing Queue");
    fireEvent.click(queueTab);
    await waitFor(() => expect(screen.getByText("Passport — Tenzin Wangchuk")).toBeInTheDocument());
  });

  it("shows 'Unindexed' tag for documents without doc_type in queue", async () => {
    renderWithRouter(<Indexing />);
    fireEvent.click(screen.getByText("Indexing Queue"));
    await waitFor(() => expect(screen.getByText("Unindexed")).toBeInTheDocument());
  });

  it("shows 'Indexed' status for already-indexed documents in queue", async () => {
    renderWithRouter(<Indexing />);
    fireEvent.click(screen.getByText("Indexing Queue"));
    await waitFor(() => expect(screen.getByText("Indexed")).toBeInTheDocument());
  });

  it("shows the QA Checklist tab with checklist items", async () => {
    renderWithRouter(<Indexing />);
    // QA checklist items appear in the Form tab's mini-checklist card without needing tab switch
    // Just verify the checklist items are present
    await waitFor(() =>
      expect(screen.getAllByText(/Image quality acceptable/i).length).toBeGreaterThan(0)
    );
  });

  it("renders Auto-Index All (AI) button in header", () => {
    renderWithRouter(<Indexing />);
    expect(screen.getByRole("button", { name: /Auto-Index All/i })).toBeInTheDocument();
  });

  it("renders AI Extracted Data Validation panel", async () => {
    renderWithRouter(<Indexing />);
    await waitFor(() => expect(screen.getByText(/AI Extracted Data Validation/i)).toBeInTheDocument());
  });

  it("renders Reject button", async () => {
    renderWithRouter(<Indexing />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Reject/i })).toBeInTheDocument());
  });

  it("opens reject modal when Reject button is clicked", async () => {
    renderWithRouter(<Indexing />);
    await waitFor(() => screen.getByRole("button", { name: /Reject/i }));
    fireEvent.click(screen.getByRole("button", { name: /Reject/i }));
    await waitFor(() => expect(screen.getByText(/Reject Document/i)).toBeInTheDocument());
  });

  it("shows success message after successful index save", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, opts?: RequestInit) => {
      if (typeof url === "string" && url.includes("/documents") && !url.includes("/index")) {
        return { ok: true, status: 200, json: async () => ({ documents: MOCK_DOCUMENTS }) } as unknown as Response;
      }
      if (typeof url === "string" && url.includes("/index/")) {
        return { ok: true, status: 200, json: async () => ({ document: { ...MOCK_DOCUMENTS[0], doc_type: "BT_CID_4G" } }) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    });

    renderWithRouter(<Indexing />);
    // Wait for queue to load
    await waitFor(() => expect(screen.queryByText(/Choose document/i)).toBeInTheDocument());

    // Select document from queue picker
    const queuePicker = screen.getByText(/Choose document/i).closest("select");
    if (queuePicker) {
      fireEvent.change(queuePicker, { target: { value: "5" } });
    }

    fireEvent.click(screen.getByRole("button", { name: /Save & Send to Workflow/i }));
    await waitFor(() => expect(screen.getByText(/indexed successfully/i)).toBeInTheDocument());
  });
});
