import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ComplianceAudit } from "./ComplianceAudit.js";

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

const mockUseAuth = vi.fn(() => ({
  user: {
    id: 1,
    username: "aud",
    roles: ["Auditor"],
    permissions: ["compliance:read"],
  } as any,
  login: async () => {},
  logout: () => {},
}));

vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => mockUseAuth(),
}));

const MOCK_SCORECARD = {
  score: 78,
  frameworks: [
    { framework: "RMA Prudential", met: 2, total: 2 },
    { framework: "RAA Audit", met: 2, total: 2 },
    { framework: "FATF / AML", met: 1, total: 2 },
    { framework: "ISO 27001", met: 2, total: 3 },
  ],
};

const MOCK_MATRIX = [
  { framework: "RMA Prudential", control: "Record retention schedule enforced", status: "Met", evidence: "retention_policies" },
  { framework: "RAA Audit", control: "Tamper-evident audit trail", status: "Met", evidence: "audit_log hash-chain" },
  { framework: "FATF / AML", control: "Restricted ACL on AML documents", status: "Partial", evidence: "folder ACL" },
  { framework: "ISO 27001", control: "Disaster-recovery RPO/RTO tested", status: "Partial", evidence: "DR posture" },
];

const MOCK_VERIFICATION = { ok: true, checked: 148, brokenAt: null };

const MOCK_AUDIT_ROWS = [
  { id: 1, actor_username: "admin", action: "LOGIN", entity: "user", entity_id: "1", created_at: "2026-06-23T09:00:00Z" },
  { id: 2, actor_username: "maker1", action: "INDEXED", entity: "document", entity_id: "42", created_at: "2026-06-23T09:05:00Z" },
];

function mockFetch(url: string) {
  const u = String(url);
  if (u.includes("/compliance/scorecard"))
    return Promise.resolve({ ok: true, json: async () => ({ scorecard: MOCK_SCORECARD }) });
  if (u.includes("/compliance/matrix"))
    return Promise.resolve({ ok: true, json: async () => ({ matrix: MOCK_MATRIX }) });
  if (u.includes("/compliance/verify"))
    return Promise.resolve({ ok: true, json: async () => ({ verification: MOCK_VERIFICATION }) });
  if (u.includes("/compliance/audit"))
    return Promise.resolve({ ok: true, json: async () => ({ rows: MOCK_AUDIT_ROWS }) });
  return Promise.resolve({ ok: true, json: async () => ({}) });
}

describe("ComplianceAudit screen", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(mockFetch) as any;
  });

  it("renders the compliance score KPI card with the fetched score", async () => {
    render(<ComplianceAudit />);
    await waitFor(() => expect(screen.getByText("78%")).toBeInTheDocument());
  });

  it("renders KPI cards for frameworks monitored and audit entries", async () => {
    render(<ComplianceAudit />);
    await waitFor(() => {
      expect(screen.getByText("4")).toBeInTheDocument(); // frameworks
      expect(screen.getByText("148")).toBeInTheDocument(); // audit entries
    });
  });

  it("shows sequence integrity as Intact when ok=true", async () => {
    render(<ComplianceAudit />);
    await waitFor(() => expect(screen.getByText("Intact")).toBeInTheDocument());
  });

  it("displays Regulatory Matrix tab content including framework names", async () => {
    render(<ComplianceAudit />);
    await waitFor(() => expect(screen.getAllByText(/Regulatory Matrix/).length).toBeGreaterThan(0));
    // switch to the matrix tab using fireEvent to stay within React's event system
    const matrixTab = screen.getByRole("button", { name: /regulatory matrix/i });
    fireEvent.click(matrixTab);
    // Multiple elements may contain this text (page subtitle + table cell); use getAllByText
    await waitFor(() => expect(screen.getAllByText(/Tamper-evident audit trail/).length).toBeGreaterThan(0));
  });

  it("calls the scorecard, matrix, verify, and audit endpoints", async () => {
    render(<ComplianceAudit />);
    await waitFor(() => screen.getByText("78%"));
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => String(c[0])
    );
    expect(calls.some((u) => u.includes("/compliance/scorecard"))).toBe(true);
    expect(calls.some((u) => u.includes("/compliance/matrix"))).toBe(true);
    expect(calls.some((u) => u.includes("/compliance/verify"))).toBe(true);
    expect(calls.some((u) => u.includes("/compliance/audit"))).toBe(true);
  });

  it("shows loading placeholder on Scorecard tab while fetching", () => {
    // fetch never resolves — simulates an in-flight request
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as any;
    render(<ComplianceAudit />);
    // The scorecard tab is active by default; loading state should be shown
    expect(screen.getByText(/Loading scorecard…/)).toBeInTheDocument();
  });

  it("propagates filter error to error banner when loadAuditFiltered fails", async () => {
    render(<ComplianceAudit />);
    // Wait for initial load
    await waitFor(() => expect(screen.getByText("78%")).toBeInTheDocument());

    // Switch to Audit Trail tab
    const auditTab = screen.getByRole("button", { name: /audit trail/i });
    fireEvent.click(auditTab);

    // Now make the next fetch fail
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("Network error"))) as any;

    const applyBtn = screen.getByRole("button", { name: /apply filter/i });
    fireEvent.click(applyBtn);

    await waitFor(() =>
      expect(screen.getByText(/Network error/)).toBeInTheDocument()
    );
  });

  it("shows 'not have permission' when user lacks compliance:read", async () => {
    // Override the mockUseAuth factory to return no permissions for this test.
    mockUseAuth.mockReturnValueOnce({
      user: { id: 2, username: "maker", roles: ["Maker"], permissions: [] } as any,
      login: async () => {},
      logout: () => {},
    });
    render(<ComplianceAudit />);
    expect(screen.getByText(/You do not have permission/)).toBeInTheDocument();
    // No fetch calls should be made when the user is not authorised
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});
