import type { Knex } from "knex";
import { newId } from "@zordms/db";

/**
 * AI capability console repository (§4.7) — feature enable/threshold config and
 * per-feature accuracy/throughput metrics.
 */

export interface AiFeature {
  featureKey: string;
  name: string;
  enabled: boolean;
  threshold: number | null;
  description: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  latestMetric: { accuracy: number | null; throughput: number | null; period: string; recordedAt: string | null } | null;
}

export interface AiMetric {
  featureKey: string;
  accuracy: number | null;
  throughput: number | null;
  period: string;
  recordedAt: string | null;
}

function featureRow(row: Record<string, unknown>, metric: AiMetric | null): AiFeature {
  return {
    featureKey: String(row.feature_key),
    name: String(row.name),
    enabled: Boolean(row.enabled),
    threshold: row.threshold === null || row.threshold === undefined ? null : Number(row.threshold),
    description: (row.description as string) ?? null,
    updatedBy: (row.updated_by as string) ?? null,
    updatedAt: (row.updated_at as string) ?? null,
    latestMetric: metric,
  };
}

function metricRow(row: Record<string, unknown>): AiMetric {
  return {
    featureKey: String(row.feature_key),
    accuracy: row.accuracy === null || row.accuracy === undefined ? null : Number(row.accuracy),
    throughput: row.throughput === null || row.throughput === undefined ? null : Number(row.throughput),
    period: String(row.period ?? "30d"),
    recordedAt: (row.recorded_at as string) ?? null,
  };
}

/** Most-recent metric per feature_key. */
async function latestMetrics(knex: Knex): Promise<Map<string, AiMetric>> {
  const rows = await knex("ai_metrics").select("*").orderBy([{ column: "recorded_at", order: "asc" }, { column: "id", order: "asc" }]);
  const map = new Map<string, AiMetric>();
  for (const r of rows) map.set(String(r.feature_key), metricRow(r)); // later rows overwrite → latest wins
  return map;
}

export async function listFeatures(knex: Knex): Promise<AiFeature[]> {
  const metrics = await latestMetrics(knex);
  const rows = await knex("ai_feature_config").select("*").orderBy("feature_key", "asc");
  return rows.map((r) => featureRow(r, metrics.get(String(r.feature_key)) ?? null));
}

export async function getFeature(knex: Knex, key: string): Promise<AiFeature | null> {
  const row = await knex("ai_feature_config").where({ feature_key: key }).first();
  if (!row) return null;
  const metric = await knex("ai_metrics").where({ feature_key: key }).orderBy([{ column: "recorded_at", order: "desc" }, { column: "id", order: "desc" }]).first();
  return featureRow(row, metric ? metricRow(metric) : null);
}

/** Patch enabled/threshold on an existing feature. Returns null if absent. */
export async function setFeature(
  knex: Knex,
  key: string,
  patch: { enabled?: boolean; threshold?: number | null; updatedBy?: string },
): Promise<AiFeature | null> {
  const existing = await knex("ai_feature_config").where({ feature_key: key }).first();
  if (!existing) return null;
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.enabled !== undefined) update.enabled = patch.enabled;
  if (patch.threshold !== undefined) update.threshold = patch.threshold;
  if (patch.updatedBy !== undefined) update.updated_by = patch.updatedBy;
  await knex("ai_feature_config").where({ feature_key: key }).update(update);
  return getFeature(knex, key);
}

export async function listMetrics(knex: Knex, featureKey?: string): Promise<AiMetric[]> {
  let q = knex("ai_metrics").select("*").orderBy([{ column: "recorded_at", order: "desc" }, { column: "id", order: "desc" }]);
  if (featureKey) q = q.where({ feature_key: featureKey });
  return (await q).map(metricRow);
}

export async function recordMetric(
  knex: Knex,
  input: { featureKey: string; accuracy?: number | null; throughput?: number | null; period?: string },
): Promise<AiMetric> {
  const id = newId();
  await knex("ai_metrics").insert({
    id,
    feature_key: input.featureKey,
    accuracy: input.accuracy ?? null,
    throughput: input.throughput ?? null,
    period: input.period ?? "30d",
  });
  return metricRow((await knex("ai_metrics").where({ id }).first())!);
}
