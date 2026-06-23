import { describe, it, expect } from "vitest";
import { tokenize, buildTokensForDoc } from "./tokenize.js";
import type { SearchDoc } from "../types.js";

describe("tokenize", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(tokenize(["Loan Application #42!", "  Thimphu  "])).toBe("loan application 42 thimphu");
  });
  it("builds tokens from a search doc", () => {
    const toks = buildTokensForDoc({
      doc_id: "D1", ocr_text: "KYC Form", metadata_text: "Customer: Dorji", doc_type: "BT_CID_4G",
      branch: "Thimphu", status: "indexed", risk_band: "low", legal_hold: false, expiry_status: "none",
      uploaded_by: "u1", indexed_at: "2026-06-23T00:00:00Z",
    } as SearchDoc);
    expect(toks).toContain("kyc form");
    expect(toks).toContain("dorji");
    expect(toks).toContain("bt_cid_4g");
  });
});
