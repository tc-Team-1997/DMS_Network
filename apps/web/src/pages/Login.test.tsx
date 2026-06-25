import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../auth/AuthContext.js";
import { Login } from "./Login.js";

describe("Login", () => {
  beforeEach(() => localStorage.clear());

  it("renders split-screen with carousel and signs in", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ token: "t", user: { id: 1, username: "admin", roles: ["CDO"], permissions: [] } }),
    }) as any;
    render(<MemoryRouter><AuthProvider><Login /></AuthProvider></MemoryRouter>);
    expect(screen.getByRole("heading", { name: /Sign in/i })).toBeInTheDocument();
    expect(screen.getByText(/Capture, classify, index\./i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: "admin123" } });
    fireEvent.click(screen.getByRole("button", { name: /^Sign in$/i }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith("/auth/login", expect.anything()));
  });
});
