import { describe, it, expect } from "vitest";
import { catalog } from "./engine.js";

const cidFields = { cid_no: "10112345678", full_name: "T", dob: "1990-01-01", expiry_date: "2030-01-01" };

describe("auto-catalog engine", () => {
  it("rule 1: routes to HUMAN_REVIEW when confidence < 0.50", () => {
    const r = catalog({ docType: "BT_CID_4G", confidence: 0.4, fields: cidFields });
    expect(r.route).toBe("HUMAN_REVIEW");
    expect(r.category).toBe("_Review/Pending");
  });

  it("rule 1: routes to HUMAN_REVIEW when a mandatory field is missing", () => {
    const r = catalog({ docType: "BT_CID_4G", confidence: 0.99, fields: { cid_no: "10112345678", full_name: "T", dob: "1990-01-01" } });
    expect(r.route).toBe("HUMAN_REVIEW");
    expect(r.mandatoryOk).toBe(false);
    expect(r.missing).toContain("expiry_date");
  });

  it("rule 2: tentative assignment for 0.50<=conf<0.85", () => {
    const r = catalog({ docType: "BT_CID_4G", confidence: 0.7, fields: cidFields });
    expect(r.route).toBe("TENTATIVE");
    expect(r.category).toBe("KYC / Identity");
    expect(r.reviewFlag).toBe(true);
  });

  it("rule 3: CID -> KYC/Identity with expiry alert + retention", () => {
    const r = catalog({ docType: "BT_CID_4G", confidence: 0.97, fields: cidFields });
    expect(r.route).toBe("AUTO");
    expect(r.category).toBe("KYC / Identity");
    expect(r.alertRule).toMatch(/expiry_date/);
    expect(r.retentionYears).toBeGreaterThan(0);
  });

  it("rule 5: BOB_LOAN_% -> Loan & Credit", () => {
    const r = catalog({ docType: "BOB_LOAN_APPLICATION", confidence: 0.95, fields: { application_no: "LN1", loan_type: "HOME", loan_amount: 1, applicant_cid: "10112345678" } });
    expect(r.category).toBe("Loan & Credit");
  });

  it("rule 8: unknown type -> General Corr.", () => {
    const r = catalog({ docType: "GENERAL_LETTER", confidence: 0.95, fields: { ref_no: "X", from_org: "A", to_org: "B", date: "2026-01-01" } });
    expect(r.category).toBe("General Corr.");
  });
});
