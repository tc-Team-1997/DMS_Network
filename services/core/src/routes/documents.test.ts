import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("documents routes", () => {
  it("uploads, lists, fetches, downloads, and deletes a document", async () => {
    const token = await h.tokenFor("admin");

    const up = await request(h.app).post("/documents").set("Authorization", `Bearer ${token}`)
      .field("title", "Customer CID").field("branch", "Thimphu")
      .attach("file", Buffer.from("file-bytes-here"), "cid.png");
    expect(up.status).toBe(201);
    const id = up.body.document.id;
    expect(up.body.document.file_hash_sha256).toHaveLength(64);

    const list = await request(h.app).get("/documents").set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.documents.some((d: any) => d.id === id)).toBe(true);

    const get = await request(h.app).get(`/documents/${id}`).set("Authorization", `Bearer ${token}`);
    expect(get.status).toBe(200);

    const dl = await request(h.app).get(`/documents/${id}/download`).set("Authorization", `Bearer ${token}`);
    expect(dl.status).toBe(200);
    expect(dl.body.toString()).toBe("file-bytes-here");

    const del = await request(h.app).delete(`/documents/${id}`).set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(204);
    const after = await request(h.app).get(`/documents/${id}`).set("Authorization", `Bearer ${token}`);
    expect(after.status).toBe(404);
  });

  it("forbids delete without document:delete", async () => {
    const token = await h.tokenFor("admin");
    const up = await request(h.app).post("/documents").set("Authorization", `Bearer ${token}`)
      .field("title", "x").field("branch", "Thimphu").attach("file", Buffer.from("y"), "y.png");
    const id = up.body.document.id;

    // create a Viewer user (document:read but not document:delete)
    const viewerRole = await h.knex("roles").where({ name: "Viewer" }).first();
    const inserted = await h.knex("users").insert({ username: "v_del", password_hash: "x", status: "Active", branch: "Thimphu" }).returning("id");
    const vid = typeof inserted[0] === "object" ? (inserted[0] as any).id : inserted[0];
    await h.knex("user_roles").insert({ user_id: vid, role_id: viewerRole.id });
    const vToken = await h.tokenFor("v_del");

    const del = await request(h.app).delete(`/documents/${id}`).set("Authorization", `Bearer ${vToken}`);
    expect(del.status).toBe(403);
  });
});

describe("document versioning routes", () => {
  it("adds a version, lists versions, and rolls back", async () => {
    const h2 = await makeTestApp();
    try {
      const token = await h2.tokenFor("admin");
      const up = await request(h2.app).post("/documents").set("Authorization", `Bearer ${token}`)
        .field("title", "V").field("branch", "Thimphu").attach("file", Buffer.from("one"), "v.png");
      const id = up.body.document.id;

      const v2 = await request(h2.app).post(`/documents/${id}/versions`).set("Authorization", `Bearer ${token}`)
        .attach("file", Buffer.from("two"), "v.png");
      expect(v2.status).toBe(201);
      expect(v2.body.version.version_no).toBe(2);

      const list = await request(h2.app).get(`/documents/${id}/versions`).set("Authorization", `Bearer ${token}`);
      expect(list.body.versions.map((v: any) => v.version_no)).toEqual([2, 1]);

      const rb = await request(h2.app).post(`/documents/${id}/rollback`).set("Authorization", `Bearer ${token}`).send({ version: 1 });
      expect(rb.status).toBe(200);
      expect(rb.body.version.version_no).toBe(3);

      const dl = await request(h2.app).get(`/documents/${id}/download`).set("Authorization", `Bearer ${token}`);
      expect(dl.body.toString()).toBe("one");
    } finally { await h2.cleanup(); }
  });
});

describe("PATCH /documents/:id — raw metadata preservation", () => {
  it("PATCH keeps existing raw metadata keys that were not in the patch payload", async () => {
    const h2 = await makeTestApp();
    try {
      const token = await h2.tokenFor("admin");
      // Upload a document
      const up = await request(h2.app)
        .post("/documents")
        .set("Authorization", `Bearer ${token}`)
        .field("title", "Raw Meta Test")
        .field("branch", "Thimphu")
        .attach("file", Buffer.from("bytes"), "doc.png");
      const id = up.body.document.id;

      // Manually set metadata in DB to simulate post-extraction raw state
      await h2.knex("documents").where({ id }).update({
        metadata: JSON.stringify({
          cid_no: "99900000001",
          full_name: "Raw Person",
          ai_internal_score: 0.95,       // raw/unmapped key
          raw_ocr_text: "Original OCR",  // raw/unmapped key
        }),
        doc_type: "BT_CID_4G",
      });

      // PATCH only the full_name field
      const patch = await request(h2.app)
        .patch(`/documents/${id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          metadata: { full_name: "Corrected Person" },
        });

      expect(patch.status).toBe(200);

      // The patched doc's metadata must retain the raw keys
      const dbDoc = await h2.knex("documents").where({ id }).first();
      const meta = JSON.parse(dbDoc.metadata);
      expect(meta.full_name).toBe("Corrected Person"); // updated
      expect(meta.cid_no).toBe("99900000001");         // preserved
      expect(meta.ai_internal_score).toBe(0.95);        // raw key preserved
      expect(meta.raw_ocr_text).toBe("Original OCR"); // raw key preserved
    } finally {
      await h2.cleanup();
    }
  });
});
