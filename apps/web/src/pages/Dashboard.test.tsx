import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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

const MOCK_SUMMARY = {
  totalDocuments: 12847,
  pendingReview: 18,
  indexedToday: 342,
  byCategory: {
    "KYC / Identity": 8200,
    "Loan & Credit": 3100,
    Compliance: 1000,
    Records: 547,
  },
};

const MOCK_DOCUMENTS = [
  {
    id: 1,
    title: "Sonam Dorji — Passport",
    branch: "Thimphu",
    catalog_category: "KYC / Identity",
    status: "Active",
    doc_type: "BT_PASSPORT",
    review_flag: false,
  },
  {
    id: 2,
    title: "Loan Application #L-001",
    branch: "Phuentsholing",
    catalog_category: "Loan & Credit",
    status: "Active",
    doc_type: "BOB_LOAN_APPLICATION",
    review_flag: false,
  },
  {
    id: 3,
    title: "CID Card — Pema Wangdi",
    branch: "Thimphu",
    catalog_category: "KYC / Identity",
    status: "Active",
    doc_type: "BT_CID_4G",
    review_flag: true,
  },
];

describe("Dashboard screen", () => {
  beforeEach(() => {
    // Mock fetch for the two API calls: dashboardSummary (with or without params) + listDocuments
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/dashboard/summary")) {
        return {
          ok: true,
          status: 200,
          json: async () => MOCK_SUMMARY,
        } as unknown as Response;
      }
      if (typeof url === "string" && url.includes("/documents")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ documents: MOCK_DOCUMENTS }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    });
  });

  it("calls the dashboard summary API at /svc/core/dashboard/summary", async () => {
    renderWithRouter(<Dashboard />);
    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/dashboard/summary"),
        expect.anything(),
      ),
    );
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

  it("does NOT show AI Active tag in the header area", async () => {
    renderWithRouter(<Dashboard />);
    // Wait for load to complete before asserting absence
    await waitFor(() => expect(screen.getByText("12,847")).toBeInTheDocument());
    expect(screen.queryByText(/AI Active/i)).not.toBeInTheDocument();
  });

  it("renders recent document activity rows after documents load", async () => {
    renderWithRouter(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByText("Sonam Dorji — Passport")).toBeInTheDocument(),
    );
  });

  it("shows KYC / Identity in activity table", async () => {
    renderWithRouter(<Dashboard />);
    await waitFor(() =>
      expect(screen.getAllByText(/KYC \/ Identity/i).length).toBeGreaterThan(0),
    );
  });

  it("does NOT render AI Insight Engine panel", async () => {
    renderWithRouter(<Dashboard />);
    // Wait for load to complete
    await waitFor(() => expect(screen.getByText("12,847")).toBeInTheDocument());
    expect(screen.queryByText(/AI Insight Engine/i)).not.toBeInTheDocument();
  });

  it("renders Branch Activity Heatmap", async () => {
    renderWithRouter(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByText(/Branch Activity Heatmap/i)).toBeInTheDocument(),
    );
  });

  it("shows an error banner when API fails", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network Error"));
    renderWithRouter(<Dashboard />);
    await waitFor(() => expect(screen.getByText(/Network Error/i)).toBeInTheDocument());
  });

  it("calls dashboard summary API with Content-Type header", async () => {
    renderWithRouter(<Dashboard />);
    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/dashboard/summary"),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        }),
      ),
    );
  });

  // ── New tests for time-period control ──

  it("renders the time period segmented buttons (Day, Month, Quarter, Year)", () => {
    renderWithRouter(<Dashboard />);
    expect(screen.getByText("Day")).toBeInTheDocument();
    expect(screen.getByText("Month")).toBeInTheDocument();
    expect(screen.getByText("Quarter")).toBeInTheDocument();
    expect(screen.getByText("Year")).toBeInTheDocument();
  });

  it("renders From and To date inputs", () => {
    renderWithRouter(<Dashboard />);
    expect(screen.getByLabelText(/From date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/To date/i)).toBeInTheDocument();
  });

  it("period selector has correct aria role and label", () => {
    renderWithRouter(<Dashboard />);
    expect(
      screen.getByRole("group", { name: /Select time period/i }),
    ).toBeInTheDocument();
  });

  it("clicking 'Day' period button triggers a re-fetch with period=day in URL", async () => {
    renderWithRouter(<Dashboard />);
    // Wait for initial load
    await waitFor(() => expect(screen.getByText("12,847")).toBeInTheDocument());

    const dayBtn = screen.getByText("Day");
    fireEvent.click(dayBtn);

    // After clicking, the load should be triggered again with period=day
    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("period=day"),
        expect.anything(),
      ),
    );
  });

  it("clicking 'Quarter' period button triggers a re-fetch with period=quarter in URL", async () => {
    renderWithRouter(<Dashboard />);
    await waitFor(() => expect(screen.getByText("12,847")).toBeInTheDocument());

    const quarterBtn = screen.getByText("Quarter");
    fireEvent.click(quarterBtn);

    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("period=quarter"),
        expect.anything(),
      ),
    );
  });

  it("renders the Expiring Soon section", async () => {
    renderWithRouter(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByText(/Expiring Soon/i)).toBeInTheDocument(),
    );
  });

  it("renders the Category Breakdown card", async () => {
    renderWithRouter(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByText(/Category Breakdown/i)).toBeInTheDocument(),
    );
  });

  it("renders the Recent Documents table", async () => {
    renderWithRouter(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByText(/Recent Documents/i)).toBeInTheDocument(),
    );
  });

  it("renders KPI label for Expiring documents within 90 days", async () => {
    renderWithRouter(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByText(/Expiring ≤90d/i)).toBeInTheDocument(),
    );
  });
});
