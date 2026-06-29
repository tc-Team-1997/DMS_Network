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

// Generic { error } envelope used by non-validation failures (401/403/404/409/500).
export const ErrorResponseSchema = registry.register(
  "ErrorResponse",
  z
    .object({
      error: z.string().openapi({ example: "not_found" }),
      detail: z.string().optional(),
    })
    .passthrough()
    .openapi("ErrorResponse"),
);

// The dedup-config endpoints reject malformed input with 422 { errors: string[] }
// (NOT the 400 validation_error envelope) — documented as its own component so we
// don't misrepresent that route's contract.
export const DedupValidationErrorSchema = registry.register(
  "DedupValidationError",
  z
    .object({ errors: z.array(z.string()).openapi({ example: ["enabled must be boolean"] }) })
    .openapi("DedupValidationError"),
);

// The metadata pipeline (POST /index/{documentId}) rejects invalid typed metadata
// with 422 { errors, missing } — distinct from boundary 400 validation_error.
export const MetadataValidationErrorSchema = registry.register(
  "MetadataValidationError",
  z
    .object({
      errors: z.array(z.string()).optional(),
      missing: z.array(z.string()).optional(),
    })
    .passthrough()
    .openapi("MetadataValidationError"),
);

// ── Query-parameter schemas ──────────────────────────────────────────────────
// Audit-trail filter/pagination (GET /compliance/audit).
export const AuditQuerySchema = registry.register(
  "AuditQuery",
  z
    .object({
      action: z.string().min(1).optional(),
      entity: z.string().min(1).optional(),
      actor: z.string().min(1).optional(),
      limit: z.coerce.number().int().positive().max(1000).optional(),
    })
    .openapi("AuditQuery"),
);

// Job monitor filter/pagination (GET /jobs).
export const JobStatusEnum = z.enum(["queued", "running", "succeeded", "failed", "dead"]);
export const JobsQuerySchema = registry.register(
  "JobsQuery",
  z
    .object({
      status: JobStatusEnum.optional(),
      type: z.string().min(1).optional(),
      limit: z.coerce.number().int().positive().max(200).optional(),
    })
    .openapi("JobsQuery"),
);

// ── Entity component schemas (response bodies) ───────────────────────────────
// These describe the SHAPE of persisted entities returned by the read/mutating
// routes. They are intentionally permissive (`.passthrough()`) so they document
// the meaningful fields without over-constraining DB-projected rows.

export const DocumentSchema = registry.register(
  "Document",
  z
    .object({
      id: z.string().openapi({ example: "doc_123" }),
      title: z.string().nullable().optional(),
      doc_type: z.string().nullable().optional(),
      catalog_category: z.string().nullable().optional(),
      status: z.string().nullable().optional().openapi({ example: "Active" }),
      branch: z.string().nullable().optional(),
      cid: z.string().nullable().optional(),
      doc_no: z.string().nullable().optional(),
      folder_id: z.string().nullable().optional(),
      confidence: z.number().nullable().optional(),
      review_flag: z.boolean().optional(),
      retention_years: z.number().nullable().optional(),
      destruction_date: z.string().nullable().optional(),
      ingest_timestamp: z.string().nullable().optional(),
      metadata: z.string().nullable().optional(),
    })
    .passthrough()
    .openapi("Document"),
);

export const FolderSchema = registry.register(
  "Folder",
  z
    .object({
      id: z.string().openapi({ example: "fld_123" }),
      name: z.string(),
      parent_id: z.string().nullable().optional(),
      path: z.string().optional(),
      domain: z.string().nullable().optional(),
      created_by: z.string().nullable().optional(),
    })
    .passthrough()
    .openapi("Folder"),
);

export const FolderTreeNodeSchema = registry.register(
  "FolderTreeNode",
  z
    .object({
      id: z.string(),
      name: z.string(),
      children: z.array(z.unknown()).optional(),
    })
    .passthrough()
    .openapi("FolderTreeNode"),
);

export const VersionSchema = registry.register(
  "DocumentVersion",
  z
    .object({
      id: z.string().optional(),
      version_no: z.number().openapi({ example: 2 }),
      mime_type: z.string().nullable().optional(),
      file_hash_sha256: z.string().nullable().optional(),
      created_by: z.string().nullable().optional(),
      comment: z.string().nullable().optional(),
      storage_key: z.string().optional(),
    })
    .passthrough()
    .openapi("DocumentVersion"),
);

export const AnnotationSchema = registry.register(
  "Annotation",
  z
    .object({
      id: z.string(),
      document_id: z.string().optional(),
      kind: z.string(),
      page: z.number().optional(),
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      content: z.string().nullable().optional(),
      color: z.string().nullable().optional(),
      created_by: z.string().nullable().optional(),
    })
    .passthrough()
    .openapi("Annotation"),
);

