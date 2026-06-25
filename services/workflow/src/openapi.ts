import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
  CreateTemplateBody,
  CreateWorkflowBody,
  ActBody,
  ListWorkflowsQuery,
  WorkflowActionEnum,
  QueueStatusEnum,
  ValidationErrorResponse,
  ErrorResponse,
} from "./schemas.js";

// ---------------------------------------------------------------------------
// P10 — OpenAPI 3.1 document for the workflow service.
//
// Paths/methods/params/request bodies are derived from the zod schemas in
// schemas.ts. Read-only response shapes are described inline (the handlers
// build plain JSON, not zod outputs).
// ---------------------------------------------------------------------------

let cached: Record<string, unknown> | null = null;

export function buildOpenApiDocument(): Record<string, unknown> {
  if (cached) return cached;

  const registry = new OpenAPIRegistry();

  // --- Security schemes ----------------------------------------------------
  // bearer JWT — primary auth for all user-facing routes.
  const bearerAuth = registry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "User JWT issued by the auth service.",
  });
  // x-internal-token — service-to-service trust (e.g. authority/integration calls).
  registry.registerComponent("securitySchemes", "internalToken", {
    type: "apiKey",
    in: "header",
    name: "x-internal-token",
    description:
      "Shared INTERNAL_SERVICE_TOKEN for trusted service-to-service calls. " +
      "Inbound integration webhooks are additionally HMAC-signed (x-signature) " +
      "and verified by the integration hub before forwarding.",
  });

  const bearer = [{ [bearerAuth.name]: [] }];

  // --- Reusable component schemas (registered so they appear in components) -
  registry.register("WorkflowAction", WorkflowActionEnum);
  registry.register("QueueStatus", QueueStatusEnum);
  registry.register("CreateTemplateBody", CreateTemplateBody);
  registry.register("CreateWorkflowBody", CreateWorkflowBody);
  registry.register("ActBody", ActBody);
  registry.register("ValidationErrorResponse", ValidationErrorResponse);
  registry.register("ErrorResponse", ErrorResponse);

  const jsonBody = (schema: z.ZodTypeAny) => ({
    content: { "application/json": { schema } },
  });
  const validationErr = {
    description: "Validation failed.",
    content: { "application/json": { schema: ValidationErrorResponse } },
  };
  const errResp = (description: string) => ({
    description,
    content: { "application/json": { schema: ErrorResponse } },
  });

  // --- GET /health ---------------------------------------------------------
  registry.registerPath({
    method: "get",
    path: "/health",
    summary: "Liveness probe",
    responses: {
      200: {
        description: "Service healthy.",
        content: {
          "application/json": {
            schema: z.object({ status: z.string(), service: z.string() }),
          },
        },
      },
    },
  });

  // --- POST /templates -----------------------------------------------------
  registry.registerPath({
    method: "post",
    path: "/templates",
    summary: "Create a workflow template",
    security: bearer,
    request: { body: jsonBody(CreateTemplateBody) },
    responses: {
      201: { description: "Template created." },
      400: validationErr,
      401: errResp("Missing/invalid JWT."),
      403: errResp("Missing workflow:act permission."),
    },
  });

  // --- GET /templates ------------------------------------------------------
  registry.registerPath({
    method: "get",
    path: "/templates",
    summary: "List active workflow templates",
    security: bearer,
    responses: {
      200: { description: "Active templates." },
      401: errResp("Missing/invalid JWT."),
    },
  });

  // --- POST /workflows -----------------------------------------------------
  registry.registerPath({
    method: "post",
    path: "/workflows",
    summary: "Instantiate a workflow from a template",
    security: bearer,
    request: { body: jsonBody(CreateWorkflowBody) },
    responses: {
      201: { description: "Workflow created with its steps." },
      400: validationErr,
      401: errResp("Missing/invalid JWT."),
      403: errResp("Missing workflow:act permission."),
      404: errResp("Template not found."),
      409: errResp("ref_code conflict."),
    },
  });

  // --- GET /workflows ------------------------------------------------------
  registry.registerPath({
    method: "get",
    path: "/workflows",
    summary: "Cross-status review queue (branch-scoped)",
    security: bearer,
    request: { query: ListWorkflowsQuery },
    responses: {
      200: { description: "Review-queue items." },
      400: validationErr,
      401: errResp("Missing/invalid JWT."),
    },
  });

  // --- GET /workflows/{id} -------------------------------------------------
  registry.registerPath({
    method: "get",
    path: "/workflows/{id}",
    summary: "Fetch a workflow and its steps",
    security: bearer,
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: "Workflow + steps." },
      401: errResp("Missing/invalid JWT."),
      404: errResp("Not found."),
    },
  });

  // --- POST /workflows/{id}/claim ------------------------------------------
  registry.registerPath({
    method: "post",
    path: "/workflows/{id}/claim",
    summary: "Claim the current pending step",
    security: bearer,
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: "Updated workflow + steps." },
      400: validationErr,
      401: errResp("Missing/invalid JWT."),
      404: errResp("Not found."),
      409: errResp("Closed/inactive/no-pending/already-claimed."),
    },
  });

  // --- POST /workflows/{id}/act --------------------------------------------
  registry.registerPath({
    method: "post",
    path: "/workflows/{id}/act",
    summary: "Apply an action (approve/reject/escalate/hold) to a workflow",
    security: bearer,
    request: {
      params: z.object({ id: z.string() }),
      body: jsonBody(ActBody),
    },
    responses: {
      200: { description: "Updated workflow + steps." },
      400: validationErr,
      401: errResp("Missing/invalid JWT."),
      403: errResp("Authority denied the action."),
      404: errResp("Not found."),
      409: errResp("Closed/inactive/no-pending."),
      500: errResp("Authority service unavailable."),
    },
  });

  const generator = new OpenApiGeneratorV31(registry.definitions);
  const doc = generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "ZorDMS Workflow Service",
      version: "1.0.0",
      description:
        "Workflow templates, instantiation, review queue, claim and act endpoints.",
    },
    servers: [{ url: "/", description: "Workflow service root" }],
  });

  cached = doc as unknown as Record<string, unknown>;
  return cached;
}
