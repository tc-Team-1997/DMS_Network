import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import Viewer from "./Viewer.js";

// Polyfill ResizeObserver for jsdom
if (typeof ResizeObserver === "undefined") {
  (globalThis as any).ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Mock react-router-dom — must not reference outer variables (hoisted)
vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams("doc=7"), vi.fn()],
}));

// Mock auth — must not reference outer variables (hoisted)
vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      username: "admin",
      roles: ["CDO"],
      permissions: ["document:read", "annotation:write"],
      branch: "Thimphu",
    },
    logout: () => {},
  }),
}));

// Mock the API module — inline all test data (no outer variable refs)
vi.mock("../api/repositoryViewerApi.js", () => {
  const annotations = [
    {
      id: 1,
      document_id: 7,
      page: 1,
      kind: "redaction",
      x: 10,
      y: 10,
      width: 20,
      height: 10,
      content: "Account number redacted per data policy",
      created_by: "admin",
      created_at: "2026-01-10T09:00:00.000Z",
    },
    {
      id: 2,
      document_id: 7,
      page: 1,
      kind: "highlight",
      x: 5,
      y: 30,
      width: 60,
      height: 8,
      content: "Verify expiry date alignment with CBS",
      created_by: "admin",
      created_at: "2026-01-10T10:00:00.000Z",
    },
  ];

  return {
    repositoryViewerApi: {
      getDocument: vi.fn().mockResolvedValue({
        document: {
          id: 7,
          title: "Passport_AHI_2022.pdf",
          original_filename: "Passport_AHI_2022.pdf",
          mime_type: "application/pdf",
          branch: "Thimphu",
          catalog_category: "KYC / Identity",
          status: "Active",
          review_flag: false,
          current_version: 2,
          file_size_bytes: 1887436,
          page_count: 4,
          file_hash_sha256: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
          source_channel: "SCAN",
          doc_type: "BT_PASSPORT",
          retention_years: 10,
        },
      }),
      listAnnotations: vi.fn().mockResolvedValue({ annotations }),
      listVersions: vi.fn().mockResolvedValue({
        versions: [
          {
            id: 1,
            document_id: 7,
            version_no: 2,
            storage_key: "ab/cd/abcd1234",
            file_hash_sha256: "abcd1234",
            file_size_bytes: 1887436,
            mime_type: "application/pdf",
            created_by: "admin",
            comment: "Re-uploaded (renewed)",
            created_at: "2026-01-12T00:00:00.000Z",
          },
          {
            id: 2,
            document_id: 7,
            version_no: 1,
            storage_key: "ab/cd/abcd5678",
            file_hash_sha256: "abcd5678",
            file_size_bytes: 2097152,
            mime_type: "application/pdf",
            created_by: "admin",
            comment: "Original scan",
            created_at: "2022-01-10T00:00:00.000Z",
          },
        ],
      }),
      createAnnotation: vi.fn().mockResolvedValue({
        annotation: { id: 99, document_id: 7, page: 1, kind: "redaction", x: 10, y: 10, width: 20, height: 10 },
      }),
      deleteAnnotation: vi.fn().mockResolvedValue(undefined),
      dashboardSummary: vi.fn().mockResolvedValue({
        totalDocuments: 42,
        pendingReview: 3,
        indexedToday: 5,
        byCategory: { "KYC / Identity": 30, "Loan & Credit": 12 },
      }),
    },
  };
});

describe("Viewer screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the page header", async () => {
    render(<Viewer />);
    expect(screen.getByText("Document Viewer")).toBeInTheDocument();
  });

  it("renders document title after loading", async () => {
    render(<Viewer />);
    await waitFor(() => expect(screen.getByText("Passport_AHI_2022.pdf")).toBeInTheDocument());
  });

  it("renders annotation list with redaction and highlight", async () => {
    render(<Viewer />);
    await waitFor(() => expect(screen.getByText("Redaction · Page 1")).toBeInTheDocument());
    expect(screen.getByText("Highlight · Page 1")).toBeInTheDocument();
    expect(screen.getByText("Account number redacted per data policy")).toBeInTheDocument();
  });

  it("renders version history", async () => {
    render(<Viewer />);
    await waitFor(() => expect(screen.getByText("Version History")).toBeInTheDocument());
    expect(screen.getByText("Re-uploaded (renewed)")).toBeInTheDocument();
    expect(screen.getByText("Original scan")).toBeInTheDocument();
  });

  it("shows Add Redaction toolbar button when user has annotation:write", async () => {
    render(<Viewer />);
    await waitFor(() => expect(screen.getByRole("button", { name: /add redaction/i })).toBeInTheDocument());
  });

  it("opens annotation modal when Redact toolbar button is clicked", async () => {
    render(<Viewer />);
    await waitFor(() => expect(screen.getByRole("button", { name: /add redaction/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add redaction/i }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Add Annotation" })).toBeInTheDocument());
  });

  it("calls createAnnotation when annotation form is submitted", async () => {
    const { repositoryViewerApi } = await import("../api/repositoryViewerApi.js");
    render(<Viewer />);

    await waitFor(() => expect(screen.getByRole("button", { name: /add redaction/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add redaction/i }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Add Annotation" })).toBeInTheDocument());

    // Submit the form
    fireEvent.click(screen.getByRole("button", { name: "Add Annotation" }));

    await waitFor(() => {
      expect(repositoryViewerApi.createAnnotation).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ kind: "redaction" })
      );
    });
  });

  it("shows document metadata panel", async () => {
    render(<Viewer />);
    await waitFor(() => expect(screen.getByText("Document Metadata")).toBeInTheDocument());
    expect(screen.getByText("BT_PASSPORT")).toBeInTheDocument();
    expect(screen.getByText("Thimphu")).toBeInTheDocument();
    expect(screen.getByText("10 Years")).toBeInTheDocument();
  });

  it("renders toolbar with zoom controls and updates zoom on click", async () => {
    render(<Viewer />);
    await waitFor(() => expect(screen.getByText("100%")).toBeInTheDocument());
    fireEvent.click(screen.getByText("⊕"));
    await waitFor(() => expect(screen.getByText("125%")).toBeInTheDocument());
  });

  it("calls getDocument with the docId from search params", async () => {
    const { repositoryViewerApi } = await import("../api/repositoryViewerApi.js");
    render(<Viewer />);
    await waitFor(() => expect(repositoryViewerApi.getDocument).toHaveBeenCalledWith(7));
  });

  it("calls listAnnotations with the docId on load", async () => {
    const { repositoryViewerApi } = await import("../api/repositoryViewerApi.js");
    render(<Viewer />);
    await waitFor(() => expect(repositoryViewerApi.listAnnotations).toHaveBeenCalledWith(7));
  });

  it("shows collaborators panel", async () => {
    render(<Viewer />);
    await waitFor(() => expect(screen.getByText("Collaborators")).toBeInTheDocument());
    expect(screen.getByText("AM")).toBeInTheDocument();
    expect(screen.getByText("OK")).toBeInTheDocument();
  });
});
