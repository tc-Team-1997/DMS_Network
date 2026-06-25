import type { Knex } from "knex";

/**
 * P8: Durable, DB-backed background JOB QUEUE.
 *
 * A portable (sqlite dev / pg / oracle prod — no Redis required) durable queue
 * so the system survives heavy load without losing or re-doing work, and so
 * document EXTRACTION can move off the request path.
 *
 * Durability: enqueue PERSISTS the payload immediately; nothing is processed
 * until it is safely stored. Idempotency: idempotency_key is UNIQUE so the same
 * logical job (e.g. "extract document X") is never enqueued twice → no rework.
 * Reliability: attempts/max_attempts + exponential backoff (available_at) +
 * dead-letter (status=dead); locked_by/locked_at give crash recovery via a
 * visibility timeout (reapStuck re-queues jobs whose worker died mid-flight).
 */
export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasTable("jobs");
  if (has) return;

  await knex.schema.createTable("jobs", (t) => {
    t.string("id", 36).notNullable().primary();
    t.string("type", 80).notNullable();
    t.text("payload").notNullable(); // JSON text — portable across sqlite/pg/oracle
    // queued | running | succeeded | failed | dead
    t.string("status", 20).notNullable().defaultTo("queued");
    t.integer("attempts").notNullable().defaultTo(0);
    t.integer("max_attempts").notNullable().defaultTo(5);
    // available_at: earliest time the job may be claimed (backoff / delay).
    t.timestamp("available_at").notNullable().defaultTo(knex.fn.now());
    t.string("locked_by", 120); // worker id holding the lease (running jobs)
    t.timestamp("locked_at"); // when the lease was taken (visibility timeout base)
    t.string("idempotency_key", 200); // unique-when-present → dedupe / no rework
    t.text("last_error");
    t.text("result"); // JSON text result of a successful handler
    t.integer("priority").notNullable().defaultTo(0); // higher = sooner
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.timestamp("updated_at").defaultTo(knex.fn.now());

    // Primary claim path: due queued jobs ordered by availability.
    t.index(["status", "available_at"], "idx_jobs_status_available");
    t.unique(["idempotency_key"], { indexName: "uq_jobs_idempotency_key" });
    t.index(["type"], "idx_jobs_type");
    t.index(["locked_at"], "idx_jobs_locked_at");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("jobs");
}
