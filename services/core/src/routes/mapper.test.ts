import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("mapper route", () => {
  it("resolves the path, creates the folder chain, seeds ACLs, and assigns the document", async () => {
    const token = await h.tokenFor("admin");
    const up = await request(h.app).post("/documents").set("Authorization", `Bearer ${token}`)
      .field("title", "CID").field("branch", "Thimphu").attach("file", Buffer.from("cid"), "cid.png");
    const id = up.body.document.id;

    const res = await request(h.app).post(`/mapper/${id}`).set("Authorization", `Bearer ${token}`).send({
      docType: "BT_CID_4G", fields: { cid_no: "10112345678", issue_date: "2026-03-01" },
    });
    expect(res.status).toBe(200);
    expect(res.body.path).toBe("/BoB/Customers/10112345678/KYC/Identity/2026/");
    expect(res.body.folderId).toBeTruthy();
    expect(res.body.acls.length).toBeGreaterThan(0);

    const folder = await h.knex("folders").where({ id: res.body.folderId }).first();
    expect(folder.path).toBe("/BoB/Customers/10112345678/KYC/Identity/2026");
    const doc = await h.knex("documents").where({ id }).first();
    expect(doc.folder_id).toBe(res.body.folderId);
  });

  it("is idempotent — re-mapping reuses the same folder chain", async () => {
    const token = await h.tokenFor("admin");
    const up = await request(h.app).post("/documents").set("Authorization", `Bearer ${token}`)
      .field("title", "CID2").field("branch", "Thimphu").attach("file", Buffer.from("cid2"), "cid2.png");
    const id = up.body.document.id;
    const res = await request(h.app).post(`/mapper/${id}`).set("Authorization", `Bearer ${token}`).send({
      docType: "BT_CID_4G", fields: { cid_no: "10112345678", issue_date: "2026-03-01" },
    });
    const count = await h.knex("folders").where({ path: "/BoB/Customers/10112345678/KYC/Identity/2026" }).count("id as c");
    expect(Number(count[0].c)).toBe(1);
    expect(res.status).toBe(200);
  });
});
