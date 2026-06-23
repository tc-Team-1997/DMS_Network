import { describe, it, expect, afterAll } from "vitest";
import { makeTestApp } from "../testutil.js";
import { captureDocument, listDocuments, getDocument, softDeleteDocument, currentVersion } from "./documents.js";
import { sha256 } from "../storage/hash.js";
import { EVENTS } from "../events/index.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("documents repo", () => {
  it("captures a document content-addressed, with v1, and emits document.captured", async () => {
    const buffer = Buffer.from("CID scan bytes");
    const doc = await captureDocument({ knex: h.knex, storage: h.storage, events: h.events },
      { title: "Customer CID", filename: "cid.png", mimeType: "image/png", buffer, branch: "Thimphu", ingestUserId: "admin" });
    expect(doc.file_hash_sha256).toBe(sha256(buffer));
    expect(doc.current_version).toBe(1);
    const v1 = await currentVersion(h.knex, doc.id);
    expect(v1!.version_no).toBe(1);
    expect(v1!.file_hash_sha256).toBe(sha256(buffer));
    expect(await h.storage.exists(v1!.storage_key)).toBe(true);
    expect(h.events.events.some((e) => e.type === EVENTS.DOCUMENT_CAPTURED)).toBe(true);
  });

  it("scopes list by branch unless crossbranch is allowed", async () => {
    await captureDocument({ knex: h.knex, storage: h.storage, events: h.events },
      { title: "Paro doc", filename: "p.png", mimeType: "image/png", buffer: Buffer.from("paro"), branch: "Paro", ingestUserId: "admin" });

    const scoped = await listDocuments(h.knex, { branch: "Thimphu", canCrossBranch: false });
    expect(scoped.every((d) => d.branch === "Thimphu")).toBe(true);

    const all = await listDocuments(h.knex, { branch: "Thimphu", canCrossBranch: true });
    expect(all.some((d) => d.branch === "Paro")).toBe(true);
  });

  it("soft-deletes a document (hidden from list, fetchable as deleted=false)", async () => {
    const doc = await captureDocument({ knex: h.knex, storage: h.storage, events: h.events },
      { title: "Temp", filename: "t.png", mimeType: "image/png", buffer: Buffer.from("temp"), branch: "Thimphu", ingestUserId: "admin" });
    await softDeleteDocument(h.knex, doc.id);
    const row = await getDocument(h.knex, doc.id);
    expect(row).toBeUndefined();
  });
});
