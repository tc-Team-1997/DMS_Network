/**
 * Tamper-evident audit chain — writeAudit + verifyAuditChain.
 */
import { describe, it, expect, afterAll } from "vitest";
import { makeTestApp } from "../testutil.js";
import { writeAudit } from "./audit.js";
import { verifyAuditChain } from "./compliance.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("audit hash chain", () => {
  it("writeAudit stores prev_hash + row_hash and the chain verifies", async () => {
    await writeAudit(h.knex, { actorUsername: "admin", action: "TEST_A", entity: "x", entityId: "1", details: "a" });
    await writeAudit(h.knex, { actorUsername: "admin", action: "TEST_B", entity: "x", entityId: "2", details: "b" });
    await writeAudit(h.knex, { actorUsername: "admin", action: "TEST_C", entity: "x", entityId: "3", details: "c" });

    const rows = await h.knex("audit_log").select("*").orderBy([{ column: "created_at" }, { column: "id" }]);
    // Every row written by writeAudit carries a 64-char row_hash.
    const hashed = rows.filter((r: any) => r.row_hash);
    expect(hashed.length).toBeGreaterThanOrEqual(3);
    expect(hashed.every((r: any) => String(r.row_hash).length === 64)).toBe(true);
    // Each row's prev_hash equals the previous row's row_hash (contiguous chain).
    for (let i = 1; i < hashed.length; i++) {
      expect(hashed[i].prev_hash).toBe(hashed[i - 1].row_hash);
    }

    const v = await verifyAuditChain(h.knex);
    expect(v.ok).toBe(true);
    expect(v.brokenAt).toBeNull();
  });

  it("detects tampering — editing a row's details breaks the chain", async () => {
    const before = await verifyAuditChain(h.knex);
    expect(before.ok).toBe(true);

    // Tamper: mutate the details of an existing hashed row without rehashing.
    const victim = await h.knex("audit_log").whereNotNull("row_hash").orderBy("id", "asc").first();
    await h.knex("audit_log").where({ id: victim.id }).update({ details: "TAMPERED" });

    const after = await verifyAuditChain(h.knex);
    expect(after.ok).toBe(false);
    expect(after.brokenAt).not.toBeNull();
  });
});
