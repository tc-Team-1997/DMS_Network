/**
 * SystemAdministration screen API module.
 * All calls go through the /svc/core proxy (http://localhost:4001).
 */
import { http, SVC } from "./http.js";

const BASE = SVC.core;

export interface ServiceHealth {
  service: string;
  status: "Up" | "Degraded" | "Down";
  latency_ms: number;
}

export interface DrPosture {
  primary_site: string;
  dr_site: string;
  rpo_minutes: number;
  rto_minutes: number;
  replication_lag_seconds: number;
  last_failover_test?: string;
}

export interface ScheduleEntry {
  name: string;
  kind: "backup" | "maintenance";
  cron: string;
  last_run?: string;
  next_run?: string;
}

export const systemAdministrationApi = {
  getHealth: () =>
    http.get<{ health: ServiceHealth[] }>(`${BASE}/admin/health`),

  getDrPosture: () =>
    http.get<{ dr: DrPosture }>(`${BASE}/admin/dr`),

  getSchedules: () =>
    http.get<{ schedules: ScheduleEntry[] }>(`${BASE}/admin/schedules`),
};
