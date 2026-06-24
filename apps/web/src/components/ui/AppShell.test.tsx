/**
 * AppShell render test
 *
 * We provide a mocked AuthContext so the sidebar RBAC filter
 * can see a user with all permissions, making nav groups visible.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

  it("renders the content slot", () => {
    renderShell();
    expect(screen.getByTestId("content")).toBeInTheDocument();
  });

  it("renders all six nav group labels", () => {
    renderShell();
    expect(screen.getByText("Intelligence")).toBeInTheDocument();
    expect(screen.getByText("Ingestion")).toBeInTheDocument();
    expect(screen.getByText("Management")).toBeInTheDocument();
    expect(screen.getByText("Discovery")).toBeInTheDocument();
    expect(screen.getByText("Process")).toBeInTheDocument();
    expect(screen.getByText("Analytics & Platform")).toBeInTheDocument();
  });

  it("renders the sidebar footer status line", () => {
    renderShell();
    expect(screen.getByText("All 18 services healthy")).toBeInTheDocument();
  });
});
