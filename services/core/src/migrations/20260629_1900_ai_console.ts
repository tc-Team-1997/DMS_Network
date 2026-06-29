import type { Knex } from "knex";
import { newId } from "@zordms/db";

/**
 * Migration: ai_feature_config + ai_metrics (§4.7 AI capability console).
 *
 * The console shows the 10 AI features with an enable toggle + tunable
 * confidence threshold, and per-feature accuracy / throughput metrics. Config is
 * a single row per feature; metrics are append-only time series. Idempotent.
 */
const FEATURES: Array<{ key: string; name: string; enabled: boolean; threshold: number | null; accuracy: number; throughput: number }> = [
  { key: "ocr", name: "OCR & ICR (Dzongkha + English)", enabled: true, threshold: null, accuracy: 0.97, throughput: 120 },
  { key: "classify", name: "Auto-Classification", enabled: true, threshold: 0.92, accuracy: 0.95, throughput: 200 },
  { key: "extract", name: "Smart Data Extraction", enabled: true, threshold: 0.7, accuracy: 0.91, throughput: 90 },
  { key: "search", name: "Semantic Smart Search", enabled: false, threshold: null, accuracy: 0.0, throughput: 0 },
  { key: "fraud", name: "Anomaly & Fraud Detection", enabled: false, threshold: 0.8, accuracy: 0.0, throughput: 0 },
  { key: "summarize", name: "Document Summarization", enabled: true, threshold: null, accuracy: 0.9, throughput: 60 },
  { key: "compliance", name: "Compliance Validation (RMA)", enabled: false, threshold: null, accuracy: 0.0, throughput: 0 },
  { key: "translate", name: "Auto-Translation (Dzongkha↔English)", enabled: false, threshold: null, accuracy: 0.0, throughput: 0 },
  { key: "chat", name: "AI Chat Assistant (LLM + RAG)", enabled: true, threshold: null, accuracy: 0.93, throughput: 40 },
  { key: "predict", name: "Predictive Analytics", enabled: false, threshold: null, accuracy: 0.0, throughput: 0 },
];

export async function up(knex: Knex): Promise<void> {
  const hasCfg = await knex.schema.hasTable("ai_feature_config");
  if (!hasCfg) {
    await knex.schema.createTable("ai_feature_config", (t) => {
      t.string("id", 36).notNullable().primary();
      t.string("feature_key", 60).notNullable().unique();
      t.string("name", 200).notNullable();
      t.boolean("enabled").notNullable().defaultTo(true);
      t.float("threshold"); // nullable — not every feature has a confidence gate
      t.text("description");
      t.string("updated_by", 100);
      t.timestamp("updated_at").defaultTo(knex.fn.now());
    });
  }

  const hasMetrics = await knex.schema.hasTable("ai_metrics");
  if (!hasMetrics) {
    await knex.schema.createTable("ai_metrics", (t) => {
      t.string("id", 36).notNullable().primary();
      t.string("feature_key", 60).notNullable().index();
      t.float("accuracy");
      t.float("throughput");
      t.string("period", 20).notNullable().defaultTo("30d");
      t.timestamp("recorded_at").defaultTo(knex.fn.now());
    });
  }

  // Seed the feature set + an initial metric snapshot (only if config is empty).
  if (!hasCfg) {
    for (const f of FEATURES) {
      await knex("ai_feature_config").insert({
        id: newId(), feature_key: f.key, name: f.name, enabled: f.enabled, threshold: f.threshold, updated_by: "system",
      });
      await knex("ai_metrics").insert({
        id: newId(), feature_key: f.key, accuracy: f.accuracy, throughput: f.throughput, period: "30d",
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("ai_metrics");
  await knex.schema.dropTableIfExists("ai_feature_config");
}
