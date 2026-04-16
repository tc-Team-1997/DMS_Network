import { test, expect } from "@playwright/test";

test.describe("Health + auth", () => {
  test("health is ok", async ({ request }) => {
    const r = await request.get("/health");
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    expect(j.status).toBe("ok");
  });

  test("API rejects without key", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: process.env.E2E_BASE_URL || "http://localhost:8000" });
    const r = await ctx.get("/api/v1/documents");
    expect(r.status()).toBe(401);
  });

  test("token flow", async ({ request }) => {
    const r = await request.post("/api/v1/auth/token", {
      data: { username: "sara.k", password: "demo" },
    });
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    expect(j.access_token).toBeTruthy();
    expect(j.roles).toContain("maker");
  });
});

test.describe("Document lifecycle", () => {
  test("upload → list → OCR enqueue → fraud score", async ({ request }) => {
    const up = await request.post("/api/v1/documents", {
      multipart: {
        file: { name: "demo.txt", mimeType: "text/plain", buffer: Buffer.from("AHMED HASSAN demo 2032") },
        doc_type: "passport",
        customer_cid: "EGY-E2E-0001",
        uploaded_by: "e2e",
      },
    });
    expect(up.ok()).toBeTruthy();
    const doc = await up.json();
    expect(doc.id).toBeGreaterThan(0);

    const list = await request.get(`/api/v1/documents?customer_cid=EGY-E2E-0001`);
    const docs = await list.json();
    expect(docs.find((d: any) => d.id === doc.id)).toBeTruthy();

    const task = await request.post("/api/v1/tasks", {
      data: { name: "ocr.process", payload: { document_id: doc.id } },
    });
    expect([200, 202]).toContain(task.status());

    const fraud = await request.get(`/api/v1/fraud/${doc.id}`);
    expect(fraud.ok()).toBeTruthy();
    const fj = await fraud.json();
    expect(["low", "medium", "high", "critical"]).toContain(fj.band);
  });

  test("SHA-256 duplicate detection", async ({ request }) => {
    const body = Buffer.from("exact-duplicate-e2e-body");
    const a = await request.post("/api/v1/documents", {
      multipart: { file: { name: "a.bin", mimeType: "application/octet-stream", buffer: body }, uploaded_by: "e2e" },
    });
    const b = await request.post("/api/v1/documents", {
      multipart: { file: { name: "b.bin", mimeType: "application/octet-stream", buffer: body }, uploaded_by: "e2e" },
    });
    const bId = (await b.json()).id;
    const scan = await request.post(`/api/v1/duplicates/${bId}/scan`);
    expect(scan.ok()).toBeTruthy();
    const matches = await scan.json();
    expect(matches.some((m: any) => m.match_type === "exact_hash")).toBeTruthy();
  });
});

test.describe("E-forms", () => {
  const formKey = `e2e_form_${Date.now()}`;

  test("upsert + validate + submit", async ({ request }) => {
    const up = await request.post("/api/v1/eforms", {
      data: {
        key: formKey,
        title: "E2E form",
        schema: {
          fields: [
            { key: "full_name", type: "string", required: true },
            { key: "dob",       type: "date",   required: true },
            { key: "income",    type: "number", min: 0 },
          ],
        },
      },
    });
    expect(up.ok()).toBeTruthy();

    const bad = await request.post(`/api/v1/eforms/${formKey}/submit`, {
      data: { data: { full_name: "" } },
    });
    expect(bad.status()).toBe(422);

    const ok = await request.post(`/api/v1/eforms/${formKey}/submit`, {
      data: { data: { full_name: "Sara K.", dob: "1990-02-15", income: 30000 } },
    });
    expect(ok.ok()).toBeTruthy();
  });
});
