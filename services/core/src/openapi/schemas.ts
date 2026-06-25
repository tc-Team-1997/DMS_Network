/**
 * P10 — Boundary zod schemas for the core service.
 *
 * These schemas are the single source of truth for BOTH:
 *   1. runtime request validation at the boundary (see ./validate.ts), and
 *   2. the generated OpenAPI 3.1 document (see ./document.ts).
 *
 * They are registered with the shared OpenAPIRegistry so each appears as a named
 * component schema (`$ref`) in the spec. We deliberately keep them permissive
 * where the existing handlers already tolerate extra keys (`.passthrough()` /
 * optional fields) so adding validation NEVER changes behavior for valid input —
 * it only rejects clearly-malformed input with a 400.
 */
import { z } from "zod";
import { extendZodWithOpenApi, OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// ── Security schemes ─────────────────────────────────────────────────────────
// User-facing routes: bearer JWT (Authorization: Bearer <jwt>).
export const bearerAuth = registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description: "User JWT issued by the gateway; carries RBAC roles + permissions.",
});

// Internal service-to-service routes (/integration/*): shared internal token.
// The integration hub verifies the inbound external webhook HMAC, then calls
// these endpoints with the shared INTERNAL_SERVICE_TOKEN header.
export const internalTokenAuth = registry.registerComponent("securitySchemes", "internalToken", {
  type: "apiKey",
  in: "header",
  name: "x-internal-token",
  description:
    "Shared internal service token. The integration hub authenticates the inbound " +
    "external webhook via HMAC, then forwards to these endpoints with this token.",
});

// ── Shared field-object schema (doc-type registry) ───────────────────────────
export const FieldObjectSchema = registry.register(
  "FieldObject",
  z
    .union([
      z.string(),
      z
        .object({
          name: z.string().min(1),
          type: z.string().optional(),
          mandatory: z.boolean().optional(),
        })
        .openapi({ description: "Field descriptor object." }),
    ])
    .openapi("FieldObject", {
      description: "A doc-type field: either a bare field name or a {name,type?,mandatory?} object.",
    }),
);

// ── Folders ──────────────────────────────────────────────────────────────────
export const CreateFolderSchema = registry.register(
  "CreateFolder",
  z
    .object({
      name: z.string().min(1).openapi({ example: "Customers" }),
      parentId: z.string().nullable().optional(),
      domain: z.string().optional().openapi({ example: "Customers" }),
    })
    .openapi("CreateFolder"),
);

export const MoveFolderSchema = registry.register(
  "MoveFolder",
  z.object({ parentId: z.string().min(1) }).openapi("MoveFolder"),
);

// ── Documents ────────────────────────────────────────────────────────────────
export const RollbackSchema = registry.register(
  "Rollback",
  z
    .object({
      version: z.coerce.number().int().positive().openapi({ example: 2 }),
    })
    .openapi("Rollback"),
);

export const StampSchema = registry.register(
  "Stamp",
  z
    .object({
      label: z.string().optional().openapi({ example: "APPROVED" }),
      by: z.string().optional(),
      date: z.string().optional().openapi({ example: "2026-06-25" }),
      page: z.coerce.number().int().positive().optional(),
      ref: z.string().optional(),
    })
    .openapi("Stamp"),
);

export const RedactRegionSchema = registry.register(
  "RedactRegion",
  z
    .object({
      page: z.coerce.number().int().positive().optional().openapi({ example: 1 }),
      x: z.coerce.number(),
      y: z.coerce.number(),
      w: z.coerce.number(),
      h: z.coerce.number(),
    })
    .openapi("RedactRegion"),
);

export const RedactSchema = registry.register(
  "Redact",
  z
    .object({
      regions: z.array(RedactRegionSchema).min(1),
    })
    .openapi("Redact"),
);

