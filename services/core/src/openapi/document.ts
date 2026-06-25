/**
 * P10 — OpenAPI 3.1 document for the core service.
 *
 * Built from the boundary zod schemas in ./schemas.ts via
 * @asteasolutions/zod-to-openapi (OpenApiGeneratorV31), so the documented request
 * bodies stay in lock-step with what the service actually validates.
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
  CreateDocTypeSchema,
  UpdateDocTypeSchema,
  ApplyFieldsSchema,
  FromSuggestionSchema,
  ExtractSchema,
  CustomerUpsertSchema,
  LoanIntakeSchema,
  ValidationErrorSchema,
} from "./schemas.js";

const idParam = z.string().openapi({ param: { name: "id", in: "path" }, example: "doc_123" });
const documentIdParam = z
  .string()
  .openapi({ param: { name: "documentId", in: "path" }, example: "doc_123" });
const codeParam = z.string().openapi({ param: { name: "code", in: "path" }, example: "BT_CID_4G" });
const refParam = z.string().openapi({ param: { name: "ref", in: "path" }, example: "HOLD-2026-01" });

const bearer = [{ bearerAuth: [] as string[] }];
const internal = [{ internalToken: [] as string[] }];

const validationErrorResponse = {
  description: "Request failed boundary validation.",
  content: { "application/json": { schema: ValidationErrorSchema } },
};

function jsonBody(schema: z.ZodType): RouteConfig["request"] {
  return { body: { content: { "application/json": { schema } } } };
}

/** Generic 2xx JSON ok response (responses are not the focus of P10 validation). */
function ok(description: string): RouteConfig["responses"][string] {
  return {
    description,
    content: { "application/json": { schema: z.object({}).passthrough().openapi("GenericOk") } },
  };
}

function register(routes: RouteConfig[]): void {
  for (const route of routes) registry.registerPath(route);
}

