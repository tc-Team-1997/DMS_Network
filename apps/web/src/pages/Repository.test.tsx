import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import Repository from "./Repository.js";

// Polyfill ResizeObserver for jsdom (recharts ResponsiveContainer requires it)
if (typeof ResizeObserver === "undefined") {
  (globalThis as any).ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Mock auth
vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      username: "admin",
      roles: ["CDO"],
      permissions: [
        "document:read",
        "folder:read",
        "folder:create",
        "document:delete",
        "document:capture",
        "document:index",
        "annotation:write",
      ],
      branch: "Thimphu",
    },
    logout: () => {},
  }),
}));

// Mock the API module
vi.mock("../api/repositoryViewerApi.js", () => ({
  repositoryViewerApi: {
    listFolders: vi.fn().mockResolvedValue({
      tree: [
        {
          id: 1,
          name: "Customers",
          path: "/BoB/Customers",
          domain: "Customers",
          children: [
            { id: 3, name: "KYC", path: "/BoB/Customers/KYC", children: [] },
          ],
        },
        {
          id: 2,
          name: "Loan Applications",
          path: "/BoB/Loan Applications",
          domain: "Operations",
          children: [],
        },
      ],
    }),
    listDocuments: vi.fn().mockResolvedValue({
      documents: [
        {
          id: 9,
          title: "Passport_AHI_2022.pdf",
          original_filename: "Passport_AHI_2022.pdf",
          branch: "Thimphu",
          catalog_category: "KYC / Identity",
          status: "Active",
          review_flag: false,
          current_version: 2,
          file_size_bytes: 1887436,
          page_count: 4,
          file_hash_sha256: "abc123",
          source_channel: "SCAN",
          doc_type: "BT_PASSPORT",
          folder_id: 3,
        },
        {
          id: 10,
          title: "LoanApp_BTN_2024.pdf",
          original_filename: "LoanApp_BTN_2024.pdf",
          branch: "Thimphu",
          catalog_category: "Loan & Credit",
          status: "Active",
          review_flag: true,
          current_version: 1,
          file_size_bytes: 524288,
          page_count: 12,
          file_hash_sha256: "def456",
          source_channel: "UPLOAD",
          doc_type: "BOB_LOAN_APPLICATION",
          folder_id: 2,
        },
      ],
    }),
    listVersions: vi.fn().mockResolvedValue({ versions: [] }),
    deleteDocument: vi.fn().mockResolvedValue(undefined),
    uploadDocument: vi.fn().mockResolvedValue({ document: { id: 11, title: "New Doc" } }),
    createFolder: vi.fn().mockResolvedValue({ folder: { id: 4, name: "Test" } }),
    dashboardSummary: vi.fn().mockResolvedValue({
      totalDocuments: 2,
      pendingReview: 1,
      indexedToday: 0,
      byCategory: { "KYC / Identity": 1, "Loan & Credit": 1 },
    }),
  },
}));

describe("Repository screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the page header and KPI cards", async () => {
    render(<Repository />);
    expect(screen.getByText("Document Repository")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Total Documents")).toBeInTheDocument());
    expect(screen.getByText("Pending Review")).toBeInTheDocument();
    expect(screen.getByText("Folder Nodes")).toBeInTheDocument();
  });

  it("renders folder tree with nested nodes", async () => {
    render(<Repository />);
    await waitFor(() => expect(screen.getByText("Customers")).toBeInTheDocument());
    expect(screen.getByText("KYC")).toBeInTheDocument();
    expect(screen.getByText("Loan Applications")).toBeInTheDocument();
  });

  it("renders documents table with titles and status tags", async () => {
    render(<Repository />);
    await waitFor(() => expect(screen.getByText("Passport_AHI_2022.pdf")).toBeInTheDocument());
    expect(screen.getByText("LoanApp_BTN_2024.pdf")).toBeInTheDocument();
    // KYC / Identity category tag — may appear in filter dropdown AND as a tag
    expect(screen.getAllByText("KYC / Identity").length).toBeGreaterThan(0);
  });

  it("shows delete button when user has document:delete permission", async () => {
    render(<Repository />);
    await waitFor(() => expect(screen.getByText("Passport_AHI_2022.pdf")).toBeInTheDocument());
    // Click first document row to select it
    fireEvent.click(screen.getByText("Passport_AHI_2022.pdf"));
    await waitFor(() => expect(screen.getByText("Open Viewer")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("calls listDocuments and listFolders on mount", async () => {
    const { repositoryViewerApi } = await import("../api/repositoryViewerApi.js");
    render(<Repository />);
    await waitFor(() => expect(repositoryViewerApi.listDocuments).toHaveBeenCalled());
    expect(repositoryViewerApi.listFolders).toHaveBeenCalled();
  });

  it("shows Upload Document button for users with document:capture", async () => {
    render(<Repository />);
    await waitFor(() => expect(screen.getByRole("button", { name: /upload document/i })).toBeInTheDocument());
  });

  it("shows New Folder button for users with folder:create", async () => {
    render(<Repository />);
    await waitFor(() => expect(screen.getByRole("button", { name: /new folder/i })).toBeInTheDocument());
  });

  it("opens upload modal when Upload Document is clicked", async () => {
    render(<Repository />);
    await waitFor(() => expect(screen.getByRole("button", { name: /upload document/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /upload document/i }));
    // After click, "Upload Document" appears as modal title (h3) plus button text — use queryAllBy
    await waitFor(() => expect(screen.getAllByText("Upload Document").length).toBeGreaterThanOrEqual(1));
    expect(screen.getByText("Capture Document")).toBeInTheDocument();
  });

  it("shows review-flagged documents with Review status tag", async () => {
    render(<Repository />);
    await waitFor(() => expect(screen.getByText("LoanApp_BTN_2024.pdf")).toBeInTheDocument());
    // The review-flagged doc should show "Review" tag
    expect(screen.getByText("Review")).toBeInTheDocument();
  });

  it("switches to analytics tab and shows category donut chart title", async () => {
    render(<Repository />);
    await waitFor(() => expect(screen.getByText("Analytics")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Analytics"));
    await waitFor(() => expect(screen.getByText("Documents by Category")).toBeInTheDocument());
  });
});
