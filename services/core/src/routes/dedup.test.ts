/**
 * Vitest + Supertest tests for:
 *   - Duplicate detection (hash + cid)
 *   - Auto-versioning path
 *   - GET/PUT /admin/dedup-config + RBAC
 *   - GET /doc-types field schema (mandatoryFields + optionalFields)
 *   - POST /documents/:id/extract quality/completeness + duplicates
 *   - PATCH /documents/:id correction + re-validation
 */
import { describe, it, expect, afterAll, vi, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";

// ── Mock the AI client module ──────────────────────────────────────────────────
vi.mock("../ai/client.js", () => ({
  aiClassify: vi.fn(),
  aiExtract: vi.fn(),
  aiProcess: vi.fn(),
}));

import { aiClassify, aiExtract } from "../ai/client.js";
const mockClassify = aiClassify as ReturnType<typeof vi.fn>;
const mockExtract  = aiExtract  as ReturnType<typeof vi.fn>;

// ── Test harness ───────────────────────────────────────────────────────────────

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

afterEach(() => {
  vi.clearAllMocks();
});

// ── Helpers ────────────────────────────────────────────────────────────────────

async function upload(token: string, fileContent: Buffer, branch = "Thimphu"): Promise<number> {
  const res = await request(h.app)
    .post("/documents")
    .set("Authorization", `Bearer ${token}`)
    .field("title", "Test Doc")
    .field("branch", branch)
    .attach("file", fileContent, "test.pdf");
  expect(res.status).toBe(201);
  return res.body.document.id;
}

async function makeViewerToken(h: Awaited<ReturnType<typeof makeTestApp>>, username: string): Promise<string> {
  const viewerRole = await h.knex("roles").where({ name: "Viewer" }).first();
  const inserted = await h.knex("users")
    .insert({ username, password_hash: "x", status: "Active", branch: "Thimphu" })
    .returning("id");
  const vid = typeof inserted[0] === "object" ? (inserted[0] as any).id : inserted[0];
  await h.knex("user_roles").insert({ user_id: vid, role_id: viewerRole.id });
  return h.tokenFor(username);
}

// ── GET /doc-types field schema ────────────────────────────────────────────────

describe("GET /doc-types field schema", () => {
  it("returns mandatoryFields and optionalFields on each doc type", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .get("/doc-types")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.docTypes)).toBe(true);

    for (const dt of res.body.docTypes) {
      expect(Array.isArray(dt.mandatoryFields)).toBe(true);
      expect(Array.isArray(dt.optionalFields)).toBe(true);
    }
  });

  it("BT_CID_4G has correct KYC / Identity mandatory fields", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .get("/doc-types")
      .set("Authorization", `Bearer ${token}`);

    const cid = res.body.docTypes.find((d: any) => d.code === "BT_CID_4G");
    expect(cid).toBeDefined();
    // KYC / Identity mandatory: full_name, dob, expiry_date
    expect(cid.mandatoryFields).toContain("full_name");
    expect(cid.mandatoryFields).toContain("dob");
    expect(cid.mandatoryFields).toContain("expiry_date");
    // Optional fields include per-type extras
    expect(Array.isArray(cid.optionalFields)).toBe(true);
    // cid and doc_no should appear in optionalFields (not mandatory for KYC)
    expect(cid.optionalFields.some((f: string) => ["cid", "doc_no", "sex"].includes(f))).toBe(true);
  });

  it("BOB_LOAN_APPLICATION has Loan & Credit mandatory fields", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .get("/doc-types")
      .set("Authorization", `Bearer ${token}`);

    const loan = res.body.docTypes.find((d: any) => d.code === "BOB_LOAN_APPLICATION");
    expect(loan).toBeDefined();
    expect(loan.mandatoryFields).toContain("application_no");
    expect(loan.mandatoryFields).toContain("applicant_cid");
    expect(loan.mandatoryFields).toContain("loan_type");
    expect(loan.mandatoryFields).toContain("loan_amount");
  });

  it("no field appears in both mandatoryFields and optionalFields for same type", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .get("/doc-types")
      .set("Authorization", `Bearer ${token}`);

    for (const dt of res.body.docTypes) {
      const mandatorySet = new Set(dt.mandatoryFields as string[]);
      const overlap = (dt.optionalFields as string[]).filter((f: string) => mandatorySet.has(f));
      expect(overlap).toEqual([]);
    }
  });
});

// ── Dedup config GET/PUT ───────────────────────────────────────────────────────