// PATCH /documents/:id — metadata correction. All fields optional.
export const PatchDocumentSchema = registry.register(
  "PatchDocument",
  z
    .object({
      doc_type: z.string().optional(),
      catalog_category: z.string().optional(),
      cid: z.string().optional(),
      doc_no: z.string().optional(),
      folder_id: z.string().nullable().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .openapi("PatchDocument"),
);

// ── Index / Catalog / Mapper (metadata pipeline) ─────────────────────────────
export const IndexSchema = registry.register(
  "IndexRequest",
  z
    .object({
      doc_type: z.string().min(1),
      fields: z.record(z.string(), z.unknown()).optional(),
      confidence: z.number().min(0).max(1).optional(),
    })
    .openapi("IndexRequest"),
);

export const CatalogSchema = registry.register(
  "CatalogRequest",
  z
    .object({
      docType: z.string().min(1),
      confidence: z.coerce.number().optional(),
      fields: z.record(z.string(), z.unknown()).optional(),
    })
    .openapi("CatalogRequest"),
);

export const MapperSchema = registry.register(
  "MapperRequest",
  z
    .object({
      docType: z.string().min(1),
      fields: z.record(z.string(), z.unknown()).optional(),
    })
    .openapi("MapperRequest"),
);

// ── Annotations ──────────────────────────────────────────────────────────────
export const CreateAnnotationSchema = registry.register(
  "CreateAnnotation",
  z
    .object({
      kind: z.string().min(1).openapi({ example: "highlight" }),
      page: z.coerce.number().int().positive().optional(),
      x: z.coerce.number(),
      y: z.coerce.number(),
      width: z.coerce.number(),
      height: z.coerce.number(),
      content: z.string().optional(),
      color: z.string().optional(),
    })
    .openapi("CreateAnnotation"),
);

// ── Branches ─────────────────────────────────────────────────────────────────
export const CreateBranchSchema = registry.register(
  "CreateBranch",
  z
    .object({
      code: z.string().min(1).openapi({ example: "THIM" }),
      name: z.string().min(1).openapi({ example: "Thimphu Main" }),
      region: z.string().optional(),
    })
    .passthrough()
    .openapi("CreateBranch"),
);

export const AccessPolicySchema = registry.register(
  "AccessPolicy",
  z
    .object({
      source_branch: z.string().min(1),
      target_branch: z.string().min(1),
      mode: z.string().optional(),
    })
    .passthrough()
    .openapi("AccessPolicy"),
);

// ── Records / Legal holds ────────────────────────────────────────────────────
export const PlaceHoldSchema = registry.register(
  "PlaceHold",
  z
    .object({
      ref: z.string().min(1),
      scope: z.string().min(1),
    })
    .passthrough()
    .openapi("PlaceHold"),
);

// ── Dedup config (admin) ─────────────────────────────────────────────────────
export const DedupConfigSchema = registry.register(
  "DedupConfig",
  z
    .object({
      enabled: z.boolean().optional(),
      matchBy: z.array(z.enum(["hash", "cid", "doc_no"])).optional(),
      action: z.enum(["flag", "auto_version"]).optional(),
      fuzzyThreshold: z.coerce.number().min(0).max(1).optional(),
    })
    .openapi("DedupConfig"),
);

// ── Doc-type registry ────────────────────────────────────────────────────────
export const CreateDocTypeSchema = registry.register(
  "CreateDocType",
  z
    .object({
      code: z.string().min(1),
      description: z.string().optional(),
      jurisdiction: z.string().optional(),
      issuer: z.string().optional(),
      category: z.string().optional(),
      mandatory_fields: z.array(FieldObjectSchema).optional(),
      mandatoryFields: z.array(FieldObjectSchema).optional(),
      optional_fields: z.array(FieldObjectSchema).optional(),
      optionalFields: z.array(FieldObjectSchema).optional(),
    })
    .passthrough()
    .openapi("CreateDocType"),
);

export const UpdateDocTypeSchema = registry.register(
  "UpdateDocType",
  z
    .object({
      description: z.string().optional(),
      jurisdiction: z.string().optional(),
      issuer: z.string().optional(),
      category: z.string().optional(),
      mandatory_fields: z.array(FieldObjectSchema).optional(),
      mandatoryFields: z.array(FieldObjectSchema).optional(),
      optional_fields: z.array(FieldObjectSchema).optional(),
      optionalFields: z.array(FieldObjectSchema).optional(),
    })
    .passthrough()
    .openapi("UpdateDocType"),
);

export const ApplyFieldsSchema = registry.register(
  "ApplyFields",
  z
    .object({
      mandatory_fields: z.array(FieldObjectSchema).optional(),
      mandatoryFields: z.array(FieldObjectSchema).optional(),
      optional_fields: z.array(FieldObjectSchema).optional(),
      optionalFields: z.array(FieldObjectSchema).optional(),
    })
    .passthrough()
    .openapi("ApplyFields"),
);

export const FromSuggestionSchema = registry.register(
  "FromSuggestion",
  z
    .object({
      proposedName: z.string().optional(),
      suggestion: z
        .object({ proposedName: z.string().optional() })
        .passthrough()
        .optional(),
    })
    .passthrough()
    .openapi("FromSuggestion"),
);

// ── Extraction ───────────────────────────────────────────────────────────────
export const ExtractSchema = registry.register(
  "ExtractRequest",
  z
    .object({
      async: z.boolean().optional(),
    })
    .passthrough()
    .openapi("ExtractRequest"),
);

// ── Integration (internal, x-internal-token) ─────────────────────────────────
export const CustomerUpsertSchema = registry.register(
  "CustomerUpsert",
  z
    .object({
      cid: z.string().min(1),
      name: z.string().optional(),
      branch: z.string().optional(),
      segment: z.string().optional(),
      kycStatus: z.string().optional(),
      kyc_status: z.string().optional(),
    })
    .passthrough()
    .openapi("CustomerUpsert"),
);

export const LoanIntakeSchema = registry.register(
  "LoanIntake",
  z
    .object({
      applicationId: z.string().optional(),
      application_id: z.string().optional(),
      cid: z.string().optional(),
      amount: z.number().optional(),
      product: z.string().optional(),
      state: z.string().optional(),
    })
    .passthrough()
    .refine((b) => Boolean(b.applicationId?.trim() || b.application_id?.trim()), {
      message: "applicationId (or application_id) is required",
      path: ["applicationId"],
    })
    .openapi("LoanIntake"),
);

// ── Shared error envelope ────────────────────────────────────────────────────
export const ValidationErrorSchema = registry.register(
  "ValidationError",
  z
    .object({
      error: z.literal("validation_error"),
      issues: z.array(
        z.object({
          path: z.array(z.union([z.string(), z.number()])),
          message: z.string(),
          code: z.string().optional(),
        }),
      ),
    })
    .openapi("ValidationError"),
);
