import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * API contract tests — hit the real ZorDMS services through the web dev-server
 * proxy (baseURL :5174 → /svc/gateway :4000, /svc/core :4001).
 *
 * The enterprise redesign moved auth to the gateway (`/auth/login`, returns
 * { token, user }), and document ids are now UUIDv7 strings (not integers).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function adminToken(request: APIRequestContext): Promise<string> {
  const r = await request.post("/svc/gateway/auth/login", {
    data: { username: "admin", password: "admin123" },
  });
  expect(r.ok()).toBeTruthy();
  const j = await r.json();
  return j.token as string;
}

test.describe("Health + auth", () => {
  test("gateway health is ok", async ({ request }) => {
    const r = await request.get("/svc/gateway/health");
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    expect(j.status).toBe("ok");
  });

  test("documents endpoint rejects without a token", async ({ request }) => {
    const r = await request.get("/svc/core/documents");
    expect(r.status()).toBe(401);
  });

  test("login flow returns a JWT and the CDO role", async ({ request }) => {
    const r = await request.post("/svc/gateway/auth/login", {
      data: { username: "admin", password: "admin123" },
    });
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    expect(j.token).toBeTruthy();
    // Admin is the Chief Data Officer in the redesign's RBAC seed.
    expect(j.user.roles).toContain("CDO");
    // The subject id is a UUIDv7.
    expect(j.user.id).toMatch(UUID_RE);
  });

  test("bad credentials are rejected", async ({ request }) => {
    const r = await request.post("/svc/gateway/auth/login", {
      data: { username: "admin", password: "nope" },
    });
    expect(r.ok()).toBeFalsy();
    expect([400, 401]).toContain(r.status());
  });
});

test.describe("Document lifecycle", () => {
  test("upload → list → fetch by id (UUID ids)", async ({ request }) => {
    const token = await adminToken(request);
    const auth = { Authorization: `Bearer ${token}` };

    const up = await request.post("/svc/core/documents", {
      headers: auth,
      multipart: {
        file: { name: "demo.txt", mimeType: "text/plain", buffer: Buffer.from("AHMED HASSAN demo 2032") },
        doc_type: "KYC_PASSPORT",
        title: "E2E lifecycle doc",
      },
    });
    expect(up.ok()).toBeTruthy();
    const { document } = await up.json();
    expect(document.id).toMatch(UUID_RE);
    expect(document.title).toBe("E2E lifecycle doc");
    // SHA-256 of the body is computed server-side.
    expect(document.file_hash_sha256).toMatch(/^[0-9a-f]{64}$/i);

    const list = await request.get("/svc/core/documents", { headers: auth });
    expect(list.ok()).toBeTruthy();
    const { documents } = await list.json();
    expect(Array.isArray(documents)).toBeTruthy();
    expect(documents.some((d: any) => d.id === document.id)).toBeTruthy();

    const one = await request.get(`/svc/core/documents/${document.id}`, { headers: auth });
    expect(one.ok()).toBeTruthy();
    const fetched = await one.json();
    expect(fetched.document.id).toBe(document.id);
  });

  test("dashboard summary returns aggregate counts", async ({ request }) => {
    const token = await adminToken(request);
    const r = await request.get("/svc/core/dashboard/summary", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    expect(typeof j.totalDocuments).toBe("number");
    expect(j.totalDocuments).toBeGreaterThan(0);
    expect(typeof j.byCategory).toBe("object");
  });
});