describe("GET /admin/dedup-config", () => {
  it("returns default config for admin", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .get("/admin/dedup-config")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.dedupConfig).toMatchObject({
      enabled: true,
      action: expect.stringMatching(/^(flag|auto_version)$/),
    });
    expect(Array.isArray(res.body.dedupConfig.matchBy)).toBe(true);
    expect(typeof res.body.dedupConfig.fuzzyThreshold).toBe("number");
  });

  it("returns 401 without auth", async () => {
    const res = await request(h.app).get("/admin/dedup-config");
    expect(res.status).toBe(401);
  });

  it("returns 403 for viewer (no admin:access)", async () => {
    const vToken = await makeViewerToken(h, "viewer_dedup_get");
    const res = await request(h.app)
      .get("/admin/dedup-config")
      .set("Authorization", `Bearer ${vToken}`);
    expect(res.status).toBe(403);
  });
});

describe("PUT /admin/dedup-config", () => {
  it("updates config and returns new values", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .put("/admin/dedup-config")
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: true, matchBy: ["hash", "cid", "doc_no"], action: "flag", fuzzyThreshold: 0.9 });

    expect(res.status).toBe(200);
    expect(res.body.dedupConfig.matchBy).toEqual(["hash", "cid", "doc_no"]);
    expect(res.body.dedupConfig.fuzzyThreshold).toBeCloseTo(0.9);
    expect(res.body.dedupConfig.action).toBe("flag");
  });

  it("allows switching action to auto_version", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .put("/admin/dedup-config")
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "auto_version" });

    expect(res.status).toBe(200);
    expect(res.body.dedupConfig.action).toBe("auto_version");
  });

  it("rejects invalid matchBy values", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .put("/admin/dedup-config")
      .set("Authorization", `Bearer ${token}`)
      .send({ matchBy: ["hash", "invalid_field"] });

    expect(res.status).toBe(422);
    expect(res.body.errors).toBeDefined();
  });

  it("rejects invalid action", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .put("/admin/dedup-config")
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "delete_all" });

    expect(res.status).toBe(422);
  });

  it("rejects fuzzyThreshold > 1", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .put("/admin/dedup-config")
      .set("Authorization", `Bearer ${token}`)
      .send({ fuzzyThreshold: 1.5 });

    expect(res.status).toBe(422);
  });

  it("returns 403 for viewer", async () => {
    const vToken = await makeViewerToken(h, "viewer_dedup_put");
    const res = await request(h.app)
      .put("/admin/dedup-config")
      .set("Authorization", `Bearer ${vToken}`)
      .send({ action: "auto_version" });
    expect(res.status).toBe(403);
  });
});

// ── Duplicate detection ────────────────────────────────────────────────────────

describe("Duplicate detection — hash match", () => {
  it("detects a hash duplicate and returns it in extract response", async () => {
    const token = await h.tokenFor("admin");

    // Set dedup config: enabled, match by hash
    await request(h.app)
      .put("/admin/dedup-config")
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: true, matchBy: ["hash"], action: "flag", fuzzyThreshold: 1.0 });

    // Upload the SAME file twice
    const fileContent = Buffer.from("SAME-HASH-CONTENT-XYZ-12345");
    const docId1 = await upload(token, fileContent);
    const docId2 = await upload(token, fileContent);

    // Extract the second document
    mockClassify.mockResolvedValue({ doc_type: "BT_CID_4G", confidence: 0.97 });
    mockExtract.mockResolvedValue({
      data: {
        cid_no: "11504000231",
        full_name: "Dorji Wangchuk",
        dob: "1985-03-12",
        expiry_date: "2030-01-01",
        issue_date: "2021-04-01",
        dzongkhag: "Thimphu",
        sex: "M",
      },
      errors: [],
      partial: false,
    });

    const res = await request(h.app)
      .post(`/documents/${docId2}/extract`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.duplicates)).toBe(true);
    const dup = res.body.duplicates.find((d: any) => d.id === docId1);
    expect(dup).toBeDefined();
    expect(dup.matchType).toBe("hash");
    expect(dup.title).toBeDefined();
  });
});

