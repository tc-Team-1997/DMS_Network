import { describe, it, expect } from "vitest";
import { buildSummary } from "./summarize.js";

describe("buildSummary", () => {
  it("leads with a titled doc type, category and branch", () => {
    const s = buildSummary({ docType: "KYC_PASSPORT", category: "Identity", branch: "Thimphu HQ", confidence: 0.93, metadata: {} });
    expect(s).toContain("KYC PASSPORT");
    expect(s).toContain("(Identity)");
    expect(s).toContain("Thimphu HQ");
    expect(s).toContain("93%");
  });

  it("highlights the most meaningful extracted fields", () => {
    const s = buildSummary({
      docType: "LOAN_APPLICATION",
      metadata: { full_name: "Ahmed Hassan", loan_type: "Education", loan_amount: 150000, irrelevant: "x" },
    });
    expect(s).toContain("Full Name: Ahmed Hassan");
    expect(s).toContain("Loan Type: Education");
    expect(s).toContain("Loan Amount: 150000");
  });

  it("falls back to a field count when no highlight keys match", () => {
    const s = buildSummary({ docType: "MISC", metadata: { foo: "1", bar: "2" } });
    expect(s).toMatch(/Captured 2 metadata field/);
  });

  it("handles a missing doc type and empty metadata gracefully", () => {
    const s = buildSummary({ metadata: {} });
    expect(s).toContain("document");
    expect(s.length).toBeGreaterThan(0);
  });
});
