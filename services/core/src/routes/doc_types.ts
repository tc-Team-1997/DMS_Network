/**
 * /doc-types — Document Type Registry (admin-manageable)
 *
 * GET  /doc-types                  list registry (+ observed-in-documents types)
 *                                  with STORED mandatoryFields/optionalFields.
 * POST /doc-types                  create a new (custom) type            [doctype:write]
 * PUT  /doc-types/:code            edit a type incl. field schemas       [doctype:write]
 * DELETE /doc-types/:code          delete a custom type (system blocked) [doctype:write]
 * POST /doc-types/from-suggestion  persist an AI suggested-new-type      [doctype:write]
 * POST /doc-types/:code/apply-fields  replace a type's field schema      [doctype:write]
 *
 * Field schemas are STORED on the doc_type_registry table (mandatory_fields /
 * optional_fields JSON columns), seeded from the derived catalog maps so behavior
 * is unchanged. Each field is a field-object: { name, type?, mandatory }.
 */
import { Router } from "express";
import { requireAuth, requirePermission } from "@zordms/auth";
import { newId } from "@zordms/db";
import type { CoreDeps } from "../deps.js";
import {
  fieldObjectsForType,
  inferFieldType,
  type FieldObject,
} from "../catalog/quality.js";

const DOCTYPE_WRITE = "doctype:write";

interface RegistryRow {
  id: string;
  code: string;
  description: string;
  jurisdiction: string;
  issuer: string;
  category: string | null;
  system: boolean | number;
  mandatory_fields: string | null;
  optional_fields: string | null;
  created_at: string | null;
  updated_at?: string | null;
}

/** Parse a JSON field-object array column; tolerate null / legacy string-arrays. */
function parseFields(raw: string | null | undefined): FieldObject[] {
  if (!raw) return [];
  let val: unknown;
  try {
    val = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return [];
  }
  if (!Array.isArray(val)) return [];
  return val
    .map((f): FieldObject | null => {
      if (typeof f === "string") return { name: f, type: inferFieldType(f), mandatory: false };
      if (f && typeof f === "object" && typeof (f as any).name === "string") {
        const o = f as Record<string, unknown>;
        return {
          name: String(o.name),
          type: typeof o.type === "string" ? o.type : inferFieldType(String(o.name)),
          mandatory: Boolean(o.mandatory),
        };
      }
      return null;
    })
    .filter((f): f is FieldObject => f !== null);
}

/**
 * Normalize an inbound field list (array of strings OR field-objects) into
 * canonical field-objects with the given mandatory flag.
 */
function normalizeFields(raw: unknown, mandatory: boolean): FieldObject[] {
  if (!Array.isArray(raw)) return [];
  const out: FieldObject[] = [];
  for (const f of raw) {
    if (typeof f === "string") {
      if (f.trim() === "") continue;
      out.push({ name: f.trim(), type: inferFieldType(f), mandatory });
    } else if (f && typeof f === "object" && typeof (f as any).name === "string") {
      const o = f as Record<string, unknown>;
      const name = String(o.name).trim();
      if (name === "") continue;
      out.push({
        name,
        type: typeof o.type === "string" ? o.type : inferFieldType(name),
        mandatory,
      });
    }
  }
  return out;
}

/** Validate that no field name appears in both mandatory and optional lists. */
function fieldOverlap(mandatory: FieldObject[], optional: FieldObject[]): string[] {
  const m = new Set(mandatory.map((f) => f.name));
  return optional.filter((f) => m.has(f.name)).map((f) => f.name);
}

function toApi(row: RegistryRow) {
  // If stored columns are missing (legacy row), fall back to derived schema.
  const hasStored = row.mandatory_fields != null || row.optional_fields != null;
  const { mandatoryFields, optionalFields } = hasStored
    ? { mandatoryFields: parseFields(row.mandatory_fields), optionalFields: parseFields(row.optional_fields) }
    : fieldObjectsForType(row.code, row.category);
  return {
    code: row.code,
    description: row.description,
    jurisdiction: row.jurisdiction,
    issuer: row.issuer,
    category: row.category,
    system: Boolean(row.system),
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    mandatoryFields,
    optionalFields,
  };
}

