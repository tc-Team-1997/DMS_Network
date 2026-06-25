import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { makeTestApp } from "../testutil.js";
import { newId } from "@zordms/db";

const execFileAsync = promisify(execFile);

// Extract selectable text from PDF bytes via poppler's pdftotext.
async function pdfText(bytes: Buffer): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zordms-pdftext-"));
  try {
    const p = join(dir, "f.pdf");
    await writeFile(p, bytes);
    const { stdout } = await execFileAsync("pdftotext", [p, "-"]);
    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

async function samplePdf(text = "Top secret account 1234567890"): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([300, 400]);
  page.drawText(text, { x: 20, y: 200, size: 14, font, color: rgb(0, 0, 0) });
  return Buffer.from(await pdf.save());
}

async function samplePng(): Promise<Buffer> {
  return sharp({ create: { width: 200, height: 250, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .png().toBuffer();
}

// Helper: upload a doc with given bytes/mime and return its id.
async function upload(token: string, buf: Buffer, name: string, mime: string): Promise<string> {
  const up = await request(h.app).post("/documents").set("Authorization", `Bearer ${token}`)
    .field("title", name).field("branch", "Thimphu")
    .attach("file", buf, { filename: name, contentType: mime });
  expect(up.status).toBe(201);
  return up.body.document.id;
}

async function makeUser(role: string, username: string): Promise<string> {
  const r = await h.knex("roles").where({ name: role }).first();
  const uid = newId();
  await h.knex("users").insert({ id: uid, username, password_hash: "x", status: "Active", branch: "Thimphu" });
  await h.knex("user_roles").insert({ user_id: uid, role_id: r.id });
  return h.tokenFor(username);
}

describe("POST /documents/:id/stamp", () => {
  it("burns a stamp into a PDF as a new version (current_version++, bytes differ)", async () => {
    const token = await h.tokenFor("admin");
    const original = await samplePdf();
    const id = await upload(token, original, "deed.pdf", "application/pdf");

    const before = await h.knex("documents").where({ id }).first();
    const beforeVersionRows = await h.knex("document_versions").where({ document_id: id });
    expect(before.current_version).toBe(1);
    expect(beforeVersionRows.length).toBe(1);

    const res = await request(h.app).post(`/documents/${id}/stamp`).set("Authorization", `Bearer ${token}`)
      .send({ label: "APPROVED", by: "checker.one", date: "2026-06-23", ref: "CERT-9" });
    expect(res.status).toBe(201);
    expect(res.body.version.version_no).toBe(2);
    expect(res.body.download).toBe(`/documents/${id}/download`);

    const after = await h.knex("documents").where({ id }).first();
    expect(after.current_version).toBe(2);
    const afterVersionRows = await h.knex("document_versions").where({ document_id: id });
    expect(afterVersionRows.length).toBe(2);

    // Stored bytes differ from the original
    const v = await h.knex("document_versions").where({ document_id: id, version_no: 2 }).first();
    const newBytes = await h.storage.get(v.storage_key);
    expect(Buffer.compare(newBytes, original)).not.toBe(0);
    expect(after.file_hash_sha256).not.toBe(before.file_hash_sha256);
    // still a valid PDF, bigger than original (stamp added)
    expect(newBytes.subarray(0, 5).toString()).toBe("%PDF-");

    // event emitted
    expect(h.events.events.some((e) => e.type === "document.stamped")).toBe(true);
  });

  it("burns a stamp into an image as a new version", async () => {
    const token = await h.tokenFor("admin");
    const original = await samplePng();
    const id = await upload(token, original, "scan.png", "image/png");

    const res = await request(h.app).post(`/documents/${id}/stamp`).set("Authorization", `Bearer ${token}`)
      .send({ by: "admin" });
    expect(res.status).toBe(201);
    expect(res.body.version.version_no).toBe(2);
    const v = await h.knex("document_versions").where({ document_id: id, version_no: 2 }).first();
    const newBytes = await h.storage.get(v.storage_key);
    expect(Buffer.compare(newBytes, original)).not.toBe(0);
    // valid PNG signature
    expect(newBytes.subarray(1, 4).toString()).toBe("PNG");
  });

  it("403 without document:approve", async () => {
    const token = await h.tokenFor("admin");
    const id = await upload(token, await samplePng(), "x.png", "image/png");
    const viewer = await makeUser("Viewer", "stamp_viewer");
    const res = await request(h.app).post(`/documents/${id}/stamp`).set("Authorization", `Bearer ${viewer}`)
      .send({ by: "v" });
    expect(res.status).toBe(403);
  });

  it("404 for missing doc", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app).post(`/documents/${newId()}/stamp`).set("Authorization", `Bearer ${token}`)
      .send({ by: "admin" });
    expect(res.status).toBe(404);
  });
});

describe("POST /documents/:id/redact", () => {
  it("destructively redacts a PDF page (rasterized) as a new version", async () => {
    const token = await h.tokenFor("admin");
    const secret = "Top secret account 1234567890";
    const original = await samplePdf(secret);
    const id = await upload(token, original, "secret.pdf", "application/pdf");

    const res = await request(h.app).post(`/documents/${id}/redact`).set("Authorization", `Bearer ${token}`)
      .send({ regions: [{ page: 1, x: 0.05, y: 0.45, w: 0.9, h: 0.15 }] });
    expect(res.status).toBe(201);
    expect(res.body.version.version_no).toBe(2);
    expect(res.body.redaction.rasterized).toBe(true);
    expect(res.body.redaction.guarantee).toMatch(/destructive/);

    const after = await h.knex("documents").where({ id }).first();
    expect(after.current_version).toBe(2);
    const rows = await h.knex("document_versions").where({ document_id: id });
    expect(rows.length).toBe(2);

    const v = await h.knex("document_versions").where({ document_id: id, version_no: 2 }).first();
    const newBytes = await h.storage.get(v.storage_key);
    expect(Buffer.compare(newBytes, original)).not.toBe(0);
    // REDACTION GUARANTEE: the original PDF has selectable text; after rasterizing
    // the redacted page the text is physically gone (no selectable text layer).
    expect(await pdfText(original)).toContain("Top secret");
    expect(await pdfText(newBytes)).not.toContain("Top secret");
  });

  it("destructively redacts an image as a new version (bytes differ)", async () => {
    const token = await h.tokenFor("admin");
    const original = await samplePng();
    const id = await upload(token, original, "id.png", "image/png");

    const res = await request(h.app).post(`/documents/${id}/redact`).set("Authorization", `Bearer ${token}`)
      .send({ regions: [{ page: 1, x: 0.1, y: 0.1, w: 0.5, h: 0.2 }] });
    expect(res.status).toBe(201);
    const v = await h.knex("document_versions").where({ document_id: id, version_no: 2 }).first();
    const newBytes = await h.storage.get(v.storage_key);
    expect(Buffer.compare(newBytes, original)).not.toBe(0);
    // confirm a black pixel exists in the redacted region
    const { data, info } = await sharp(newBytes).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    expect(px(20, 30)).toEqual([0, 0, 0]);
  });

  it("400 when regions missing/empty", async () => {
    const token = await h.tokenFor("admin");
    const id = await upload(token, await samplePng(), "r.png", "image/png");
    const res = await request(h.app).post(`/documents/${id}/redact`).set("Authorization", `Bearer ${token}`)
      .send({ regions: [] });
    expect(res.status).toBe(400);
  });

  it("403 without document:write", async () => {
    const token = await h.tokenFor("admin");
    const id = await upload(token, await samplePng(), "r2.png", "image/png");
    const viewer = await makeUser("Viewer", "redact_viewer");
    const res = await request(h.app).post(`/documents/${id}/redact`).set("Authorization", `Bearer ${viewer}`)
      .send({ regions: [{ page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] });
    expect(res.status).toBe(403);
  });

  it("404 for missing doc", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app).post(`/documents/${newId()}/redact`).set("Authorization", `Bearer ${token}`)
      .send({ regions: [{ page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] });
    expect(res.status).toBe(404);
  });
});