register([
  // ── Health / spec ──────────────────────────────────────────────────────────
  {
    method: "get",
    path: "/health",
    tags: ["meta"],
    summary: "Liveness probe.",
    responses: { 200: ok("Service is up.") },
  },
  {
    method: "get",
    path: "/openapi.json",
    tags: ["meta"],
    summary: "This OpenAPI 3.1 document.",
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
    responses: { 201: ok("Folder created."), 400: validationErrorResponse, 401: ok("Unauthorized.") },
  },
  {
    method: "post",
    path: "/folders/{id}/move",
    tags: ["folders"],
    security: bearer,
    summary: "Move a folder under a new parent.",
    request: { params: z.object({ id: idParam }), ...jsonBody(MoveFolderSchema) },
    responses: { 200: ok("Folder moved."), 400: validationErrorResponse },
  },

  // ── Documents ──────────────────────────────────────────────────────────────
  {
    method: "delete",
    path: "/documents/{id}",
    tags: ["documents"],
    security: bearer,
    summary: "Soft-delete a document (blocked under legal hold).",
    request: { params: z.object({ id: idParam }) },
    responses: { 204: { description: "Deleted." }, 409: ok("Under legal hold.") },
  },
  {
    method: "post",
    path: "/documents/{id}/rollback",
    tags: ["documents"],
    security: bearer,
    summary: "Roll a document back to a prior version.",
    request: { params: z.object({ id: idParam }), ...jsonBody(RollbackSchema) },
    responses: { 200: ok("Rolled back."), 400: validationErrorResponse },
  },
  {
    method: "post",
    path: "/documents/{id}/stamp",
    tags: ["documents"],
    security: bearer,
    summary: "Burn a visible stamp into a new version.",
    request: { params: z.object({ id: idParam }), ...jsonBody(StampSchema) },
    responses: { 201: ok("Stamped."), 400: validationErrorResponse },
  },
  {
    method: "post",
    path: "/documents/{id}/redact",
    tags: ["documents"],
    security: bearer,
    summary: "Destructively redact regions into a new version.",
    request: { params: z.object({ id: idParam }), ...jsonBody(RedactSchema) },
    responses: { 201: ok("Redacted."), 400: validationErrorResponse },
  },
  {
    method: "patch",
    path: "/documents/{id}",
    tags: ["documents"],
    security: bearer,
    summary: "Correct document metadata.",
    request: { params: z.object({ id: idParam }), ...jsonBody(PatchDocumentSchema) },
    responses: { 200: ok("Updated."), 400: validationErrorResponse },
  },
  {
    method: "post",
    path: "/documents/{id}/extract",
    tags: ["documents", "extraction"],
    security: bearer,
    summary: "Run AI extraction (sync, or async with { async: true }).",
    request: { params: z.object({ id: idParam }), ...jsonBody(ExtractSchema) },
    responses: { 200: ok("Extracted."), 202: ok("Queued."), 400: validationErrorResponse },
  },
  {
    method: "post",
    path: "/documents/{id}/extract-async",
    tags: ["documents", "extraction"],
    security: bearer,
    summary: "Enqueue a durable async extraction job.",
    request: { params: z.object({ id: idParam }) },
    responses: { 202: ok("Queued.") },
  },

  // ── Index / Catalog / Mapper ─────────────────────────────────────────────
  {
    method: "post",
    path: "/index/{documentId}",
    tags: ["pipeline"],
    security: bearer,
    summary: "Index a document's typed metadata.",
    request: { params: z.object({ documentId: documentIdParam }), ...jsonBody(IndexSchema) },
    responses: { 200: ok("Indexed."), 400: validationErrorResponse, 422: ok("Metadata invalid.") },
  },
  {
    method: "post",
    path: "/catalog/{documentId}",
    tags: ["pipeline"],
    security: bearer,
    summary: "Catalog/classify a document.",
    request: { params: z.object({ documentId: documentIdParam }), ...jsonBody(CatalogSchema) },
    responses: { 200: ok("Cataloged."), 400: validationErrorResponse },
  },
  {
    method: "post",
    path: "/mapper/{documentId}",
    tags: ["pipeline"],
    security: bearer,
    summary: "Auto-file a document into the directory tree.",
    request: { params: z.object({ documentId: documentIdParam }), ...jsonBody(MapperSchema) },
    responses: { 200: ok("Filed."), 400: validationErrorResponse },
  },

  // ── Annotations ──────────────────────────────────────────────────────────
  {
    method: "post",
    path: "/documents/{documentId}/annotations",
    tags: ["annotations"],
    security: bearer,
    summary: "Create an annotation on a document.",
    request: { params: z.object({ documentId: documentIdParam }), ...jsonBody(CreateAnnotationSchema) },
    responses: { 201: ok("Created."), 400: validationErrorResponse },
  },
  {
    method: "delete",
    path: "/documents/{documentId}/annotations/{id}",
    tags: ["annotations"],
    security: bearer,
    summary: "Delete an annotation.",
    request: { params: z.object({ documentId: documentIdParam, id: idParam }) },
    responses: { 204: { description: "Deleted." }, 404: ok("Not found.") },
  },

  // ── Branches ─────────────────────────────────────────────────────────────
  {
    method: "post",
    path: "/branches",
    tags: ["branches"],
    security: bearer,
    summary: "Create a branch.",
    request: jsonBody(CreateBranchSchema),
    responses: { 201: ok("Created."), 400: validationErrorResponse },
  },
  {
    method: "post",
    path: "/branches/access",
    tags: ["branches"],
    security: bearer,
    summary: "Set a cross-branch access policy.",
    request: jsonBody(AccessPolicySchema),
    responses: { 201: ok("Set."), 400: validationErrorResponse },
  },

  // ── Records / legal holds ────────────────────────────────────────────────
  {
    method: "post",
    path: "/records/holds",
    tags: ["records"],
    security: bearer,
    summary: "Place a legal hold.",
    request: jsonBody(PlaceHoldSchema),
    responses: { 201: ok("Placed."), 400: validationErrorResponse },
  },
  {
    method: "post",
    path: "/records/holds/{ref}/release",
    tags: ["records"],
    security: bearer,
    summary: "Release a legal hold.",
    request: { params: z.object({ ref: refParam }) },
    responses: { 200: ok("Released.") },
  },
  {
    method: "post",
    path: "/records/disposal/{documentId}/certify",
    tags: ["records"],
    security: bearer,
    summary: "Certify disposal of a document.",
    request: { params: z.object({ documentId: documentIdParam }) },
    responses: { 201: ok("Certified."), 409: ok("Under legal hold / not eligible.") },
  },

  // ── Admin: dedup config ──────────────────────────────────────────────────
  {
    method: "put",
    path: "/admin/dedup-config",
    tags: ["admin"],
    security: bearer,
    summary: "Update dedup configuration.",
    request: jsonBody(DedupConfigSchema),
    responses: { 200: ok("Updated."), 400: validationErrorResponse },
  },

  // ── Doc-type registry ────────────────────────────────────────────────────
  {
    method: "post",
    path: "/doc-types",
    tags: ["doc-types"],
    security: bearer,
    summary: "Create a custom doc type.",
    request: jsonBody(CreateDocTypeSchema),
    responses: { 201: ok("Created."), 400: validationErrorResponse, 409: ok("Conflict.") },
  },
  {
    method: "put",
    path: "/doc-types/{code}",
    tags: ["doc-types"],
    security: bearer,
    summary: "Edit a doc type.",
    request: { params: z.object({ code: codeParam }), ...jsonBody(UpdateDocTypeSchema) },
    responses: { 200: ok("Updated."), 400: validationErrorResponse, 404: ok("Not found.") },
  },
  {
    method: "delete",
    path: "/doc-types/{code}",
    tags: ["doc-types"],
    security: bearer,
    summary: "Delete a custom doc type.",
    request: { params: z.object({ code: codeParam }) },
    responses: { 200: ok("Deleted."), 403: ok("System type."), 404: ok("Not found.") },
  },
  {
    method: "post",
    path: "/doc-types/from-suggestion",
    tags: ["doc-types"],
    security: bearer,
    summary: "Persist an AI-suggested doc type.",
    request: jsonBody(FromSuggestionSchema),
    responses: { 201: ok("Created."), 400: validationErrorResponse, 409: ok("Conflict.") },
  },
  {
    method: "post",
    path: "/doc-types/{code}/apply-fields",
    tags: ["doc-types"],
    security: bearer,
    summary: "Replace a doc type's field schema.",
    request: { params: z.object({ code: codeParam }), ...jsonBody(ApplyFieldsSchema) },
    responses: { 200: ok("Applied."), 400: validationErrorResponse, 404: ok("Not found.") },
  },

  // ── Integration (internal, x-internal-token) ─────────────────────────────
  {
    method: "post",
    path: "/integration/customer-upsert",
    tags: ["integration"],
    security: internal,
    summary: "CBS customer upsert (internal).",
    request: jsonBody(CustomerUpsertSchema),
    responses: { 200: ok("Updated."), 201: ok("Created."), 400: validationErrorResponse, 401: ok("Unauthorized.") },
  },
  {
    method: "post",
    path: "/integration/loan-intake",
    tags: ["integration"],
    security: internal,
    summary: "LOS loan-intake upsert (internal).",
    request: jsonBody(LoanIntakeSchema),
    responses: { 200: ok("Updated."), 201: ok("Created."), 400: validationErrorResponse, 401: ok("Unauthorized.") },
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
      { name: "branches" },
      { name: "records" },
      { name: "admin" },
      { name: "doc-types" },
      { name: "extraction" },
      { name: "integration" },
    ],
  }) as unknown as Record<string, unknown>;
}
