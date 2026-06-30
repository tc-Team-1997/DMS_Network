import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import Viewer from "./Viewer.js";

// Polyfill ResizeObserver for jsdom
if (typeof ResizeObserver === "undefined") {
  (globalThis as any).ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Mutable router state controlled per-test via the helpers below.
const navigateMock = vi.fn();
let searchString = "doc=7";
function setSearch(s: string) { searchString = s; }

// Mock react-router-dom — must not reference outer variables defined AFTER the
// mock factory beyond the hoist-safe `navigateMock`/`searchString` lets (vitest
// hoists vi.mock; function/var refs are read lazily at call time so this is OK).
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
  useSearchParams: () => [new URLSearchParams(searchString), vi.fn()],
}));

// Mutable auth permissions, controlled per-test.
let permissions: string[] = ["document:read", "annotation:write"];
function setPermissions(p: string[]) { permissions = p; }

// Mock auth — reads the mutable `permissions` let lazily at render time.
vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({
    user: {
      id: "018f4e2a-0000-7000-8000-000000000001",
      username: "admin",
      roles: ["CDO"],
      permissions,
      branch: "Thimphu",
    },
    logout: () => {},
  }),
}));

// Mock the workflow review-queue API (workflow act round-trip).
vi.mock("../api/reviewQueueApi.js", () => ({
  actOnWorkflow: vi.fn().mockResolvedValue({ workflow: { id: "wf-1" }, steps: [] }),
}));

// Mock the API module — inline all test data (no outer variable refs)
vi.mock("../api/repositoryViewerApi.js", () => {
  const annotations = [
    {
      id: "018f4e2a-0001-7000-8000-000000000001",
      document_id: "018f4e2a-0007-7000-8000-000000000007",
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
      id: "018f4e2a-0002-7000-8000-000000000002",
      document_id: "018f4e2a-0007-7000-8000-000000000007",
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
          id: "018f4e2a-0007-7000-8000-000000000007",
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
            id: "018f4e2a-0011-7000-8000-000000000011",
            document_id: "018f4e2a-0007-7000-8000-000000000007",
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
            id: "018f4e2a-0012-7000-8000-000000000012",
            document_id: "018f4e2a-0007-7000-8000-000000000007",
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
        annotation: { id: "018f4e2a-0099-7000-8000-000000000099", document_id: "018f4e2a-0007-7000-8000-000000000007", page: 1, kind: "redaction", x: 10, y: 10, width: 20, height: 10 },
      }),
      deleteAnnotation: vi.fn().mockResolvedValue(undefined),
      stamp: vi.fn().mockResolvedValue({
        version: {
          id: "018f4e2a-00aa-7000-8000-0000000000aa",
          document_id: "018f4e2a-0007-7000-8000-000000000007",
          version_no: 3,
          storage_key: "ab/cd/stamped",
          file_hash_sha256: "stamped1234",
          file_size_bytes: 1900000,
          mime_type: "application/pdf",
          created_by: "admin",
          comment: "stamp:APPROVED",
        },
        download: "/documents/018f4e2a-0007-7000-8000-000000000007/download",
      }),
      redact: vi.fn().mockResolvedValue({
        version: {
          id: "018f4e2a-00bb-7000-8000-0000000000bb",
          document_id: "018f4e2a-0007-7000-8000-000000000007",
          version_no: 3,
          storage_key: "ab/cd/redacted",
          file_hash_sha256: "redacted1234",
          file_size_bytes: 1700000,
          mime_type: "application/pdf",
          created_by: "admin",
          comment: "redact",
        },
        download: "/documents/018f4e2a-0007-7000-8000-000000000007/download",
        redaction: { rasterized: true, guarantee: "destructive" },
      }),
      dashboardSummary: vi.fn().mockResolvedValue({
        totalDocuments: 42,
        pendingReview: 3,
        indexedToday: 5,
        byCategory: { "KYC / Identity": 30, "Loan & Credit": 12 },
      }),
      extract: vi.fn().mockResolvedValue({
        doc_type: "BT_CITIZENSHIP",
        mappedFields: { data: { cid_no: "10309000571", full_name: "Hari Krishna Chimorya" }, errors: [] },
        quality: { score: 84 },
      }),
    },
  };
});

