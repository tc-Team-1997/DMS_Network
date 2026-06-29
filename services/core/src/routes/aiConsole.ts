import { Router } from "express";
import type { Knex } from "knex";
import { requireAuth, requirePermission } from "@zordms/auth";
import { validateBody } from "../openapi/validate.js";
import { SetAiFeatureSchema, RecordAiMetricSchema } from "../openapi/schemas.js";
import { listFeatures, getFeature, setFeature, listMetrics, recordMetric } from "../repo/aiConsole.js";
import { writeAudit } from "../modules/audit.js";

/**
 * §4.7 AI capability console — feature enable/threshold + accuracy/throughput metrics.
 * Admin-only (admin:access), behind the gateway-issued JWT. Distinct from the
 * Python inference service (proxied at /svc/ai); this is core's config surface.
 */
export function aiConsoleRouter(): Router {
  const r = Router();
  r.use(requireAuth);
  r.use(requirePermission("admin:access"));

  // GET /ai-config/features — feature grid with the latest metric merged in.
  r.get("/features", async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      res.json({ features: await listFeatures(knex) });
    } catch (e: any) { res.status(500).json({ error: "internal", detail: String(e?.message ?? e) }); }
  });

  // GET /ai-config/features/:key
  r.get("/features/:key", async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const feature = await getFeature(knex, req.params.key);
      if (!feature) { res.status(404).json({ error: "not_found" }); return; }
      res.json({ feature });
    } catch (e: any) { res.status(500).json({ error: "internal", detail: String(e?.message ?? e) }); }
  });

  // PATCH /ai-config/features/:key — toggle enabled / tune threshold (audited).
  r.patch("/features/:key", validateBody(SetAiFeatureSchema), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const feature = await setFeature(knex, req.params.key, {
        enabled: req.body.enabled,
        threshold: req.body.threshold,
        updatedBy: req.authUser!.username,
      });
      if (!feature) { res.status(404).json({ error: "not_found" }); return; }
      await writeAudit(knex, {
        actorId: req.authUser!.id,
        actorUsername: req.authUser!.username,
        action: "AI_FEATURE_SET",
        entity: "ai_feature_config",
        entityId: req.params.key,
        details: `enabled=${feature.enabled} threshold=${feature.threshold ?? "null"}`,
      });
      res.json({ feature });
    } catch (e: any) { res.status(500).json({ error: "internal", detail: String(e?.message ?? e) }); }
  });

  // GET /ai-config/metrics[?feature=classify]
  r.get("/metrics", async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const feature = typeof req.query.feature === "string" ? req.query.feature : undefined;
      res.json({ metrics: await listMetrics(knex, feature) });
    } catch (e: any) { res.status(500).json({ error: "internal", detail: String(e?.message ?? e) }); }
  });

  // POST /ai-config/metrics — record a metric snapshot (admin / inference service push).
  r.post("/metrics", validateBody(RecordAiMetricSchema), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const metric = await recordMetric(knex, {
        featureKey: req.body.feature_key,
        accuracy: req.body.accuracy,
        throughput: req.body.throughput,
        period: req.body.period,
      });
      res.status(201).json({ metric });
    } catch (e: any) { res.status(500).json({ error: "internal", detail: String(e?.message ?? e) }); }
  });

  return r;
}
