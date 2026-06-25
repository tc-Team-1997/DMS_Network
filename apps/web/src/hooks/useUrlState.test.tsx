import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useUrlState } from "./useUrlState.js";

// Helper component that exposes state through the DOM for assertions.
function Fixture({ defaults }: { defaults: Record<string, string> }) {
  const [state, setState] = useUrlState(defaults);
  const location = useLocation();
  return (
    <div>
      <span data-testid="state">{JSON.stringify(state)}</span>
      <span data-testid="search">{location.search}</span>
      <button
        onClick={() => setState({ status: "active" })}
        data-testid="set-status"
      >
        set status
      </button>
      <button
        onClick={() => setState({ status: "active", branch: "Thimphu" })}
        data-testid="set-multi"
      >
        set multi
      </button>
      <button
        onClick={() => setState({ status: "" })}
        data-testid="clear-status"
      >
        clear status
      </button>
    </div>
  );
}

function renderFixture(
  defaults: Record<string, string>,
  initialSearch = "",
) {
  return render(
    <MemoryRouter initialEntries={[`/${initialSearch}`]}>
      <Fixture defaults={defaults} />
    </MemoryRouter>,
  );
}

describe("useUrlState", () => {
  it("returns defaults when no query params are present", () => {
    renderFixture({ status: "", branch: "all" });
    const state = JSON.parse(screen.getByTestId("state").textContent!);
    expect(state).toEqual({ status: "", branch: "all" });
  });

  it("reads existing query params from the URL, overriding defaults", () => {
    renderFixture({ status: "", branch: "all" }, "?status=pending&branch=Paro");
    const state = JSON.parse(screen.getByTestId("state").textContent!);
    expect(state.status).toBe("pending");
    expect(state.branch).toBe("Paro");
  });

  it("merges a partial update while keeping other params unchanged", async () => {
    renderFixture({ status: "", branch: "all" }, "?branch=Thimphu");
    await act(async () => {
      screen.getByTestId("set-status").click();
    });
    const state = JSON.parse(screen.getByTestId("state").textContent!);
    expect(state.status).toBe("active");
    expect(state.branch).toBe("Thimphu"); // unchanged
  });

  it("updates multiple params in one call", async () => {
    renderFixture({ status: "", branch: "" });
    await act(async () => {
      screen.getByTestId("set-multi").click();
    });
    const state = JSON.parse(screen.getByTestId("state").textContent!);
    expect(state.status).toBe("active");
    expect(state.branch).toBe("Thimphu");
  });

  it("removes a param from the query string when set to empty string", async () => {
    renderFixture({ status: "" }, "?status=active");
    await act(async () => {
      screen.getByTestId("clear-status").click();
    });
    // After clearing, the search string should not contain status=
    const search = screen.getByTestId("search").textContent!;
    expect(search).not.toContain("status=");
  });

  it("falls back to default for params not in the URL", () => {
    renderFixture({ status: "draft", branch: "" }, "?branch=Paro");
    const state = JSON.parse(screen.getByTestId("state").textContent!);
    expect(state.status).toBe("draft"); // default, not in URL
    expect(state.branch).toBe("Paro");  // from URL
  });
});
