import { describe, it, expect } from "vitest";
import { resolvePath, defaultAcls, domainForPath } from "./directory.js";

describe("directory mapper path templates (IDP 5.2)", () => {
  it("maps CID to the customer KYC identity path with year", () => {
    expect(resolvePath("BT_CID_4G", { cid_no: "10112345678", issue_date: "2026-03-01" }))
      .toBe("/BoB/Customers/10112345678/KYC/Identity/2026/");
  });

  it("maps a loan application to the customer loans path", () => {
    expect(resolvePath("BOB_LOAN_APPLICATION", { applicant_cid: "10112345678", loan_type: "HOME", application_no: "LN2026001" }))
      .toBe("/BoB/Customers/10112345678/Loans/HOME/LN2026001/");
  });

  it("maps a SAR report to the AML quarter path", () => {
    expect(resolvePath("SAR_REPORT", { report_no: "SAR1", filing_date: "2026-04-15" }))
      .toBe("/BoB/Compliance/AML/SAR/2026/Q2/");
  });

  it("falls back to the review pending path for unknown types", () => {
    const p = resolvePath("UNKNOWN", { doc_id: "abc", ingest: "2026-06-23" });
    expect(p.startsWith("/BoB/_Review/Pending/")).toBe(true);
  });

  it("derives the domain from a path", () => {
    expect(domainForPath("/BoB/Customers/10112345678/KYC/Identity/2026/")).toBe("Customers");
    expect(domainForPath("/BoB/Compliance/AML/SAR/2026/Q2/")).toBe("Compliance");
  });

  it("returns IDP 5.3 default ACLs for a domain", () => {
    const acls = defaultAcls("Customers");
    expect(acls.some((a) => a.access === "read")).toBe(true);
    expect(acls.some((a) => a.access === "write")).toBe(true);
  });
});
