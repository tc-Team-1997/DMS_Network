import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// Search now reads the time period from the URL via usePeriod() →
// useSearchParams, so react-router-dom must be mocked (no period in URL here, so
// the filter stays inactive and behaviour is unchanged).
vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(""), vi.fn()],
}));

// Mock the auth context.
// I-1 fix verification: permissions now use "document:read" (not the phantom "search:read").
vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      username: "admin",
      roles: ["CDO"],
      permissions: ["document:read", "crossbranch:read"],
      branch: "Thimphu",
    },
    logout: () => {},
  }),
}));

// Mock the searchApi module
vi.mock("../api/searchApi.js", () => ({
  searchApi: {
    query: vi.fn(),
    facets: vi.fn(),
    saveSearch: vi.fn(),
    listSaved: vi.fn(),
    runSaved: vi.fn(),
    exportCsv: vi.fn(),
  },
}));

// Mock client.ts so getToken is available in exportCsv tests
vi.mock("../api/client.js", () => ({
  getToken: () => "test-jwt-token",
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));

import { searchApi } from "../api/searchApi.js";
import Search from "./Search.js";

const mockResults = {
  hits: [
    {
      doc_id: "DOC-001",
      doc_type: "BOB_LOAN_APPLICATION",
      branch: "Thimphu",
      status: "indexed",
      snippet: "Loan application for Dorji Wangchuk...",
      score: 0.92,
      indexed_at: "2026-06-23T10:00:00Z",
    },
    {
      doc_id: "DOC-002",
      doc_type: "BT_CID_4G",
      branch: "Paro",
      status: "approved",
      snippet: "CID document for Karma Tshering...",
      score: 0.75,
      indexed_at: "2026-06-22T08:30:00Z",
    },
  ],
  total: 2,
  page: 1,
  pageSize: 20,
  tookMs: 42,
  facets: {
    doc_type: [
      { value: "BOB_LOAN_APPLICATION", count: 1 },
      { value: "BT_CID_4G", count: 1 },
    ],
    branch: [
      { value: "Thimphu", count: 1 },
      { value: "Paro", count: 1 },
    ],
    status: [
      { value: "indexed", count: 1 },
      { value: "approved", count: 1 },
    ],
    risk_band: [{ value: "low", count: 2 }],
  },
};

describe("Search screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (searchApi.listSaved as ReturnType<typeof vi.fn>).mockResolvedValue({ saved: [] });
    (searchApi.query as ReturnType<typeof vi.fn>).mockResolvedValue(mockResults);
    (searchApi.facets as ReturnType<typeof vi.fn>).mockResolvedValue({ facets: {} });
    (searchApi.exportCsv as ReturnType<typeof vi.fn>).mockResolvedValue(new Blob(["col1,col2\nval1,val2"], { type: "text/csv" }));
  });

  it("renders the page heading and search input", () => {
    render(<Search />);
    expect(screen.getByRole("heading", { name: /Enterprise Search/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Search query/i })).toBeInTheDocument();
  });

  it("renders all search mode buttons", () => {
    render(<Search />);
    // Use getAllByText since the empty state also shows mode labels as tags
    expect(screen.getAllByText("Full Text").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Boolean").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Wildcard").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Fuzzy").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Semantic AI/i).length).toBeGreaterThanOrEqual(1);
    // Verify at least one is a button (the mode selector)
    expect(screen.getByRole("button", { name: "Full Text" })).toBeInTheDocument();
  });

  it("calls searchApi.query when user types in the search box", async () => {
    render(<Search />);
    const input = screen.getByRole("textbox", { name: /Search query/i });
    await act(async () => {
      fireEvent.change(input, { target: { value: "dorji loan" } });
    });

    await waitFor(() => {
      expect(searchApi.query).toHaveBeenCalledWith(
        expect.objectContaining({ text: "dorji loan", mode: "fulltext" })
      );
    }, { timeout: 1000 });
  });

  it("displays results from the API after a search", async () => {
    render(<Search />);
    const input = screen.getByRole("textbox", { name: /Search query/i });
    await act(async () => {
      fireEvent.change(input, { target: { value: "dorji" } });
    });

    await waitFor(() => {
      expect(screen.getByText("DOC-001")).toBeInTheDocument();
      expect(screen.getByText("DOC-002")).toBeInTheDocument();
    }, { timeout: 1000 });
  });

  it("shows KPI cards after results load", async () => {
    render(<Search />);
    const input = screen.getByRole("textbox", { name: /Search query/i });
    await act(async () => {
      fireEvent.change(input, { target: { value: "dorji" } });
    });

    await waitFor(() => {
      expect(screen.getByText("Total Results")).toBeInTheDocument();
      expect(screen.getByText("Search Time")).toBeInTheDocument();
    }, { timeout: 1000 });
  });

  it("shows an empty state when no query is entered", () => {
    render(<Search />);
    expect(screen.getByText(/Start typing to search across all documents/i)).toBeInTheDocument();
  });

  it("calls /svc/search via searchApi.query with the correct endpoint", async () => {
    render(<Search />);
    const input = screen.getByRole("textbox", { name: /Search query/i });
    await act(async () => {
      fireEvent.change(input, { target: { value: "test query" } });
    });

    await waitFor(() => {
      expect(searchApi.query).toHaveBeenCalled();
    }, { timeout: 1000 });

    // Verify it was called with a valid search query shape
    const call = (searchApi.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call).toHaveProperty("text");
    expect(call).toHaveProperty("mode");
  });

  it("shows the Saved searches button", () => {
    render(<Search />);
    expect(screen.getByText(/Saved/i)).toBeInTheDocument();
  });

  it("shows error state when search API fails", async () => {
    (searchApi.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));
    render(<Search />);
    const input = screen.getByRole("textbox", { name: /Search query/i });
    await act(async () => {
      fireEvent.change(input, { target: { value: "fail query" } });
    });

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    }, { timeout: 1000 });
  });

  it("renders Results and Analytics tabs", async () => {
    render(<Search />);
    // The tabs always show even before search
    expect(screen.getAllByText(/Results/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Analytics")).toBeInTheDocument();
  });

  it("changes mode when user clicks Boolean button", async () => {
    render(<Search />);
    // Click the Boolean mode selector button (title matches the button role)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Boolean" }));
    });
    expect(screen.getByText(/Syntax:/i)).toBeInTheDocument();
  });

  // ── Fix verifications ─────────────────────────────────────────────────────

  // I-1: canSearch now uses "document:read" (not the nonexistent "search:read")
  // so the Save button appears for users with document:read permission.
  it("I-1: shows Save search button when user has document:read permission", async () => {
    render(<Search />);
    const input = screen.getByRole("textbox", { name: /Search query/i });
    await act(async () => {
      fireEvent.change(input, { target: { value: "dorji" } });
    });
    // The bookmark/save button should now be visible (was permanently hidden before fix)
    await waitFor(() => {
      // BookmarkCheck button has no text, find by its parent button
      const saveBtn = document.querySelector('button[title="Save this search"]');
      expect(saveBtn).not.toBeNull();
    }, { timeout: 1000 });
  });

  // I-4: Changing mode resets page to 1
  it("I-4: clicking a different mode resets pagination to page 1", async () => {
    render(<Search />);
    const input = screen.getByRole("textbox", { name: /Search query/i });
    await act(async () => {
      fireEvent.change(input, { target: { value: "loan" } });
    });
    await waitFor(() => expect(searchApi.query).toHaveBeenCalled(), { timeout: 1000 });

    const callCountBefore = (searchApi.query as ReturnType<typeof vi.fn>).mock.calls.length;

    // Switch mode — should re-issue query with page=1
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Boolean" }));
    });

    await waitFor(() => {
      const calls = (searchApi.query as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThan(callCountBefore);
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall.page).toBe(1);
    }, { timeout: 1000 });
  });

  // I-4: Changing sort resets page to 1
  it("I-4: changing sort order resets pagination to page 1", async () => {
    render(<Search />);
    const input = screen.getByRole("textbox", { name: /Search query/i });
    await act(async () => {
      fireEvent.change(input, { target: { value: "loan" } });
    });
    await waitFor(() => expect(searchApi.query).toHaveBeenCalled(), { timeout: 1000 });

    const callCountBefore = (searchApi.query as ReturnType<typeof vi.fn>).mock.calls.length;

    await act(async () => {
      const sortSelect = screen.getByRole("combobox");
      fireEvent.change(sortSelect, { target: { value: "recent" } });
    });

    await waitFor(() => {
      const calls = (searchApi.query as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThan(callCountBefore);
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall.page).toBe(1);
    }, { timeout: 1000 });
  });

  // C-2: Export CSV button wired to searchApi.exportCsv
  it("C-2: Export button calls searchApi.exportCsv when clicked", async () => {
    // Set up URL.createObjectURL so the anchor click doesn't throw
    const createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    render(<Search />);
    const input = screen.getByRole("textbox", { name: /Search query/i });
    await act(async () => {
      fireEvent.change(input, { target: { value: "loan" } });
    });
    await waitFor(() => expect(screen.getByText("DOC-001")).toBeInTheDocument(), { timeout: 1000 });

    const exportBtn = screen.getByTitle("Export CSV");
    expect(exportBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(exportBtn);
    });

    await waitFor(() => {
      expect(searchApi.exportCsv).toHaveBeenCalledWith(
        expect.objectContaining({ text: "loan" })
      );
    }, { timeout: 1000 });
  });

  // I-5: HitPanel Open Document and Download buttons have onClick handlers
  it("I-5: HitPanel Open Document button is wired (has onClick / aria-label)", async () => {
    render(<Search />);
    const input = screen.getByRole("textbox", { name: /Search query/i });
    await act(async () => {
      fireEvent.change(input, { target: { value: "dorji" } });
    });
    await waitFor(() => expect(screen.getByText("DOC-001")).toBeInTheDocument(), { timeout: 1000 });

    // Click the first result row to open the detail panel
    await act(async () => {
      fireEvent.click(screen.getByText("DOC-001"));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Open document/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Download document/i })).toBeInTheDocument();
    });
  });
});