export function docTypesRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  // ── GET /doc-types ─────────────────────────────────────────────────────────
  r.get("/", async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;

      const registryRows: RegistryRow[] = await knex("doc_type_registry")
        .select(
          "id", "code", "description", "jurisdiction", "issuer", "category",
          "system", "mandatory_fields", "optional_fields", "created_at", "updated_at",
        )
        .orderBy("code");

      // Observed-in-documents types not yet registered
      const dynamicRows = await knex("documents")
        .select("doc_type")
        .whereNotNull("doc_type")
        .whereNot("doc_type", "")
        .whereNotIn("doc_type", registryRows.map((row) => row.code))
        .groupBy("doc_type");

      const registered = registryRows.map(toApi);
      const dynamic = dynamicRows.map((d: any) => {
        const { mandatoryFields, optionalFields } = fieldObjectsForType(d.doc_type, null);
        return {
          code: d.doc_type as string,
          description: "Observed in documents (not yet registered)",
          jurisdiction: "ANY",
          issuer: "Unknown",
          category: null,
          system: false,
          created_at: null,
          updated_at: null,
          mandatoryFields,
          optionalFields,
        };
      });

      const docTypes = [...registered, ...dynamic];
      res.json({ docTypes, total: docTypes.length });
    } catch (e: any) {
      res.status(500).json({ error: "internal", detail: String(e?.message ?? e) });
    }
  });

  // ── POST /doc-types — create a new (custom) type ─────────────────────────────
  r.post("/", requirePermission(DOCTYPE_WRITE), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      const body = req.body ?? {};
      const code = typeof body.code === "string" ? body.code.trim() : "";
      if (!code) {
        res.status(400).json({ error: "validation", detail: "code is required" });
        return;
      }
      const existing = await knex("doc_type_registry").where({ code }).first();
      if (existing) {
        res.status(409).json({ error: "conflict", detail: `doc type '${code}' already exists` });
        return;
      }

      const mandatoryFields = normalizeFields(body.mandatory_fields ?? body.mandatoryFields, true);
      const optionalFields = normalizeFields(body.optional_fields ?? body.optionalFields, false);
      const overlap = fieldOverlap(mandatoryFields, optionalFields);
      if (overlap.length) {
        res.status(400).json({ error: "validation", detail: `field(s) in both mandatory and optional: ${overlap.join(", ")}` });
        return;
      }

      const row = {
        id: newId(),
        code,
        description: typeof body.description === "string" && body.description.trim() ? body.description.trim() : code,
        jurisdiction: typeof body.jurisdiction === "string" && body.jurisdiction.trim() ? body.jurisdiction.trim() : "ANY",
        issuer: typeof body.issuer === "string" && body.issuer.trim() ? body.issuer.trim() : "Unknown",
        category: typeof body.category === "string" && body.category.trim() ? body.category.trim() : null,
        system: false,
        mandatory_fields: JSON.stringify(mandatoryFields),
        optional_fields: JSON.stringify(optionalFields),
      };
      await knex("doc_type_registry").insert(row);
      const saved: RegistryRow = await knex("doc_type_registry").where({ code }).first();
      res.status(201).json({ docType: toApi(saved) });
    } catch (e: any) {
      res.status(500).json({ error: "internal", detail: String(e?.message ?? e) });
    }
  });

  // ── PUT /doc-types/:code — edit an existing type ─────────────────────────────
  r.put("/:code", requirePermission(DOCTYPE_WRITE), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      const code = req.params.code;
      const existing: RegistryRow = await knex("doc_type_registry").where({ code }).first();
      if (!existing) {
        res.status(404).json({ error: "not_found", detail: `doc type '${code}' not found` });
        return;
      }
      const body = req.body ?? {};

      const update: Record<string, unknown> = { updated_at: knex.fn.now() };
      if (typeof body.description === "string") update.description = body.description.trim() || existing.description;
      if (typeof body.category === "string") update.category = body.category.trim() || null;
      if (typeof body.jurisdiction === "string") update.jurisdiction = body.jurisdiction.trim() || "ANY";
      if (typeof body.issuer === "string") update.issuer = body.issuer.trim() || "Unknown";

      // Resolve the effective field lists (use provided, else keep stored) for overlap validation.
      const hasMandatory = body.mandatory_fields !== undefined || body.mandatoryFields !== undefined;
      const hasOptional = body.optional_fields !== undefined || body.optionalFields !== undefined;
      const mandatoryFields = hasMandatory
        ? normalizeFields(body.mandatory_fields ?? body.mandatoryFields, true)
        : parseFields(existing.mandatory_fields);
      const optionalFields = hasOptional
        ? normalizeFields(body.optional_fields ?? body.optionalFields, false)
        : parseFields(existing.optional_fields);

      if (hasMandatory || hasOptional) {
        const overlap = fieldOverlap(mandatoryFields, optionalFields);
        if (overlap.length) {
          res.status(400).json({ error: "validation", detail: `field(s) in both mandatory and optional: ${overlap.join(", ")}` });
          return;
        }
        if (hasMandatory) update.mandatory_fields = JSON.stringify(mandatoryFields);
        if (hasOptional) update.optional_fields = JSON.stringify(optionalFields);
      }

      await knex("doc_type_registry").where({ code }).update(update);
      const saved: RegistryRow = await knex("doc_type_registry").where({ code }).first();
      res.json({ docType: toApi(saved) });
    } catch (e: any) {
      res.status(500).json({ error: "internal", detail: String(e?.message ?? e) });
    }
  });

  // ── DELETE /doc-types/:code — only custom (system=false) types ───────────────
  r.delete("/:code", requirePermission(DOCTYPE_WRITE), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      const code = req.params.code;
      const existing: RegistryRow = await knex("doc_type_registry").where({ code }).first();
      if (!existing) {
        res.status(404).json({ error: "not_found", detail: `doc type '${code}' not found` });
        return;
      }
      if (Boolean(existing.system)) {
        res.status(403).json({ error: "forbidden", detail: `system doc type '${code}' cannot be deleted` });
        return;
      }
      await knex("doc_type_registry").where({ code }).del();
      res.json({ deleted: true, code });
    } catch (e: any) {
      res.status(500).json({ error: "internal", detail: String(e?.message ?? e) });
    }
  });

  // ── POST /doc-types/from-suggestion — persist an AI suggested-new-type ────────
  r.post("/from-suggestion", requirePermission(DOCTYPE_WRITE), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      const body = req.body ?? {};
      // Accept either { suggestion: {...} } or the suggestion fields at the top level.
      const s = (body.suggestion && typeof body.suggestion === "object" ? body.suggestion : body) as Record<string, unknown>;
      const proposedName = typeof s.proposedName === "string" ? s.proposedName.trim() : "";
      if (!proposedName) {
        res.status(400).json({ error: "validation", detail: "proposedName is required" });
        return;
      }
      const code = proposedName;
      const existing = await knex("doc_type_registry").where({ code }).first();
      if (existing) {
        res.status(409).json({ error: "conflict", detail: `doc type '${code}' already exists` });
        return;
      }

      // sampleFields become optional fields by default (admin can promote later).
      const sampleFields = Array.isArray(s.sampleFields) ? s.sampleFields : [];
      const optionalFields = normalizeFields(sampleFields, false);

      const row = {
        id: newId(),
        code,
        description: typeof s.reason === "string" && s.reason.trim()
          ? s.reason.trim().slice(0, 255)
          : `AI-suggested document type (${code})`,
        jurisdiction: typeof s.jurisdiction === "string" && s.jurisdiction.trim() ? s.jurisdiction.trim() : "ANY",
        issuer: typeof s.issuer === "string" && s.issuer.trim() ? s.issuer.trim() : "Unknown",
        category: typeof s.category === "string" && s.category.trim() ? s.category.trim() : null,
        system: false,
        mandatory_fields: JSON.stringify([]),
        optional_fields: JSON.stringify(optionalFields),
      };
      await knex("doc_type_registry").insert(row);
      const saved: RegistryRow = await knex("doc_type_registry").where({ code }).first();
      res.status(201).json({ docType: toApi(saved) });
    } catch (e: any) {
      res.status(500).json({ error: "internal", detail: String(e?.message ?? e) });
    }
  });

  // ── POST /doc-types/:code/apply-fields — replace the field schema ────────────
  r.post("/:code/apply-fields", requirePermission(DOCTYPE_WRITE), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      const code = req.params.code;
      const existing = await knex("doc_type_registry").where({ code }).first();
      if (!existing) {
        res.status(404).json({ error: "not_found", detail: `doc type '${code}' not found` });
        return;
      }
      const body = req.body ?? {};
      const mandatoryFields = normalizeFields(body.mandatory_fields ?? body.mandatoryFields, true);
      const optionalFields = normalizeFields(body.optional_fields ?? body.optionalFields, false);
      const overlap = fieldOverlap(mandatoryFields, optionalFields);
      if (overlap.length) {
        res.status(400).json({ error: "validation", detail: `field(s) in both mandatory and optional: ${overlap.join(", ")}` });
        return;
      }
      await knex("doc_type_registry").where({ code }).update({
        mandatory_fields: JSON.stringify(mandatoryFields),
        optional_fields: JSON.stringify(optionalFields),
        updated_at: knex.fn.now(),
      });
      const saved: RegistryRow = await knex("doc_type_registry").where({ code }).first();
      res.json({ docType: toApi(saved) });
    } catch (e: any) {
      res.status(500).json({ error: "internal", detail: String(e?.message ?? e) });
    }
  });

  return r;
}
