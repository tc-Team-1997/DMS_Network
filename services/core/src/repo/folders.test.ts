import { describe, it, expect, afterAll } from "vitest";
import { makeTestApp } from "../testutil.js";
import { createFolder, listTree, moveFolder } from "./folders.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("folders repo", () => {
  it("creates a root folder under /BoB and a child with a materialized path", async () => {
    const customers = await createFolder(h.knex, { name: "Customers", domain: "Customers", createdBy: "admin" });
    expect(customers.path).toBe("/BoB/Customers");
    const kyc = await createFolder(h.knex, { name: "KYC", parentId: customers.id, createdBy: "admin" });
    expect(kyc.path).toBe("/BoB/Customers/KYC");
  });

  it("rejects a duplicate path", async () => {
    await createFolder(h.knex, { name: "Dupe" });
    await expect(createFolder(h.knex, { name: "Dupe" })).rejects.toThrow();
  });

  it("lists a nested tree", async () => {
    const tree = await listTree(h.knex);
    const customers = tree.find((n) => n.name === "Customers");
    expect(customers).toBeTruthy();
    expect(customers!.children.some((c) => c.name === "KYC")).toBe(true);
  });

  it("moves a folder and recomputes descendant paths", async () => {
    const ops = await createFolder(h.knex, { name: "Operations", domain: "Operations" });
    const customers = await h.knex("folders").where({ name: "Customers" }).first();
    const moved = await moveFolder(h.knex, customers.id, ops.id);
    expect(moved.path).toBe("/BoB/Operations/Customers");
    const kyc = await h.knex("folders").where({ name: "KYC" }).first();
    expect(kyc.path).toBe("/BoB/Operations/Customers/KYC");
  });

  it("refuses to move a folder into its own subtree", async () => {
    const ops = await h.knex("folders").where({ name: "Operations" }).first();
    const customers = await h.knex("folders").where({ name: "Customers" }).first();
    await expect(moveFolder(h.knex, ops.id, customers.id)).rejects.toThrow(/subtree/);
  });
});
