import { describe, it, expect } from "vitest";
import { applyFolderTemplate } from "./directory.js";

describe("applyFolderTemplate", () => {
  it("substitutes built-in {cid} and {year} tokens", () => {
    const path = applyFolderTemplate("/BoB/Customers/{cid}/KYC/{year}/", {
      cid_no: "11303000329",
      issue_date: "2024-05-01",
    });
    expect(path).toBe("/BoB/Customers/11303000329/KYC/2024");
  });

  it("substitutes arbitrary {field} tokens from extracted data", () => {
    const path = applyFolderTemplate("/BoB/Loans/{loan_type}/{application_no}", {
      loan_type: "Education",
      application_no: "APP-9",
    });
    expect(path).toBe("/BoB/Loans/Education/APP-9");
  });

  it("sanitises slashes/traversal in token values", () => {
    const path = applyFolderTemplate("/BoB/{name}", { name: "../etc/passwd" });
    expect(path).not.toContain("..");
    expect(path).not.toContain("/etc/");
  });

  it("returns null for an empty template", () => {
    expect(applyFolderTemplate(null, {})).toBeNull();
    expect(applyFolderTemplate("", {})).toBeNull();
  });

  it("uses UNK for missing required tokens", () => {
    const path = applyFolderTemplate("/BoB/Customers/{cid}/", {});
    expect(path).toBe("/BoB/Customers/UNK");
  });
});