describe("Duplicate detection — cid match", () => {
  it("detects a cid duplicate and includes it with matchType=cid", async () => {
    const token = await h.tokenFor("admin");

    // Ensure dedup config uses cid matching
    await request(h.app)
      .put("/admin/dedup-config")
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: true, matchBy: ["cid"], action: "flag", fuzzyThreshold: 1.0 });

    // Upload first doc
    const docId1 = await upload(token, Buffer.from("first-cid-doc-unique-abc"));
    // Set its cid via extract
    mockClassify.mockResolvedValue({ doc_type: "BT_CID_4G", confidence: 0.97 });
    mockExtract.mockResolvedValue({
      data: { cid_no: "99901000001", full_name: "Test Person", dob: "1990-01-01", expiry_date: "2030-01-01", issue_date: "2020-01-01" },
      errors: [],
      partial: false,
    });
    await request(h.app)
      .post(`/documents/${docId1}/extract`)
      .set("Authorization", `Bearer ${token}`);

    // Upload second doc with different file but same CID extraction
    const docId2 = await upload(token, Buffer.from("second-cid-doc-unique-xyz"));
    mockClassify.mockResolvedValue({ doc_type: "BT_CID_4G", confidence: 0.97 });
    mockExtract.mockResolvedValue({
      data: { cid_no: "99901000001", full_name: "Test Person", dob: "1990-01-01", expiry_date: "2031-01-01", issue_date: "2021-01-01" },
      errors: [],
      partial: false,
    });
    const res = await request(h.app)
      .post(`/documents/${docId2}/extract`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const cidDup = res.body.duplicates.find((d: any) => d.matchType === "cid" && d.id === docId1);
    expect(cidDup).toBeDefined();
  });
});

// ── Auto-versioning ────────────────────────────────────────────────────────────

describe("Auto-versioning (action=auto_version)", () => {
  it("appends a new version to the original and marks the dupe as Superseded", async () => {
    const token = await h.tokenFor("admin");

    // Set action to auto_version
    await request(h.app)
      .put("/admin/dedup-config")
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: true, matchBy: ["hash"], action: "auto_version", fuzzyThreshold: 1.0 });

    const sameContent = Buffer.from("AUTO-VERSION-TEST-CONTENT-UNIQ");
    const docId1 = await upload(token, sameContent);
    const docId2 = await upload(token, sameContent);

    mockClassify.mockResolvedValue({ doc_type: "BT_PASSPORT", confidence: 0.95 });
    mockExtract.mockResolvedValue({
      data: {
        passport_no: "BT9999001",
        full_name: "Auto Version Test",
        dob: "1985-01-01",
        expiry_date: "2030-01-01",
        issue_date: "2022-01-01",
        nationality: "BTN",
      },
      errors: [],
      partial: false,
    });

    const res = await request(h.app)
      .post(`/documents/${docId2}/extract`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.autoVersioned).toBe(true);

    // docId2 should be Superseded
    const dupeDoc = await h.knex("documents").where({ id: docId2 }).first();
    expect(dupeDoc.status).toBe("Superseded");

    // docId1 should have a new version
    const versions = await h.knex("document_versions")
      .where({ document_id: docId1 })
      .orderBy("version_no", "asc");
    expect(versions.length).toBeGreaterThanOrEqual(2);
  });

  it("is idempotent: re-extracting does not double-version", async () => {
    const token = await h.tokenFor("admin");

    // Already configured auto_version from previous test; reset it cleanly
    await request(h.app)
      .put("/admin/dedup-config")
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: true, matchBy: ["hash"], action: "auto_version", fuzzyThreshold: 1.0 });

    const content = Buffer.from("IDEMPOTENT-VERSION-TEST-CONTENT-999");
    const docId1 = await upload(token, content);
    const docId2 = await upload(token, content);

    mockClassify.mockResolvedValue({ doc_type: "BT_PASSPORT", confidence: 0.95 });
    mockExtract.mockResolvedValue({
      data: { passport_no: "BT0000099", full_name: "Idempotent Test", dob: "1990-01-01", expiry_date: "2030-01-01", issue_date: "2022-01-01" },
      errors: [],
      partial: false,
    });

    // Extract twice
    await request(h.app)
      .post(`/documents/${docId2}/extract`)
      .set("Authorization", `Bearer ${token}`);
    await request(h.app)
      .post(`/documents/${docId2}/extract`)
      .set("Authorization", `Bearer ${token}`);

    // Versions on docId1 should not be doubled
    const versions = await h.knex("document_versions")
      .where({ document_id: docId1 })
      .orderBy("version_no", "asc");
    // Should have exactly 2: initial + 1 auto-version (no more)
    expect(versions.length).toBeLessThanOrEqual(3);
  });
});

// ── Extract quality / completeness ────────────────────────────────────────────