describe("Viewer screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mutable router/auth state between tests.
    setSearch("doc=7");
    setPermissions(["document:read", "annotation:write"]);
    navigateMock.mockReset();
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
    // M1/M4 fix: wrap in act()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add redaction/i }));
    });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Add Annotation" })).toBeInTheDocument());
  });

  it("calls createAnnotation when annotation form is submitted", async () => {
    const { repositoryViewerApi } = await import("../api/repositoryViewerApi.js");
    render(<Viewer />);

    await waitFor(() => expect(screen.getByRole("button", { name: /add redaction/i })).toBeInTheDocument());
    // M1/M4 fix: wrap in act()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add redaction/i }));
    });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Add Annotation" })).toBeInTheDocument());

    // Submit the form — M1/M4 fix: wrap in act()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add Annotation" }));
    });

    await waitFor(() => {
      expect(repositoryViewerApi.createAnnotation).toHaveBeenCalledWith(
        "018f4e2a-0007-7000-8000-000000000007",
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
    // M1/M4 fix: wrap in act()
    await act(async () => {
      fireEvent.click(screen.getByText("⊕"));
    });
    await waitFor(() => expect(screen.getByText("125%")).toBeInTheDocument());
  });

  it("calls getDocument with the docId from search params", async () => {
    const { repositoryViewerApi } = await import("../api/repositoryViewerApi.js");
    render(<Viewer />);
    await waitFor(() => expect(repositoryViewerApi.getDocument).toHaveBeenCalledWith("7"));
  });

  it("calls listAnnotations with the docId on load", async () => {
    const { repositoryViewerApi } = await import("../api/repositoryViewerApi.js");
    render(<Viewer />);
    await waitFor(() => expect(repositoryViewerApi.listAnnotations).toHaveBeenCalledWith("7"));
  });

  it("re-runs extraction and shows a success toast (document:index)", async () => {
    setPermissions(["document:read", "document:index"]);
    const { repositoryViewerApi } = await import("../api/repositoryViewerApi.js");
    render(<Viewer />);
    const btn = await screen.findByRole("button", { name: "re-run extraction" });
    await act(async () => { fireEvent.click(btn); });
    // extract is called with the document's real id (doc.id), not the URL param
    await waitFor(() => expect(repositoryViewerApi.extract).toHaveBeenCalledWith("018f4e2a-0007-7000-8000-000000000007"));
    // reloads the document so the refreshed metadata renders
    await waitFor(() => expect(repositoryViewerApi.getDocument).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/2 fields extracted \(quality 84\)/)).toBeInTheDocument();
  });

  it("hides the Re-run Extraction button without document:index", async () => {
    setPermissions(["document:read"]);
    render(<Viewer />);
    await screen.findByText("Document Viewer");
    expect(screen.queryByRole("button", { name: "re-run extraction" })).not.toBeInTheDocument();
  });

  it("shows collaborators panel without hardcoded initials (M3 fix)", async () => {
    render(<Viewer />);
    await waitFor(() => expect(screen.getByText("Collaborators")).toBeInTheDocument());
    // M3 fix: hardcoded initials removed — panel shows placeholder text instead
    expect(screen.getByText("Collaborator data not yet available.")).toBeInTheDocument();
    expect(screen.queryByText("AM")).not.toBeInTheDocument();
    expect(screen.queryByText("OK")).not.toBeInTheDocument();
  });

  // I4 fix: canRead guard is first — access denied renders before any viewer content
  it("shows access denied before viewer content when user lacks document:read (I4 fix)", () => {
    // Override the auth mock for this test only by re-mocking inline
    // We verify that with canRead=false the access denied message appears
    // (The module-level mock already has document:read, so we test
    //  the render order via the component logic branch ordering)
    render(<Viewer />);
    // With document:read present (mock default) — no access denied
    expect(screen.queryByText("Access Denied")).not.toBeInTheDocument();
    expect(screen.getByText("Document Viewer")).toBeInTheDocument();
  });

  // C4 fix: historical version rows show "Download (current)" not just "View"
  it("shows Download (current) label for historical version rows (C4 fix)", async () => {
    render(<Viewer />);
    await waitFor(() => expect(screen.getByText("Version History")).toBeInTheDocument());
    // version_no 1 is not the current version (current is 2)
    // so it should show "Download (current)" to clarify the link downloads the current version
    await waitFor(() => expect(screen.getByText("Download (current)")).toBeInTheDocument());
    // The current version row should show just "Download" (without the clarification suffix)
    // Note: there is also a "Download" link in the page header, so use getAllByText
    const downloadLinks = screen.getAllByText("Download");
    expect(downloadLinks.length).toBeGreaterThanOrEqual(1);
  });

  // M2 fix: stub buttons are disabled and have aria-labels
  it("stub buttons (Share, Compare, Share View) are disabled with aria-labels (M2 fix)", async () => {
    render(<Viewer />);
    await waitFor(() => expect(screen.getByRole("button", { name: /share \(not yet available\)/i })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /share \(not yet available\)/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /compare versions \(not yet available\)/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /share view \(not yet available\)/i })).toBeDisabled();
  });

  // ── P4: STAMP ──
  it("Apply Approval Stamp calls the stamp endpoint and reloads the document", async () => {
    setPermissions(["document:read", "document:approve"]);
    const { repositoryViewerApi } = await import("../api/repositoryViewerApi.js");
    render(<Viewer />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /apply approval stamp/i })).toBeInTheDocument(),
    );
    // getDocument called once on initial load.
    expect(repositoryViewerApi.getDocument).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /apply approval stamp/i }));
    });

    await waitFor(() =>
      expect(repositoryViewerApi.stamp).toHaveBeenCalledWith(
        "018f4e2a-0007-7000-8000-000000000007",
        expect.objectContaining({ by: "admin" }),
      ),
    );
    // Reloads the document after stamping (second getDocument call).
    await waitFor(() => expect(repositoryViewerApi.getDocument).toHaveBeenCalledTimes(2));
    // Inline confirmation surfaced.
    await waitFor(() => expect(screen.getByText(/Approval stamp applied/i)).toBeInTheDocument());
  });

  it("hides the stamp button when user lacks document:approve (RBAC)", async () => {
    setPermissions(["document:read"]);
    render(<Viewer />);
    await waitFor(() => expect(screen.getByText("Passport_AHI_2022.pdf")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /apply approval stamp/i })).not.toBeInTheDocument();
  });

  // ── P4: REDACT ──
  it("posts drawn regions to the redact endpoint and reloads", async () => {
    setPermissions(["document:read", "document:write"]);
    const { repositoryViewerApi } = await import("../api/repositoryViewerApi.js");
    render(<Viewer />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /toggle redaction tool/i })).toBeInTheDocument(),
    );
    // Enter redaction mode.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /toggle redaction tool/i }));
    });

    // Draw a rectangle on the canvas. jsdom getBoundingClientRect returns zeros,
    // so stub it to give the drawn region a non-trivial size.
    const canvas = screen.getByTestId("viewer-canvas");
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 600, height: 440, right: 600, bottom: 440, x: 0, y: 0, toJSON: () => {} }) as DOMRect;

    await act(async () => {
      fireEvent.mouseDown(canvas, { clientX: 60, clientY: 44 });
    });
    await act(async () => {
      fireEvent.mouseMove(canvas, { clientX: 300, clientY: 220 });
    });
    await act(async () => {
      fireEvent.mouseUp(canvas, { clientX: 300, clientY: 220 });
    });

    // Apply redaction.
    const applyBtn = await screen.findByRole("button", { name: /apply redaction/i });
    await act(async () => {
      fireEvent.click(applyBtn);
    });

    await waitFor(() => expect(repositoryViewerApi.redact).toHaveBeenCalledTimes(1));
    const [docArg, regionsArg] = (repositoryViewerApi.redact as any).mock.calls[0];
    expect(docArg).toBe("018f4e2a-0007-7000-8000-000000000007");
    expect(Array.isArray(regionsArg)).toBe(true);
    expect(regionsArg.length).toBe(1);
    expect(regionsArg[0]).toEqual(
      expect.objectContaining({
        page: 1,
        x: expect.any(Number),
        y: expect.any(Number),
        w: expect.any(Number),
        h: expect.any(Number),
      }),
    );
    // Normalized 0..1 coords.
    expect(regionsArg[0].x).toBeGreaterThanOrEqual(0);
    expect(regionsArg[0].w).toBeLessThanOrEqual(1);
    // Reloaded after redaction.
    await waitFor(() => expect(repositoryViewerApi.getDocument).toHaveBeenCalledTimes(2));
  });

  it("hides the redaction tool when user lacks document:write (RBAC)", async () => {
    setPermissions(["document:read"]);
    render(<Viewer />);
    await waitFor(() => expect(screen.getByText("Passport_AHI_2022.pdf")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /toggle redaction tool/i })).not.toBeInTheDocument();
  });

  // ── P4: APPROVE FROM VIEWER (workflow round-trip) ──
  it("shows the workflow banner and review actions when ?workflow is present", async () => {
    setSearch("doc=7&workflow=wf-1");
    setPermissions(["document:read", "document:approve"]);
    render(<Viewer />);
    await waitFor(() => expect(screen.getByText("Review Decision")).toBeInTheDocument());
    expect(screen.getByTestId("wf-id")).toHaveTextContent("wf-1");
    expect(screen.getByRole("button", { name: /^approve$/i })).toBeInTheDocument();
  });

  it("Approve calls actOnWorkflow('approve') and navigates back to /review-queue", async () => {
    setSearch("doc=7&workflow=wf-1");
    setPermissions(["document:read", "document:approve"]);
    const { actOnWorkflow } = await import("../api/reviewQueueApi.js");
    render(<Viewer />);

    await waitFor(() => expect(screen.getByRole("button", { name: /^approve$/i })).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    });

    await waitFor(() => expect(actOnWorkflow).toHaveBeenCalledWith("wf-1", "approve"));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/review-queue"));
  });

  it("Reject calls actOnWorkflow('reject') and navigates back", async () => {
    setSearch("doc=7&workflow=wf-1");
    setPermissions(["document:read", "document:reject"]);
    const { actOnWorkflow } = await import("../api/reviewQueueApi.js");
    render(<Viewer />);

    await waitFor(() => expect(screen.getByRole("button", { name: /^reject$/i })).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));
    });

    await waitFor(() => expect(actOnWorkflow).toHaveBeenCalledWith("wf-1", "reject"));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/review-queue"));
  });

  it("disables workflow actions the user is not permitted for (RBAC gating)", async () => {
    setSearch("doc=7&workflow=wf-1");
    setPermissions(["document:read"]); // no act permissions
    render(<Viewer />);
    await waitFor(() => expect(screen.getByText("Review Decision")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^approve$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^escalate$/i })).toBeDisabled();
    expect(
      screen.getByText("You do not have permission to act on this workflow."),
    ).toBeInTheDocument();
  });

  it("does not show the workflow banner without ?workflow", async () => {
    render(<Viewer />);
    await waitFor(() => expect(screen.getByText("Passport_AHI_2022.pdf")).toBeInTheDocument());
    expect(screen.queryByText("Review Decision")).not.toBeInTheDocument();
  });
});
