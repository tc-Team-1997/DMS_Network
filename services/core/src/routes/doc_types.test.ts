/**
 * Tests for the admin-manageable Document Type registry (P5).
 *
 * Covers: stored field schemas surfaced by GET, create/edit/delete,
 * system-type delete blocked, from-suggestion persistence, apply-fields,
 * field overlap validation, and RBAC 403.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import request from "supertest";
import { makeTestApp, type TestHarness } from "../testutil.js";
import { signToken } from "@zordms/auth";

const SECRET = "t";
let h: TestHarness;

beforeAll(async () => { h = await makeTestApp(); });
afterAll(async () => { await h.cleanup(); });

/** Token WITHOUT doctype:write (Viewer) for RBAC negative tests. */
function viewerToken(): string {
  return signToken(
    { sub: "v1", username: "viewer", roles: ["Viewer"], permissions: ["document:read", "folder:read"] },
    SECRET,
  );
}

function getType(body: any, code: string) {
  return body.docTypes.find((d: any) => d.code === code);
}

describe("doc-types registry", () => {
  it("GET returns the 25 seeded types with STORED field schemas (field-objects)", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app).get("/doc-types").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(25);

    const cid = getType(res.body, "BT_CID_4G");
    expect(cid).toBeTruthy();
    // KYC mandatory fields are stored, as field-objects { name, type?, mandatory }
    const mNames = cid.mandatoryFields.map((f: any) => f.name);
    expect(mNames).toEqual(expect.arrayContaining(["full_name", "dob", "expiry_date"]));
    expect(cid.mandatoryFields.every((f: any) => f.mandatory === true)).toBe(true);
    expect(cid.optionalFields.every((f: any) => f.mandatory === false)).toBe(true);
    // per-type optional extras present
    expect(cid.optionalFields.map((f: any) => f.name)).toEqual(expect.arrayContaining(["dzongkhag", "gewog"]));
  });

  it("POST creates a new custom type (system=false) and GET reflects stored fields", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app).post("/doc-types").set("Authorization", `Bearer ${token}`).send({
      code: "BT_LAND_TAX_RECEIPT",
      description: "Bhutan Land Tax Receipt",
      category: "General Corr.",
      jurisdiction: "BT",
      issuer: "Dzongkhag",
      mandatory_fields: ["receipt_no", { name: "paid_date", type: "date" }],
      optional_fields: [{ name: "amount", type: "number" }],
    });
    expect(res.status).toBe(201);
    expect(res.body.docType.system).toBe(false);
    expect(res.body.docType.mandatoryFields.map((f: any) => f.name)).toEqual(["receipt_no", "paid_date"]);

    const list = await request(h.app).get("/doc-types").set("Authorization", `Bearer ${token}`);
    const created = getType(list.body, "BT_LAND_TAX_RECEIPT");
    expect(created.optionalFields.map((f: any) => f.name)).toEqual(["amount"]);
    expect(created.mandatoryFields.find((f: any) => f.name === "paid_date").type).toBe("date");
  });

  it("POST rejects a field that is in both mandatory and optional", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app).post("/doc-types").set("Authorization", `Bearer ${token}`).send({
      code: "BAD_TYPE_1",
      mandatory_fields: ["x", "y"],
      optional_fields: ["y", "z"],
    });
    expect(res.status).toBe(400);
    expect(res.body.detail).toContain("y");
  });

  it("PUT edits description/category and replaces field lists", async () => {
    const token = await h.tokenFor("admin");
    await request(h.app).post("/doc-types").set("Authorization", `Bearer ${token}`).send({ code: "EDIT_ME" });
    const res = await request(h.app).put("/doc-types/EDIT_ME").set("Authorization", `Bearer ${token}`).send({
      description: "Edited description",
      category: "Loan & Credit",
      mandatory_fields: [{ name: "loan_no", mandatory: true }],
      optional_fields: ["officer"],
    });
    expect(res.status).toBe(200);
    expect(res.body.docType.description).toBe("Edited description");
    expect(res.body.docType.category).toBe("Loan & Credit");
    expect(res.body.docType.mandatoryFields.map((f: any) => f.name)).toEqual(["loan_no"]);
    expect(res.body.docType.optionalFields.map((f: any) => f.name)).toEqual(["officer"]);
  });

  it("PUT rejects overlapping field lists", async () => {
    const token = await h.tokenFor("admin");
    await request(h.app).post("/doc-types").set("Authorization", `Bearer ${token}`).send({ code: "EDIT_OVERLAP" });
    const res = await request(h.app).put("/doc-types/EDIT_OVERLAP").set("Authorization", `Bearer ${token}`).send({
      mandatory_fields: ["dup"],
      optional_fields: ["dup"],
    });
    expect(res.status).toBe(400);
  });

  it("DELETE removes a custom type but BLOCKS deletion of a system type", async () => {
    const token = await h.tokenFor("admin");
    await request(h.app).post("/doc-types").set("Authorization", `Bearer ${token}`).send({ code: "DELETE_ME" });
    const del = await request(h.app).delete("/doc-types/DELETE_ME").set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(true);

    // System (seeded) type cannot be deleted
    const blocked = await request(h.app).delete("/doc-types/BT_CID_4G").set("Authorization", `Bearer ${token}`);
    expect(blocked.status).toBe(403);
    const stillThere = await h.knex("doc_type_registry").where({ code: "BT_CID_4G" }).first();
    expect(stillThere).toBeTruthy();
  });

  it("POST /from-suggestion persists a suggested-new-type as a custom registry entry", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app).post("/doc-types/from-suggestion").set("Authorization", `Bearer ${token}`).send({
      proposedName: "INSURANCE_POLICY",
      reason: "AI saw a recurring insurance policy document",
      sampleFields: ["policy_no", "insured_name", "premium"],
    });
    expect(res.status).toBe(201);
    expect(res.body.docType.code).toBe("INSURANCE_POLICY");
    expect(res.body.docType.system).toBe(false);
    expect(res.body.docType.optionalFields.map((f: any) => f.name)).toEqual([
      "policy_no", "insured_name", "premium",
    ]);

    const row = await h.knex("doc_type_registry").where({ code: "INSURANCE_POLICY" }).first();
    expect(row).toBeTruthy();
    expect(Boolean(row.system)).toBe(false);
  });

  it("POST /:code/apply-fields replaces the stored schema (P6 AI inference)", async () => {
    const token = await h.tokenFor("admin");
    await request(h.app).post("/doc-types").set("Authorization", `Bearer ${token}`).send({ code: "APPLY_TARGET" });
    const res = await request(h.app).post("/doc-types/APPLY_TARGET/apply-fields").set("Authorization", `Bearer ${token}`).send({
      mandatory_fields: [{ name: "detected_id", type: "string", mandatory: true }],
      optional_fields: [{ name: "detected_date", type: "date", mandatory: false }],
    });
    expect(res.status).toBe(200);
    expect(res.body.docType.mandatoryFields.map((f: any) => f.name)).toEqual(["detected_id"]);
    expect(res.body.docType.optionalFields.map((f: any) => f.name)).toEqual(["detected_date"]);

    // apply-fields works on a SYSTEM type too (it does not delete, only sets schema)
    const sys = await request(h.app).post("/doc-types/BT_PASSPORT/apply-fields").set("Authorization", `Bearer ${token}`).send({
      mandatory_fields: ["passport_no"],
      optional_fields: ["nationality"],
    });
    expect(sys.status).toBe(200);
    expect(sys.body.docType.mandatoryFields.map((f: any) => f.name)).toEqual(["passport_no"]);
  });

  it("POST /:code/apply-training sets prompts + folder template (Group C)", async () => {
    const token = await h.tokenFor("admin");
    await request(h.app).post("/doc-types").set("Authorization", `Bearer ${token}`).send({ code: "TRAIN_TARGET" });
    const res = await request(h.app).post("/doc-types/TRAIN_TARGET/apply-training").set("Authorization", `Bearer ${token}`).send({
      promptClassify: "Classify as TRAIN_TARGET if it has a stamp.",
      promptExtract: "Extract id and date.",
      folderPathTemplate: "/BoB/Custom/{cid}/{year}/",
    });
    expect(res.status).toBe(200);
    expect(res.body.docType.promptClassify).toContain("stamp");
    expect(res.body.docType.folderPathTemplate).toBe("/BoB/Custom/{cid}/{year}/");

    // persisted across a re-read
    const list = await request(h.app).get("/doc-types").set("Authorization", `Bearer ${token}`);
    const row = (list.body.docTypes as any[]).find((d) => d.code === "TRAIN_TARGET");
    expect(row.promptExtract).toBe("Extract id and date.");
  });

  it("POST /:code/apply-training rejects a non-absolute folder template", async () => {
    const token = await h.tokenFor("admin");
    await request(h.app).post("/doc-types").set("Authorization", `Bearer ${token}`).send({ code: "TRAIN_BAD" });
    const res = await request(h.app).post("/doc-types/TRAIN_BAD/apply-training").set("Authorization", `Bearer ${token}`).send({
      folderPathTemplate: "Customers/{cid}",
    });
    expect(res.status).toBe(400);
  });

  it("RBAC: a user without doctype:write gets 403 on all write endpoints", async () => {
    const token = viewerToken();
    const create = await request(h.app).post("/doc-types").set("Authorization", `Bearer ${token}`).send({ code: "NOPE" });
    expect(create.status).toBe(403);

    const edit = await request(h.app).put("/doc-types/BT_CID_4G").set("Authorization", `Bearer ${token}`).send({ description: "x" });
    expect(edit.status).toBe(403);

    const del = await request(h.app).delete("/doc-types/BT_CID_4G").set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(403);

    const sugg = await request(h.app).post("/doc-types/from-suggestion").set("Authorization", `Bearer ${token}`).send({ proposedName: "X" });
    expect(sugg.status).toBe(403);

    const apply = await request(h.app).post("/doc-types/BT_CID_4G/apply-fields").set("Authorization", `Bearer ${token}`).send({});
    expect(apply.status).toBe(403);

    // Read is still allowed for any authenticated user
    const read = await request(h.app).get("/doc-types").set("Authorization", `Bearer ${token}`);
    expect(read.status).toBe(200);
  });
});
