/**
 * P8: Durable-queue WORKER.
 *
 * A small poll loop that, on each tick:
 *   1. reaps stuck jobs (crash recovery), then
 *   2. up to `concurrency` times: claimNext() → run handler → complete()/fail().
 *
 * Started in server boot (guarded by START_WORKER / NODE_ENV so tests never
 * spawn a background loop). Knobs are env-driven for ops:
 *   QUEUE_POLL_INTERVAL_MS      poll cadence (default 1000)
 *   QUEUE_CONCURRENCY           jobs claimed per tick (default 2)
 *   QUEUE_VISIBILITY_TIMEOUT_MS lease before a running job is reaped (default 60000)
 *   QUEUE_BACKOFF_BASE_MS       exponential-backoff base on retry (default 1000)
 */
import { hostname } from "node:os";
import type { CoreDeps } from "../deps.js";
import {
  claimNext,
  complete,
  fail,
  reapStuck,
  DEFAULT_VISIBILITY_TIMEOUT_MS,
  DEFAULT_BACKOFF_BASE_MS,
  type Job,
} from "../queue/index.js";
import { defaultHandlers, type JobHandler } from "./handlers.js";

export interface WorkerOptions {
  workerId?: string;
  pollIntervalMs?: number;
  concurrency?: number;
  visibilityTimeoutMs?: number;
  backoffBaseMs?: number;
  handlers?: Record<string, JobHandler>;
}

export interface Worker {
  /** Run exactly one tick (reap + claim/run up to concurrency). Returns #processed. */
  tick(): Promise<number>;
  /** Start the poll loop. */
  start(): void;
  /** Stop the poll loop (awaits any in-flight tick). */
  stop(): Promise<void>;
}

export function createWorker(deps: CoreDeps, opts: WorkerOptions = {}): Worker {
  const workerId = opts.workerId ?? `${hostname()}#${process.pid}#${Math.random().toString(36).slice(2, 8)}`;
  const pollIntervalMs = opts.pollIntervalMs ?? Number(process.env.QUEUE_POLL_INTERVAL_MS ?? 1000);
  const concurrency = opts.concurrency ?? Number(process.env.QUEUE_CONCURRENCY ?? 2);
  const visibilityTimeoutMs = opts.visibilityTimeoutMs ?? DEFAULT_VISIBILITY_TIMEOUT_MS;
  const backoffBaseMs = opts.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
  const handlers = opts.handlers ?? defaultHandlers();

  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let inflight: Promise<unknown> | null = null;

  async function runOne(job: Job): Promise<void> {
    const handler = handlers[job.type];
    if (!handler) {
      // Unknown type — fail it (will retry/dead-letter; surfaces misconfiguration).
      await fail(deps.knex, job.id, new Error(`no_handler_for_type:${job.type}`), { backoffBaseMs });
      return;
    }
    try {
      const result = await handler(job.payload, deps);
      await complete(deps.knex, job.id, result);
    } catch (err) {
      await fail(deps.knex, job.id, err, { backoffBaseMs });
    }
  }

  async function tick(): Promise<number> {
    // 1. Crash recovery: re-queue abandoned leases first.
    try {
      await reapStuck(deps.knex, visibilityTimeoutMs);
    } catch (err) {
      console.warn(JSON.stringify({ level: "warn", msg: "queue_reap_failed", detail: String(err) }));
    }

    // 2. Claim + run up to `concurrency` due jobs this tick.
    let processed = 0;
    for (let i = 0; i < concurrency; i++) {
      let job: Job | null;
      try {
        job = await claimNext(deps.knex, workerId);
      } catch (err) {
        console.warn(JSON.stringify({ level: "warn", msg: "queue_claim_failed", detail: String(err) }));
        break;
      }
      if (!job) break;
      await runOne(job);
      processed++;
    }
    return processed;
  }

  function scheduleNext(): void {
    if (!running) return;
    timer = setTimeout(async () => {
      inflight = tick().catch((err) =>
        console.warn(JSON.stringify({ level: "warn", msg: "queue_tick_failed", detail: String(err) })),
      );
      await inflight;
      inflight = null;
      scheduleNext();
    }, pollIntervalMs);
  }

  return {
    tick,
    start() {
      if (running) return;
      running = true;
      scheduleNext();
    },
    async stop() {
      running = false;
      if (timer) { clearTimeout(timer); timer = null; }
      if (inflight) { await inflight.catch(() => {}); }
    },
  };
}