export const DocTypeSchema = registry.register(
  "DocType",
  z
    .object({
      code: z.string().openapi({ example: "BT_CID_4G" }),
      description: z.string().nullable().optional(),
      jurisdiction: z.string().nullable().optional(),
      issuer: z.string().nullable().optional(),
      category: z.string().nullable().optional(),
      system: z.boolean(),
      created_at: z.string().nullable().optional(),
      updated_at: z.string().nullable().optional(),
      mandatoryFields: z.array(z.unknown()).optional(),
      optionalFields: z.array(z.unknown()).optional(),
    })
    .passthrough()
    .openapi("DocType"),
);

export const DedupConfigStateSchema = registry.register(
  "DedupConfigState",
  z
    .object({
      enabled: z.boolean().optional(),
      matchBy: z.array(z.string()).optional(),
      action: z.string().optional(),
      fuzzyThreshold: z.number().optional(),
    })
    .passthrough()
    .openapi("DedupConfigState"),
);

// ── System config (§4.13) ────────────────────────────────────────────────────
// A JSON value: number, boolean, string, null, array or object.
const ConfigValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);

// Request body for PUT /config/{key}.
export const SetConfigSchema = registry.register(
  "SetConfig",
  z
    .object({
      value: ConfigValueSchema.openapi({ example: 0.9 }),
      category: z.string().max(60).optional(),
      description: z.string().max(500).optional(),
    })
    .strict()
    .openapi("SetConfig"),
);

// Response shape for a single config entry.
export const ConfigEntrySchema = registry.register(
  "ConfigEntry",
  z
    .object({
      key: z.string().openapi({ example: "ai.classification_threshold" }),
      value: ConfigValueSchema,
      category: z.string().nullable(),
      description: z.string().nullable(),
      updatedBy: z.string().nullable(),
      updatedAt: z.string().nullable(),
    })
    .openapi("ConfigEntry"),
);

// ── Validation module (§4.6) ──────────────────────────────────────────────────
const RuleTypeEnum = z.enum(["required", "regex", "min_length", "max_length", "range", "enum"]);
const SeverityEnum = z.enum(["error", "warning"]);

export const CreateValidationRuleSchema = registry.register(
  "CreateValidationRule",
  z
    .object({
      doc_type: z.string().max(80).nullable().optional().openapi({ example: "BT_CID_4G" }),
      field_key: z.string().min(1).max(120).openapi({ example: "cid_no" }),
      rule_type: RuleTypeEnum.openapi({ example: "regex" }),
      params: z.record(z.string(), z.unknown()).optional().openapi({ example: { pattern: "^[0-9]{11}$" } }),
      severity: SeverityEnum.optional().openapi({ example: "error" }),
      message: z.string().max(300).optional(),
      enabled: z.boolean().optional(),
    })
    .strict()
    .openapi("CreateValidationRule"),
);

export const UpdateValidationRuleSchema = registry.register(
  "UpdateValidationRule",
  z
    .object({
      doc_type: z.string().max(80).nullable().optional(),
      field_key: z.string().min(1).max(120).optional(),
      rule_type: RuleTypeEnum.optional(),
      params: z.record(z.string(), z.unknown()).optional(),
      severity: SeverityEnum.optional(),
      message: z.string().max(300).optional(),
      enabled: z.boolean().optional(),
    })
    .strict()
    .openapi("UpdateValidationRule"),
);

export const RunValidationSchema = registry.register(
  "RunValidation",
  z
    .object({
      documentId: z.string().min(1).optional(),
      doc_type: z.string().min(1).openapi({ example: "BT_CID_4G" }),
      data: z.record(z.string(), z.unknown()).optional().openapi({ example: { cid_no: "11504000231" } }),
    })
    .strict()
    .openapi("RunValidation"),
);

export const ValidationRuleSchema = registry.register(
  "ValidationRule",
  z
    .object({
      id: z.string(),
      docType: z.string().nullable(),
      fieldKey: z.string(),
      ruleType: z.string(),
      params: z.record(z.string(), z.unknown()),
      severity: z.string(),
      message: z.string().nullable(),
      enabled: z.boolean(),
      createdBy: z.string().nullable(),
      createdAt: z.string().nullable(),
    })
    .openapi("ValidationRule"),
);

export const ValidationResultSchema = registry.register(
  "ValidationResult",
  z
    .object({
      ruleId: z.string().nullable(),
      fieldKey: z.string(),
      ruleType: z.string(),
      passed: z.boolean(),
      severity: z.string(),
      message: z.string().nullable(),
    })
    .openapi("ValidationResult"),
);

