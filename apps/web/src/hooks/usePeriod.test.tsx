import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import {
  appendPeriod,
  inPeriod,
  resolvePeriod,
  usePeriod,
  type PeriodState,
} from "./usePeriod.js";

const P: PeriodState = { period: "month", from: "2026-01-01", to: "2026-01-31" };

describe("appendPeriod", () => {
  it("adds period/from/to to a bare path", () => {
    expect(appendPeriod("/repository", P)).toBe(
      "/repository?period=month&from=2026-01-01&to=2026-01-31",
    );
  });

  it("preserves an existing query string with &", () => {
    expect(appendPeriod("/viewer?id=abc", P)).toBe(
      "/viewer?id=abc&period=month&from=2026-01-01&to=2026-01-31",
    );
  });
});

describe("inPeriod", () => {
  it("keeps dates inside the inclusive window", () => {
    expect(inPeriod("2026-01-15", P)).toBe(true);
    expect(inPeriod("2026-01-01", P)).toBe(true); // start boundary
    expect(inPeriod("2026-01-31T18:00:00Z", P)).toBe(true); // end day, still in
  });

  it("rejects dates outside the window", () => {
    expect(inPeriod("2025-12-31", P)).toBe(false);
    expect(inPeriod("2026-02-01", P)).toBe(false);
  });

  it("accepts Unix-ms numbers", () => {
    expect(inPeriod(Date.parse("2026-01-10"), P)).toBe(true);
    expect(inPeriod(Date.parse("2026-03-10"), P)).toBe(false);
  });

  it("keeps undated / unparseable values visible (returns true)", () => {
    expect(inPeriod(null, P)).toBe(true);
    expect(inPeriod(undefined, P)).toBe(true);
    expect(inPeriod("", P)).toBe(true);
    expect(inPeriod("not-a-date", P)).toBe(true);
  });
});

describe("resolvePeriod", () => {
  it("falls back to month + computed range when empty", () => {
    const r = resolvePeriod({});
    expect(r.period).toBe("month");
    expect(r.from).not.toBe("");
    expect(r.to).not.toBe("");
  });

  it("ignores an invalid period value", () => {
    expect(resolvePeriod({ period: "decade" }).period).toBe("month");
  });

  it("honours explicit values", () => {
    expect(resolvePeriod({ period: "year", from: "2025-01-01", to: "2025-12-31" })).toEqual({
      period: "year",
      from: "2025-01-01",
      to: "2025-12-31",
    });
  });
});

function Fixture() {
  const p = usePeriod();
  const location = useLocation();
  return (
    <div>
      <span data-testid="active">{String(p.active)}</span>
      <span data-testid="period">{p.period}</span>
      <span data-testid="from">{p.from}</span>
      <span data-testid="search">{location.search}</span>
      <button data-testid="set" onClick={() => p.set({ period: "year", from: "2025-01-01", to: "2025-12-31" })}>set</button>
      <button data-testid="clear" onClick={() => p.clear()}>clear</button>
    </div>
  );
}

function renderAt(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/${search}`]}>
      <Fixture />
    </MemoryRouter>,
  );
}

describe("usePeriod", () => {
  it("is inactive with sensible defaults when no params present", () => {
    renderAt();
    expect(screen.getByTestId("active").textContent).toBe("false");
    expect(screen.getByTestId("period").textContent).toBe("month");
  });

  it("is active and reflects URL params", () => {
    renderAt("?period=year&from=2025-01-01&to=2025-12-31");
    expect(screen.getByTestId("active").textContent).toBe("true");
    expect(screen.getByTestId("period").textContent).toBe("year");
    expect(screen.getByTestId("from").textContent).toBe("2025-01-01");
  });

  it("writes params on set()", async () => {
    renderAt();
    await act(async () => { screen.getByTestId("set").click(); });
    const search = screen.getByTestId("search").textContent!;
    expect(search).toContain("period=year");
    expect(search).toContain("from=2025-01-01");
  });

  it("removes params on clear()", async () => {
    renderAt("?period=year&from=2025-01-01&to=2025-12-31");
    await act(async () => { screen.getByTestId("clear").click(); });
    const search = screen.getByTestId("search").textContent!;
    expect(search).not.toContain("period=");
    expect(search).not.toContain("from=");
  });
});
