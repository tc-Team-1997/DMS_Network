import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import Security from "./Security.js";

/* ─── ResizeObserver polyfill (recharts needs it in jsdom) ─── */
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe()   { /* noop */ }
      unobserve() { /* noop */ }
      disconnect(){ /* noop */ }
    } as unknown as typeof ResizeObserver;
  }
});

/* ─── Mock auth context ─── */
vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      username: "admin",
      roles: ["CDO"],
      permissions: ["user:read", "user:create", "user:update", "role:assign", "security:read"],
    },
    logout: () => {},
  }),
}));

/* ─── Mock the security API module ─── */
vi.mock("../api/securityScreen.js", () => ({
  securityApi: {
    getUsers: vi.fn().mockResolvedValue({
      users: [
        { id: 1, username: "admin",    full_name: "System Administrator", branch: "Thimphu HQ", mfa_enabled: true,  status: "Active", email: "admin@bank.bt",     roles: ["CDO"] },
        { id: 2, username: "maker_01", full_name: "Dorji Wangchuk",       branch: "Paro",       mfa_enabled: true,  status: "Active", email: "dorji@bank.bt",     roles: ["Maker"] },
        { id: 3, username: "checker_01", full_name: "Tshering Pem",       branch: "Thimphu HQ", mfa_enabled: false, status: "Active", email: "tshering@bank.bt",  roles: ["Checker"] },
        { id: 4, username: "viewer_01", full_name: "Namgay Dorji",        branch: "Bumthang",   mfa_enabled: true,  status: "Locked", email: "namgay@bank.bt",    roles: ["Viewer"] },
      ],
    }),
    createUser: vi.fn(),
    assignRoles: vi.fn(),
    toggleLock: vi.fn(),
    getAuditLog: vi.fn().mockResolvedValue({ logs: [] }),
  },
}));

describe("Security screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the page heading", async () => {
    render(<Security />);
    expect(screen.getByText("Security & Access Control")).toBeInTheDocument();
  });

  it("renders the security sub-heading", () => {
    render(<Security />);
    expect(screen.getByText(/RBAC/)).toBeInTheDocument();
  });

  it("renders all four KPI cards", () => {
    render(<Security />);
    expect(screen.getByText("Active Users")).toBeInTheDocument();
    expect(screen.getByText("MFA Enrolled")).toBeInTheDocument();
    expect(screen.getByText("Failed Logins (24h)")).toBeInTheDocument();
    expect(screen.getByText("Locked Accounts")).toBeInTheDocument();
  });

  it("renders all tab labels", () => {
    render(<Security />);
    // "User Management" appears in both tab and card header — use getAllByText
    const umItems = screen.getAllByText("User Management");
    expect(umItems.length).toBeGreaterThan(0);
    expect(screen.getByText("Permission Matrix")).toBeInTheDocument();
    expect(screen.getByText("Security Policies")).toBeInTheDocument();
    expect(screen.getByText("Access Analytics")).toBeInTheDocument();
  });

  it("calls getUsers on mount", async () => {
    const { securityApi } = await import("../api/securityScreen.js");
    render(<Security />);
    await waitFor(() => expect(securityApi.getUsers).toHaveBeenCalledTimes(1));
  });

  it("calls /svc/gateway/users endpoint (via getUsers)", async () => {
    const { securityApi } = await import("../api/securityScreen.js");
    render(<Security />);
    await waitFor(() => expect(securityApi.getUsers).toHaveBeenCalled());
  });

  it("renders users from the API in the table", async () => {
    render(<Security />);
    await waitFor(() => expect(screen.getByText("Dorji Wangchuk")).toBeInTheDocument());
  });

  it("renders a locked user status badge", async () => {
    render(<Security />);
    await waitFor(() => {
      const lockedBadges = screen.getAllByText("Locked");
      expect(lockedBadges.length).toBeGreaterThan(0);
    });
  });

  it("shows the Add User button for users with user:create permission", () => {
    render(<Security />);
    const addButtons = screen.getAllByText("+ Add User");
    expect(addButtons.length).toBeGreaterThan(0);
  });

  it("shows Lock/Unlock action buttons for users with user:update permission", async () => {
    render(<Security />);
    await waitFor(() => {
      const lockButtons = screen.getAllByText(/Lock|Unlock/);
      expect(lockButtons.length).toBeGreaterThan(0);
    });
  });

  it("shows MFA status for users", async () => {
    render(<Security />);
    await waitFor(() => {
      const mfaIndicators = screen.getAllByText(/TOTP|Pending/);
      expect(mfaIndicators.length).toBeGreaterThan(0);
    });
  });

  it("renders the Role Distribution card", async () => {
    render(<Security />);
    await waitFor(() => expect(screen.getByText("Role Distribution")).toBeInTheDocument());
  });

  it("renders the Active Sessions card", async () => {
    render(<Security />);
    await waitFor(() => expect(screen.getByText("Active Sessions")).toBeInTheDocument());
  });
});
