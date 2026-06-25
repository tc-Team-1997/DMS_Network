import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
  SearchQuerySchema,
  SaveSearchRequestSchema,
  ReindexRequestSchema,
  SavedSearchIdParamsSchema,
  SearchResultsSchema,
  SavedSearchSchema,
  ValidationErrorSchema,
  ErrorSchema,
} from "./schemas.js";

// Serialized OpenAPI document shape. We annotate explicitly (rather than letting
// TS infer the openapi3-ts type) so the emitted .d.ts stays portable.
export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers?: Array<{ url: string; description?: string }>;
  paths: Record<string, unknown>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
  [key: string]: unknown;
}

export function buildOpenApiDocument(): OpenApiDocument {
  const registry = new OpenAPIRegistry();

  // Security schemes -------------------------------------------------------
  const bearerAuth = registry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "User-facing endpoints require a bearer JWT issued by @zordms/auth.",
  });
  const internalToken = registry.registerComponent("securitySchemes", "internalToken", {
    type: "apiKey",
    in: "header",
    name: "x-internal-token",
    description:
      "Shared internal token for service-to-service / integration inbound calls.",
  });
  const hmacSignature = registry.registerComponent("securitySchemes", "hmacSignature", {
    type: "apiKey",
    in: "header",
    name: "x-signature",
    description:
      "HMAC signature over the raw request body for integration inbound webhook calls.",
  });

  const validationError = {
    description: "Request failed boundary validation.",
    content: {
      "application/json": { schema: ValidationErrorSchema },
    },
  };
  const errorResponse = (description: string) => ({
    description,
    content: { "application/json": { schema: ErrorSchema } },
  });

  // POST /search -----------------------------------------------------------
  registry.registerPath({
    method: "post",
    path: "/search",
    summary: "Run a search query within the caller's branch scope.",
    tags: ["search"],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: {
        content: { "application/json": { schema: SearchQuerySchema } },
      },
    },
    responses: {
      200: {
        description: "Search results.",
        content: { "application/json": { schema: SearchResultsSchema } },
      },
      400: validationError,
      401: errorResponse("Missing or invalid bearer token."),
      403: errorResponse("Caller lacks document:read permission."),
    },
  });

  // GET /facets ------------------------------------------------------------
  registry.registerPath({
    method: "get",
    path: "/facets",
    summary: "Return facet dimensions for the caller scope.",
    tags: ["search"],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: {
        description: "Facet buckets keyed by dimension.",
        content: {
          "application/json": {
            schema: z.object({ facets: SearchResultsSchema.shape.facets }),
          },
        },
      },
      401: errorResponse("Missing or invalid bearer token."),
      403: errorResponse("Caller lacks document:read permission."),
    },
  });

  // POST /search/export.csv ------------------------------------------------
  registry.registerPath({
    method: "post",
    path: "/search/export.csv",
    summary: "Export search results as CSV (capped at 5000 rows).",
    tags: ["search"],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: { content: { "application/json": { schema: SearchQuerySchema } } },
    },
    responses: {
      200: {
        description: "CSV export.",
        content: { "text/csv": { schema: z.string() } },
      },
      400: validationError,
      401: errorResponse("Missing or invalid bearer token."),
      403: errorResponse("Caller lacks document:read permission."),
    },
  });

  // POST /saved ------------------------------------------------------------
  registry.registerPath({
    method: "post",
    path: "/saved",
    summary: "Create a saved search.",
    tags: ["saved-searches"],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: { content: { "application/json": { schema: SaveSearchRequestSchema } } },
    },
    responses: {
      201: {
        description: "Saved search created.",
        content: { "application/json": { schema: SavedSearchSchema } },
      },
      400: validationError,
      401: errorResponse("Missing or invalid bearer token."),
      403: errorResponse("Caller lacks document:read permission."),
    },
  });

  // GET /saved -------------------------------------------------------------
  registry.registerPath({
    method: "get",
    path: "/saved",
    summary: "List the caller's own + public saved searches.",
    tags: ["saved-searches"],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: {
        description: "Saved searches visible to the caller.",
        content: {
          "application/json": {
            schema: z.object({ saved: z.array(SavedSearchSchema) }),
          },
        },
      },
      401: errorResponse("Missing or invalid bearer token."),
      403: errorResponse("Caller lacks document:read permission."),
    },
  });

  // POST /saved/{id}/run ---------------------------------------------------
  registry.registerPath({
    method: "post",
    path: "/saved/{id}/run",
    summary: "Run a previously saved search with the caller's scope.",
    tags: ["saved-searches"],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      params: SavedSearchIdParamsSchema,
    },
    responses: {
      200: {
        description: "Search results.",
        content: { "application/json": { schema: SearchResultsSchema } },
      },
      400: validationError,
      401: errorResponse("Missing or invalid bearer token."),
      404: errorResponse("Saved search not found or not visible to caller."),
      500: errorResponse("Stored query is corrupted."),
    },
  });

  // POST /admin/reindex ----------------------------------------------------
  registry.registerPath({
    method: "post",
    path: "/admin/reindex",
    summary: "Reindex a batch of documents.",
    tags: ["admin"],
    security: [
      { [bearerAuth.name]: [] },
      { [internalToken.name]: [], [hmacSignature.name]: [] },
    ],
    request: {
      body: { content: { "application/json": { schema: ReindexRequestSchema } } },
    },
    responses: {
      200: {
        description: "Number of documents reindexed.",
        content: {
          "application/json": {
            schema: z.object({ reindexed: z.number() }),
          },
        },
      },
      400: validationError,
      401: errorResponse("Missing or invalid bearer token."),
      403: errorResponse("Caller lacks admin:access permission."),
    },
  });

  // GET /health ------------------------------------------------------------
  registry.registerPath({
    method: "get",
    path: "/health",
    summary: "Liveness probe.",
    tags: ["ops"],
    responses: {
      200: {
        description: "Service healthy.",
        content: {
          "application/json": {
            schema: z.object({ status: z.string(), backend: z.string() }),
          },
        },
      },
    },
  });

  const generator = new OpenApiGeneratorV31(registry.definitions);
  const doc = generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "ZorDMS Search Service",
      version: "1.0.0",
      description:
        "Full-text & faceted search, saved searches, CSV export and admin reindex for the ZorDMS platform.",
    },
    servers: [{ url: "/", description: "Search service root" }],
  });
  return doc as unknown as OpenApiDocument;
}