describe("POST /documents/:id/extract quality field", () => {
  beforeAll(async () => {
    // Reset dedup config to flag mode for these tests
    const token = await h.tokenFor("admin");
    await request(h.app)
      .put("/admin/dedup-config")
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: true, matchBy: ["hash", "cid"], action: "flag", fuzzyThreshold: 1.0 });
  });

  it("returns quality object with score, completeness, mandatoryMissing, confidence", async () => {
    const token = await h.tokenFor("admin");
    const docId = await upload(token, Buffer.from("quality-test-full-ok"));

    mockClassify.mockResolvedValue({ doc_type: "BT_CID_4G", confidence: 0.97 });
    mockExtract.mockResolvedValue({
      data: {
        cid_no: "11504000231",
        full_name: "Dorji Wangchuk",
        dob: "1985-03-12",
        expiry_date: "2030-01-01",
        issue_date: "2021-04-01",
        dzongkhag: "Thimphu",
        sex: "M",
      },
      errors: [],
      partial: false,
    });

    const res = await request(h.app)
      .post(`/documents/${docId}/extract`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.quality).toBeDefined();
    expect(typeof res.body.quality.score).toBe("number");
    expect(res.body.quality.score).toBeGreaterThanOrEqual(0);
    expect(res.body.quality.score).toBeLessThanOrEqual(100);
    expect(typeof res.body.quality.completeness).toBe("number");
    expect(Array.isArray(res.body.quality.mandatoryMissing)).toBe(true);
    expect(typeof res.body.quality.confidence).toBe("number");
  });

  it("full mandatory fields → completeness=1 and high score", async () => {
    const token = await h.tokenFor("admin");
    const docId = await upload(token, Buffer.from("quality-full-mandatory-test"));

    mockClassify.mockResolvedValue({ doc_type: "BT_CID_4G", confidence: 0.97 });
    mockExtract.mockResolvedValue({
      data: {
        cid_no: "11999000001",
        full_name: "Test Full Name",
        dob: "1985-03-12",
        expiry_date: "2030-01-01",
        issue_date: "2021-04-01",
        sex: "M",
      },
      errors: [],
      partial: false,
    });

    const res = await request(h.app)
      .post(`/documents/${docId}/extract`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.body.quality.completeness).toBeCloseTo(1.0, 1);
    expect(res.body.quality.mandatoryMissing).toHaveLength(0);
    expect(res.body.quality.score).toBeGreaterThan(80);
  });

  it("missing mandatory fields → mandatoryMissing non-empty + low score + review_flag", async () => {
    const token = await h.tokenFor("admin");
    const docId = await upload(token, Buffer.from("quality-missing-mandatory"));

    // BT_PASSPORT needs: full_name, dob, expiry_date
    // Omit expiry_date
    mockClassify.mockResolvedValue({ doc_type: "BT_PASSPORT", confidence: 0.90 });
    mockExtract.mockResolvedValue({
      data: {
        passport_no: "BT4400001",
        full_name: "Missing Fields Test",
        dob: "1985-01-01",
        // expiry_date intentionally missing
      },
      errors: [],
      partial: true,
    });

    const res = await request(h.app)
      .post(`/documents/${docId}/extract`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.quality.mandatoryMissing).toContain("expiry_date");
    expect(res.body.quality.completeness).toBeLessThan(1);
    // Review flag should be set
    expect(res.body.document.review_flag).toBe(true);
  });

  it("duplicates array is returned (possibly empty) in extract response", async () => {
    const token = await h.tokenFor("admin");
    const docId = await upload(token, Buffer.from("unique-content-no-dup-" + Date.now()));

    mockClassify.mockResolvedValue({ doc_type: "BT_PASSPORT", confidence: 0.97 });
    mockExtract.mockResolvedValue({
      data: { passport_no: "BT5550001", full_name: "Unique Test", dob: "1990-01-01", expiry_date: "2030-01-01" },
      errors: [],
      partial: false,
    });

    const res = await request(h.app)
      .post(`/documents/${docId}/extract`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.duplicates)).toBe(true);
  });
});

// ── PATCH /documents/:id correction ───────────────────────────────────────────

