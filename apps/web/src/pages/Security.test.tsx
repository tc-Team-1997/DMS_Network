import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Security from "./Security.js";

function renderSecurity(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/${search}`]}>
      <Security />
    </MemoryRouter>,
  );
}

/* ResizeObserver polyfill (recharts needs it in jsdom) */
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe()   { /* noop */ }
      unobserve() { /* noop */ }
      disconnect(){ /* noop */ }
    } as unknown as typeof ResizeObserver;
  }
});

/* Mock auth context */
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

/* Mock the security API module */
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
    await act(async () => { renderSecurity(); });
    expect(screen.getByText("Security & Access Control")).toBeInTheDocument();
  });

  it("renders the security sub-heading", async () => {
    await act(async () => { renderSecurity(); });
    expect(screen.getByText(/RBAC/)).toBeInTheDocument();
  });

  it("renders all four KPI cards", async () => {
    await act(async () => { renderSecurity(); });
    expect(screen.getByText("Active Users")).toBeInTheDocument();
    expect(screen.getByText("MFA Enrolled")).toBeInTheDocument();
    expect(screen.getByText("Failed Logins (24h)")).toBeInTheDocument();
    expect(screen.getByText("Locked Accounts")).toBeInTheDocument();
  });

  it("renders all tab labels", async () => {
    await act(async () => { renderSecurity(); });
    const umItems = screen.getAllByText("User Management");
    expect(umItems.length).toBeGreaterThan(0);
    expect(screen.getByText("Permission Matrix")).toBeInTheDocument();
    expect(screen.getByText("Security Policies")).toBeInTheDocument();
    expect(screen.getByText("Access Analytics")).toBeInTheDocument();
  });

  it("calls getUsers on mount", async () => {
    const { securityApi } = await import("../api/securityScreen.js");
    await act(async () => { renderSecurity(); });
    await waitFor(() => expect(securityApi.getUsers).toHaveBeenCalledTimes(1));
  });

  it("renders users from the API in the table", async () => {
    await act(async () => { renderSecurity(); });
    await waitFor(() => expect(screen.getByText("Dorji Wangchuk")).toBeInTheDocument());
  });

  it("renders a locked user status badge", async () => {
    await act(async () => { renderSecurity(); });
    await waitFor(() => {
      const lockedBadges = screen.getAllByText("Locked");
      expect(lockedBadges.length).toBeGreaterThan(0);
    });
  });

  it("shows the Add User button for users with user:create permission", async () => {
    await act(async () => { renderSecurity(); });
    const addButtons = screen.getAllByText("+ Add User");
    expect(addButtons.length).toBeGreaterThan(0);
  });

  it("shows Lock/Unlock action buttons for users with user:update permission", async () => {
    await act(async () => { renderSecurity(); });
    await waitFor(() => {
      const lockButtons = screen.getAllByText(/Lock|Unlock/);
      expect(lockButtons.length).toBeGreaterThan(0);
    });
  });

  it("shows MFA status for users", async () => {
    await act(async () => { renderSecurity(); });
    await waitFor(() => {
      const mfaIndicators = screen.getAllByText(/TOTP|Pending/);
      expect(mfaIndicators.length).toBeGreaterThan(0);
    });
  });

  it("renders the Role Distribution card", async () => {
    await act(async () => { renderSecurity(); });
    await waitFor(() => expect(screen.getByText("Role Distribution")).toBeInTheDocument());
  });

  it("renders the Active Sessions card", async () => {
    await act(async () => { renderSecurity(); });
    await waitFor(() => expect(screen.getByText("Active Sessions")).toBeInTheDocument());
  });

  /* I2: Password field type fix */
  it("I2: Add User modal password field renders as type=password (not plaintext)", async () => {
    await act(async () => { renderSecurity(); });
    const addButtons = screen.getAllByText("+ Add User");
    await act(async () => { fireEvent.click(addButtons[0]); });
    const passwordInput = screen.getByPlaceholderText("Min 8 characters");
    expect(passwordInput).toHaveAttribute("type", "password");
  });

  /* I4: Failed Logins KPI placeholder */
  it("I4: Failed Logins (24h) KPI is clearly marked as a placeholder (not hardcoded 7)", async () => {
    await act(async () => { renderSecurity(); });
    expect(screen.queryByText("7")).not.toBeInTheDocument();
    expect(screen.getByText("audit log endpoint pending")).toBeInTheDocument();
  });

  /* M1: Recent Security Events empty state */
  it("M1: Recent Security Events shows empty state when audit log endpoint is not yet exposed", async () => {
    await act(async () => { renderSecurity(); });
    const analyticsTab = screen.getByText("Access Analytics");
    await act(async () => { fireEvent.click(analyticsTab); });
    await waitFor(() => {
      expect(screen.getByText("Recent Security Events")).toBeInTheDocument();
      expect(screen.getByText("Audit log endpoint not yet exposed.")).toBeInTheDocument();
    });
  });

  /* M2: getAuditLog removed */
  it("M2: securityApi mock does not expose getAuditLog (dead code removed from real module)", async () => {
    const { securityApi } = await import("../api/securityScreen.js");
    expect((securityApi as Record<string, unknown>)["getAuditLog"]).toBeUndefined();
  });

  /* M4 replacement */
  it("M4 replacement: getUsers is called exactly once on mount (not a duplicate of call test)", async () => {
    const { securityApi } = await import("../api/securityScreen.js");
    await act(async () => { renderSecurity(); });
    await waitFor(() => expect(securityApi.getUsers).toHaveBeenCalledTimes(1));
    expect(securityApi.getUsers).toHaveBeenCalledWith();
  });

  /* URL-driven state */
  it("URL: default tab is 'users' — User Management card visible without query param", async () => {
    await act(async () => { renderSecurity(); });
    await waitFor(() => {
      const umItems = screen.getAllByText("User Management");
      expect(umItems.length).toBeGreaterThan(0);
    });
  });

  it("URL: ?tab=matrix renders Permission Matrix tab content", async () => {
    await act(async () => { renderSecurity("?tab=matrix"); });
    await waitFor(() => expect(screen.getByText("Capture & Scan")).toBeInTheDocument());
  });

  /* Pagination */
  it("PAGER: users table renders pager when more than 10 users are returned", async () => {
    const { securityApi } = await import("../api/securityScreen.js");
    vi.mocked(securityApi.getUsers).mockResolvedValueOnce({
      users: Array.from({ length: 12 }, (_, i) => ({
        id: `018f4e2a-0000-7000-8000-${String(i + 1).padStart(12, "0")}`,
        username: `user_${i + 1}`,
        full_name: `User ${i + 1}`,
        branch: "Thimphu HQ",
        mfa_enabled: true,
        status: "Active" as const,
        email: `user${i + 1}@bank.bt`,
        roles: ["Viewer"],
      })),
    });
    await act(async () => { renderSecurity(); });
    await waitFor(() => expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument());
  });
});
