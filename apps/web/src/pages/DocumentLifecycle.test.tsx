import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DocumentLifecycle } from "./DocumentLifecycle.js";

/* ─── ResizeObserver polyfill (recharts needs it in jsdom) ─── */
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe()    { /* noop */ }
      unobserve()  { /* noop */ }
      disconnect() { /* noop */ }
    } as unknown as typeof ResizeObserver;
  }
});

/*
 * Mock react-router-dom — keep useParams returning docId: "9" while
 * preserving useSearchParams from the real library so useUrlState works.
 */
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useParams: () => ({ docId: "9" }),
  };
});

vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      username: "admin",
      roles: ["CDO"],
      // "lifecycle:read" does not exist in RBAC — only "document:read" is the real gate
      permissions: ["document:read"],
    },
    logout: () => {},
  }),
}));

const MOCK_TRACE = {
  document_id: 9,
  doc_no: "L9",
  doc_type: "LETTER",
  stages: [
    { stage: "capture", at: "2026-06-01T08:00:00Z", actor: "admin", complete: true },
    { stage: "index", at: "2026-06-02T09:00:00Z", actor: "admin", complete: true },
    { stage: "workflow", at: null, actor: undefined, complete: false },
    { stage: "archive", at: null, actor: undefined, complete: false },
    { stage: "disposal", at: null, actor: undefined, complete: false },
  ],
  versions: [
    {
      version_no: 1,
      file_hash_sha256: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      created_by: "admin",
      created_at: "2026-06-01T08:00:00Z",
    },
  ],
  funnel: { capture: 5, index: 4, workflow: 2, archive: 1, disposal: 0 },
};

/* Wrap in MemoryRouter so useUrlState (useSearchParams) works in tests */
function renderPage(initialSearch = "") {
  return render(
    <MemoryRouter initialEntries={[`/${initialSearch}`]}>
      <DocumentLifecycle />
    </MemoryRouter>,
  );
}

describe("DocumentLifecycle screen", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn((url: string) => {
      if (String(url).includes("/lifecycle/9")) {
        return Promise.resolve({ ok: true, json: async () => ({ trace: MOCK_TRACE }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ documents: [] }) });
    }) as any;
  });

  it("renders the document type after loading", async () => {
    renderPage();
    await waitFor(() => {
      const matches = screen.getAllByText(/LETTER/);
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it("renders the document number", async () => {
    renderPage();
    await waitFor(() => {
      const matches = screen.getAllByText("L9");
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it("renders stage names in the trace", async () => {
    renderPage();
    await waitFor(() => {
      const captures = screen.getAllByText(/Capture/i);
      expect(captures.length).toBeGreaterThan(0);
    });
  });

  it("shows version v1 label after switching to Versions tab", async () => {
    renderPage();
    // Wait for trace to load
    await waitFor(() => {
      const matches = screen.getAllByText(/LETTER/);
      expect(matches.length).toBeGreaterThan(0);
    });
    // Use fireEvent.click to stay within React's event system (avoids act() warnings)
    const versionTab = screen.getByRole("button", { name: /version control/i });
    fireEvent.click(versionTab);
    await waitFor(() => {
      const v1 = screen.getAllByText(/v1/i);
      expect(v1.length).toBeGreaterThan(0);
    });
  });

  it("renders the pipeline funnel numbers", async () => {
    renderPage();
    await waitFor(() => {
      // funnel capture=5 should appear in the pipeline bar area
      const fives = screen.getAllByText("5");
      expect(fives.length).toBeGreaterThan(0);
    });
  });

  it("calls the lifecycle endpoint with the docId from route params", async () => {
    renderPage();
    await waitFor(() => {
      const matches = screen.getAllByText(/LETTER/);
      expect(matches.length).toBeGreaterThan(0);
    });
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => String(c[0])
    );
    expect(calls.some((u) => u.includes("/lifecycle/9"))).toBe(true);
  });
});

/* ─── Client-side document search filtering (C-2 workaround) ─── */
// The main describe block mocks useParams to return docId: "9", so no browse-list
// auto-load happens. To test client-side filtering we use the existing render,
// switch to the Browse tab, trigger a search, and verify the filter narrows results.
describe("DocumentLifecycle — client-side search filtering", () => {
  const MOCK_DOCS = [
    { id: 1, doc_no: "D001", doc_type: "LETTER", status: "Indexed", branch: "HQ", created_at: "2026-06-01T00:00:00Z" },
    { id: 2, doc_no: "D002", doc_type: "REPORT", status: "Captured", branch: "Branch-A", created_at: "2026-06-02T00:00:00Z" },
    { id: 3, doc_no: "D003", doc_type: "MEMO", status: "Archived", branch: "HQ", created_at: "2026-06-03T00:00:00Z" },
  ];

  beforeAll(() => {
    if (typeof globalThis.ResizeObserver === "undefined") {
      globalThis.ResizeObserver = class ResizeObserver {
        observe()    { /* noop */ }
        unobserve()  { /* noop */ }
        disconnect() { /* noop */ }
      } as unknown as typeof ResizeObserver;
    }
  });

  beforeEach(() => {
    // Backend returns unfiltered list regardless of query params (C-2 known issue).
    // On the first call the lifecycle trace is fetched (docId=9 from the mock),
    // on subsequent /documents calls the full list is returned.
    globalThis.fetch = vi.fn((url: string) => {
      if (String(url).includes("/lifecycle/9")) {
        return Promise.resolve({ ok: true, json: async () => ({ trace: MOCK_TRACE }) });
      }
      // /documents returns unfiltered list — client must filter
      return Promise.resolve({ ok: true, json: async () => ({ documents: MOCK_DOCS }) });
    }) as any;
  });

  it("client-side filter by doc_type hides non-matching documents", async () => {
    renderPage();

    // Wait for trace to load so initial fetch completes
    await waitFor(() => expect(screen.getAllByText(/LETTER/).length).toBeGreaterThan(0));

    // Switch to Browse tab and load the full document list
    const browseTab = screen.getByRole("button", { name: /browse documents/i });
    fireEvent.click(browseTab);

    // The Browse tab shows a Search button; click it to load all docs (no filter)
    const searchBtn = screen.getByRole("button", { name: /^Search$/i });
    fireEvent.click(searchBtn);

    // All three docs should appear
    await waitFor(() => {
      expect(screen.getByText("D001")).toBeInTheDocument();
      expect(screen.getByText("D002")).toBeInTheDocument();
      expect(screen.getByText("D003")).toBeInTheDocument();
    });

    // Type "REPORT" into the search box and click Search again
    const searchInput = screen.getByPlaceholderText(/doc number, type, branch/i);
    fireEvent.change(searchInput, { target: { value: "REPORT" } });
    fireEvent.click(searchBtn);

    // Only D002 (REPORT) should be visible; D001 and D003 should disappear
    await waitFor(() => {
      expect(screen.getByText("D002")).toBeInTheDocument();
      expect(screen.queryByText("D001")).not.toBeInTheDocument();
      expect(screen.queryByText("D003")).not.toBeInTheDocument();
    });
  });
});
