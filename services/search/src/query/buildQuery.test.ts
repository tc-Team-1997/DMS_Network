import { describe, it, expect } from "vitest";
import knexLib from "knex";
import { applyScope, applyFilters, applyTextMatch, scoreHit, paginate } from "./buildQuery.js";
import { aggregateFacets } from "./facets.js";

const knex = knexLib({ client: "sqlite3", useNullAsDefault: true });
const base = () => knex("search_index");

describe("applyScope", () => {
  it("restricts to own branch without crossbranch", () => {
    const sql = applyScope(base(), { crossBranch: false, branch: "Thimphu" }).toString();
    expect(sql).toMatch(/branch.*=.*Thimphu/);
  });
  it("does not restrict branch when crossBranch is true", () => {
    const sql = applyScope(base(), { crossBranch: true }).toString();
    expect(sql).not.toMatch(/where/i);
  });
  // CRITICAL-1: null branch without crossbranch must produce a deny-all clause
  it("produces a deny-all clause when branch is null and crossBranch is false", () => {
    const sql = applyScope(base(), { crossBranch: false, branch: undefined }).toString();
    expect(sql).toMatch(/1\s*=\s*0/);
  });
});

describe("applyTextMatch boolean OR grouping", () => {
  // CRITICAL-2: the OR group must be wrapped so it cannot escape the outer branch scope
  it("wraps boolean OR terms in a grouped sub-clause (not a top-level OR)", () => {
    const sql = applyTextMatch(base(), "loan OR dorji", "boolean").toString();
    // Both terms should appear inside parentheses, meaning the OR is scoped.
    // The simplest invariant: the generated SQL contains both LIKE terms and
    // also contains a parenthesised group (knex renders this as `(... or ...)`)
    expect(sql).toMatch(/like.*%loan%/i);
    expect(sql).toMatch(/like.*%dorji%/i);
    // With the fix, there should be a subgroup parenthesis enclosing the OR.
    // Knex renders grouped wheres as `where (... or ...)`.
    expect(sql).toMatch(/\(.*like.*%loan%.*or.*like.*%dorji%.*\)/i);
  });
});

describe("applyFilters", () => {
  it("filters by doc_type, status and legal_hold", () => {
    const sql = applyFilters(base(), { doc_type: "BT_CID_4G", status: "indexed", legal_hold: true }).toString();
    expect(sql).toMatch(/doc_type.*BT_CID_4G/);
    expect(sql).toMatch(/status.*indexed/);
    expect(sql).toMatch(/legal_hold/);
  });
  it("applies a date range on indexed_at", () => {
    const sql = applyFilters(base(), { date_from: "2026-01-01", date_to: "2026-12-31" }).toString();
    expect(sql).toMatch(/indexed_at/);
    expect(sql).toMatch(/2026-01-01/);
  });
  it("maps expiry_status le30 to a stored value filter", () => {
    const sql = applyFilters(base(), { expiry_status: "le30" }).toString();
    expect(sql).toMatch(/expiry_status.*le30/);
  });
});

describe("applyTextMatch", () => {
  it("fulltext ANDs each term as a LIKE on tokens", () => {
    const sql = applyTextMatch(base(), "loan dorji", "fulltext").toString();
    expect(sql).toMatch(/tokens.*like.*%loan%/i);
    expect(sql).toMatch(/tokens.*like.*%dorji%/i);
  });
  it("wildcard translates * and ? to SQL % and _", () => {
    const sql = applyTextMatch(base(), "dor*", "wildcard").toString();
    expect(sql).toMatch(/like.*%dor%/i);
  });
  it("boolean honours NOT to exclude a term", () => {
    const sql = applyTextMatch(base(), "loan NOT closed", "boolean").toString();
    // knex renders NOT EXISTS as: not (`tokens` like '%closed%')
    expect(sql).toMatch(/not.*like.*%closed%/i);
  });
});

describe("scoreHit", () => {
  it("scores higher when more query terms appear", () => {
    const a = scoreHit("loan application dorji thimphu", ["loan", "dorji"]);
    const b = scoreHit("loan application", ["loan", "dorji"]);
    expect(a).toBeGreaterThan(b);
    expect(a).toBeLessThanOrEqual(1);
  });
});

describe("paginate", () => {
  it("defaults to page 1 / size 20 and caps size at 100", () => {
    expect(paginate()).toEqual({ limit: 20, offset: 0 });
    expect(paginate(3, 25)).toEqual({ limit: 25, offset: 50 });
    expect(paginate(1, 5000)).toEqual({ limit: 100, offset: 0 });
  });
});

describe("aggregateFacets", () => {
  it("counts distinct values per facet dimension", () => {
    const f = aggregateFacets([
      { doc_type: "A", status: "x", branch: "T", risk_band: "low" },
      { doc_type: "A", status: "y", branch: "T", risk_band: "high" },
      { doc_type: "B", status: "x", branch: "P", risk_band: "low" },
    ]);
    expect(f.doc_type).toEqual(expect.arrayContaining([{ value: "A", count: 2 }, { value: "B", count: 1 }]));
    expect(f.branch).toEqual(expect.arrayContaining([{ value: "T", count: 2 }, { value: "P", count: 1 }]));
  });
});
