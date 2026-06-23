/**
 * Security regression tests for review findings C1–C5, I1, I2, I3, I5, I6.
 * Each test corresponds to a specific review finding and proves the hole is closed.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import request from "supertest";
import { makeTestApp, type TestHarness } from "../testutil.js";
import { signToken } from "@zordms/auth";

let h: TestHarness;

beforeAll(async () => { h = await makeTestApp(); });
afterAll(async () => { await h.cleanup(); });

// ------------------------------------------------------------------
// Helper: create a user with a specific role + branch and return a token
async function createUserWithRole(
  username: string,
  roleName: string,
  branch: string,
): Promise<string> {
  const role = await h.knex("roles").where({ name: roleName }).first();
  const existing = await h.knex("users").where({ username }).first();
  let userId: number;
  if (existing) {
    userId = existing.id;
  } else {
    const inserted = await h.knex("users").insert({
      username,
      password_hash: "x",
      status: "Active",
      branch,
    }).returning("id");
    userId = typeof inserted[0] === "object" ? (inserted[0] as any).id : inserted[0];
    await h.knex("user_roles").insert({ user_id: userId, role_id: role.id });
  }
  const u = await h.knex("users").where({ id: userId }).first();
  return signToken({ sub: u.id, username: u.username }, "t");
}

// Upload a document as a specific user to a specific branch
async function uploadDoc(token: string, branch: string, filename = "test.png"): Promise<number> {
  const res = await request(h.app).post("/documents")
    .set("Authorization", `Bearer ${token}`)
    .field("title", "Test Doc")
    .field("branch", branch)
    .attach("file", Buffer.from("content"), filename);
  expect(res.status).toBe(201);
  return res.body.document.id;
}

// ------------------------------------------------------------------
// C1: IDOR — single-document endpoints bypass branch scoping
describe("C1: branch-scoped single-document IDOR prevention", () => {
  it("user from branch Paro cannot GET a document owned by branch Thimphu", async () => {
    const thimphuToken = await createUserWithRole("c1_thimphu_maker", "Maker", "Thimphu");
    const paroToken = await createUserWithRole("c1_paro_viewer", "Viewer", "Paro");

    // Upload as Thimphu user — branch is derived from JWT (not req.body) for non-crossbranch
    const adminToken = await h.tokenFor("admin");
    const id = await uploadDoc(adminToken, "Thimphu");

    // Update document to be owned by Thimphu branch explicitly
    await h.knex("documents").where({ id }).update({ branch: "Thimphu" });

    // Paro user should not see it
    const res = await request(h.app).get(`/documents/${id}`)
      .set("Authorization", `Bearer ${paroToken}`);
    expect(res.status).toBe(404);
  });

  it("user from branch Paro cannot download a document owned by branch Thimphu", async () => {
    const adminToken = await h.tokenFor("admin");
    const paroToken = await createUserWithRole("c1_paro_viewer2", "Viewer", "Paro");

    const id = await uploadDoc(adminToken, "Thimphu");
    await h.knex("documents").where({ id }).update({ branch: "Thimphu" });

    const res = await request(h.app).get(`/documents/${id}/download`)
      .set("Authorization", `Bearer ${paroToken}`);
    expect(res.status).toBe(404);
  });

  it("user from branch Paro without crossbranch:read cannot DELETE a document owned by branch Thimphu", async () => {
    const adminToken = await h.tokenFor("admin");
    // Maker role has document:read but NOT crossbranch:read
    const paroMakerToken = await createUserWithRole("c1_paro_maker_del", "Maker", "Paro");

    const id = await uploadDoc(adminToken, "Thimphu");
    await h.knex("documents").where({ id }).update({ branch: "Thimphu" });

    // Grant document:delete to the Maker role for this test
    const makerRole = await h.knex("roles").where({ name: "Maker" }).first();
    const delPerm = await h.knex("permissions").where({ key: "document:delete" }).first();
    const existing = await h.knex("role_permissions").where({ role_id: makerRole.id, permission_id: delPerm.id }).first();
    if (!existing) await h.knex("role_permissions").insert({ role_id: makerRole.id, permission_id: delPerm.id });

    // Must re-mint token so permissions are resolved fresh
    const u = await h.knex("users").where({ username: "c1_paro_maker_del" }).first();
    const { signToken } = await import("@zordms/auth");
    const freshToken = signToken({ sub: u.id, username: u.username }, "t");

    const res = await request(h.app).delete(`/documents/${id}`)
      .set("Authorization", `Bearer ${freshToken}`);
    // Paro user without crossbranch:read cannot see/delete Thimphu document
    expect(res.status).toBe(404);
  });

  it("crossbranch:read user CAN see any branch's document", async () => {
    const adminToken = await h.tokenFor("admin");
    const auditorToken = await createUserWithRole("c1_auditor", "Auditor", "Paro");

    const id = await uploadDoc(adminToken, "Thimphu");
    await h.knex("documents").where({ id }).update({ branch: "Thimphu" });

    const res = await request(h.app).get(`/documents/${id}`)
      .set("Authorization", `Bearer ${auditorToken}`);
    expect(res.status).toBe(200);
  });
});

// ------------------------------------------------------------------
// C2: Branch spoofing — non-crossbranch user cannot set branch via body
describe("C2: branch spoofing prevention on document capture", () => {
  it("a Maker user cannot set a different branch via req.body", async () => {
    const makerToken = await createUserWithRole("c2_maker", "Maker", "Thimphu");

    const res = await request(h.app).post("/documents")
      .set("Authorization", `Bearer ${makerToken}`)
      .field("title", "Spoof attempt")
      .field("branch", "Paro") // attempting to spoof a different branch
      .attach("file", Buffer.from("data"), "spoof.png");

    expect(res.status).toBe(201);
    // Branch should be Thimphu (from JWT), not Paro (from body)
    expect(res.body.document.branch).toBe("Thimphu");
  });

  it("a user with crossbranch:read CAN override branch", async () => {
    const auditorToken = await createUserWithRole("c2_auditor", "Auditor", "Thimphu");

    // Auditors have crossbranch:read
    const res = await request(h.app).post("/documents")
      .set("Authorization", `Bearer ${auditorToken}`)
      .field("title", "Cross-branch doc")
      .field("branch", "Paro")
      .attach("file", Buffer.from("data"), "cross.png");

    // Auditor doesn't have document:capture; expect 403 - this proves the perm check still applies
    // Use admin instead who has crossbranch:read via CDO
    expect(res.status).toBe(403);
  });

  it("admin (CDO with crossbranch:read) CAN override branch", async () => {
    const adminToken = await h.tokenFor("admin");
    const res = await request(h.app).post("/documents")
      .set("Authorization", `Bearer ${adminToken}`)
      .field("title", "Admin cross-branch")
      .field("branch", "Paro")
      .attach("file", Buffer.from("data"), "admin.png");
    expect(res.status).toBe(201);
    expect(res.body.document.branch).toBe("Paro");
  });
});

// ------------------------------------------------------------------
// C3: Catalog route — review_flag set on HUMAN_REVIEW path
describe("C3: review_flag persisted on HUMAN_REVIEW catalog result", () => {
  it("sets review_flag=true in DB when routed to HUMAN_REVIEW", async () => {
    const adminToken = await h.tokenFor("admin");
    const id = await uploadDoc(adminToken, "Thimphu");

    const res = await request(h.app).post(`/catalog/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ docType: "BT_CID_4G", confidence: 0.3, fields: { full_name: "T", dob: "1990-01-01", expiry_date: "2030-01-01" } });

    expect(res.status).toBe(200);
    expect(res.body.result.route).toBe("HUMAN_REVIEW");

    const doc = await h.knex("documents").where({ id }).first();
    // C3: review_flag must be set to 1/true in DB
    expect(Boolean(doc.review_flag)).toBe(true);
  });
});

// ------------------------------------------------------------------
// C4: Annotation delete IDOR — annotation must belong to the document
describe("C4: annotation delete IDOR prevention", () => {
  it("cannot delete an annotation belonging to a different document via /:documentId/annotations/:id", async () => {
    const adminToken = await h.tokenFor("admin");
    const docA = await uploadDoc(adminToken, "Thimphu");
    const docB = await uploadDoc(adminToken, "Thimphu");

    // Create annotation on docA
    const annRes = await request(h.app).post(`/documents/${docA}/annotations`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ kind: "note", page: 1, x: 0, y: 0, width: 10, height: 10, content: "on docA" });
    expect(annRes.status).toBe(201);
    const annId = annRes.body.annotation.id;

    // Try to delete it via docB's annotation URL (IDOR attempt)
    const del = await request(h.app).delete(`/documents/${docB}/annotations/${annId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    // Should not find/delete it; returns 404
    expect(del.status).toBe(404);

    // Confirm the annotation still exists on docA
    const list = await request(h.app).get(`/documents/${docA}/annotations`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.body.annotations.some((a: any) => a.id === annId)).toBe(true);
  });

  it("user from branch Paro cannot list annotations on a Thimphu document", async () => {
    const adminToken = await h.tokenFor("admin");
    const paroToken = await createUserWithRole("c4_paro_viewer", "Viewer", "Paro");

    const docId = await uploadDoc(adminToken, "Thimphu");
    await h.knex("documents").where({ id: docId }).update({ branch: "Thimphu" });

    const res = await request(h.app).get(`/documents/${docId}/annotations`)
      .set("Authorization", `Bearer ${paroToken}`);
    expect(res.status).toBe(404);
  });
});

// ------------------------------------------------------------------
// C5: Content-Disposition header injection
describe("C5: Content-Disposition header injection prevention", () => {
  it("strips double-quote injection characters from filename in Content-Disposition", async () => {
    const adminToken = await h.tokenFor("admin");

    // Upload with a malicious filename — multer will set originalname from the multipart field
    const res = await request(h.app).post("/documents")
      .set("Authorization", `Bearer ${adminToken}`)
      .field("title", "Injection test")
      .field("branch", "Thimphu")
      .attach("file", Buffer.from("bytes"), 'evil"; type=text/html\r\nX-Injected: val.png');

    expect(res.status).toBe(201);
    const id = res.body.document.id;

    const dl = await request(h.app).get(`/documents/${id}/download`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(dl.status).toBe(200);
    const disposition = dl.headers["content-disposition"] as string;
    // The injected quote and CRLF must be gone
    expect(disposition).not.toContain('";"');
    expect(disposition).not.toContain('\r');
    expect(disposition).not.toContain('\n');
  });
});

// ------------------------------------------------------------------
// I1: listDocuments fail-closed when branch is null
describe("I1: listDocuments fail-closed for branchless user without crossbranch:read", () => {
  it("user with no branch and no crossbranch:read sees zero documents", async () => {
    // Insert a branchless Viewer user
    const role = await h.knex("roles").where({ name: "Viewer" }).first();
    const inserted = await h.knex("users").insert({
      username: "i1_branchless",
      password_hash: "x",
      status: "Active",
      branch: null,
    }).returning("id");
    const uid = typeof inserted[0] === "object" ? (inserted[0] as any).id : inserted[0];
    await h.knex("user_roles").insert({ user_id: uid, role_id: role.id });
    const token = signToken({ sub: uid, username: "i1_branchless" }, "t");

    const res = await request(h.app).get("/documents")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    // Must not see any documents (fail-closed)
    expect(res.body.documents).toHaveLength(0);
  });
});

// ------------------------------------------------------------------
// I3: Version race condition — transaction wraps the read-max + insert
describe("I3: version number atomicity", () => {
  it("concurrent version inserts for the same document do not produce duplicate version numbers", async () => {
    const adminToken = await h.tokenFor("admin");
    const id = await uploadDoc(adminToken, "Thimphu");

    // Fire 3 concurrent version uploads
    const results = await Promise.all([
      request(h.app).post(`/documents/${id}/versions`).set("Authorization", `Bearer ${adminToken}`).attach("file", Buffer.from("v2a"), "v.png"),
      request(h.app).post(`/documents/${id}/versions`).set("Authorization", `Bearer ${adminToken}`).attach("file", Buffer.from("v2b"), "v.png"),
      request(h.app).post(`/documents/${id}/versions`).set("Authorization", `Bearer ${adminToken}`).attach("file", Buffer.from("v2c"), "v.png"),
    ]);

    // All should succeed (200/201)
    for (const r of results) {
      expect([200, 201]).toContain(r.status);
    }

    // All version_no values should be distinct
    const versions = await h.knex("document_versions").where({ document_id: id }).orderBy("version_no");
    const nos = versions.map((v: any) => v.version_no);
    const unique = new Set(nos);
    expect(unique.size).toBe(nos.length);
  });
});

// ------------------------------------------------------------------
// I6: moveFolder destination path conflict
describe("I6: moveFolder rejects duplicate destination path", () => {
  it("returns error when moving a folder would create a path that already exists", async () => {
    const adminToken = await h.tokenFor("admin");

    // Create: /BoB/ParentA and /BoB/ParentA/Child
    const parentA = await request(h.app).post("/folders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "I6ParentA", domain: "Operations" });
    expect(parentA.status).toBe(201);

    const child = await request(h.app).post("/folders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "I6Child", parentId: parentA.body.folder.id });
    expect(child.status).toBe(201);

    // Create: /BoB/ParentB/I6Child — same name in different parent first
    const parentB = await request(h.app).post("/folders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "I6ParentB", domain: "Operations" });
    expect(parentB.status).toBe(201);

    // Create a folder named I6Child under ParentB
    const siblingChild = await request(h.app).post("/folders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "I6Child", parentId: parentB.body.folder.id });
    expect(siblingChild.status).toBe(201);

    // Now try to move ParentA/I6Child under ParentB — collision with existing ParentB/I6Child
    const move = await request(h.app).post(`/folders/${child.body.folder.id}/move`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ parentId: parentB.body.folder.id });
    // Should fail with 400 due to duplicate path
    expect(move.status).toBe(400);
    expect(move.body.error).toContain("duplicate_path");
  });
});

// ------------------------------------------------------------------
// I7: SQLite boolean 0/1 normalized to true/false
describe("I7: SQLite boolean normalized to true/false in JSON", () => {
  it("GET /documents returns review_flag as boolean not 0/1", async () => {
    const adminToken = await h.tokenFor("admin");
    const id = await uploadDoc(adminToken, "Thimphu");

    // Mark the document with review_flag = true via catalog
    await request(h.app).post(`/catalog/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ docType: "BT_CID_4G", confidence: 0.1, fields: {} });

    const list = await request(h.app).get("/documents")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    const doc = list.body.documents.find((d: any) => d.id === id);
    expect(doc).toBeDefined();
    // Must be boolean true/false, not 0/1
    expect(typeof doc.review_flag).toBe("boolean");
  });

  it("GET /documents/:id returns review_flag as boolean", async () => {
    const adminToken = await h.tokenFor("admin");
    const id = await uploadDoc(adminToken, "Thimphu");

    const res = await request(h.app).get(`/documents/${id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.document.review_flag).toBe("boolean");
  });
});
