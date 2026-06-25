/**
 * P8 durable queue — unit tests (sqlite).
 *
 * Covers: enqueue persistence + idempotency dedupe; atomic claimNext (two
 * concurrent claims never grab the same job); fail() retries with exponential
 * backoff then dead-letters at max_attempts; reapStuck() re-queues an
 * expired-lock (crashed-worker) job.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import knexLib, { type Knex } from "knex";
import { fileURLToPath } from "node:url";
import {
  enqueue,
  claimNext,
  complete,
  fail,
  reapStuck,
  getJob,
  listJobs,
  jobCounts,
} from "./index.js";

const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));

function makeKnex(): Knex {
  return knexLib({
    client: "sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 }, // single shared in-memory connection
  });
}

let knex: Knex;

beforeEach(async () => {
  knex = makeKnex();
  await knex.migrate.latest({ directory: migrationsDir });
});

afterEach(async () => {
  await knex.destroy();
});

describe("enqueue", () => {
  it("persists the payload immediately (durability)", async () => {
    const job = await enqueue(knex, "extract", { docId: "doc-1" });
    expect(job.id).toBeTruthy();
    expect(job.status).toBe("queued");
    expect(job.payload).toEqual({ docId: "doc-1" });

    const row = await knex("jobs").where({ id: job.id }).first();
    expect(row).toBeTruthy();
    expect(JSON.parse(row.payload)).toEqual({ docId: "doc-1" });
    expect(row.status).toBe("queued");
  });

  it("is idempotent on idempotency_key (returns existing, no duplicate)", async () => {
    const a = await enqueue(knex, "extract", { docId: "doc-1" }, { idempotencyKey: "extract:doc-1" });
    const b = await enqueue(knex, "extract", { docId: "doc-1-DUP" }, { idempotencyKey: "extract:doc-1" });

    expect(b.id).toBe(a.id);
    // The original payload wins — no rework / no overwrite.
    expect(b.payload).toEqual({ docId: "doc-1" });

    const count = await knex("jobs").where({ idempotency_key: "extract:doc-1" }).count<{ c: number }[]>("* as c");
    expect(Number(count[0].c)).toBe(1);
  });

  it("allows multiple keyless jobs (nullable key does not collide)", async () => {
    await enqueue(knex, "extract", { a: 1 });
    await enqueue(knex, "extract", { a: 2 });
    const rows = await knex("jobs").select("*");
    expect(rows.length).toBe(2);
  });

  it("honours delayMs / priority / maxAttempts", async () => {
    const job = await enqueue(knex, "extract", {}, { delayMs: 60_000, priority: 7, maxAttempts: 3 });
    expect(job.priority).toBe(7);
    expect(job.maxAttempts).toBe(3);
    expect(new Date(job.availableAt).getTime()).toBeGreaterThan(Date.now() + 50_000);
  });
});

describe("claimNext", () => {
  it("claims a due queued job and sets it running + locked", async () => {
    const job = await enqueue(knex, "extract", { docId: "x" });
    const claimed = await claimNext(knex, "w1");
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.status).toBe("running");
    expect(claimed?.lockedBy).toBe("w1");
    expect(claimed?.lockedAt).toBeTruthy();
  });

  it("does not claim a delayed (not-yet-due) job", async () => {
    await enqueue(knex, "extract", {}, { delayMs: 60_000 });
    const claimed = await claimNext(knex, "w1");
    expect(claimed).toBeNull();
  });

  it("is atomic — two concurrent claims never grab the same job", async () => {
    await enqueue(knex, "extract", { docId: "only-one" });
    const [a, b] = await Promise.all([claimNext(knex, "wA"), claimNext(knex, "wB")]);
    const claimedIds = [a, b].filter(Boolean).map((j) => j!.id);
    // Exactly one worker got the single job.
    expect(claimedIds.length).toBe(1);
  });

  it("respects priority ordering (higher priority first)", async () => {
    await enqueue(knex, "extract", { p: "low" }, { priority: 0 });
    const hi = await enqueue(knex, "extract", { p: "high" }, { priority: 10 });
    const claimed = await claimNext(knex, "w1");
    expect(claimed?.id).toBe(hi.id);
  });
});

describe("complete", () => {
  it("marks succeeded + stores result + clears lock", async () => {
    const job = await enqueue(knex, "extract", { docId: "x" });
    await claimNext(knex, "w1");
    await complete(knex, job.id, { ok: true, n: 42 });
    const got = await getJob(knex, job.id);
    expect(got?.status).toBe("succeeded");
    expect(got?.result).toEqual({ ok: true, n: 42 });
    expect(got?.lockedBy).toBeNull();
  });
});

describe("fail — retry with exponential backoff then dead-letter", () => {
  it("requeues with backoff while attempts < max, then dead-letters at max", async () => {
    const job = await enqueue(knex, "extract", { docId: "x" }, { maxAttempts: 3 });

    // Attempt 1 fails → requeued (attempts=1), backoff in the future.
    await claimNext(knex, "w1");
    let status = await fail(knex, job.id, new Error("boom-1"), { backoffBaseMs: 1000 });
    expect(status).toBe("queued");
    let row = await getJob(knex, job.id);
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toContain("boom-1");
    const after1 = new Date(row!.availableAt).getTime();
    expect(after1).toBeGreaterThan(Date.now()); // backoff = 1000*2^1 = 2000ms

    // Make it due again to claim, then fail attempt 2 → still queued (attempts=2).
    await knex("jobs").where({ id: job.id }).update({ available_at: new Date().toISOString() });
    await claimNext(knex, "w1");
    status = await fail(knex, job.id, new Error("boom-2"), { backoffBaseMs: 1000 });
    expect(status).toBe("queued");
    row = await getJob(knex, job.id);
    expect(row?.attempts).toBe(2);

    // Attempt 3 (== max_attempts) → dead-letter.
    await knex("jobs").where({ id: job.id }).update({ available_at: new Date().toISOString() });
    await claimNext(knex, "w1");
    status = await fail(knex, job.id, new Error("boom-3"), { backoffBaseMs: 1000 });
    expect(status).toBe("dead");
    row = await getJob(knex, job.id);
    expect(row?.status).toBe("dead");
    expect(row?.attempts).toBe(3);
    expect(row?.lastError).toContain("boom-3");
  });

  it("backoff grows exponentially across attempts", async () => {
    const job = await enqueue(knex, "extract", {}, { maxAttempts: 5 });
    await claimNext(knex, "w1");
    const t0 = Date.now();
    await fail(knex, job.id, "e1", { backoffBaseMs: 1000 });
    const r1 = await getJob(knex, job.id);
    const d1 = new Date(r1!.availableAt).getTime() - t0; // ~ 1000*2^1 = 2000

    await knex("jobs").where({ id: job.id }).update({ available_at: new Date().toISOString() });
    await claimNext(knex, "w1");
    const t1 = Date.now();
    await fail(knex, job.id, "e2", { backoffBaseMs: 1000 });
    const r2 = await getJob(knex, job.id);
    const d2 = new Date(r2!.availableAt).getTime() - t1; // ~ 1000*2^2 = 4000

    expect(d2).toBeGreaterThan(d1);
  });
});

describe("reapStuck — crash recovery", () => {
  it("re-queues a running job whose lock is older than the visibility timeout", async () => {
    const job = await enqueue(knex, "extract", { docId: "x" });
    await claimNext(knex, "w-dead");
    // Simulate the worker dying: backdate the lease well past the timeout.
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    await knex("jobs").where({ id: job.id }).update({ locked_at: old });

    const reaped = await reapStuck(knex, 60_000);
    expect(reaped).toBe(1);

    const row = await getJob(knex, job.id);
    expect(row?.status).toBe("queued");
    expect(row?.lockedBy).toBeNull();
    // It can be claimed again.
    const reclaimed = await claimNext(knex, "w-new");
    expect(reclaimed?.id).toBe(job.id);
  });

  it("does NOT reap a fresh running job within the visibility window", async () => {
    await enqueue(knex, "extract", {});
    await claimNext(knex, "w1");
    const reaped = await reapStuck(knex, 60_000);
    expect(reaped).toBe(0);
  });

  it("dead-letters a reaped job that has already exhausted attempts", async () => {
    const job = await enqueue(knex, "extract", {}, { maxAttempts: 1 });
    await claimNext(knex, "w-dead");
    await knex("jobs").where({ id: job.id })
      .update({ locked_at: new Date(Date.now() - 10 * 60_000).toISOString() });
    await reapStuck(knex, 60_000);
    const row = await getJob(knex, job.id);
    expect(row?.status).toBe("dead");
  });
});

describe("listJobs + jobCounts", () => {
  it("filters by status/type and counts by status", async () => {
    await enqueue(knex, "extract", { a: 1 });
    const j2 = await enqueue(knex, "extract", { a: 2 });
    await claimNext(knex, "w1"); // claims j1 (oldest)
    await claimNext(knex, "w1"); // claims j2
    await complete(knex, j2.id, { done: true });

    const counts = await jobCounts(knex);
    expect(counts.running).toBe(1);
    expect(counts.succeeded).toBe(1);

    const running = await listJobs(knex, { status: "running" });
    expect(running.every((j) => j.status === "running")).toBe(true);

    const byType = await listJobs(knex, { type: "extract" });
    expect(byType.length).toBe(2);
  });
});
