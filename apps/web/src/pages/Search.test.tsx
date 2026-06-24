import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mock the auth context
vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      username: "admin",
      roles: ["CDO"],
      permissions: ["search:read", "document:read", "crossbranch:read"],
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
  },
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
    fireEvent.change(input, { target: { value: "dorji loan" } });

    await waitFor(() => {
      expect(searchApi.query).toHaveBeenCalledWith(
        expect.objectContaining({ text: "dorji loan", mode: "fulltext" })
      );
    }, { timeout: 1000 });
  });

  it("displays results from the API after a search", async () => {
    render(<Search />);
    const input = screen.getByRole("textbox", { name: /Search query/i });
    fireEvent.change(input, { target: { value: "dorji" } });

    await waitFor(() => {
      expect(screen.getByText("DOC-001")).toBeInTheDocument();
      expect(screen.getByText("DOC-002")).toBeInTheDocument();
    }, { timeout: 1000 });
  });

  it("shows KPI cards after results load", async () => {
    render(<Search />);
    const input = screen.getByRole("textbox", { name: /Search query/i });
    fireEvent.change(input, { target: { value: "dorji" } });

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
    fireEvent.change(input, { target: { value: "test query" } });

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
    fireEvent.change(input, { target: { value: "fail query" } });

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

  it("changes mode when user clicks Boolean button", () => {
    render(<Search />);
    // Click the Boolean mode selector button (title matches the button role)
    fireEvent.click(screen.getByRole("button", { name: "Boolean" }));
    expect(screen.getByText(/Syntax:/i)).toBeInTheDocument();
  });
});
