import { describe, it, expect } from "vitest";
import { MockConnector } from "../connectors/mock.js";
import { cbsCustomerLookup, cbsKycSync } from "./cbs.js";
import { losPushLoan, losLoanStatus } from "./los.js";
import { kycVerify } from "./kyc.js";

const cbs = new MockConnector("cbs", {
  "customer.lookup": { ok: true, status: 200, data: { cid: "C1", name: "Dorji", branch: "Thimphu", segment: "RETAIL" } },
  "kyc.sync": { ok: true, status: 200, data: { cid: "C1", kycStatus: "VERIFIED" } },
});
const los = new MockConnector("los", {
  "loan.push": { ok: true, status: 201, data: { loanId: "L9", state: "RECEIVED" } },
  "loan.status": { ok: true, status: 200, data: { loanId: "L9", state: "UNDER_REVIEW" } },
});
const kyc = new MockConnector("kyc", {
  "verify": { ok: true, status: 200, data: { match: true, score: 0.97, decision: "PASS" } },
});

describe("adapters via mock connector", () => {
  it("CBS customer lookup", async () => {
    const r = await cbsCustomerLookup(cbs, "C1");
    expect(r.ok).toBe(true);
    expect(r.data?.name).toBe("Dorji");
  });
  it("CBS KYC sync", async () => {
    const r = await cbsKycSync(cbs, "C1");
    expect(r.data?.kycStatus).toBe("VERIFIED");
  });
  it("LOS push + status", async () => {
    const push = await losPushLoan(los, { applicationId: "A1", cid: "C1", amount: 50000 });
    expect(push.status).toBe(201);
    expect(push.data?.loanId).toBe("L9");
    const status = await losLoanStatus(los, "L9");
    expect(status.data?.state).toBe("UNDER_REVIEW");
  });
  it("KYC verify", async () => {
    const r = await kycVerify(kyc, { cid: "C1", documentType: "BT_CID_4G", documentNo: "10101000001" });
    expect(r.data?.decision).toBe("PASS");
  });
});
