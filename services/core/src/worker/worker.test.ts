/**
 * P8 worker + async-extract integration tests (sqlite).
 *
 * Covers: the "extract" job handler runs the EXISTING extraction pipeline;
 * the worker tick claims+runs+completes a job; async extract (?async=true and
 * /extract-async) returns 202 + a job; bulk ingestion enqueues async jobs;
 * GET /jobs/:id and the admin monitor GET /jobs.
 */
import { describe, it, expect, afterAll, vi, afterEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";

vi.mock("../ai/client.js", () => ({
  aiClassify: vi.fn(),
  aiExtract: vi.fn(),
  aiProcess: vi.fn(),
}));
vi.mock("../workflow/client.js", () => ({
  createWorkflowCase: vi.fn(),
  resolveDefaultTemplateId: vi.fn(),
  DEFAULT_REVIEW_TEMPLATE_NAME: "KYC & Account Opening",
}));

import { aiClassify, aiExtract } from "../ai/client.js";
const mockClassify = aiClassify as ReturnType<typeof vi.fn>;
const mockExtract = aiExtract as ReturnType<typeof vi.fn>;

import { createWorker } from "./index.js";
import { extractHandler } from "./handlers.js";
import { enqueue, getJob } from "../queue/index.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });
afterEach(() => { vi.clearAllMocks(); });

async function upload(token: string, branch = "Thimphu"): Promise<string> {
  const res = await request(h.app)
    .post("/documents")
    .set("Authorization", `Bearer ${token}`)
    .field("title", "Test CID")
    .field("branch", branch)
    .attach("file", Buffer.from("mock-file-bytes"), "cid.png");
  expect(res.status).toBe(201);
  return res.body.document.id as string;
}

function mockCidExtraction(): void {
  mockClassify.mockResolvedValue({ doc_type: "BT_CID_4G", confidence: 0.97 });
  mockExtract.mockResolvedValue({
    data: { cid_no: "11504000231", full_name: "Dorji Wangchuk", dob: "1985-03-12", expiry_date: "2030-01-01", issue_date: "2021-04-01", dzongkhag: "Thimphu", sex: "M" },
    partial: false,
    errors: [],
  });
}

describe("extract job handler", () => {
  it("runs the existing extraction pipeline on a document", async () => {
    const token = await h.tokenFor("admin");
    const docId = await upload(token);
    mockCidExtraction();

    const result = await extractHandler({ docId, bearer: "", callerUsername: "admin" }, {
      knex: h.knex, config: (h as any).config ?? undefined, storage: h.storage, events: h.events,
    } as any);

    expect((result as any).docId).toBe(docId);
    expect((result as any).docType).toBe("BT_CID_4G");

    const dbDoc = await h.knex("documents").where({ id: docId }).first();
    expect(dbDoc.doc_type).toBe("BT_CID_4G");
    expect(dbDoc.cid).toBe("11504000231");
    expect(dbDoc.extraction_status).toBe("DONE");
  });
});

describe("worker tick", () => {
  it("claims, runs and completes an enqueued extract job", async () => {
    const token = await h.tokenFor("admin");
    const docId = await upload(token);
    mockCidExtraction();

    const deps = { knex: h.knex, storage: h.storage, events: h.events, config: {} } as any;
    const job = await enqueue(h.knex, "extract", { docId, bearer: "", callerUsername: "admin" });

    const worker = createWorker(deps, { concurrency: 1 });
    const processed = await worker.tick();
    expect(processed).toBe(1);

    const done = await getJob(h.knex, job.id);
    expect(done?.status).toBe("succeeded");
    expect((done?.result as any).docType).toBe("BT_CID_4G");

    const dbDoc = await h.knex("documents").where({ id: docId }).first();
    expect(dbDoc.extraction_status).toBe("DONE");
  });

  it("fails a job whose document does not exist (terminal handler error → retry path)", async () => {
    const deps = { knex: h.knex, storage: h.storage, events: h.events, config: {} } as any;
    const job = await enqueue(h.knex, "extract", { docId: "018f0000-0000-7000-0000-000000000000" }, { maxAttempts: 1 });
    const worker = createWorker(deps, { concurrency: 1 });
    await worker.tick();
    const after = await getJob(h.knex, job.id);
    // maxAttempts=1 → first failure dead-letters.
    expect(after?.status).toBe("dead");
    expect(after?.lastError).toContain("extract_not_found");
  });
});

describe("POST /documents/:id/extract { async:true }", () => {
  it("returns 202 with a queued job and sets extraction_status=QUEUED", async () => {
    const token = await h.tokenFor("admin");
    const docId = await upload(token);

    const res = await request(h.app)
      .post(`/documents/${docId}/extract`)
      .set("Authorization", `Bearer ${token}`)
      .send({ async: true });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe("queued");
    expect(res.body.jobId).toBeTruthy();

    const job = await getJob(h.knex, res.body.jobId);
    expect(job?.type).toBe("extract");
    expect((job?.payload as any).docId).toBe(docId);

    const dbDoc = await h.knex("documents").where({ id: docId }).first();
    expect(dbDoc.extraction_status).toBe("QUEUED");
  });

  it("is idempotent — a second async extract returns the SAME job", async () => {
    const token = await h.tokenFor("admin");
    const docId = await upload(token);

    const a = await request(h.app).post(`/documents/${docId}/extract`).set("Authorization", `Bearer ${token}`).send({ async: true });
    const b = await request(h.app).post(`/documents/${docId}/extract-async`).set("Authorization", `Bearer ${token}`).send({});
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(b.body.jobId).toBe(a.body.jobId);

    const count = await h.knex("jobs").where({ idempotency_key: `extract:${docId}` }).count<{ c: number }[]>("* as c");
    expect(Number(count[0].c)).toBe(1);
  });

  it("404s async extract for a document the caller cannot see", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .post(`/documents/018f0000-0000-7000-0000-000000000000/extract-async`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(404);
  });
});

describe("POST /documents/bulk", () => {
  it("captures many files and enqueues an async extract job per doc (202)", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .post("/documents/bulk")
      .set("Authorization", `Bearer ${token}`)
      .field("branch", "Thimphu")
      .attach("files", Buffer.from("a"), "a.png")
      .attach("files", Buffer.from("b"), "b.png");

    expect(res.status).toBe(202);
    expect(res.body.count).toBe(2);
    expect(res.body.status).toBe("queued");
    for (const item of res.body.items) {
      const job = await getJob(h.knex, item.jobId);
      expect(job?.type).toBe("extract");
      const doc = await h.knex("documents").where({ id: item.docId }).first();
      expect(doc.extraction_status).toBe("QUEUED");
      expect(doc.source_channel).toBe("BULK");
    }
  });
});

describe("GET /jobs/:id and GET /jobs (monitor)", () => {
  it("GET /jobs/:id returns status/attempts/result/last_error", async () => {
    const token = await h.tokenFor("admin");
    const job = await enqueue(h.knex, "extract", { docId: "x" });
    const res = await request(h.app).get(`/jobs/${job.id}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("queued");
    expect(res.body.attempts).toBe(0);
    expect(res.body).toHaveProperty("result");
    expect(res.body).toHaveProperty("last_error");
  });

  it("GET /jobs/:id returns 404 for unknown job", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app).get(`/jobs/does-not-exist`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("GET /jobs requires admin and returns counts + jobs", async () => {
    const token = await h.tokenFor("admin");
    await enqueue(h.knex, "extract", { a: 1 });
    const res = await request(h.app).get(`/jobs?type=extract`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("counts");
    expect(Array.isArray(res.body.jobs)).toBe(true);
  });

  it("GET /jobs is 401 without auth", async () => {
    const res = await request(h.app).get(`/jobs`);
    expect(res.status).toBe(401);
  });
});