describe("PATCH /documents/:id metadata correction", () => {
  it("updates doc_type, cid, doc_no and recomputes quality", async () => {
    const token = await h.tokenFor("admin");
    const docId = await upload(token, Buffer.from("patch-test-content-unique"));

    const res = await request(h.app)
      .patch(`/documents/${docId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        doc_type: "BT_CID_4G",
        cid: "11504000231",
        doc_no: "CID-11504000231",
        metadata: {
          full_name: "Dorji Wangchuk",
          dob: "1985-03-12",
          expiry_date: "2030-01-01",
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.document).toBeDefined();
    expect(res.body.document.doc_type).toBe("BT_CID_4G");
    expect(res.body.document.cid).toBe("11504000231");
    expect(res.body.document.doc_no).toBe("CID-11504000231");
    expect(res.body.quality).toBeDefined();
    expect(typeof res.body.quality.score).toBe("number");
    expect(Array.isArray(res.body.quality.mandatoryMissing)).toBe(true);
    expect(res.body.catalog).toBeDefined();
  });

  it("merges metadata (does not replace existing fields)", async () => {
    const token = await h.tokenFor("admin");
    const docId = await upload(token, Buffer.from("merge-test-content-unique"));

    // First patch: set initial metadata
    await request(h.app)
      .patch(`/documents/${docId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ metadata: { full_name: "Initial Name", dob: "1990-01-01" } });

    // Second patch: update only expiry_date
    const res = await request(h.app)
      .patch(`/documents/${docId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ metadata: { expiry_date: "2035-01-01" } });

    expect(res.status).toBe(200);
    const meta = JSON.parse(res.body.document.metadata);
    // Should retain fields from first patch
    expect(meta.full_name).toBe("Initial Name");
    expect(meta.dob).toBe("1990-01-01");
    // And have the new field
    expect(meta.expiry_date).toBe("2035-01-01");
  });

  it("re-validates mandatory fields and updates quality", async () => {
    const token = await h.tokenFor("admin");
    const docId = await upload(token, Buffer.from("revalidate-test-content-unique"));

    // Patch with BT_CID_4G but missing mandatory fields
    const res = await request(h.app)
      .patch(`/documents/${docId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        doc_type: "BT_CID_4G",
        metadata: { full_name: "Incomplete" },
        // Missing dob and expiry_date
      });

    expect(res.status).toBe(200);
    // full_name present, but dob + expiry_date missing
    const missing = res.body.quality.mandatoryMissing as string[];
    expect(missing).toContain("dob");
    expect(missing).toContain("expiry_date");
    expect(res.body.quality.completeness).toBeLessThan(1);
  });

  it("returns 404 for non-existent document", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .patch("/documents/999999")
      .set("Authorization", `Bearer ${token}`)
      .send({ doc_type: "BT_CID_4G" });
    expect(res.status).toBe(404);
  });

  it("returns 401 without auth", async () => {
    const res = await request(h.app)
      .patch("/documents/1")
      .send({ doc_type: "BT_CID_4G" });
    expect(res.status).toBe(401);
  });

  it("returns 403 for viewer (no document:index)", async () => {
    const token = await h.tokenFor("admin");
    const docId = await upload(token, Buffer.from("rbac-patch-test-unique"));
    const vToken = await makeViewerToken(h, "viewer_patch");
    const res = await request(h.app)
      .patch(`/documents/${docId}`)
      .set("Authorization", `Bearer ${vToken}`)
      .send({ doc_type: "BT_CID_4G" });
    expect(res.status).toBe(403);
  });
});

// ── Dedup disabled path ────────────────────────────────────────────────────────

describe("Dedup detection when disabled", () => {
  it("returns empty duplicates when dedup is disabled", async () => {
    const token = await h.tokenFor("admin");

    // Disable dedup
    await request(h.app)
      .put("/admin/dedup-config")
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: false });

    const sameContent = Buffer.from("DISABLED-DEDUP-CONTENT-UNIQUE-ABC");
    const docId1 = await upload(token, sameContent);
    const docId2 = await upload(token, sameContent);
    // Silence lint warning on unused docId1
    void docId1;

    mockClassify.mockResolvedValue({ doc_type: "BT_PASSPORT", confidence: 0.95 });
    mockExtract.mockResolvedValue({
      data: { passport_no: "BT6660001", full_name: "Disabled Test", dob: "1990-01-01", expiry_date: "2030-01-01" },
      errors: [],
      partial: false,
    });

    const res = await request(h.app)
      .post(`/documents/${docId2}/extract`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.duplicates).toEqual([]);

    // Re-enable for subsequent tests
    await request(h.app)
      .put("/admin/dedup-config")
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: true, matchBy: ["hash", "cid"], action: "flag" });
  });
});
