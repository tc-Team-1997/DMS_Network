import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";
import { scanDisposalEligibility } from "../modules/records.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("records routes", () => {
  it("lists the file plan with compliance:read", async () => {
    const adminToken = await h.tokenFor("admin");
    await h.knex("retention_policies").insert({ id: "018f4e3a-1b2c-7d4e-8f5a-6b7c8d000001", doc_class: "GENERAL_LETTER", retention_years: 7, trigger: "ingest", regulation: "Default" });
    const res = await request(h.app).get("/records/file-plan").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.policies.map((p: any) => p.doc_class)).toContain("GENERAL_LETTER");
  });

  it("forbids placing a hold without legal_hold:place (Viewer role)", async () => {
    const viewerRole = await h.knex("roles").where({ name: "Viewer" }).first();
    const vid = "018f4e3a-1b2c-7d4e-8f5a-6b7c8d000002";
    await h.knex("users").insert({ id: vid, username: "viewer_rec", password_hash: "x", status: "Active" });
    await h.knex("user_roles").insert({ user_id: vid, role_id: viewerRole.id });
    const viewerToken = await h.tokenFor("viewer_rec");

    const res = await request(h.app).post("/records/holds").set("Authorization", `Bearer ${viewerToken}`)
      .send({ ref: "LH-X", scope: "branch:THI001" });
    expect(res.status).toBe(403);
  });

  it("admin places and releases a legal hold", async () => {
    const adminToken = await h.tokenFor("admin");
    const place = await request(h.app).post("/records/holds").set("Authorization", `Bearer ${adminToken}`)
      .send({ ref: "LH-2026-09", scope: "branch:THI001" });
    expect(place.status).toBe(201);
    const rel = await request(h.app).post("/records/holds/LH-2026-09/release").set("Authorization", `Bearer ${adminToken}`);
    expect(rel.status).toBe(200);
    expect(rel.body.hold.status).toBe("Released");
  });

  it("legal hold blocks certified disposal", async () => {
    const adminToken = await h.tokenFor("admin");
    const docId = "018f4e3a-1b2c-7d4e-8f5a-6b7c8d000003";
    // Insert a doc in branch THI001
    await h.knex("documents").insert({
      id: docId,
      title: "HoldDoc", doc_type: "BOB_LOAN_APPLICATION", cid: "1", branch: "THI001",
      file_hash_sha256: "hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh", status: "Active", source_channel: "UPLOAD", page_count: 1, file_size_bytes: 0, current_version: 1,
    });

    // Place hold on branch:THI001
    await request(h.app).post("/records/holds").set("Authorization", `Bearer ${adminToken}`)
      .send({ ref: "LH-BLOCK-01", scope: "branch:THI001" });

    // Disposal should be refused (409)
    const cert = await request(h.app).post(`/records/disposal/${docId}/certify`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(cert.status).toBe(409);
    expect(cert.body.error).toBe("under_legal_hold");
    expect(cert.body.hold).toBe("LH-BLOCK-01");
  });

  it("blocks soft-delete under an active hold and allows it after release", async () => {
    const adminToken = await h.tokenFor("admin");
    const docId = "018f4e3a-1b2c-7d4e-8f5a-6b7c8d000010";
    await h.knex("documents").insert({
      id: docId, title: "DelHold", doc_type: "BOB_LOAN_APPLICATION", cid: "1", branch: "DEL001",
      file_hash_sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "Active", source_channel: "UPLOAD", page_count: 1, file_size_bytes: 0, current_version: 1,
    });

    await request(h.app).post("/records/holds").set("Authorization", `Bearer ${adminToken}`)
      .send({ ref: "LH-DEL-10", scope: "branch:DEL001" });

    // DELETE must be refused with 409 under_legal_hold and the doc must remain.
    const del = await request(h.app).delete(`/documents/${docId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(del.status).toBe(409);
    expect(del.body.error).toBe("under_legal_hold");
    expect(del.body.hold).toBe("LH-DEL-10");
    const still = await h.knex("documents").where({ id: docId }).first();
    expect(still.status).toBe("Active");

    // Release the hold → delete is re-enabled.
    await request(h.app).post("/records/holds/LH-DEL-10/release").set("Authorization", `Bearer ${adminToken}`);
    const del2 = await request(h.app).delete(`/documents/${docId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(del2.status).toBe(204);
    const after = await h.knex("documents").where({ id: docId }).first();
    expect(after.status).toBe("Deleted");
  });

  it("disposal scan marks an over-retention hold-free doc eligible but skips a held one", async () => {
    const oldDate = "2000-01-01 00:00:00"; // well past any retention window
    const freeId = "018f4e3a-1b2c-7d4e-8f5a-6b7c8d000020";
    const heldId = "018f4e3a-1b2c-7d4e-8f5a-6b7c8d000021";

    await h.knex("documents").insert([
      {
        id: freeId, title: "FreeOld", doc_type: "BOB_LOAN_APPLICATION", cid: "9", branch: "SCANFREE",
        file_hash_sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        status: "Active", source_channel: "UPLOAD", page_count: 1, file_size_bytes: 0, current_version: 1,
        ingest_timestamp: oldDate,
      },
      {
        id: heldId, title: "HeldOld", doc_type: "BOB_LOAN_APPLICATION", cid: "9", branch: "SCANHELD",
        file_hash_sha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        status: "Active", source_channel: "UPLOAD", page_count: 1, file_size_bytes: 0, current_version: 1,
        ingest_timestamp: oldDate,
      },
    ]);

    // Hold only the SCANHELD branch.
    const adminToken = await h.tokenFor("admin");
    await request(h.app).post("/records/holds").set("Authorization", `Bearer ${adminToken}`)
      .send({ ref: "LH-SCAN-21", scope: "branch:SCANHELD" });

    const result = await scanDisposalEligibility(h.knex);
    expect(result.eligible).toBeGreaterThanOrEqual(1);
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    const free = await h.knex("documents").where({ id: freeId }).first();
    const held = await h.knex("documents").where({ id: heldId }).first();
    expect(free.disposal_status).toBe("Eligible");
    expect(held.disposal_status).toBeFalsy(); // SKIPPED — under hold

    // An eligibility audit row exists for the free doc, none for the held doc.
    const freeAudit = await h.knex("audit_log")
      .where({ entity: "document", entity_id: freeId, action: "DISPOSAL_ELIGIBLE" }).first();
    expect(freeAudit).toBeTruthy();
    const heldAudit = await h.knex("audit_log")
      .where({ entity: "document", entity_id: heldId, action: "DISPOSAL_ELIGIBLE" }).first();
    expect(heldAudit).toBeFalsy();

    // GET /disposal/eligibility reflects the scan marking for the free doc.
    const elig = await request(h.app).get("/records/disposal/eligibility")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(elig.status).toBe(200);
    const freeCandidate = elig.body.candidates.find((c: any) => c.document_id === freeId);
    expect(freeCandidate?.disposal_status).toBe("Eligible");
  });
});
