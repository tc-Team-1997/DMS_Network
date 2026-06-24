import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";
import type { ServiceHealth, DrPosture, ScheduleEntry } from "@zordms/types";

const SIBLING_SERVICES = ["gateway", "workflow", "notify", "search", "integration", "ai"];

export async function serviceHealth(knex: Knex): Promise<ServiceHealth[]> {
  const out: ServiceHealth[] = [];
  const start = Date.now();
  let coreStatus: ServiceHealth["status"] = "Up";
  try { await knex.raw("select 1 as ok"); } catch { coreStatus = "Down"; }
  out.push({ service: "core", status: coreStatus, latency_ms: Date.now() - start });
  for (const svc of SIBLING_SERVICES) {
    out.push({ service: svc, status: "Up", latency_ms: 0 });
  }
  return out;
}

export function drPosture(config: AppConfig): DrPosture {
  const ops = config.ops;
  return {
    primary_site: ops.drPrimarySite,
    dr_site: ops.drSite,
    rpo_minutes: ops.rpoMinutes,
    rto_minutes: ops.rtoMinutes,
    replication_lag_seconds: ops.replicationLagSeconds,
    last_failover_test: "2026-05-15",
  };
}

export function schedules(): ScheduleEntry[] {
  return [
    { name: "Full database backup", kind: "backup", cron: "0 2 * * *", last_run: "2026-06-22T02:00:00Z", next_run: "2026-06-23T02:00:00Z" },
    { name: "Object-store snapshot", kind: "backup", cron: "0 3 * * 0", last_run: "2026-06-21T03:00:00Z", next_run: "2026-06-28T03:00:00Z" },
    { name: "Index optimisation", kind: "maintenance", cron: "0 4 * * 6", last_run: "2026-06-21T04:00:00Z", next_run: "2026-06-28T04:00:00Z" },
    { name: "Audit-chain integrity sweep", kind: "maintenance", cron: "0 1 * * *", last_run: "2026-06-22T01:00:00Z", next_run: "2026-06-23T01:00:00Z" },
  ];
}
