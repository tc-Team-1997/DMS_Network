/**
 * P10 — OpenAPI 3.1 document for the core service.
 *
 * Built from the boundary zod schemas in ./schemas.ts via
 * @asteasolutions/zod-to-openapi (OpenApiGeneratorV31), so the documented request
 * bodies stay in lock-step with what the service actually validates.
 *
 * Every route mounted by `createApp` (see ../app.ts) is registered here with its
 * path/method, params/query, request body, and realistic response codes + schemas.
 * The contract test in ./openapi.test.ts asserts the documented path set EXACTLY
 * matches the live router (no undocumented or phantom routes).
 *
 * `buildOpenApiDocument()` returns the spec object; `writeOpenApiSpec(path)`
 * persists it to disk (used to regenerate docs/superpowers/specs/openapi/core.json).
 */
import { z } from "zod";
import { OpenApiGeneratorV31, type RouteConfig } from "@asteasolutions/zod-to-openapi";
import {
  registry,
  CreateFolderSchema,
  MoveFolderSchema,
  RollbackSchema,
  StampSchema,
  RedactSchema,
  PatchDocumentSchema,
  IndexSchema,
  CatalogSchema,
  MapperSchema,
  CreateAnnotationSchema,
  CreateBranchSchema,
  AccessPolicySchema,
  PlaceHoldSchema,
  DedupConfigSchema,
  SetConfigSchema,
  ConfigEntrySchema,
  CreateValidationRuleSchema,
  UpdateValidationRuleSchema,
  RunValidationSchema,
  ValidationRuleSchema,
  ValidationResultSchema,
  ValidationRunResultSchema,
  RunReportSchema,
  SaveReportSchema,
  ReportRunResultSchema,
  ReportDefinitionSchema,
  ReportSourceSchema,
  SetAiFeatureSchema,
  RecordAiMetricSchema,
  AiFeatureSchema,
  AiMetricSchema,
  CreateDepartmentSchema,
  UpdateDepartmentSchema,
  DepartmentSchema,
  CreateRetentionRuleSchema,
  UpdateRetentionRuleSchema,
  RetentionPolicySchema,
  CreateDocTypeSchema,
  UpdateDocTypeSchema,
  ApplyFieldsSchema,
  FromSuggestionSchema,
  ExtractSchema,
  CustomerUpsertSchema,
  LoanIntakeSchema,
  ValidationErrorSchema,
  ErrorResponseSchema,
  DedupValidationErrorSchema,
  MetadataValidationErrorSchema,
  AuditQuerySchema,
  JobsQuerySchema,
  DocumentSchema,
  FolderSchema,
  FolderTreeNodeSchema,
  VersionSchema,
  AnnotationSchema,
  DocTypeSchema,
  DedupConfigStateSchema,
  QualitySchema,
  CatalogResultSchema,
  LegalHoldSchema,
  CustomerProfileSchema,
  JobSchema,
  HealthSchema,
} from "./schemas.js";

const idParam = z.string().openapi({ param: { name: "id", in: "path" }, example: "doc_123" });
const documentIdParam = z
  .string()
  .openapi({ param: { name: "documentId", in: "path" }, example: "doc_123" });
const codeParam = z.string().openapi({ param: { name: "code", in: "path" }, example: "BT_CID_4G" });
const refParam = z.string().openapi({ param: { name: "ref", in: "path" }, example: "HOLD-2026-01" });
const cidParam = z.string().openapi({ param: { name: "cid", in: "path" }, example: "10705001234" });
const docIdParam = z
  .string()
  .openapi({ param: { name: "docId", in: "path" }, example: "doc_123" });
const annIdParam = z.string().openapi({ param: { name: "id", in: "path" }, example: "ann_123" });
const jobIdParam = z.string().openapi({ param: { name: "id", in: "path" }, example: "job_123" });

const bearer = [{ bearerAuth: [] as string[] }];
const internal = [{ internalToken: [] as string[] }];

// ── Reusable response builders ───────────────────────────────────────────────
function json(description: string, schema: z.ZodType, example?: unknown): RouteConfig["responses"][string] {
  return {
    description,
    content: { "application/json": example !== undefined ? { schema, example } : { schema } },
  };
}

const validationErrorResponse = json(
  "Request failed boundary validation.",
  ValidationErrorSchema,
  { error: "validation_error", issues: [{ path: ["name"], message: "Expected string, received number", code: "invalid_type" }] },
);
const unauthorized = json("Missing/invalid credentials.", ErrorResponseSchema, { error: "unauthorized" });
const forbidden = json("Caller lacks the required permission.", ErrorResponseSchema, { error: "forbidden" });
const notFound = json("Resource not found.", ErrorResponseSchema, { error: "not_found" });
const internalError = json("Unexpected server error.", ErrorResponseSchema, { error: "internal" });

/** Generic empty-object 2xx (used only where the body is an opaque pass-through map). */
function ok(description: string): RouteConfig["responses"][string] {
  return json(description, z.object({}).passthrough().openapi("GenericOk"));
}

