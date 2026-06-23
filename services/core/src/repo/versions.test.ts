import { describe, it, expect, afterAll } from "vitest";
import { makeTestApp } from "../testutil.js";
import { captureDocument } from "./documents.js";
import { addVersion, listVersions, rollback } from "./versions.js";
import { sha256 } from "../storage/hash.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

const deps = () => ({ knex: h.knex, storage: h.storage, events: h.events });

describe("versions repo", () => {
  it("adds versions and bumps current_version", async () => {
    const doc = await captureDocument(deps(), {
      title: "D", filename: "d.png", mimeType: "image/png",
      buffer: Buffer.from("v1"), branch: "Thimphu", ingestUserId: "admin",
    });
    const v2 = await addVersion(deps(), doc.id, { buffer: Buffer.from("v2"), mimeType: "image/png", createdBy: "admin", comment: "edit" });
    expect(v2.version_no).toBe(2);
    const fresh = await h.knex("documents").where({ id: doc.id }).first();
    expect(fresh.current_version).toBe(2);
    expect(fresh.file_hash_sha256).toBe(sha256(Buffer.from("v2")));
    const all = await listVersions(h.knex, doc.id);
    expect(all.map((v) => v.version_no)).toEqual([2, 1]);
  });

  it("rolls back by creating a new version equal to the target bytes", async () => {
    const doc = await captureDocument(deps(), {
      title: "R", filename: "r.png", mimeType: "image/png",
      buffer: Buffer.from("orig"), branch: "Thimphu", ingestUserId: "admin",
    });
    await addVersion(deps(), doc.id, { buffer: Buffer.from("changed"), mimeType: "image/png", createdBy: "admin" });
    const rolled = await rollback(deps(), doc.id, 1);
    expect(rolled.version_no).toBe(3);
    expect(rolled.file_hash_sha256).toBe(sha256(Buffer.from("orig")));
    const bytes = await h.storage.get(rolled.storage_key);
    expect(bytes.toString()).toBe("orig");
    const fresh = await h.knex("documents").where({ id: doc.id }).first();
    expect(fresh.current_version).toBe(3);
  });
});
