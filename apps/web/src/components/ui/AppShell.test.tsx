/**
 * AppShell render test
 *
 * We provide a mocked AuthContext so the sidebar RBAC filter
 * can see a user with all permissions, making nav groups visible.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppShell } from "./AppShell.js";

// Mock useAuth so we don't need a real AuthProvider / fetch
vi.mock("../../auth/AuthContext.js", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      username: "admin",
      roles: ["CDO"],
      permissions: [
        "user:read", "dashboard:read", "branch:read", "customer:read",
        "document:capture", "document:index", "ai:read", "case:read",
        "document:read", "records:read", "lifecycle:read", "search:read",
        "workflow:read", "review:read", "compliance:read", "alerts:read",
        "integration:read", "security:read", "admin:read",
      ],
    },
    login:  vi.fn(),
    logout: vi.fn(),
  }),
}));

describe("AppShell", () => {
  function renderShell(children = <div data-testid="content">Hello</div>) {
    return render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <AppShell>{children}</AppShell>
      </MemoryRouter>,
    );
  }

  it("renders the ZorDMS brand in the topbar", () => {
    renderShell();
    expect(screen.getAllByText("ZorDMS").length).toBeGreaterThan(0);
  });

  it("does NOT render the 'Enterprise Document Management' subtitle", () => {
    renderShell();
    expect(screen.queryByText(/Enterprise Document Management/i)).toBeNull();
  });

  it("renders the content slot", () => {
    renderShell();
    expect(screen.getByTestId("content")).toBeInTheDocument();
  });

  it("renders all six nav group labels (Iteration-2 IA)", () => {
    renderShell();
    expect(screen.getByText("Ingestion")).toBeInTheDocument();
    expect(screen.getByText("Document Management")).toBeInTheDocument();
    expect(screen.getByText("Operations")).toBeInTheDocument();
    // /dashboard lives in Analytics, so the breadcrumb also shows "Analytics".
    expect(screen.getAllByText("Analytics").length).toBeGreaterThan(0);
    expect(screen.getByText("Intelligence")).toBeInTheDocument();
    expect(screen.getByText("Platform")).toBeInTheDocument();
  });

  it("places Document Viewer and Review Queue under Ingestion (SC-09/10)", () => {
    renderShell();
    // both nav links exist (Ingestion section); their order is Viewer then Review Queue
    expect(screen.getByText("Document Viewer")).toBeInTheDocument();
    expect(screen.getByText("Review Queue")).toBeInTheDocument();
  });

  it("renders the sidebar footer version/build line", () => {
    renderShell();
    expect(screen.getByText(/Build/i)).toBeInTheDocument();
  });

  it("renders user name and role on the same line as plain text (no button/pill)", () => {
    renderShell();
    // usr-identity should be a div, not a button
    const identity = document.querySelector(".usr-identity");
    expect(identity).not.toBeNull();
    expect(identity?.tagName.toLowerCase()).toBe("div");
    // Both name and role visible in the document
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("CDO")).toBeInTheDocument();
    // The separator dot span is present (text content is " · ")
    const dotSpan = document.querySelector(".usr-dot");
    expect(dotSpan).not.toBeNull();
    expect(dotSpan?.textContent).toBe(" · ");
  });

  it("does NOT render usr-pill (old button/pill chrome removed)", () => {
    renderShell();
    expect(document.querySelector(".usr-pill")).toBeNull();
  });

  it("shows a portal tooltip on hover of an icon-only action button", async () => {
    renderShell();
    const signOut = screen.getByRole("button", { name: /sign out/i });
    const wrap = signOut.closest(".zor-tooltip-wrap");
    expect(wrap).not.toBeNull();
    fireEvent.mouseEnter(wrap as Element);
    // The bubble appears (after the hover-intent delay) as a role=tooltip…
    await waitFor(() =>
      expect(screen.getByRole("tooltip")).toHaveTextContent(/sign out/i),
    );
    // …and is portaled to <body>, so it can't be clipped by the topbar.
    expect(screen.getByRole("tooltip").parentElement).toBe(document.body);
  });

  it("sign-out button has aria-label 'Sign out'", () => {
    renderShell();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("alerts button has aria-label", () => {
    renderShell();
    expect(screen.getByRole("button", { name: /alerts/i })).toBeInTheDocument();
  });
});
