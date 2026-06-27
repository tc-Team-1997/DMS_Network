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

export interface DedupConfig {
  enabled: boolean;
  matchBy: Array<"hash" | "cid" | "doc_no">;
  action: "flag" | "auto_version";
  fuzzyThreshold: number;
}

export interface PlatformSettings {
  defaultRetentionYears: number;
  branches: string[];
  aiConfidenceThreshold: number;
  autoFolderRouting: boolean;
}

export const systemAdministrationApi = {
  getHealth: () =>
    http.get<{ health: ServiceHealth[] }>(`${BASE}/admin/health`),

  getDrPosture: () =>
    http.get<{ dr: DrPosture }>(`${BASE}/admin/dr`),

  getSchedules: () =>
    http.get<{ schedules: ScheduleEntry[] }>(`${BASE}/admin/schedules`),

  getDedupConfig: () =>
    http.get<{ dedupConfig: DedupConfig }>(`${BASE}/admin/dedup-config`),

  putDedupConfig: (body: Partial<DedupConfig>) =>
    http.put<{ dedupConfig: DedupConfig }>(`${BASE}/admin/dedup-config`, body),

  getSettings: () =>
    http.get<{ settings: PlatformSettings }>(`${BASE}/admin/settings`),

  putSettings: (body: Partial<PlatformSettings>) =>
    http.put<{ settings: PlatformSettings }>(`${BASE}/admin/settings`, body),
};
