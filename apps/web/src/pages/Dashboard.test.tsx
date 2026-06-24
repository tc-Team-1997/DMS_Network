import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Dashboard from "./Dashboard.js";

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
      username: "admin",
      roles: ["CDO"],
      permissions: ["dashboard:read", "document:read", "document:capture"],
      branch: "Thimphu",
    },
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("Dashboard screen", () => {
  beforeEach(() => {
    // Mock fetch for the two API calls: dashboardSummary + listDocuments
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/dashboard/summary")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            totalDocuments: 12847,
            pendingReview: 18,
            indexedToday: 342,
            byCategory: {
              "KYC / Identity": 8200,
              "Loan & Credit": 3100,
              Compliance: 1000,
              Records: 547,
            },
          }),
        } as unknown as Response;
      }
      if (typeof url === "string" && url.includes("/documents")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            documents: [
              { id: 1, title: "Sonam Dorji — Passport", branch: "Thimphu", catalog_category: "KYC / Identity", status: "Active", doc_type: "BT_PASSPORT", review_flag: false },
              { id: 2, title: "Loan Application #L-001", branch: "Phuentsholing", catalog_category: "Loan & Credit", status: "Active", doc_type: "BOB_LOAN_APPLICATION", review_flag: false },
              { id: 3, title: "CID Card — Pema Wangdi", branch: "Thimphu", catalog_category: "KYC / Identity", status: "Active", doc_type: "BT_CID_4G", review_flag: true },
            ],
          }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    });
  });

  it("renders the Executive Dashboard page header", () => {
    renderWithRouter(<Dashboard />);
    expect(screen.getByText("Executive Dashboard")).toBeInTheDocument();
  });

  it("calls the dashboard summary API at /svc/core/dashboard/summary", async () => {
    renderWithRouter(<Dashboard />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/dashboard/summary"),
      expect.anything(),
    ));
  });

  it("displays total documents KPI card after API resolves", async () => {
    renderWithRouter(<Dashboard />);
    await waitFor(() => expect(screen.getByText("12,847")).toBeInTheDocument());
  });

  it("displays pending review KPI card value", async () => {
    renderWithRouter(<Dashboard />);
    await waitFor(() => expect(screen.getByText("18")).toBeInTheDocument());
  });

  it("renders the KPI label for Total Documents", async () => {
    renderWithRouter(<Dashboard />);
    await waitFor(() => expect(screen.getByText(/Total Documents/i)).toBeInTheDocument());
  });

  it("renders Pending Review KPI label", async () => {
    renderWithRouter(<Dashboard />);
    await waitFor(() => expect(screen.getByText(/Pending Review/i)).toBeInTheDocument());
  });

  it("shows AI Active tag in the header", async () => {
    renderWithRouter(<Dashboard />);
    await waitFor(() => expect(screen.getByText(/AI Active/i)).toBeInTheDocument());
  });

  it("renders recent document activity rows after documents load", async () => {
    renderWithRouter(<Dashboard />);
    await waitFor(() => expect(screen.getByText("Sonam Dorji — Passport")).toBeInTheDocument());
  });

  it("shows KYC / Identity in activity table", async () => {
    renderWithRouter(<Dashboard />);
    await waitFor(() => expect(screen.getAllByText(/KYC \/ Identity/i).length).toBeGreaterThan(0));
  });

  it("shows Quick Actions section", async () => {
    renderWithRouter(<Dashboard />);
    await waitFor(() => expect(screen.getByText(/Quick Actions/i)).toBeInTheDocument());
  });

  it("renders AI Insight Engine panel", async () => {
    renderWithRouter(<Dashboard />);
    await waitFor(() => expect(screen.getByText(/AI Insight Engine/i)).toBeInTheDocument());
  });

  it("renders Branch Activity Heatmap", async () => {
    renderWithRouter(<Dashboard />);
    await waitFor(() => expect(screen.getByText(/Branch Activity Heatmap/i)).toBeInTheDocument());
  });

  it("shows an error banner when API fails", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network Error"));
    renderWithRouter(<Dashboard />);
    await waitFor(() => expect(screen.getByText(/Network Error/i)).toBeInTheDocument());
  });
});
