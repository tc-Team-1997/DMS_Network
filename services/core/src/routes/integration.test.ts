import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

// loadConfig default when INTERNAL_SERVICE_TOKEN unset.
const TOKEN = "change-me-internal";

describe("POST /integration/customer-upsert", () => {
  it("rejects without the internal token (401)", async () => {
    const res = await request(h.app).post("/integration/customer-upsert").send({ cid: "C1" });
    expect(res.status).toBe(401);
  });

  it("rejects with a wrong internal token (401)", async () => {
    const res = await request(h.app)
      .post("/integration/customer-upsert")
      .set("x-internal-token", "wrong-token")
      .send({ cid: "C1" });
    expect(res.status).toBe(401);
  });

  it("creates then idempotently updates a customer master record", async () => {
    const created = await request(h.app)
      .post("/integration/customer-upsert")
      .set("x-internal-token", TOKEN)
      .send({ cid: "20098765432", name: "Dorji", branch: "Thimphu", segment: "RETAIL", kycStatus: "VERIFIED" });
    expect(created.status).toBe(201);
    expect(created.body.change).toBe("created");

    const updated = await request(h.app)
      .post("/integration/customer-upsert")
      .set("x-internal-token", TOKEN)
      .send({ cid: "20098765432", name: "Dorji Wangchuk" });
    expect(updated.status).toBe(200);
    expect(updated.body.change).toBe("updated");

    // exactly one row (idempotent by cid), with the merged data
    const rows = await h.knex("customers").where({ cid: "20098765432" });
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe("Dorji Wangchuk");
    expect(rows[0].kyc_status).toBe("VERIFIED");
  });

  it("400 when cid missing", async () => {
    const res = await request(h.app)
      .post("/integration/customer-upsert")
      .set("x-internal-token", TOKEN)
      .send({ name: "No CID" });
    expect(res.status).toBe(400);
  });
});

describe("POST /integration/loan-intake", () => {
  it("requires the internal token (401)", async () => {
    const res = await request(h.app).post("/integration/loan-intake").send({ applicationId: "A1" });
    expect(res.status).toBe(401);
  });

  it("creates then idempotently updates a loan intake (keyed by applicationId)", async () => {
    const created = await request(h.app)
      .post("/integration/loan-intake")
      .set("x-internal-token", TOKEN)
      .send({ applicationId: "A100", cid: "C9", amount: 50000, product: "HOME" });
    expect(created.status).toBe(201);
    expect(created.body.change).toBe("created");

    const updated = await request(h.app)
      .post("/integration/loan-intake")
      .set("x-internal-token", TOKEN)
      .send({ applicationId: "A100", state: "UNDER_REVIEW" });
    expect(updated.status).toBe(200);
    expect(updated.body.change).toBe("updated");

    const rows = await h.knex("loan_intakes").where({ application_id: "A100" });
    expect(rows.length).toBe(1);
    expect(rows[0].state).toBe("UNDER_REVIEW");
    expect(rows[0].cid).toBe("C9");
  });
});
