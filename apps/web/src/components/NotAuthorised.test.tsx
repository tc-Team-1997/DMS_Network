import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NotAuthorised } from "./NotAuthorised.js";
import { SessionExpiredScreen } from "./SessionExpiredScreen.js";

describe("NotAuthorised", () => {
  it("renders the forbidden state with a default access message", () => {
    render(<MemoryRouter><NotAuthorised variant="forbidden" /></MemoryRouter>);
    expect(screen.getByText("You don't have access")).toBeInTheDocument();
    expect(screen.getByText("Back to dashboard")).toBeInTheDocument();
  });

  it("renders the not-found state with a resource label", () => {
    render(<MemoryRouter><NotAuthorised variant="notfound" resourceLabel="Document abc" /></MemoryRouter>);
    expect(screen.getByText("Not found")).toBeInTheDocument();
    expect(screen.getByText("Document abc")).toBeInTheDocument();
  });

  it("supports title/message overrides", () => {
    render(<MemoryRouter><NotAuthorised title="Restricted" message="Ask the owner." /></MemoryRouter>);
    expect(screen.getByText("Restricted")).toBeInTheDocument();
    expect(screen.getByText("Ask the owner.")).toBeInTheDocument();
  });
});

describe("SessionExpiredScreen", () => {
  it("shows the expiry dialog and fires re-auth on the button", () => {
    const onReauth = vi.fn();
    render(<SessionExpiredScreen onReauthenticate={onReauth} />);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Session expired")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /sign in again/i }));
    expect(onReauth).toHaveBeenCalledTimes(1);
  });
});
