/**
 * SC-10 — nav integrity: every sidebar nav link must resolve to a registered
 * route (no dead links). Asserts NAV_GROUPS paths ⊆ router route paths.
 */
import { describe, it, expect } from "vitest";
import { NAV_GROUPS } from "./AppShell.js";
import { router } from "../../router.js";

describe("navigation integrity (SC-10)", () => {
  it("every sidebar nav path has a matching route", () => {
    const routePaths = new Set(((router.routes as Array<{ path?: string }>) ?? []).map((r) => r.path).filter(Boolean));
    const navPaths = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.path));
    const missing = navPaths.filter((p) => !routePaths.has(p));
    expect(missing, `nav paths with no route: ${missing.join(", ")}`).toEqual([]);
  });

  it("has no duplicate nav paths", () => {
    const navPaths = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.path));
    const dupes = navPaths.filter((p, i) => navPaths.indexOf(p) !== i);
    expect(dupes, `duplicate nav paths: ${dupes.join(", ")}`).toEqual([]);
  });
});
