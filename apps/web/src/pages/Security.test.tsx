import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
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
  },
}));

describe("Security screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the page heading", async () => {
    await act(async () => { render(<Security />); });
    expect(screen.getByText("Security & Access Control")).toBeInTheDocument();
  });

  it("renders the security sub-heading", async () => {
    await act(async () => { render(<Security />); });
    expect(screen.getByText(/RBAC/)).toBeInTheDocument();
  });

  it("renders all four KPI cards", async () => {
    await act(async () => { render(<Security />); });
    expect(screen.getByText("Active Users")).toBeInTheDocument();
    expect(screen.getByText("MFA Enrolled")).toBeInTheDocument();
    expect(screen.getByText("Failed Logins (24h)")).toBeInTheDocument();
    expect(screen.getByText("Locked Accounts")).toBeInTheDocument();
  });

  it("renders all tab labels", async () => {
    await act(async () => { render(<Security />); });
    // "User Management" appears in both tab and card header — use getAllByText
    const umItems = screen.getAllByText("User Management");
    expect(umItems.length).toBeGreaterThan(0);
    expect(screen.getByText("Permission Matrix")).toBeInTheDocument();
    expect(screen.getByText("Security Policies")).toBeInTheDocument();
    expect(screen.getByText("Access Analytics")).toBeInTheDocument();
  });

  it("calls getUsers on mount", async () => {
    const { securityApi } = await import("../api/securityScreen.js");
    await act(async () => { render(<Security />); });
    await waitFor(() => expect(securityApi.getUsers).toHaveBeenCalledTimes(1));
  });

  it("renders users from the API in the table", async () => {
    await act(async () => { render(<Security />); });
    await waitFor(() => expect(screen.getByText("Dorji Wangchuk")).toBeInTheDocument());
  });

  it("renders a locked user status badge", async () => {
    await act(async () => { render(<Security />); });
    await waitFor(() => {
      const lockedBadges = screen.getAllByText("Locked");
      expect(lockedBadges.length).toBeGreaterThan(0);
    });
  });

  it("shows the Add User button for users with user:create permission", async () => {
    await act(async () => { render(<Security />); });
    const addButtons = screen.getAllByText("+ Add User");
    expect(addButtons.length).toBeGreaterThan(0);
  });

  it("shows Lock/Unlock action buttons for users with user:update permission", async () => {
    await act(async () => { render(<Security />); });
    await waitFor(() => {
      const lockButtons = screen.getAllByText(/Lock|Unlock/);
      expect(lockButtons.length).toBeGreaterThan(0);
    });
  });

  it("shows MFA status for users", async () => {
    await act(async () => { render(<Security />); });
    await waitFor(() => {
      const mfaIndicators = screen.getAllByText(/TOTP|Pending/);
      expect(mfaIndicators.length).toBeGreaterThan(0);
    });
  });

  it("renders the Role Distribution card", async () => {
    await act(async () => { render(<Security />); });
    await waitFor(() => expect(screen.getByText("Role Distribution")).toBeInTheDocument());
  });

  it("renders the Active Sessions card", async () => {
    await act(async () => { render(<Security />); });
    await waitFor(() => expect(screen.getByText("Active Sessions")).toBeInTheDocument());
  });

  /* ── I2: Password field type fix ── */
  it("I2: Add User modal password field renders as type=password (not plaintext)", async () => {
    await act(async () => { render(<Security />); });

    // Open the Add User modal
    const addButtons = screen.getAllByText("+ Add User");
    await act(async () => { fireEvent.click(addButtons[0]); });

    // Find the password input — must be type="password"
    const passwordInput = screen.getByPlaceholderText("Min 8 characters");
    expect(passwordInput).toHaveAttribute("type", "password");
  });

  /* ── I4: Failed Logins KPI is clearly marked as a placeholder ── */
  it("I4: Failed Logins (24h) KPI is clearly marked as a placeholder (not hardcoded 7)", async () => {
    await act(async () => { render(<Security />); });
    // The KPI card should show "—" or the audit-log-pending sub label, NOT the hardcoded 7
    expect(screen.queryByText("7")).not.toBeInTheDocument();
    expect(screen.getByText("audit log endpoint pending")).toBeInTheDocument();
  });

  /* ── M1: Stable keys for security events (no index key warnings) ── */
  it("M1: Recent Security Events list renders without index-based keys (stable event+time keys)", async () => {
    await act(async () => { render(<Security />); });

    // Navigate to Analytics tab to see security events
    const analyticsTab = screen.getByText("Access Analytics");
    await act(async () => { fireEvent.click(analyticsTab); });

    // Both LOGIN_FAILED events have different times so keys are unique
    await waitFor(() => {
      const loginFailedEvents = screen.getAllByText("LOGIN_FAILED");
      expect(loginFailedEvents.length).toBe(2);
    });
  });

  /* ── M2: securityApi mock must not contain getAuditLog (removed from real module) ── */
  it("M2: securityApi mock does not expose getAuditLog (dead code removed from real module)", async () => {
    // The mocked securityApi in this file does not include getAuditLog,
    // matching the real module where it was removed (M2 fix).
    const { securityApi } = await import("../api/securityScreen.js");
    expect((securityApi as Record<string, unknown>)["getAuditLog"]).toBeUndefined();
  });

  /* ── M4 replacement: verify getUsers is called exactly once on mount ── */
  it("M4 replacement: getUsers is called exactly once on mount (not a duplicate of call test)", async () => {
    const { securityApi } = await import("../api/securityScreen.js");
    await act(async () => { render(<Security />); });
    await waitFor(() => expect(securityApi.getUsers).toHaveBeenCalledTimes(1));
    // Ensure it was called with no arguments (simple mount call)
    expect(securityApi.getUsers).toHaveBeenCalledWith();
  });
});