function jsonBody(schema: z.ZodType): RouteConfig["request"] {
  return { body: { content: { "application/json": { schema } } } };
}

function register(routes: RouteConfig[]): void {
  for (const route of routes) registry.registerPath(route);
}

register([
  // ── Meta ─────────────────────────────────────────────────────────────────
  {
    method: "get",
    path: "/health",
    tags: ["meta"],
    summary: "Liveness probe.",
    responses: { 200: json("Service is up.", HealthSchema, { status: "ok", service: "core" }) },
  },
  {
    method: "get",
    path: "/openapi.json",
    tags: ["meta"],
    summary: "This OpenAPI 3.1 document (JSON).",
    responses: { 200: ok("The OpenAPI spec.") },
  },
  {
    method: "get",
    path: "/openapi",
    tags: ["meta"],
    summary: "This OpenAPI 3.1 document (raw, pretty-printed JSON).",
    responses: { 200: ok("The OpenAPI spec.") },
  },

  // ── Folders ──────────────────────────────────────────────────────────────
  {
    method: "post",
    path: "/folders",
    tags: ["folders"],
    security: bearer,
    summary: "Create a folder.",
    request: jsonBody(CreateFolderSchema),
    responses: {
      201: json("Folder created.", z.object({ folder: FolderSchema }), { folder: { id: "fld_1", name: "Customers" } }),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "get",
    path: "/folders",
    tags: ["folders"],
    security: bearer,
    summary: "List the folder tree.",
    responses: {
      200: json("Folder tree.", z.object({ tree: z.array(FolderTreeNodeSchema) })),
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "post",
    path: "/folders/{id}/move",
    tags: ["folders"],
    security: bearer,
    summary: "Move a folder under a new parent.",
    request: { params: z.object({ id: idParam }), ...jsonBody(MoveFolderSchema) },
    responses: {
      200: json("Folder moved.", z.object({ folder: FolderSchema })),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },

  // ── Documents ────────────────────────────────────────────────────────────
  {
    method: "post",
    path: "/documents",
    tags: ["documents"],
    security: bearer,
    summary: "Capture a document (multipart upload).",
    description: "multipart/form-data: `file` (required) plus optional `title`, `branch`, `sourceChannel`, `folderId`.",
    request: {
      body: {
        content: {
          "multipart/form-data": {
            schema: z.object({
              file: z.string().openapi({ type: "string", format: "binary" }),
              title: z.string().optional(),
              branch: z.string().optional(),
              sourceChannel: z.string().optional(),
              folderId: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: {
      201: json("Document captured.", z.object({ document: DocumentSchema })),
      400: json("Missing file.", ErrorResponseSchema, { error: "file_required" }),
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "post",
    path: "/documents/bulk",
    tags: ["documents"],
    security: bearer,
    summary: "Bulk-capture documents; enqueues async extraction per file.",
    description: "multipart/form-data: `files[]` (up to 200) plus optional `branch`, `sourceChannel`, `folderId`.",
    request: {
      body: {
        content: {
          "multipart/form-data": {
            schema: z.object({
              files: z.array(z.string().openapi({ type: "string", format: "binary" })),
              branch: z.string().optional(),
              sourceChannel: z.string().optional(),
              folderId: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: {
      202: json("Captured + queued.", z.object({
        count: z.number(),
        items: z.array(z.object({ docId: z.string(), jobId: z.string() })),
        status: z.literal("queued"),
      }), { count: 2, items: [{ docId: "doc_1", jobId: "job_1" }], status: "queued" }),
      400: json("No files provided.", ErrorResponseSchema, { error: "files_required" }),
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "get",
    path: "/documents",
    tags: ["documents"],
    security: bearer,
    summary: "List documents visible to the caller's branch.",
    responses: {
      200: json("Documents.", z.object({ documents: z.array(DocumentSchema) })),
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "get",
    path: "/documents/export",
    tags: ["documents"],
    security: bearer,
    summary: "Export the filtered, branch-scoped document set as CSV (SC-02).",
    request: {
      query: z.object({
        type: z.string().optional().openapi({ param: { name: "type", in: "query" } }),
        branch: z.string().optional().openapi({ param: { name: "branch", in: "query" } }),
        status: z.string().optional().openapi({ param: { name: "status", in: "query" } }),
        from: z.string().optional().openapi({ param: { name: "from", in: "query" }, example: "2026-01-01" }),
        to: z.string().optional().openapi({ param: { name: "to", in: "query" }, example: "2026-12-31" }),
        minConf: z.string().optional().openapi({ param: { name: "minConf", in: "query" }, example: "0.7" }),
      }),
    },
    responses: {
      200: { description: "CSV file (text/csv at runtime).", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } as unknown as z.ZodType } } },
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "get",
    path: "/documents/{id}",
    tags: ["documents"],
    security: bearer,
    summary: "Fetch a single document.",
    request: { params: z.object({ id: idParam }) },
    responses: {
      200: json("Document.", z.object({ document: DocumentSchema }), { document: { id: "doc_123", title: "KYC form", status: "Active" } }),
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },
  {
    method: "get",
    path: "/documents/{id}/download",
    tags: ["documents"],
    security: bearer,
    summary: "Download the current version bytes.",
    request: { params: z.object({ id: idParam }) },
    responses: {
      200: { description: "File bytes.", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } as unknown as z.ZodType } } },
      401: unauthorized,
      403: forbidden,
      404: json("Document or version not found.", ErrorResponseSchema, { error: "no_version" }),
      500: internalError,
    },
  },
  {
    method: "delete",
    path: "/documents/{id}",
    tags: ["documents"],
    security: bearer,
    summary: "Soft-delete a document (blocked under legal hold).",
    request: { params: z.object({ id: idParam }) },
    responses: {
      204: { description: "Deleted." },
      401: unauthorized,
      403: forbidden,
      404: notFound,
      409: json("Under an active legal hold.", ErrorResponseSchema, { error: "under_legal_hold" }),
      500: internalError,
    },
  },
  {
    method: "post",
    path: "/documents/{id}/versions",
    tags: ["documents"],
    security: bearer,
    summary: "Add a new version (multipart upload).",
    description: "multipart/form-data: `file` (required), optional `comment`.",
    request: {
      params: z.object({ id: idParam }),
      body: { content: { "multipart/form-data": { schema: z.object({ file: z.string().openapi({ type: "string", format: "binary" }), comment: z.string().optional() }) } } },
    },
    responses: {
      201: json("Version added.", z.object({ version: VersionSchema })),
      400: json("Missing file.", ErrorResponseSchema, { error: "file_required" }),
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },
  {
    method: "get",
    path: "/documents/{id}/versions",
    tags: ["documents"],
    security: bearer,
    summary: "List document versions.",
    request: { params: z.object({ id: idParam }) },
    responses: {
      200: json("Versions.", z.object({ versions: z.array(VersionSchema) })),
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },
  {
    method: "post",
    path: "/documents/{id}/rollback",
    tags: ["documents"],
    security: bearer,
    summary: "Roll a document back to a prior version.",
    request: { params: z.object({ id: idParam }), ...jsonBody(RollbackSchema) },
    responses: {
      200: json("Rolled back.", z.object({ version: VersionSchema }), { version: { version_no: 2 } }),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },
  {
    method: "post",
    path: "/documents/{id}/stamp",
    tags: ["documents"],
    security: bearer,
    summary: "Burn a visible stamp into a new version.",
    request: { params: z.object({ id: idParam }), ...jsonBody(StampSchema) },
    responses: {
      201: json("Stamped.", z.object({ version: VersionSchema, download: z.string() })),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },
  {
    method: "post",
    path: "/documents/{id}/redact",
    tags: ["documents"],
    security: bearer,
    summary: "Destructively redact regions into a new version.",
    request: { params: z.object({ id: idParam }), ...jsonBody(RedactSchema) },
    responses: {
      201: json("Redacted.", z.object({
        version: VersionSchema,
        download: z.string(),
        redaction: z.object({ rasterized: z.boolean(), guarantee: z.string() }),
      })),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },
  {
    method: "patch",
    path: "/documents/{id}",
    tags: ["documents"],
    security: bearer,
    summary: "Correct document metadata.",
    request: { params: z.object({ id: idParam }), ...jsonBody(PatchDocumentSchema) },
    responses: {
      200: json("Updated.", z.object({ document: DocumentSchema, quality: QualitySchema, catalog: CatalogResultSchema })),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },
  {
    method: "post",
    path: "/documents/{id}/extract",
    tags: ["documents", "extraction"],
    security: bearer,
    summary: "Run AI extraction (sync, or async with { async: true }).",
    request: { params: z.object({ id: idParam }), ...jsonBody(ExtractSchema) },
    responses: {
      200: ok("Extracted (sync)."),
      202: json("Queued (async).", z.object({ jobId: z.string(), status: z.string() }), { jobId: "job_1", status: "queued" }),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },
  {
    method: "post",
    path: "/documents/{id}/extract-async",
    tags: ["documents", "extraction"],
    security: bearer,
    summary: "Enqueue a durable async extraction job.",
    request: { params: z.object({ id: idParam }) },
    responses: {
      202: json("Queued.", z.object({ jobId: z.string(), status: z.string() }), { jobId: "job_1", status: "queued" }),
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },

  // ── Annotations ────────────────────────────────────────────────────────────
  {
    method: "get",
    path: "/documents/{documentId}/annotations",
    tags: ["annotations"],
    security: bearer,
    summary: "List annotations on a document.",
    request: { params: z.object({ documentId: documentIdParam }) },
    responses: {
      200: json("Annotations.", z.object({ annotations: z.array(AnnotationSchema) })),
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },
  {
    method: "post",
    path: "/documents/{documentId}/annotations",
    tags: ["annotations"],
    security: bearer,
    summary: "Create an annotation on a document.",
    request: { params: z.object({ documentId: documentIdParam }), ...jsonBody(CreateAnnotationSchema) },
    responses: {
      201: json("Created.", z.object({ annotation: AnnotationSchema })),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },
  {
    method: "delete",
    path: "/documents/{documentId}/annotations/{id}",
    tags: ["annotations"],
    security: bearer,
    summary: "Delete an annotation.",
    request: { params: z.object({ documentId: documentIdParam, id: annIdParam }) },
    responses: {
      204: { description: "Deleted." },
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },

  // ── Pipeline: index / catalog / mapper ───────────────────────────────────
  {
    method: "post",
    path: "/index/{documentId}",
    tags: ["pipeline"],
    security: bearer,
    summary: "Index a document's typed metadata.",
    request: { params: z.object({ documentId: documentIdParam }), ...jsonBody(IndexSchema) },
    responses: {
      200: json("Indexed.", z.object({ document: DocumentSchema })),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      404: notFound,
      422: json("Typed metadata invalid for the doc type.", MetadataValidationErrorSchema, { errors: ["cid_no is required"], missing: ["cid_no"] }),
      500: internalError,
    },
  },
  {
    method: "post",
    path: "/catalog/{documentId}",
    tags: ["pipeline"],
    security: bearer,
    summary: "Catalog/classify a document.",
    request: { params: z.object({ documentId: documentIdParam }), ...jsonBody(CatalogSchema) },
    responses: {
      200: json("Cataloged.", z.object({ result: CatalogResultSchema })),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },
  {
    method: "post",
    path: "/mapper/{documentId}",
    tags: ["pipeline"],
    security: bearer,
    summary: "Auto-file a document into the directory tree.",
    request: { params: z.object({ documentId: documentIdParam }), ...jsonBody(MapperSchema) },
    responses: {
      200: json("Filed.", z.object({ path: z.string(), folderId: z.string(), acls: z.array(z.unknown()) }), { path: "/BoB/Customers", folderId: "fld_1", acls: [] }),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },

  // ── Dashboard ────────────────────────────────────────────────────────────
  {
    method: "get",
    path: "/dashboard/summary",
    tags: ["dashboard"],
    security: bearer,
    summary: "Dashboard summary counts.",
    responses: {
      200: json("Summary.", z.object({
        totalDocuments: z.number(),
        byCategory: z.record(z.string(), z.number()),
        pendingReview: z.number(),
        indexedToday: z.number(),
      }), { totalDocuments: 42, byCategory: { KYC: 10 }, pendingReview: 3, indexedToday: 5 }),
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },

  // ── Branches ─────────────────────────────────────────────────────────────
  {
    method: "get",
    path: "/branches",
    tags: ["branches"],
    security: bearer,
    summary: "List branches.",
    responses: {
      200: json("Branches.", z.object({ branches: z.array(z.record(z.string(), z.unknown())) })),
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "post",
    path: "/branches",
    tags: ["branches"],
    security: bearer,
    summary: "Create a branch.",
    request: jsonBody(CreateBranchSchema),
    responses: {
      201: json("Created.", z.object({ branch: z.record(z.string(), z.unknown()) })),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "get",
    path: "/branches/access",
    tags: ["branches"],
    security: bearer,
    summary: "List cross-branch access policies.",
    responses: {
      200: json("Policies.", z.object({ policies: z.array(z.record(z.string(), z.unknown())) })),
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "post",
    path: "/branches/access",
    tags: ["branches"],
    security: bearer,
    summary: "Set a cross-branch access policy.",
    request: jsonBody(AccessPolicySchema),
    responses: {
      201: json("Set.", z.object({ policy: z.record(z.string(), z.unknown()) })),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },

  // ── Customers (Customer 360) ─────────────────────────────────────────────
  {
    method: "get",
    path: "/customers/{cid}",
    tags: ["customers"],
    security: bearer,
    summary: "Customer 360 profile by CID.",
    request: { params: z.object({ cid: cidParam }) },
    responses: {
      200: json("Profile.", z.object({ profile: CustomerProfileSchema })),
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },

  // ── Records / legal holds / disposal ─────────────────────────────────────
  {
    method: "get",
    path: "/records/file-plan",
    tags: ["records"],
    security: bearer,
    summary: "List retention file-plan policies.",
    responses: {
      200: json("Policies.", z.object({ policies: z.array(z.record(z.string(), z.unknown())) })),
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "post",
    path: "/records/file-plan",
    tags: ["records"],
    security: bearer,
    summary: "Create or update a retention rule (by doc_class) — SC-06.",
    request: jsonBody(CreateRetentionRuleSchema),
    responses: {
      201: json("Saved.", z.object({ policy: RetentionPolicySchema })),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "put",
    path: "/records/file-plan/{id}",
    tags: ["records"],
    security: bearer,
    summary: "Update a retention rule.",
    request: { params: z.object({ id: idParam }), ...jsonBody(UpdateRetentionRuleSchema) },
    responses: {
      200: json("Updated.", z.object({ policy: RetentionPolicySchema })),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },
  {
    method: "delete",
    path: "/records/file-plan/{id}",
    tags: ["records"],
    security: bearer,
    summary: "Delete a retention rule.",
    request: { params: z.object({ id: idParam }) },
    responses: {
      200: json("Deleted.", z.object({ deleted: z.boolean() })),
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },
  {
    method: "get",
    path: "/records/holds",
    tags: ["records"],
    security: bearer,
    summary: "List legal holds.",
    responses: {
      200: json("Holds.", z.object({ holds: z.array(LegalHoldSchema) })),
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "post",
    path: "/records/holds",
    tags: ["records"],
    security: bearer,
    summary: "Place a legal hold.",
    request: jsonBody(PlaceHoldSchema),
    responses: {
      201: json("Placed.", z.object({ hold: LegalHoldSchema }), { hold: { ref: "HOLD-2026-01", scope: "cid:10705001234" } }),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "post",
    path: "/records/holds/{ref}/release",
    tags: ["records"],
    security: bearer,
    summary: "Release a legal hold.",
    request: { params: z.object({ ref: refParam }) },
    responses: {
      200: json("Released.", z.object({ hold: LegalHoldSchema })),
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "get",
    path: "/records/disposal/eligibility",
    tags: ["records"],
    security: bearer,
    summary: "List documents eligible for disposal.",
    responses: {
      200: json("Candidates.", z.object({ candidates: z.array(z.record(z.string(), z.unknown())) })),
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "post",
    path: "/records/disposal/{documentId}/certify",
    tags: ["records"],
    security: bearer,
    summary: "Certify disposal of a document.",
    request: { params: z.object({ documentId: documentIdParam }) },
    responses: {
      201: ok("Certified."),
      401: unauthorized,
      403: forbidden,
      409: json("Under legal hold / not eligible.", ErrorResponseSchema, { error: "under_legal_hold" }),
      500: internalError,
    },
  },

  // ── Compliance ───────────────────────────────────────────────────────────
  {
    method: "get",
    path: "/compliance/scorecard",
    tags: ["compliance"],
    security: bearer,
    summary: "Compliance scorecard.",
    responses: {
      200: json("Scorecard.", z.object({ scorecard: z.record(z.string(), z.unknown()) })),
      401: unauthorized,
      403: forbidden,
    },
  },
  {
    method: "get",
    path: "/compliance/matrix",
    tags: ["compliance"],
    security: bearer,
    summary: "Regulatory matrix.",
    responses: {
      200: json("Matrix.", z.object({ matrix: z.array(z.record(z.string(), z.unknown())) })),
      401: unauthorized,
      403: forbidden,
    },
  },
  {
    method: "get",
    path: "/compliance/audit",
    tags: ["compliance"],
    security: bearer,
    summary: "Query the audit trail (filtered/paginated).",
    request: { query: AuditQuerySchema },
    responses: {
      200: json("Audit rows.", z.object({ rows: z.array(z.record(z.string(), z.unknown())) })),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "get",
    path: "/compliance/verify",
    tags: ["compliance"],
    security: bearer,
    summary: "Verify the audit hash chain.",
    responses: {
      200: json("Verification.", z.object({ verification: z.record(z.string(), z.unknown()) })),
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },

  // ── Lifecycle ────────────────────────────────────────────────────────────
  {
    method: "get",
    path: "/lifecycle/{docId}",
    tags: ["lifecycle"],
    security: bearer,
    summary: "Document lifecycle trace.",
    request: { params: z.object({ docId: docIdParam }) },
    responses: {
      200: json("Trace.", z.object({ trace: z.record(z.string(), z.unknown()) })),
      401: unauthorized,
      403: forbidden,
      404: notFound,
    },
  },

  // ── Admin (sysadmin + dedup config) ──────────────────────────────────────
  {
    method: "get",
    path: "/admin/health",
    tags: ["admin"],
    security: bearer,
    summary: "Service-health posture.",
    responses: {
      200: json("Health.", z.object({ health: z.record(z.string(), z.unknown()) })),
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "get",
    path: "/admin/dr",
    tags: ["admin"],
    security: bearer,
    summary: "Disaster-recovery posture.",
    responses: {
      200: json("DR posture.", z.object({ dr: z.record(z.string(), z.unknown()) })),
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "get",
    path: "/admin/schedules",
    tags: ["admin"],
    security: bearer,
    summary: "Scheduled jobs.",
    responses: {
      200: json("Schedules.", z.object({ schedules: z.array(z.record(z.string(), z.unknown())) })),
      401: unauthorized,
      403: forbidden,
    },
  },
  {
    method: "get",
    path: "/admin/dedup-config",
    tags: ["admin"],
    security: bearer,
    summary: "Read dedup configuration.",
    responses: {
      200: json("Dedup config.", z.object({ dedupConfig: DedupConfigStateSchema })),
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "put",
    path: "/admin/dedup-config",
    tags: ["admin"],
    security: bearer,
    summary: "Update dedup configuration.",
    description: "Invalid values are rejected with 422 { errors: string[] } (NOT the 400 validation_error envelope).",
    request: jsonBody(DedupConfigSchema),
    responses: {
      200: json("Updated.", z.object({ dedupConfig: DedupConfigStateSchema })),
      401: unauthorized,
      403: forbidden,
      422: json("Invalid dedup configuration.", DedupValidationErrorSchema, { errors: ["enabled must be boolean"] }),
      500: internalError,
    },
  },

  // ── System config (§4.13) ────────────────────────────────────────────────
  {
    method: "get",
    path: "/config",
    tags: ["config"],
    security: bearer,
    summary: "List runtime config entries (optionally by category).",
    request: {
      query: z.object({
        category: z.string().optional().openapi({ param: { name: "category", in: "query" }, example: "ai" }),
      }),
    },
    responses: {
      200: json("Config entries.", z.object({ config: z.array(ConfigEntrySchema) })),
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "get",
    path: "/config/{key}",
    tags: ["config"],
    security: bearer,
    summary: "Read a single config entry by key.",
    request: {
      params: z.object({
        key: z.string().openapi({ param: { name: "key", in: "path" }, example: "ai.classification_threshold" }),
      }),
    },
    responses: {
      200: json("Config entry.", z.object({ config: ConfigEntrySchema })),
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },
  {
    method: "put",
    path: "/config/{key}",
    tags: ["config"],
    security: bearer,
    summary: "Create or update a config entry (audited).",
    request: {
      params: z.object({
        key: z.string().openapi({ param: { name: "key", in: "path" }, example: "ai.classification_threshold" }),
      }),
      ...jsonBody(SetConfigSchema),
    },
    responses: {
      200: json("Updated.", z.object({ config: ConfigEntrySchema })),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },

  // ── Validation module (§4.6) ─────────────────────────────────────────────
  {
    method: "get",
    path: "/validation/rules",
    tags: ["validation"],
    security: bearer,
    summary: "List validation rules (optionally by doc_type).",
    request: {
      query: z.object({
        doc_type: z.string().optional().openapi({ param: { name: "doc_type", in: "query" }, example: "BT_CID_4G" }),
      }),
    },
    responses: {
      200: json("Rules.", z.object({ rules: z.array(ValidationRuleSchema) })),
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "post",
    path: "/validation/rules",
    tags: ["validation"],
    security: bearer,
    summary: "Create a validation rule.",
    request: jsonBody(CreateValidationRuleSchema),
    responses: {
      201: json("Created.", z.object({ rule: ValidationRuleSchema })),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "put",
    path: "/validation/rules/{id}",
    tags: ["validation"],
    security: bearer,
    summary: "Update a validation rule.",
    request: { params: z.object({ id: idParam }), ...jsonBody(UpdateValidationRuleSchema) },
    responses: {
      200: json("Updated.", z.object({ rule: ValidationRuleSchema })),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },
  {
    method: "delete",
    path: "/validation/rules/{id}",
    tags: ["validation"],
    security: bearer,
    summary: "Delete a validation rule.",
    request: { params: z.object({ id: idParam }) },
    responses: {
      200: json("Deleted.", z.object({ deleted: z.boolean() })),
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },
  {
    method: "post",
    path: "/validation/run",
    tags: ["validation"],
    security: bearer,
    summary: "Run validation rules against supplied field data (optionally persisting per-document results).",
    request: jsonBody(RunValidationSchema),
    responses: {
      200: json("Validation outcome.", ValidationRunResultSchema),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "get",
    path: "/validation/results",
    tags: ["validation"],
    security: bearer,
    summary: "List persisted validation results for a document.",
    request: {
      query: z.object({
        document_id: z.string().openapi({ param: { name: "document_id", in: "query" }, example: "doc_123" }),
      }),
    },
    responses: {
      200: json("Results.", z.object({ results: z.array(ValidationResultSchema) })),
      400: json("Missing document_id.", ErrorResponseSchema, { error: "document_id required" }),
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },

  // ── Reports module (§4.10) ───────────────────────────────────────────────
  {
    method: "get",
    path: "/reports/sources",
    tags: ["reports"],
    security: bearer,
    summary: "List report sources + their groupable/numeric columns.",
    responses: {
      200: json("Sources.", z.object({ sources: z.array(ReportSourceSchema) })),
      401: unauthorized,
      403: forbidden,
    },
  },
  {
    method: "post",
    path: "/reports/run",
    tags: ["reports"],
    security: bearer,
    summary: "Run an ad-hoc report (group-by + measures over a whitelisted source).",
    description: "Non-whitelisted source/column/measure is rejected with 400 { error }.",
    request: jsonBody(RunReportSchema),
    responses: {
      200: json("Report result.", ReportRunResultSchema),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "get",
    path: "/reports/library",
    tags: ["reports"],
    security: bearer,
    summary: "List saved report definitions.",
    responses: {
      200: json("Saved reports.", z.object({ reports: z.array(ReportDefinitionSchema) })),
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "post",
    path: "/reports/library",
    tags: ["reports"],
    security: bearer,
    summary: "Save a report definition.",
    request: jsonBody(SaveReportSchema),
    responses: {
      201: json("Created.", z.object({ report: ReportDefinitionSchema })),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "get",
    path: "/reports/library/{id}",
    tags: ["reports"],
    security: bearer,
    summary: "Get a saved report definition.",
    request: { params: z.object({ id: idParam }) },
    responses: {
      200: json("Report.", z.object({ report: ReportDefinitionSchema })),
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },
  {
    method: "delete",
    path: "/reports/library/{id}",
    tags: ["reports"],
    security: bearer,
    summary: "Delete a saved report definition.",
    request: { params: z.object({ id: idParam }) },
    responses: {
      200: json("Deleted.", z.object({ deleted: z.boolean() })),
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },
  {
    method: "get",
    path: "/reports/library/{id}/export",
    tags: ["reports"],
    security: bearer,
    summary: "Run a saved report and export the result as CSV.",
    request: { params: z.object({ id: idParam }) },
    responses: {
      200: { description: "CSV file (text/csv at runtime).", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } as unknown as z.ZodType } } },
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },

  // ── AI capability console (§4.7) ─────────────────────────────────────────
  {
    method: "get",
    path: "/ai-config/features",
    tags: ["ai-console"],
    security: bearer,
    summary: "List AI features (enable/threshold) with the latest metric merged.",
    responses: {
      200: json("Features.", z.object({ features: z.array(AiFeatureSchema) })),
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "get",
    path: "/ai-config/features/{key}",
    tags: ["ai-console"],
    security: bearer,
    summary: "Get a single AI feature.",
    request: { params: z.object({ key: z.string().openapi({ param: { name: "key", in: "path" }, example: "classify" }) }) },
    responses: {
      200: json("Feature.", z.object({ feature: AiFeatureSchema })),
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },
  {
    method: "patch",
    path: "/ai-config/features/{key}",
    tags: ["ai-console"],
    security: bearer,
    summary: "Toggle a feature on/off and/or tune its confidence threshold (audited).",
    request: { params: z.object({ key: z.string().openapi({ param: { name: "key", in: "path" }, example: "classify" }) }), ...jsonBody(SetAiFeatureSchema) },
    responses: {
      200: json("Updated.", z.object({ feature: AiFeatureSchema })),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },
  {
    method: "get",
    path: "/ai-config/metrics",
    tags: ["ai-console"],
    security: bearer,
    summary: "List AI metric snapshots (optionally by feature).",
    request: {
      query: z.object({
        feature: z.string().optional().openapi({ param: { name: "feature", in: "query" }, example: "classify" }),
      }),
    },
    responses: {
      200: json("Metrics.", z.object({ metrics: z.array(AiMetricSchema) })),
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "post",
    path: "/ai-config/metrics",
    tags: ["ai-console"],
    security: bearer,
    summary: "Record an AI metric snapshot.",
    request: jsonBody(RecordAiMetricSchema),
    responses: {
      201: json("Recorded.", z.object({ metric: AiMetricSchema })),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },

  // ── Departments (§4.11 Master Data) ──────────────────────────────────────
  {
    method: "get",
    path: "/departments",
    tags: ["master-data"],
    security: bearer,
    summary: "List departments.",
    responses: {
      200: json("Departments.", z.object({ departments: z.array(DepartmentSchema) })),
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "get",
    path: "/departments/{id}",
    tags: ["master-data"],
    security: bearer,
    summary: "Get a department.",
    request: { params: z.object({ id: idParam }) },
    responses: {
      200: json("Department.", z.object({ department: DepartmentSchema })),
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },
  {
    method: "post",
    path: "/departments",
    tags: ["master-data"],
    security: bearer,
    summary: "Create a department.",
    request: jsonBody(CreateDepartmentSchema),
    responses: {
      201: json("Created.", z.object({ department: DepartmentSchema })),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      409: json("Duplicate code.", ErrorResponseSchema, { error: "duplicate_code" }),
      500: internalError,
    },
  },
  {
    method: "put",
    path: "/departments/{id}",
    tags: ["master-data"],
    security: bearer,
    summary: "Update a department.",
    request: { params: z.object({ id: idParam }), ...jsonBody(UpdateDepartmentSchema) },
    responses: {
      200: json("Updated.", z.object({ department: DepartmentSchema })),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },
  {
    method: "delete",
    path: "/departments/{id}",
    tags: ["master-data"],
    security: bearer,
    summary: "Delete a department.",
    request: { params: z.object({ id: idParam }) },
    responses: {
      200: json("Deleted.", z.object({ deleted: z.boolean() })),
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },

  // ── Doc-type registry ────────────────────────────────────────────────────
  {
    method: "get",
    path: "/doc-types",
    tags: ["doc-types"],
    security: bearer,
    summary: "List the doc-type registry (+ observed-in-documents types).",
    responses: {
      200: json("Doc types.", z.object({ docTypes: z.array(DocTypeSchema), total: z.number() })),
      401: unauthorized,
      500: internalError,
    },
  },
  {
    method: "post",
    path: "/doc-types",
    tags: ["doc-types"],
    security: bearer,
    summary: "Create a custom doc type.",
    request: jsonBody(CreateDocTypeSchema),
    responses: {
      201: json("Created.", z.object({ docType: DocTypeSchema })),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      409: json("Doc type already exists.", ErrorResponseSchema, { error: "conflict" }),
      500: internalError,
    },
  },
  {
    method: "put",
    path: "/doc-types/{code}",
    tags: ["doc-types"],
    security: bearer,
    summary: "Edit a doc type.",
    request: { params: z.object({ code: codeParam }), ...jsonBody(UpdateDocTypeSchema) },
    responses: {
      200: json("Updated.", z.object({ docType: DocTypeSchema })),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },
  {
    method: "delete",
    path: "/doc-types/{code}",
    tags: ["doc-types"],
    security: bearer,
    summary: "Delete a custom doc type.",
    request: { params: z.object({ code: codeParam }) },
    responses: {
      200: json("Deleted.", z.object({ deleted: z.boolean(), code: z.string() }), { deleted: true, code: "MY_TYPE" }),
      401: unauthorized,
      403: json("System doc type cannot be deleted.", ErrorResponseSchema, { error: "forbidden" }),
      404: notFound,
      500: internalError,
    },
  },
  {
    method: "post",
    path: "/doc-types/from-suggestion",
    tags: ["doc-types"],
    security: bearer,
    summary: "Persist an AI-suggested doc type.",
    request: jsonBody(FromSuggestionSchema),
    responses: {
      201: json("Created.", z.object({ docType: DocTypeSchema })),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      409: json("Doc type already exists.", ErrorResponseSchema, { error: "conflict" }),
      500: internalError,
    },
  },
  {
    method: "post",
    path: "/doc-types/{code}/apply-fields",
    tags: ["doc-types"],
    security: bearer,
    summary: "Replace a doc type's field schema.",
    request: { params: z.object({ code: codeParam }), ...jsonBody(ApplyFieldsSchema) },
    responses: {
      200: json("Applied.", z.object({ docType: DocTypeSchema })),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      404: notFound,
      500: internalError,
    },
  },

  // ── Jobs ─────────────────────────────────────────────────────────────────
  {
    method: "get",
    path: "/jobs",
    tags: ["jobs"],
    security: bearer,
    summary: "Job monitor: counts + recent jobs (filtered/paginated).",
    request: { query: JobsQuerySchema },
    responses: {
      200: json("Jobs.", z.object({ counts: z.record(z.string(), z.number()), jobs: z.array(JobSchema) })),
      400: validationErrorResponse,
      401: unauthorized,
      403: forbidden,
      500: internalError,
    },
  },
  {
    method: "get",
    path: "/jobs/{id}",
    tags: ["jobs"],
    security: bearer,
    summary: "Poll a single job's status.",
    request: { params: z.object({ id: jobIdParam }) },
    responses: {
      200: json("Job.", JobSchema, { id: "job_1", type: "extract", status: "succeeded" }),
      401: unauthorized,
      404: notFound,
      500: internalError,
    },
  },

  // ── Integration (internal, x-internal-token) ─────────────────────────────
  {
    method: "post",
    path: "/integration/customer-upsert",
    tags: ["integration"],
    security: internal,
    summary: "CBS customer upsert (internal).",
    request: jsonBody(CustomerUpsertSchema),
    responses: {
      200: json("Updated.", z.object({ change: z.literal("updated"), cid: z.string() }), { change: "updated", cid: "10705001234" }),
      201: json("Created.", z.object({ change: z.literal("created"), cid: z.string() }), { change: "created", cid: "10705001234" }),
      400: validationErrorResponse,
      401: unauthorized,
      500: internalError,
    },
  },
  {
    method: "post",
    path: "/integration/loan-intake",
    tags: ["integration"],
    security: internal,
    summary: "LOS loan-intake upsert (internal).",
    request: jsonBody(LoanIntakeSchema),
    responses: {
      200: json("Updated.", z.object({ change: z.literal("updated"), applicationId: z.string() }), { change: "updated", applicationId: "LOS-1001" }),
      201: json("Created.", z.object({ change: z.literal("created"), applicationId: z.string() }), { change: "created", applicationId: "LOS-1001" }),
      400: validationErrorResponse,
      401: unauthorized,
      500: internalError,
    },
  },
]);

export function buildOpenApiDocument(): Record<string, unknown> {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "ZorDMS Core Service",
      version: "0.0.0",
      description:
        "Document management core service: capture, indexing, catalog, mapper, " +
        "records/legal-hold lifecycle, doc-type registry, and internal integration ingest. " +
        "User routes use bearer JWT; /integration/* uses the shared x-internal-token " +
        "(set after the integration hub verifies the inbound external webhook HMAC).",
    },
    servers: [{ url: "/", description: "core service root" }],
    tags: [
      { name: "meta" },
      { name: "folders" },
      { name: "documents" },
      { name: "pipeline" },
      { name: "annotations" },
      { name: "dashboard" },
      { name: "branches" },
      { name: "customers" },
      { name: "records" },
      { name: "compliance" },
      { name: "lifecycle" },
      { name: "admin" },
      { name: "doc-types" },
      { name: "extraction" },
      { name: "jobs" },
      { name: "integration" },
    ],
  }) as unknown as Record<string, unknown>;
}
