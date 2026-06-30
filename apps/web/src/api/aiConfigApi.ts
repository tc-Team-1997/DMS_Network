/**
 * aiConfigApi.ts — AI capability console (§4.7 / SC-18) client.
 *
 * Wires the core AI feature config + metrics (built this session):
 *   GET   /ai-config/features
 *   PATCH /ai-config/features/:key   (enabled / threshold)
 *   GET   /ai-config/metrics[?feature]
 */
import { http, SVC } from "./http.js";

const BASE = SVC.core;

export interface AiMetric { featureKey: string; accuracy: number | null; throughput: number | null; period: string; recordedAt: string | null }
export interface AiFeature {
  featureKey: string;
  name: string;
  enabled: boolean;
  threshold: number | null;
  description: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  latestMetric: AiMetric | null;
}

export async function listFeatures(): Promise<AiFeature[]> {
  return (await http.get<{ features: AiFeature[] }>(`${BASE}/ai-config/features`)).features ?? [];
}

export async function setFeature(key: string, patch: { enabled?: boolean; threshold?: number | null }): Promise<AiFeature> {
  // PATCH via http helper.
  const res = await http.patch<{ feature: AiFeature }>(`${BASE}/ai-config/features/${encodeURIComponent(key)}`, patch);
  return res.feature;
}

export async function listMetrics(feature?: string): Promise<AiMetric[]> {
  const qs = feature ? `?feature=${encodeURIComponent(feature)}` : "";
  return (await http.get<{ metrics: AiMetric[] }>(`${BASE}/ai-config/metrics${qs}`)).metrics ?? [];
}

export const aiConfigApi = { listFeatures, setFeature, listMetrics };
