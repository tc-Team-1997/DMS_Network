import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";
import { newId } from "@zordms/db";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("GET /customers/:cid", () => {
  it("returns a 360 profile with kyc scoring", async () => {
    const token = await h.tokenFor("admin");
    await h.knex("documents").insert({
      id: newId(),
      title: "CID Doc", doc_no: "D9", doc_type: "BT_CID_4G", cid: "20098765432",
      branch: "PAR002", file_hash_sha256: "hx", status: "Active",
      source_channel: "UPLOAD", page_count: 1, file_size_bytes: 0, current_version: 1,
    });
    const res = await request(h.app).get("/customers/20098765432").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.profile.cid).toBe("20098765432");
    expect(res.body.profile.kyc.requirements.length).toBe(4);
    expect(typeof res.body.profile.kyc.completeness).toBe("number");
  });

  it("401 without a token", async () => {
    expect((await request(h.app).get("/customers/20098765432")).status).toBe(401);
  });
});
