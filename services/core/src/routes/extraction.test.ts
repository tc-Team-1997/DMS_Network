/**
 * Vitest + Supertest tests for:
 *   GET  /doc-types
 *   POST /documents/:id/extract
 *
 * All AI HTTP calls are mocked via vi.mock — no network required.
 */
import { describe, it, expect, afterAll, vi, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";

// ── Mock the AI client module so no real HTTP is made ──────────────────────────
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

// ── Helper: upload a document ──────────────────────────────────────────────────

async function upload(token: string, branch = "Thimphu"): Promise<number> {
  const res = await request(h.app)
    .post("/documents")
    .set("Authorization", `Bearer ${token}`)
    .field("title", "Test CID")
    .field("branch", branch)
    .attach("file", Buffer.from("mock-file-bytes"), "cid.png");
  expect(res.status).toBe(201);
  return res.body.document.id;
}

// ── GET /doc-types ─────────────────────────────────────────────────────────────

describe("GET /doc-types", () => {
  it("returns 200 with docTypes array for authenticated user", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .get("/doc-types")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.docTypes)).toBe(true);
    expect(typeof res.body.total).toBe("number");

    // Must include at least the seeded IDP types
    const codes = res.body.docTypes.map((d: any) => d.code);
    expect(codes).toContain("BT_CID_4G");
    expect(codes).toContain("BT_PASSPORT");
    expect(codes).toContain("BOB_LOAN_APPLICATION");
  });

  it("returns 401 without auth", async () => {
    const res = await request(h.app).get("/doc-types");
    expect(res.status).toBe(401);
  });

  it("each doc type has required fields", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .get("/doc-types")
      .set("Authorization", `Bearer ${token}`);
    for (const dt of res.body.docTypes) {
      expect(dt).toHaveProperty("code");
      expect(dt).toHaveProperty("description");
      expect(dt).toHaveProperty("jurisdiction");
      expect(dt).toHaveProperty("issuer");
    }
  });
});

// ── POST /documents/:id/extract ────────────────────────────────────────────────

