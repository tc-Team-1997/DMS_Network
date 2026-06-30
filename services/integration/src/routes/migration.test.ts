import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { buildServiceKnex } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { signToken } from "@zordms/auth";
import { createApp } from "../app.js";

const migrationsDir = new URL("../migrations", import.meta.url).pathname;
const seedsDir = new URL("../seeds", import.meta.url).pathname;
const db = { client: "sqlite3" as const, host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "" };
const knex = buildServiceKnex({ migrationsDir, seedsDir, db });
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv) });
let token = "";

beforeAll(async () => {
  await knex.migrate.latest();
  await knex.seed.run();
  const admin = await knex("users").where({ username: "admin" }).first();
  token = signToken({ sub: admin.id, username: "admin", roles: ["CDO"], permissions: ["integration:read", "integration:manage"] }, "t");
});
afterAll(async () => { await knex.destroy(); });

const auth = () => ({ Authorization: `Bearer ${token}` });

const MANIFEST = [
  JSON.stringify({ external_id: "K-1", title: "Old Loan File", doc_type: "BOB_LOAN_APPLICATION" }),
  JSON.stringify({ external_id: "K-2", title: "Old KYC", doc_type: "BT_CID_4G" }),
  "{ this is not valid json",                       // → failed
  JSON.stringify({ external_id: "K-3" }),            // missing title → failed
].join("\n");

describe("Krystal migration (/migration)", () => {
  it("requires auth", async () => {
    expect((await request(app).post("/migration/krystal/run").send({ manifest: "" })).status).toBe(401);
  });

  it("rejects a body with neither manifest nor records (400)", async () => {
    const res = await request(app).post("/migration/krystal/run").set(auth()).send({ dryRun: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("dry-run previews without staging (no record blocks a later real run)", async () => {
    const res = await request(app).post("/migration/krystal/run").set(auth()).send({ manifest: MANIFEST, dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ total: 4, staged: 2, failed: 2, dryRun: true });
    // dry-run rows are "previewed", not "staged"
    const staged = await knex("migration_records").where({ status: "staged" });
    expect(staged.length).toBe(0);
  });

  it("real run stages valid records and counts bad ones as failed", async () => {
    const res = await request(app).post("/migration/krystal/run").set(auth()).send({ manifest: MANIFEST });
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ total: 4, staged: 2, skipped: 0, failed: 2, dryRun: false });
    const staged = await knex("migration_records").where({ status: "staged" });
    expect(staged.map((r: any) => r.external_id).sort()).toEqual(["K-1", "K-2"]);
  });

  it("re-running is idempotent — already-staged records are skipped", async () => {
    const res = await request(app).post("/migration/krystal/run").set(auth()).send({ manifest: MANIFEST });
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ total: 4, staged: 0, skipped: 2, failed: 2 });
  });

  it("accepts inline records and lists/fetches the job", async () => {
    const run = await request(app)
      .post("/migration/krystal/run")
      .set(auth())
      .send({ records: [{ external_id: "K-9", title: "Inline doc" }] });
    expect(run.status).toBe(200);
    expect(run.body.summary.staged).toBe(1);
    const jobId = run.body.jobId;

    const list = await request(app).get("/migration/jobs").set(auth());
    expect(list.body.jobs.some((j: any) => j.id === jobId)).toBe(true);

    const detail = await request(app).get(`/migration/jobs/${jobId}`).set(auth());
    expect(detail.status).toBe(200);
    expect(detail.body.records.some((r: any) => r.external_id === "K-9" && r.status === "staged")).toBe(true);

    expect((await request(app).get("/migration/jobs/nope").set(auth())).status).toBe(404);
  });
});
