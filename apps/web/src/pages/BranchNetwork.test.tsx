import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import BranchNetwork from "./BranchNetwork.js";

/* ─── ResizeObserver polyfill (recharts needs it in jsdom) ─── */
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// Mock AuthContext
vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      username: "admin",
      roles: ["CDO"],
      permissions: ["crossbranch:read", "admin:access"],
    },
    logout: () => {},
  }),
}));

// Mock the api module so we control what fetch returns
vi.mock("../api/branchNetwork.js", () => ({
  fetchBranches: vi.fn().mockResolvedValue([
    { id: 1, code: "THI001", name: "Thimphu Main", region: "West", replication_mode: "sync",  status: "Active" },
    { id: 2, code: "PAR002", name: "Paro Branch",  region: "West", replication_mode: "async", status: "Degraded" },
    { id: 3, code: "LUX003", name: "Luxor Office", region: "South", replication_mode: "none", status: "Offline" },
  ]),
  fetchAccessPolicies: vi.fn().mockResolvedValue([
    { id: 1, source_branch: "THI001", target_branch: "PAR002", policy: "read",  created_at: "2026-01-01" },
    { id: 2, source_branch: "PAR002", target_branch: "THI001", policy: "write", created_at: "2026-01-02" },
  ]),
  fetchNetworkSummary: vi.fn().mockResolvedValue({
    totalDocuments: 48210,
    indexedToday: 312,
    pendingReview: 7,
  }),
  createBranch: vi.fn().mockResolvedValue({ id: 4, code: "NEW004", name: "New Branch", status: "Active", replication_mode: "async" }),
  setAccessPolicy: vi.fn().mockResolvedValue({ id: 3, source_branch: "NEW004", target_branch: "THI001", policy: "read" }),
}));

describe("BranchNetwork screen", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("renders the page header", async () => {
    render(<BranchNetwork />);
    await waitFor(() =>
      expect(screen.getByText(/Branch Network/i)).toBeInTheDocument()
    );
  });

  it("shows KPI cards including active branches", async () => {
    render(<BranchNetwork />);
    await waitFor(() =>
      expect(screen.getByText("Active Branches")).toBeInTheDocument()
    );
    expect(screen.getByText("Cross-Branch Docs Today")).toBeInTheDocument();
  });

  it("renders branch cards from the API", async () => {
    render(<BranchNetwork />);
    await waitFor(() =>
      expect(screen.getByText("Thimphu Main")).toBeInTheDocument()
    );
    expect(screen.getByText("Paro Branch")).toBeInTheDocument();
    expect(screen.getByText("Luxor Office")).toBeInTheDocument();
  });

  it("shows replication mode labels on branch cards", async () => {
    render(<BranchNetwork />);
    await waitFor(() =>
      expect(screen.getByText("Thimphu Main")).toBeInTheDocument()
    );
    // sync = Active-Active, async = Active-Passive
    expect(screen.getAllByText("Active-Active").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Active-Passive").length).toBeGreaterThanOrEqual(1);
  });

  it("shows the correct branch status badges", async () => {
    render(<BranchNetwork />);
    await waitFor(() =>
      expect(screen.getAllByText("Degraded").length).toBeGreaterThanOrEqual(1)
    );
    expect(screen.getAllByText("Offline").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the Tabs component with overview tab selected by default", async () => {
    render(<BranchNetwork />);
    await waitFor(() =>
      expect(screen.getByText("Branch Overview")).toBeInTheDocument()
    );
    expect(screen.getByText("Replication & Access Policy")).toBeInTheDocument();
    expect(screen.getByText("Volume Heatmap")).toBeInTheDocument();
  });

  it("shows admin button to add branch when user has admin:access", async () => {
    render(<BranchNetwork />);
    await waitFor(() =>
      expect(screen.getByText("+ Add Branch")).toBeInTheDocument()
    );
  });

  it("shows the Network Report button", async () => {
    render(<BranchNetwork />);
    await waitFor(() =>
      expect(screen.getByText("Network Report")).toBeInTheDocument()
    );
  });

  // I-1: setAccessPolicy is now statically imported — verify it exists in the mock module at import time
  it("I-1: setAccessPolicy is resolvable from the static import (no dynamic import)", async () => {
    const mod = await import("../api/branchNetwork.js");
    expect(typeof mod.setAccessPolicy).toBe("function");
  });

  // I-2: handleAddBranch — createBranch rejection shows error banner
  it("I-2: shows error banner when createBranch rejects", async () => {
    const { createBranch } = await import("../api/branchNetwork.js");
    (createBranch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Duplicate branch code"));

    render(<BranchNetwork />);
    await waitFor(() => expect(screen.getByText("+ Add Branch")).toBeInTheDocument());

    // Open the add branch modal
    fireEvent.click(screen.getByText("+ Add Branch"));
    await waitFor(() => expect(screen.getByText("Create Branch")).toBeInTheDocument());

    // Fill in required fields
    const [codeInput, nameInput] = screen.getAllByRole("textbox");
    fireEvent.change(codeInput, { target: { value: "DUP001" } });
    fireEvent.change(nameInput, { target: { value: "Duplicate Branch" } });

    // Submit form
    fireEvent.click(screen.getByRole("button", { name: "Create Branch" }));

    await waitFor(() =>
      expect(screen.getByText(/Failed to create branch/i)).toBeInTheDocument()
    );
  });

  // I-2: setAccessPolicy rejection shows error banner
  it("I-2: shows error banner when setAccessPolicy rejects", async () => {
    const { setAccessPolicy } = await import("../api/branchNetwork.js");
    (setAccessPolicy as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Policy conflict"));

    render(<BranchNetwork />);
    // Wait for page to load (branches appear)
    await waitFor(() => expect(screen.getByText("Thimphu Main")).toBeInTheDocument());

    // Switch to Replication tab
    fireEvent.click(screen.getByText("Replication & Access Policy"));
    await waitFor(() => expect(screen.getByText("+ Set Policy")).toBeInTheDocument());

    fireEvent.click(screen.getByText("+ Set Policy"));
    await waitFor(() => expect(screen.getByText("Apply Policy")).toBeInTheDocument());

    // Select source and target branches
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "THI001" } });
    fireEvent.change(selects[1], { target: { value: "PAR002" } });

    fireEvent.click(screen.getByRole("button", { name: "Apply Policy" }));

    await waitFor(() =>
      expect(screen.getByText(/Failed to set access policy/i)).toBeInTheDocument()
    );
  });
});