describe("POST /documents/:id/extract", () => {
  it("returns 401 without auth", async () => {
    const res = await request(h.app).post("/documents/1/extract");
    expect(res.status).toBe(401);
  });

  it("returns 403 when user lacks document:index permission", async () => {
    const token = await h.tokenFor("admin");
    const docId = await upload(token);

    // Create a Viewer user (document:read only — no document:index)
    const viewerRole = await h.knex("roles").where({ name: "Viewer" }).first();
    const ins = await h.knex("users")
      .insert({ username: "viewer_extr", password_hash: "x", status: "Active", branch: "Thimphu" })
      .returning("id");
    const vid = typeof ins[0] === "object" ? (ins[0] as any).id : ins[0];
    await h.knex("user_roles").insert({ user_id: vid, role_id: viewerRole.id });
    const vToken = await h.tokenFor("viewer_extr");

    const res = await request(h.app)
      .post(`/documents/${docId}/extract`)
      .set("Authorization", `Bearer ${vToken}`);
    expect(res.status).toBe(403);
  });

  it("returns 404 for non-existent document", async () => {
    const token = await h.tokenFor("admin");
    mockClassify.mockResolvedValue({ doc_type: "BT_CID_4G", confidence: 0.95 });
    mockExtract.mockResolvedValue({ data: null, errors: [], partial: false });

    const res = await request(h.app)
      .post("/documents/999999/extract")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("extracts BT_CID_4G: maps cid + sets catalog + returns 200", async () => {
    const token = await h.tokenFor("admin");
    const docId = await upload(token);

    // Mock AI responses
    mockClassify.mockResolvedValue({ doc_type: "BT_CID_4G", confidence: 0.97 });
    mockExtract.mockResolvedValue({
      doc_type: "BT_CID_4G",
      valid: true,
      review_flag: false,
      partial: false,
      errors: [],
      data: {
        cid_no: "11504000231",
        full_name: "Dorji Wangchuk",
        dob: "1985-03-12",
        expiry_date: "2030-01-01",
        issue_date: "2021-04-01",
        dzongkhag: "Thimphu",
        sex: "M",
      },
    });

    const res = await request(h.app)
      .post(`/documents/${docId}/extract`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body;

    // Top-level shape
    expect(body).toHaveProperty("document");
    expect(body).toHaveProperty("classification");
    expect(body).toHaveProperty("mappedFields");
    expect(body).toHaveProperty("catalog");
    expect(body).toHaveProperty("source");

    // Classification
    expect(body.classification.doc_type).toBe("BT_CID_4G");
    expect(body.classification.confidence).toBeCloseTo(0.97);

    // Field mapping
    expect(body.mappedFields.cid).toBe("11504000231");
    expect(body.mappedFields.mappedKeys).toContain("cid");

    // Catalog — high confidence → AUTO, KYC / Identity
    expect(body.catalog.category).toBe("KYC / Identity");
    expect(body.catalog.route).toBe("AUTO");
    expect(body.catalog.mandatoryOk).toBe(true);

    // Document persisted
    expect(body.document.doc_type).toBe("BT_CID_4G");
    expect(body.document.cid).toBe("11504000231");
    expect(body.document.extraction_status).toBe("DONE");

    // No new-type suggestion for known type with high confidence
    expect(body.suggestedNewType).toBeNull();

    // Source: came from AI
    expect(body.source).toBe("ai");

    // Verify DB was updated
    const dbDoc = await h.knex("documents").where({ id: docId }).first();
    expect(dbDoc.doc_type).toBe("BT_CID_4G");
    expect(dbDoc.cid).toBe("11504000231");
    expect(dbDoc.catalog_category).toBe("KYC / Identity");
    expect(dbDoc.extraction_status).toBe("DONE");
  });

  it("extracts BOB_LOAN_APPLICATION: maps doc_no + sets Loan & Credit catalog", async () => {
    const token = await h.tokenFor("admin");
    const docId = await upload(token);

    mockClassify.mockResolvedValue({ doc_type: "BOB_LOAN_APPLICATION", confidence: 0.92 });
    mockExtract.mockResolvedValue({
      doc_type: "BOB_LOAN_APPLICATION",
      valid: true,
      review_flag: false,
      partial: false,
      errors: [],
      data: {
        application_no: "BOB-L-2026-0099",
        applicant_cid: "11504000231",
        applicant_name: "Dorji Wangchuk",
        loan_type: "HOME",
        loan_amount: 2500000,
        branch_code: "THM-HQ",
        submission_date: "2026-05-01",
      },
    });

    const res = await request(h.app)
      .post(`/documents/${docId}/extract`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.classification.doc_type).toBe("BOB_LOAN_APPLICATION");
    expect(res.body.mappedFields.doc_no).toBe("BOB-L-2026-0099");
    expect(res.body.catalog.category).toBe("Loan & Credit");
    expect(res.body.document.extraction_status).toBe("DONE");
  });

  it("returns suggestedNewType for unknown doc type", async () => {
    const token = await h.tokenFor("admin");
    const docId = await upload(token);

    mockClassify.mockResolvedValue({ doc_type: "BHUTAN_LAND_DEED_UNKNOWN_XYZ", confidence: 0.72 });
    mockExtract.mockResolvedValue({
      doc_type: "BHUTAN_LAND_DEED_UNKNOWN_XYZ",
      valid: false,
      review_flag: true,
      partial: true,
      errors: ["schema not found"],
      data: { plot_no: "THP-LR-123", owner: "John Doe" },
    });

    const res = await request(h.app)
      .post(`/documents/${docId}/extract`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.suggestedNewType).not.toBeNull();
    expect(res.body.suggestedNewType.proposedName).toBe("BHUTAN_LAND_DEED_UNKNOWN_XYZ");
    expect(res.body.suggestedNewType.reason).toMatch(/not in the ZorDMS registry/);
    expect(Array.isArray(res.body.suggestedNewType.sampleFields)).toBe(true);
  });

  it("returns suggestedNewType when confidence is very low", async () => {
    const token = await h.tokenFor("admin");
    const docId = await upload(token);

    mockClassify.mockResolvedValue({ doc_type: "UNKNOWN", confidence: 0.1 });
    mockExtract.mockResolvedValue({ data: null, errors: [], partial: true });

    const res = await request(h.app)
      .post(`/documents/${docId}/extract`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.suggestedNewType).not.toBeNull();
    expect(res.body.classification.confidence).toBeCloseTo(0.1);
  });

  it("low confidence triggers review_flag + TENTATIVE/HUMAN_REVIEW catalog", async () => {
    const token = await h.tokenFor("admin");
    const docId = await upload(token);

    mockClassify.mockResolvedValue({ doc_type: "BT_PASSPORT", confidence: 0.55 });
    mockExtract.mockResolvedValue({
      doc_type: "BT_PASSPORT",
      valid: false,
      review_flag: true,
      partial: true,
      errors: ["expiry_date missing"],
      data: { passport_no: "BT1234567", surname: "Test" },
    });

    const res = await request(h.app)
      .post(`/documents/${docId}/extract`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    // Low confidence → review
    expect(res.body.classification.review_flag).toBe(true);
    // Catalog: missing mandatory fields + low conf → HUMAN_REVIEW
    expect(["HUMAN_REVIEW", "TENTATIVE"]).toContain(res.body.catalog.route);

    const dbDoc = await h.knex("documents").where({ id: docId }).first();
    expect(Boolean(dbDoc.review_flag)).toBe(true);
  });

  it("degrades gracefully when AI service is unavailable (ocr-fallback)", async () => {
    const token = await h.tokenFor("admin");
    const docId = await upload(token);

    mockClassify.mockRejectedValue(new Error("ECONNREFUSED: AI service down"));

    const res = await request(h.app)
      .post(`/documents/${docId}/extract`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("ocr-fallback");
    // Falls back to existing doc_type (UNKNOWN since doc was just uploaded)
    const errors: string[] = res.body.mappedFields.errors;
    expect(errors.some((e) => e.includes("AI unavailable"))).toBe(true);
  });

  it("sets extraction_status=DONE after successful extraction", async () => {
    const token = await h.tokenFor("admin");
    const docId = await upload(token);

    mockClassify.mockResolvedValue({ doc_type: "BT_CID_4G", confidence: 0.95 });
    mockExtract.mockResolvedValue({
      data: { cid_no: "11701000504", full_name: "Pema Lhamo", dob: "1991-01-01", expiry_date: "2030-01-01", issue_date: "2022-01-01", dzongkhag: "Thimphu" },
      partial: false,
      errors: [],
    });

    await request(h.app)
      .post(`/documents/${docId}/extract`)
      .set("Authorization", `Bearer ${token}`);

    const dbDoc = await h.knex("documents").where({ id: docId }).first();
    expect(dbDoc.extraction_status).toBe("DONE");
    expect(dbDoc.extracted_at).toBeTruthy();
  });

  it("returns rawMetadata with ALL keys including unmapped ones", async () => {
    const token = await h.tokenFor("admin");
    const docId = await upload(token);

    mockClassify.mockResolvedValue({ doc_type: "BT_CID_4G", confidence: 0.97 });
    mockExtract.mockResolvedValue({
      data: {
        cid_no: "11504000231",
        full_name: "Dorji Wangchuk",
        dob: "1985-03-12",
        expiry_date: "2030-01-01",
        // unmapped keys — these are the ones being tested
        ai_internal_score: 0.97,
        raw_ocr_text: "Some OCR text the model saw",
        unusual_field_xyz: "value that has no schema mapping",
      },
      partial: false,
      errors: [],
    });

    const res = await request(h.app)
      .post(`/documents/${docId}/extract`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    // rawMetadata must be present in response
    expect(res.body).toHaveProperty("rawMetadata");
    const raw = res.body.rawMetadata as Record<string, unknown>;
    // All unmapped keys preserved
    expect(raw).toHaveProperty("ai_internal_score", 0.97);
    expect(raw).toHaveProperty("raw_ocr_text", "Some OCR text the model saw");
    expect(raw).toHaveProperty("unusual_field_xyz", "value that has no schema mapping");
    // Mapped keys also present
    expect(raw).toHaveProperty("cid_no", "11504000231");
    expect(raw).toHaveProperty("full_name", "Dorji Wangchuk");
  });

  it("persists unmapped raw keys in the metadata column", async () => {
    const token = await h.tokenFor("admin");
    const docId = await upload(token);

    mockClassify.mockResolvedValue({ doc_type: "BT_CID_4G", confidence: 0.95 });
    mockExtract.mockResolvedValue({
      data: {
        cid_no: "00000000001",
        full_name: "Test Person",
        dob: "1990-01-01",
        expiry_date: "2030-01-01",
        completely_custom_field: "preserved_value",
      },
      partial: false,
      errors: [],
    });

    await request(h.app)
      .post(`/documents/${docId}/extract`)
      .set("Authorization", `Bearer ${token}`);

    const dbDoc = await h.knex("documents").where({ id: docId }).first();
    const storedMeta = JSON.parse(dbDoc.metadata);
    // The unmapped key must survive in the DB
    expect(storedMeta).toHaveProperty("completely_custom_field", "preserved_value");
  });

  it("incomplete extraction (only partial fields) still persists what it has", async () => {
    const token = await h.tokenFor("admin");
    const docId = await upload(token);

    // AI only returns 2 of the expected fields — partial=true
    mockClassify.mockResolvedValue({ doc_type: "BT_CID_4G", confidence: 0.6 });
    mockExtract.mockResolvedValue({
      data: {
        cid_no: "22222222222",
        // missing: full_name, dob, expiry_date
      },
      partial: true,
      errors: ["Could not extract full_name", "dob not found"],
    });

    const res = await request(h.app)
      .post(`/documents/${docId}/extract`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    // Should still return rawMetadata with what was extracted
    expect(res.body.rawMetadata).toHaveProperty("cid_no", "22222222222");
    // DB should have saved partial data
    const dbDoc = await h.knex("documents").where({ id: docId }).first();
    const storedMeta = JSON.parse(dbDoc.metadata);
    expect(storedMeta).toHaveProperty("cid_no", "22222222222");
    // extraction_status should still be DONE (not FAILED) — incomplete is not a failure
    expect(dbDoc.extraction_status).toBe("DONE");
  });
});