export const ValidationRunResultSchema = registry.register(
  "ValidationRunResult",
  z
    .object({
      results: z.array(ValidationResultSchema),
      summary: z.object({
        total: z.number(),
        passed: z.number(),
        failed: z.number(),
        errors: z.number(),
        warnings: z.number(),
      }),
    })
    .openapi("ValidationRunResult"),
);

// ── Reports module (§4.10) ────────────────────────────────────────────────────
const ReportSourceEnum = z.enum(["documents", "jobs", "customers"]);
const MeasureSchema = z
  .object({
    fn: z.enum(["count", "sum", "avg", "min", "max"]).openapi({ example: "count" }),
    field: z.string().optional(),
    alias: z.string().optional(),
  })
  .openapi("ReportMeasure");

export const RunReportSchema = registry.register(
  "RunReport",
  z
    .object({
      source: ReportSourceEnum,
      group_by: z.array(z.string()).optional().openapi({ example: ["doc_type"] }),
      measures: z.array(MeasureSchema).optional(),
      filters: z.record(z.string(), z.unknown()).optional(),
    })
    .strict()
    .openapi("RunReport"),
);

export const SaveReportSchema = registry.register(
  "SaveReport",
  z
    .object({
      name: z.string().min(1).max(200).openapi({ example: "Documents by type" }),
      description: z.string().max(500).optional(),
      source: ReportSourceEnum,
      group_by: z.array(z.string()).optional(),
      measures: z.array(MeasureSchema).optional(),
      filters: z.record(z.string(), z.unknown()).optional(),
    })
    .strict()
    .openapi("SaveReport"),
);

export const ReportRunResultSchema = registry.register(
  "ReportRunResult",
  z
    .object({
      columns: z.array(z.string()),
      rows: z.array(z.record(z.string(), z.unknown())),
    })
    .openapi("ReportRunResult"),
);

export const ReportDefinitionSchema = registry.register(
  "ReportDefinition",
  z
    .object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      source: z.string(),
      groupBy: z.array(z.string()),
      measures: z.array(z.record(z.string(), z.unknown())),
      filters: z.record(z.string(), z.unknown()),
      createdBy: z.string().nullable(),
      createdAt: z.string().nullable(),
    })
    .openapi("ReportDefinition"),
);

export const ReportSourceSchema = registry.register(
  "ReportSource",
  z
    .object({
      source: z.string(),
      groupable: z.array(z.string()),
      numeric: z.array(z.string()),
    })
    .openapi("ReportSource"),
);

export const QualitySchema = registry.register(
  "Quality",
  z
    .object({
      score: z.number().openapi({ example: 0.92 }),
      completeness: z.number().optional(),
      mandatoryMissing: z.array(z.string()).optional(),
      confidence: z.number().optional(),
    })
    .passthrough()
    .openapi("Quality"),
);

export const CatalogResultSchema = registry.register(
  "CatalogResult",
  z
    .object({
      category: z.string().nullable().optional(),
      route: z.string().optional().openapi({ example: "AUTO_FILE" }),
      mandatoryOk: z.boolean().optional(),
      missing: z.array(z.string()).optional(),
      retentionYears: z.number().optional(),
      reviewFlag: z.boolean().optional(),
    })
    .passthrough()
    .openapi("CatalogResult"),
);

export const LegalHoldSchema = registry.register(
  "LegalHold",
  z
    .object({
      ref: z.string().openapi({ example: "HOLD-2026-01" }),
      scope: z.string(),
      placed_by: z.string().nullable().optional(),
      released_at: z.string().nullable().optional(),
      status: z.string().optional(),
    })
    .passthrough()
    .openapi("LegalHold"),
);

export const CustomerProfileSchema = registry.register(
  "CustomerProfile",
  z
    .object({
      cid: z.string().optional(),
      master: z.record(z.string(), z.unknown()).nullable().optional(),
    })
    .passthrough()
    .openapi("CustomerProfile"),
);

export const JobSchema = registry.register(
  "Job",
  z
    .object({
      id: z.string(),
      type: z.string().openapi({ example: "extract" }),
      status: JobStatusEnum,
      attempts: z.number().optional(),
      maxAttempts: z.number().optional(),
      result: z.unknown().nullable().optional(),
      last_error: z.string().nullable().optional(),
      availableAt: z.string().nullable().optional(),
      createdAt: z.string().nullable().optional(),
      updatedAt: z.string().nullable().optional(),
    })
    .passthrough()
    .openapi("Job"),
);

export const HealthSchema = registry.register(
  "Health",
  z
    .object({ status: z.string().openapi({ example: "ok" }), service: z.string().optional() })
    .passthrough()
    .openapi("Health"),
);
