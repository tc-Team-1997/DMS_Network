import { describe, it, expect, afterAll } from "vitest";
import { makeTestApp } from "../testutil.js";
import { captureDocument } from "./documents.js";
import { createAnnotation, listAnnotations, deleteAnnotation } from "./annotations.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

async function doc(): Promise<number> {
  const d = await captureDocument({ knex: h.knex, storage: h.storage, events: h.events },
    { title: "A", filename: "a.png", mimeType: "image/png", buffer: Buffer.from("a"), branch: "Thimphu", ingestUserId: "admin" });
  return d.id;
}

describe("annotations repo", () => {
  it("creates note, redaction, and stamp annotations and lists them", async () => {
    const id = await doc();
    await createAnnotation(h.knex, id, { kind: "note", page: 1, x: 10, y: 20, width: 100, height: 40, content: "Check this", createdBy: "admin" });
    await createAnnotation(h.knex, id, { kind: "redaction", page: 1, x: 50, y: 60, width: 80, height: 20, createdBy: "admin" });
    await createAnnotation(h.knex, id, { kind: "stamp", page: 2, x: 0, y: 0, width: 120, height: 60, content: "APPROVED", createdBy: "admin" });
    const list = await listAnnotations(h.knex, id);
    expect(list.map((a) => a.kind).sort()).toEqual(["note", "redaction", "stamp"]);
    const redaction = list.find((a) => a.kind === "redaction")!;
    expect(redaction.x).toBe(50);
    expect(redaction.width).toBe(80);
  });

  it("rejects an unknown annotation kind", async () => {
    const id = await doc();
    await expect(createAnnotation(h.knex, id, { kind: "scribble" as any, page: 1, x: 0, y: 0, width: 1, height: 1 })).rejects.toThrow();
  });

  it("deletes an annotation", async () => {
    const id = await doc();
    const a = await createAnnotation(h.knex, id, { kind: "highlight", page: 1, x: 1, y: 1, width: 5, height: 5 });
    await deleteAnnotation(h.knex, a.id);
    expect((await listAnnotations(h.knex, id)).find((x) => x.id === a.id)).toBeUndefined();
  });
});
