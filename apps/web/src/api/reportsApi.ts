/**
 * reportsApi.ts — Reports builder/library (§4.10) client.
 *
 * Wires the core report engine (built this session):
 *   GET    /reports/sources              — whitelisted sources + columns
 *   POST   /reports/run                  — ad-hoc group-by + measures
 *   GET    /reports/library              — saved definitions
 *   POST   /reports/library              — save a definition
 *   DELETE /reports/library/:id
 *   GET    /reports/library/:id/export   — CSV (auth'd blob download)
 */
import { http, SVC } from "./http.js";
import { getToken } from "./client.js";

const BASE = SVC.core;

export interface ReportSource { source: string; groupable: string[]; numeric: string[] }
export interface Measure { fn: "count" | "sum" | "avg" | "min" | "max"; field?: string; alias?: string }
export interface RunResult { columns: string[]; rows: Array<Record<string, unknown>> }
export interface ReportSpec { source: string; group_by?: string[]; measures?: Measure[]; filters?: Record<string, unknown> }
export interface ReportDefinition {
  id: string; name: string; description: string | null; source: string;
  groupBy: string[]; measures: Measure[]; filters: Record<string, unknown>;
  createdBy: string | null; createdAt: string | null;
}

export async function getSources(): Promise<ReportSource[]> {
  return (await http.get<{ sources: ReportSource[] }>(`${BASE}/reports/sources`)).sources ?? [];
}

export async function runReport(spec: ReportSpec): Promise<RunResult> {
  return http.post<RunResult>(`${BASE}/reports/run`, spec);
}

export async function listLibrary(): Promise<ReportDefinition[]> {
  return (await http.get<{ reports: ReportDefinition[] }>(`${BASE}/reports/library`)).reports ?? [];
}

export async function saveReport(def: ReportSpec & { name: string; description?: string }): Promise<ReportDefinition> {
  return (await http.post<{ report: ReportDefinition }>(`${BASE}/reports/library`, def)).report;
}

export async function deleteReport(id: string): Promise<void> {
  await http.delete(`${BASE}/reports/library/${encodeURIComponent(id)}`);
}

/** Download a saved report as CSV (carries the Bearer token, then triggers a blob download). */
export async function exportReport(id: string, name?: string): Promise<void> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}/reports/library/${encodeURIComponent(id)}/export`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `report-${name || id}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const reportsApi = { getSources, runReport, listLibrary, saveReport, deleteReport, exportReport };
