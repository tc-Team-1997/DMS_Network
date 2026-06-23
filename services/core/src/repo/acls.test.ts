import { describe, it, expect, afterAll } from "vitest";
import { makeTestApp } from "../testutil.js";
import { createFolder } from "./folders.js";
import { setFolderAcls, effectiveAcls } from "./acls.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("folder ACL inheritance", () => {
  it("a child folder inherits ancestor ACLs unioned with its own", async () => {
    const customers = await createFolder(h.knex, { name: "Customers", domain: "Customers" });
    await setFolderAcls(h.knex, customers.id, [{ role: "Compliance", access: "read" }], false);

    const kyc = await createFolder(h.knex, { name: "KYC", parentId: customers.id });
    await setFolderAcls(h.knex, kyc.id, [{ role: "DMSOperator", access: "write" }], false);

    const eff = await effectiveAcls(h.knex, kyc.id);
    const pairs = eff.map((a) => `${a.role}:${a.access}`);
    expect(pairs).toContain("Compliance:read");   // inherited from parent
    expect(pairs).toContain("DMSOperator:write");  // own
    expect(eff.find((a) => a.role === "Compliance")!.inherited).toBe(true);
    expect(eff.find((a) => a.role === "DMSOperator")!.inherited).toBe(false);
  });
});
