import { Router } from "express";
import type { Knex } from "knex";
import { requireAuth, requirePermission } from "@zordms/auth";
import { newId } from "@zordms/db";
import type { ChannelRegistry } from "../channels/registry.js";
import { validateBody, validateParams } from "../validate.js";
import {
  CreateEmailTemplateBodySchema,
  UpdateEmailTemplateBodySchema,
  PreviewEmailTemplateBodySchema,
  TestSendEmailTemplateBodySchema,
  IdParamSchema,
  type CreateEmailTemplateBody,
  type UpdateEmailTemplateBody,
  type PreviewEmailTemplateBody,
  type TestSendEmailTemplateBody,
} from "../schemas.js";
import { renderEmail, sampleContext, TAG_CATALOG, type RenderContext } from "../templates/render.js";

interface TemplateRow {
  id: string;
  key: string;
  name: string;
  category: string | null;
  description: string | null;
  subject_template: string;
  html_body_template: string;
  text_body_template: string | null;
  enabled: boolean | number;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function normalize(row: TemplateRow) {
  return { ...row, enabled: Boolean(row.enabled) };
}

export function templatesRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  // Static catalog of merge tags for the admin UI palette (no DB).
  r.get("/tags", requirePermission("email_template:read"), (_req, res) => {
    res.json({ tags: TAG_CATALOG });
  });

  // List all templates.
  r.get("/", requirePermission("email_template:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const rows = (await knex("email_templates").orderBy("key", "asc")) as TemplateRow[];
    res.json({ templates: rows.map(normalize) });
  });

  // Get one template.
  r.get("/:id", requirePermission("email_template:read"), validateParams(IdParamSchema), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const row = (await knex("email_templates").where({ id: req.params.id }).first()) as TemplateRow | undefined;
    if (!row) { res.status(404).json({ error: "not_found" }); return; }
    res.json({ template: normalize(row) });
  });

  // Create.
  r.post("/", requirePermission("email_template:manage"), validateBody(CreateEmailTemplateBodySchema), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const b = req.body as CreateEmailTemplateBody;
    const dupe = await knex("email_templates").where({ key: b.key }).first();
    if (dupe) { res.status(409).json({ error: "key_taken" }); return; }
    const id = newId();
    await knex("email_templates").insert({
      id,
      key: b.key,
      name: b.name,
      category: b.category ?? null,
      description: b.description ?? null,
      subject_template: b.subjectTemplate,
      html_body_template: b.htmlBodyTemplate,
      text_body_template: b.textBodyTemplate ?? null,
      enabled: b.enabled ?? true,
      created_by: req.authUser?.username ?? "system",
    });
    res.status(201).json({ id });
  });

  // Update.
  r.patch("/:id", requirePermission("email_template:manage"), validateParams(IdParamSchema), validateBody(UpdateEmailTemplateBodySchema), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const b = req.body as UpdateEmailTemplateBody;
    const patch: Record<string, unknown> = { updated_at: knex.fn.now() };
    if (b.name !== undefined) patch.name = b.name;
    if (b.category !== undefined) patch.category = b.category;
    if (b.description !== undefined) patch.description = b.description;
    if (b.subjectTemplate !== undefined) patch.subject_template = b.subjectTemplate;
    if (b.htmlBodyTemplate !== undefined) patch.html_body_template = b.htmlBodyTemplate;
    if (b.textBodyTemplate !== undefined) patch.text_body_template = b.textBodyTemplate;
    if (b.enabled !== undefined) patch.enabled = b.enabled;
    const n = await knex("email_templates").where({ id: req.params.id }).update(patch);
    if (!n) { res.status(404).json({ error: "not_found" }); return; }
    res.json({ ok: true });
  });

  // Delete.
  r.delete("/:id", requirePermission("email_template:manage"), validateParams(IdParamSchema), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const n = await knex("email_templates").where({ id: req.params.id }).delete();
    if (!n) { res.status(404).json({ error: "not_found" }); return; }
    res.json({ ok: true });
  });

  // Preview — render with sample (or supplied) context, no send.
  r.post("/:id/preview", requirePermission("email_template:read"), validateParams(IdParamSchema), validateBody(PreviewEmailTemplateBodySchema), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const row = (await knex("email_templates").where({ id: req.params.id }).first()) as TemplateRow | undefined;
    if (!row) { res.status(404).json({ error: "not_found" }); return; }
    const b = req.body as PreviewEmailTemplateBody;
    const ctx: RenderContext = { ...sampleContext(), ...(b.context ?? {}) };
    const rendered = renderEmail(row, ctx);
    res.json({ rendered });
  });

  // Test-send — render and actually email one recipient.
  r.post("/:id/test-send", requirePermission("email_template:manage"), validateParams(IdParamSchema), validateBody(TestSendEmailTemplateBodySchema), async (req, res) => {
    const { knex, registry } = req.app.locals.deps as { knex: Knex; registry: ChannelRegistry };
    const row = (await knex("email_templates").where({ id: req.params.id }).first()) as TemplateRow | undefined;
    if (!row) { res.status(404).json({ error: "not_found" }); return; }
    const b = req.body as TestSendEmailTemplateBody;
    const ctx: RenderContext = { ...sampleContext(), recipient: { name: b.to.split("@")[0], email: b.to }, ...(b.context ?? {}) };
    const { subject, html, text } = renderEmail(row, ctx);
    const [result] = await registry.dispatch(["email"], { recipient: b.to, subject, body: text, html });
    if (result.status === "failed") {
      res.status(502).json({ error: "send_failed", detail: result.error });
      return;
    }
    res.json({ ok: true, sentTo: b.to, providerId: result.providerId });
  });

  return r;
}
