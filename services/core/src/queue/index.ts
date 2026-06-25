import type { Knex } from "knex";
import { newId } from "@zordms/db";

/**
 * P8 — Durable, DB-backed job queue (portable: sqlite dev / pg / oracle prod).
 *
 * Design goals:
 *  - DURABILITY: enqueue persists the payload before anything runs. A job that
 *    has been accepted survives a process crash.
 *  - IDEMPOTENCY: enqueue with an idempotency_key returns the existing job
 *    instead of creating a duplicate → no double-work (e.g. extracting a doc
 *    twice).
 *  - ATOMIC CLAIM: claimNext() uses a guarded UPDATE ... WHERE so two concurrent
 *    workers never grab the same job (safe on sqlite). On pg/oracle the same
 *    guarded UPDATE is correct; SELECT .. FOR UPDATE SKIP LOCKED is an available
 *    optimization (see claimNext notes).
 *  - RETRY + DEAD-LETTER: fail() retries with exponential backoff until
 *    max_attempts, then marks the job `dead` (dead-letter queue).
 *  - CRASH RECOVERY: reapStuck() re-queues jobs whose worker died while holding
 *    the lease (locked_at older than the visibility timeout).
 */

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "dead";

export interface JobRow {
  id: string;
  type: string;
  payload: string; // JSON text
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  available_at: string;
  locked_by: string | null;
  locked_at: string | null;
  idempotency_key: string | null;
  last_error: string | null;
  result: string | null; // JSON text
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface Job<P = unknown> {
  id: string;
  type: string;
  payload: P;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  availableAt: string;
  lockedBy: string | null;
  lockedAt: string | null;
  idempotencyKey: string | null;
  lastError: string | null;
  result: unknown;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface EnqueueOptions {
  idempotencyKey?: string;
  maxAttempts?: number;
  priority?: number;
  delayMs?: number;
}

/** Exponential-backoff base (ms). available_at = now + base * 2^attempts. */
export const DEFAULT_BACKOFF_BASE_MS = Number(process.env.QUEUE_BACKOFF_BASE_MS ?? 1000);
/** Visibility timeout (ms): a running job whose lock is older than this is
 *  considered abandoned (worker crash) and is re-queued by reapStuck(). */
export const DEFAULT_VISIBILITY_TIMEOUT_MS = Number(process.env.QUEUE_VISIBILITY_TIMEOUT_MS ?? 60_000);

function nowMs(): number {
  return Date.now();
}

/** ISO timestamp `now + offsetMs`, in a form sqlite/pg/oracle all compare correctly. */
function isoAt(offsetMs = 0): string {
  return new Date(nowMs() + offsetMs).toISOString();
}

function parseJson(text: string | null): unknown {
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function toJob<P = unknown>(row: JobRow): Job<P> {
  return {
    id: row.id,
    type: row.type,
    payload: parseJson(row.payload) as P,
    status: row.status,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    availableAt: row.available_at,
    lockedBy: row.locked_by ?? null,
    lockedAt: row.locked_at ?? null,
    idempotencyKey: row.idempotency_key ?? null,
    lastError: row.last_error ?? null,
    result: parseJson(row.result),
    priority: Number(row.priority),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Enqueue a job. Persists the payload immediately (durability). If
 * `idempotencyKey` is supplied and a job with that key already exists, the
 * EXISTING job is returned unchanged (idempotent → no duplicate / no rework).
 */
export async function enqueue<P = unknown>(
  knex: Knex,
  type: string,
  payload: P,
  opts: EnqueueOptions = {},
): Promise<Job<P>> {
  const idempotencyKey = opts.idempotencyKey ?? null;

  // Idempotency fast-path: return the existing job if the key is already used.
  if (idempotencyKey) {
    const existing = await knex<JobRow>("jobs").where({ idempotency_key: idempotencyKey }).first();
    if (existing) return toJob<P>(existing);
  }

  const row = {
    id: newId(),
    type,
    payload: JSON.stringify(payload ?? null),
    status: "queued" as JobStatus,
    attempts: 0,
    max_attempts: opts.maxAttempts ?? 5,
    available_at: isoAt(opts.delayMs ?? 0),
    locked_by: null as string | null,
    locked_at: null as string | null,
    idempotency_key: idempotencyKey,
    last_error: null as string | null,
    result: null as string | null,
    priority: opts.priority ?? 0,
    created_at: isoAt(),
    updated_at: isoAt(),
  };

  try {
    await knex("jobs").insert(row);
  } catch (err: unknown) {
    // Lost an enqueue race on the unique idempotency_key → return the winner.
    if (idempotencyKey) {
      const existing = await knex<JobRow>("jobs").where({ idempotency_key: idempotencyKey }).first();
      if (existing) return toJob<P>(existing);
    }
    throw err;
  }

  return toJob<P>(row as unknown as JobRow);
}

/**
 * Atomically claim ONE due job (status=queued AND available_at<=now), setting
 * it to `running` with locked_by/locked_at. Returns the claimed job or null.
 *
 * Concurrency safety: we read a candidate id, then run a GUARDED UPDATE that
 * only succeeds while the row is still `queued`. The update reports affected
 * rows, so if two workers race for the same candidate only one update matches
 * and the loser retries with the next candidate. This is correct on sqlite
 * (which lacks SKIP LOCKED) and on pg/oracle.
 *
 * NOTE (pg/oracle): a higher-throughput variant is
 *   SELECT id FROM jobs WHERE status='queued' AND available_at<=now
 *     ORDER BY priority DESC, available_at ASC FOR UPDATE SKIP LOCKED LIMIT 1
 * inside a transaction, then UPDATE that id. The guarded-UPDATE approach below
 * is portable and used everywhere for a single, easily-tested code path.
 */
export async function claimNext(knex: Knex, workerId: string): Promise<Job | null> {
  // Bounded retry across candidates to tolerate lost races under contention.
  for (let i = 0; i < 25; i++) {
    const now = isoAt();
    const candidate = await knex<JobRow>("jobs")
      .where({ status: "queued" })
      .andWhere("available_at", "<=", now)
      .orderBy([
        { column: "priority", order: "desc" },
        { column: "available_at", order: "asc" },
        { column: "created_at", order: "asc" },
      ])
      .first();

    if (!candidate) return null;

    // Guarded claim: only flips the row if it is STILL queued (atomic per-row).
    const affected = await knex("jobs")
      .where({ id: candidate.id, status: "queued" })
      .update({
        status: "running",
        locked_by: workerId,
        locked_at: isoAt(),
        updated_at: isoAt(),
      });

    if (affected === 1) {
      const claimed = await knex<JobRow>("jobs").where({ id: candidate.id }).first();
      return claimed ? toJob(claimed) : null;
    }
    // Lost the race for this candidate — try the next one.
  }
  return null;
}

/** Mark a running job succeeded and store its result (JSON). */
export async function complete(knex: Knex, id: string, result: unknown): Promise<void> {
  await knex("jobs").where({ id }).update({
    status: "succeeded",
    result: JSON.stringify(result ?? null),
    last_error: null,
    locked_by: null,
    locked_at: null,
    updated_at: isoAt(),
  });
}

export interface FailOptions {
  /** Exponential-backoff base (ms). Defaults to DEFAULT_BACKOFF_BASE_MS. */
  backoffBaseMs?: number;
}

/**
 * Mark a job failed. If attempts < max_attempts it is re-queued with EXPONENTIAL
 * BACKOFF (available_at = now + base * 2^attempts); otherwise it is moved to the
 * dead-letter state (`dead`). Returns the resulting status.
 */
export async function fail(
  knex: Knex,
  id: string,
  error: unknown,
  opts: FailOptions = {},
): Promise<JobStatus> {
  const base = opts.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
  const row = await knex<JobRow>("jobs").where({ id }).first();
  if (!row) return "failed";

  const attempts = Number(row.attempts) + 1; // this run counts as an attempt
  const maxAttempts = Number(row.max_attempts);
  const message = error instanceof Error ? error.message : String(error);

  if (attempts < maxAttempts) {
    // Retry: backoff grows as base * 2^attempts (attempts already incremented).
    const delay = base * Math.pow(2, attempts);
    await knex("jobs").where({ id }).update({
      status: "queued",
      attempts,
      last_error: message,
      available_at: isoAt(delay),
      locked_by: null,
      locked_at: null,
      updated_at: isoAt(),
    });
    return "queued";
  }

  // Exhausted retries → dead-letter.
  await knex("jobs").where({ id }).update({
    status: "dead",
    attempts,
    last_error: message,
    locked_by: null,
    locked_at: null,
    updated_at: isoAt(),
  });
  return "dead";
}

/**
 * CRASH RECOVERY: re-queue jobs stuck in `running` whose lease is older than the
 * visibility timeout (the worker holding them likely died). Returns the number
 * of jobs reaped. Does NOT increment attempts beyond max — a reaped job that has
 * already exhausted attempts is dead-lettered instead of re-queued.
 */
export async function reapStuck(
  knex: Knex,
  visibilityTimeoutMs: number = DEFAULT_VISIBILITY_TIMEOUT_MS,
): Promise<number> {
  const cutoff = isoAt(-visibilityTimeoutMs);
  const stuck = await knex<JobRow>("jobs")
    .where({ status: "running" })
    .andWhere("locked_at", "<=", cutoff);

  let reaped = 0;
  for (const row of stuck) {
    const attempts = Number(row.attempts) + 1;
    const maxAttempts = Number(row.max_attempts);
    const base = {
      last_error: "reaped: worker lease expired (visibility timeout)",
      attempts,
      locked_by: null as string | null,
      locked_at: null as string | null,
      updated_at: isoAt(),
    };
    if (attempts < maxAttempts) {
      const affected = await knex("jobs")
        .where({ id: row.id, status: "running" })
        .update({ ...base, status: "queued", available_at: isoAt() });
      reaped += affected;
    } else {
      const affected = await knex("jobs")
        .where({ id: row.id, status: "running" })
        .update({ ...base, status: "dead" });
      reaped += affected;
    }
  }
  return reaped;
}

/** Fetch a single job by id (decoded). */
export async function getJob(knex: Knex, id: string): Promise<Job | null> {
  const row = await knex<JobRow>("jobs").where({ id }).first();
  return row ? toJob(row) : null;
}

export interface ListJobsFilter {
  status?: JobStatus;
  type?: string;
  limit?: number;
}

/** List recent jobs (admin monitor), optionally filtered by status/type. */
export async function listJobs(knex: Knex, filter: ListJobsFilter = {}): Promise<Job[]> {
  const q = knex<JobRow>("jobs");
  if (filter.status) q.where({ status: filter.status });
  if (filter.type) q.where({ type: filter.type });
  const rows = await q.orderBy("created_at", "desc").limit(filter.limit ?? 50);
  return rows.map((r) => toJob(r));
}

/** Counts grouped by status (for the monitor dashboard). */
export async function jobCounts(knex: Knex): Promise<Record<string, number>> {
  const rows = await knex("jobs").select("status").count<{ status: string; c: number | string }[]>(
    "* as c",
  ).groupBy("status");
  const out: Record<string, number> = {};
  for (const r of rows as Array<{ status: string; c: number | string }>) {
    out[r.status] = Number(r.c);
  }
  return out;
}
