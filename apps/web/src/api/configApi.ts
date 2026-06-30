/**
 * configApi.ts — System Configuration (§4.13 / SC-14) client.
 *
 * Wires the core service's audited key/value config store:
 *   GET /config[?category]   — list entries
 *   GET /config/:key         — read one
 *   PUT /config/:key         — upsert (audited)
 *
 * `value` is any JSON (number/boolean/string/array/object). Base path from SVC.
 */
import { http, SVC } from "./http.js";

const BASE = SVC.core;

export interface ConfigEntry {
  key: string;
  value: unknown;
  category: string | null;
  description: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

export async function listConfig(category?: string): Promise<ConfigEntry[]> {
  const qs = category ? `?category=${encodeURIComponent(category)}` : "";
  const res = await http.get<{ config: ConfigEntry[] }>(`${BASE}/config${qs}`);
  return res.config ?? [];
}

export async function setConfig(
  key: string,
  value: unknown,
  opts: { category?: string; description?: string } = {},
): Promise<ConfigEntry> {
  const res = await http.put<{ config: ConfigEntry }>(`${BASE}/config/${encodeURIComponent(key)}`, {
    value,
    ...(opts.category !== undefined ? { category: opts.category } : {}),
    ...(opts.description !== undefined ? { description: opts.description } : {}),
  });
  return res.config;
}

/** Parse an edited text value as JSON, falling back to the raw string. */
export function parseConfigValue(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    return text;
  }
}

export const configApi = { listConfig, setConfig, parseConfigValue };
