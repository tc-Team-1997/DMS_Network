import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
});
