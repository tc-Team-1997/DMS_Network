import type { CoreDeps } from "../deps.js";
import { scanDisposalEligibility } from "../modules/records.js";

/**
 * P9 SCHEDULED DISPOSAL JOB.
 *
 * Mirrors the workflow SLA-worker pattern (services/workflow/src/jobs/slaWorker.ts)
 * but uses a plain setInterval timer so no extra cron dependency is pulled into
 * core. On each tick it runs `scanDisposalEligibility`, which marks
 * over-retention, hold-free, not-yet-disposed documents as disposal-ELIGIBLE and
 * emits an audit/event for a human to certify. It NEVER hard-deletes.
 *
 * Interval is env-configurable via DISPOSAL_SCAN_INTERVAL_MS (default 1h).
 */
export interface DisposalScanHandle {
  stop(): void;
}

export function disposalScanIntervalMs(): number {
  const raw = Number(process.env.DISPOSAL_SCAN_INTERVAL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 60 * 60 * 1000;
}

export async function runDisposalScan(deps: CoreDeps): Promise<{ eligible: number; skipped: number }> {
  return scanDisposalEligibility(deps.knex, (type, payload) => deps.events.emit(type, payload));
}

export function startDisposalScan(deps: CoreDeps): DisposalScanHandle {
  const timer = setInterval(() => {
    void runDisposalScan(deps).catch((err) => console.error("disposal_scan_error", err));
  }, disposalScanIntervalMs());
  // Do not keep the event loop alive solely for this timer.
  if (typeof timer.unref === "function") timer.unref();
  return { stop: () => clearInterval(timer) };
}
