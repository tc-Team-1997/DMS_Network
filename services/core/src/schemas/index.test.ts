import { describe, it, expect } from "vitest";
import { SCHEMAS, validateMetadata } from "./index.js";

describe("Bhutan metadata schemas", () => {
  it("defines the three BoB doc-type schemas", () => {
    expect(Object.keys(SCHEMAS)).toEqual(expect.arrayContaining(["BT_CID_4G", "BT_PASSPORT", "BOB_LOAN_APPLICATION"]));
  });

  it("accepts a valid CID record", () => {
    const r = validateMetadata("BT_CID_4G", {
      cid_no: "10112345678", full_name: "Tashi Dorji", dob: "1990-05-01",
      issue_date: "2020-01-01", expiry_date: "2030-01-01", dzongkhag: "Thimphu",
    });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.missing).toEqual([]);
  });

  it("rejects a CID with bad cid_no regex and a missing required field", () => {
    const r = validateMetadata("BT_CID_4G", {
      cid_no: "123", full_name: "X", dob: "1990-05-01", issue_date: "2020-01-01", dzongkhag: "Thimphu",
      // expiry_date missing
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("expiry_date");
    expect(r.errors.some((e) => e.includes("cid_no"))).toBe(true);
  });

  it("enforces enum on loan_type", () => {
    const r = validateMetadata("BOB_LOAN_APPLICATION", {
      application_no: "LN2026001", applicant_cid: "10112345678", applicant_name: "Y",
      loan_type: "SPACESHIP", loan_amount: 1000, branch_code: "THI001", submission_date: "2026-01-01",
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("loan_type"))).toBe(true);
  });

  it("validates passport_no format", () => {
    const ok = validateMetadata("BT_PASSPORT", {
      passport_no: "A1234567", surname: "Dorji", given_names: "Tashi",
      nationality: "Bhutanese",
      dob: "1990-05-01", issue_date: "2020-01-01", expiry_date: "2030-01-01",
    });
    expect(ok.ok).toBe(true);
    const bad = validateMetadata("BT_PASSPORT", {
      passport_no: "1234567", surname: "Dorji", given_names: "Tashi",
      nationality: "Bhutanese",
      dob: "1990-05-01", issue_date: "2020-01-01", expiry_date: "2030-01-01",
    });
    expect(bad.ok).toBe(false);
  });
});
