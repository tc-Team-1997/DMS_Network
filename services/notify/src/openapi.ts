/**
 * OpenAPI 3.1 document for the notify service.
 *
 * The document is derived from the zod schemas in schemas.ts via
 * @asteasolutions/zod-to-openapi, so request/response shapes stay in sync with
 * the actual boundary validation.
 *
 * Auth scheme: bearer JWT (HS256) on all REST + SSE routes. The notify service
 * additionally ingests domain events over an internal event bus (not HTTP);
 * cross-service HTTP calls in this platform carry an x-internal-token header
 * and HMAC-signed bodies, documented here as security schemes for reference.
 */
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from "@asteasolutions/zod-to-openapi";
import {
  z,
  ChannelKeySchema,
  IdParamSchema,
  AlertListQuerySchema,
  EscalateBodySchema,
  CreateRuleBodySchema,
  UpdateRuleBodySchema,
  ValidationErrorSchema,
  ErrorSchema,
  OkSchema,
  AlertSchema,
  RuleSchema,
} from "./schemas.js";

export function buildOpenApiDocument(): Record<string, unknown> {
  const registry = new OpenAPIRegistry();

  const bearer = registry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "JWT (HS256) bearer token. Claims carry roles/permissions/branch.",
  });

  // Documented for inbound cross-service integration calls (not used by REST
  // routes below, which are JWT-gated). The notify consumer ingests events via
  // an internal event bus rather than HTTP.
  registry.registerComponent("securitySchemes", "internalToken", {
    type: "apiKey",
    in: "header",
    name: "x-internal-token",
    description: "Shared secret for trusted service-to-service calls.",
  });
  registry.registerComponent("securitySchemes", "hmacSignature", {
    type: "apiKey",
    in: "header",
    name: "x-signature",
    description: "HMAC-SHA256 signature of the raw request body for inbound integration webhooks.",
  });

  // Register named component schemas.
  registry.register("ChannelKey", ChannelKeySchema);
  registry.register("Alert", AlertSchema);
  registry.register("Rule", RuleSchema);
  registry.register("ValidationError", ValidationErrorSchema);
  registry.register("Error", ErrorSchema);
  registry.register("Ok", OkSchema);
  registry.register("CreateRuleBody", CreateRuleBodySchema);
  registry.register("UpdateRuleBody", UpdateRuleBodySchema);
  registry.register("EscalateBody", EscalateBodySchema);

  const security = [{ bearerAuth: [] as string[] }];
  const jsonContent = (schema: z.ZodType) => ({ "application/json": { schema } });

  const validationResponse = {
    description: "Validation error",
    content: jsonContent(ValidationErrorSchema),
  };
  const unauthorized = { description: "Missing/invalid token", content: jsonContent(ErrorSchema) };
  const forbidden = { description: "Missing permission", content: jsonContent(ErrorSchema) };
  const notFound = { description: "Resource not found", content: jsonContent(ErrorSchema) };

  // --- /health -----------------------------------------------------------
  registry.registerPath({
    method: "get",
    path: "/health",
    tags: ["meta"],
    summary: "Liveness probe",
    responses: {
      200: {
        description: "Service is up",
        content: jsonContent(z.object({ status: z.string(), service: z.string() })),
      },
    },
  });

  // --- /openapi.json -----------------------------------------------------
  registry.registerPath({
    method: "get",
    path: "/openapi.json",
    tags: ["meta"],
    summary: "OpenAPI 3.1 document for this service",
    responses: {
      200: { description: "The OpenAPI document", content: { "application/json": { schema: z.object({}).passthrough() } } },
    },
  });

  // --- GET /alerts -------------------------------------------------------
  registry.registerPath({
    method: "get",
    path: "/alerts",
    tags: ["alerts"],
    summary: "List alerts",
    security,
    request: { query: AlertListQuerySchema },
    responses: {
      200: { description: "Alert list", content: jsonContent(z.object({ alerts: z.array(AlertSchema) })) },
      400: validationResponse,
      401: unauthorized,
      403: forbidden,
    },
  });

  // --- GET /alerts/stream (SSE) -----------------------------------------
  registry.registerPath({
    method: "get",
    path: "/alerts/stream",
    tags: ["alerts"],
    summary: "Server-Sent Events stream of live alerts (auth-gated)",
    security,
    responses: {
      200: { description: "text/event-stream of alert events", content: { "text/event-stream": { schema: z.string() } } },
      401: unauthorized,
      403: forbidden,
    },
  });

  // --- POST /alerts/{id}/read -------------------------------------------
  registry.registerPath({
    method: "post",
    path: "/alerts/{id}/read",
    tags: ["alerts"],
    summary: "Mark an alert as read",
    security,
    request: { params: IdParamSchema },
    responses: {
      200: { description: "Marked read", content: jsonContent(OkSchema) },
      400: validationResponse,
      401: unauthorized,
      403: forbidden,
      404: notFound,
    },
  });

  // --- POST /alerts/{id}/escalate ---------------------------------------
  registry.registerPath({
    method: "post",
    path: "/alerts/{id}/escalate",
    tags: ["alerts"],
    summary: "Escalate an alert to a role",
    security,
    request: {
      params: IdParamSchema,
      body: { required: true, content: jsonContent(EscalateBodySchema) },
    },
    responses: {
      200: { description: "Escalated", content: jsonContent(z.object({ escalatedTo: z.number() })) },
      400: { description: "target required / validation error", content: jsonContent(ErrorSchema) },
      401: unauthorized,
      403: forbidden,
      404: notFound,
    },
  });

  // --- GET /rules --------------------------------------------------------
  registry.registerPath({
    method: "get",
    path: "/rules",
    tags: ["rules"],
    summary: "List alert rules",
    security,
    responses: {
      200: { description: "Rule list", content: jsonContent(z.object({ rules: z.array(RuleSchema) })) },
      401: unauthorized,
      403: forbidden,
    },
  });

  // --- POST /rules -------------------------------------------------------
  registry.registerPath({
    method: "post",
    path: "/rules",
    tags: ["rules"],
    summary: "Create an alert rule",
    security,
    request: { body: { required: true, content: jsonContent(CreateRuleBodySchema) } },
    responses: {
      201: { description: "Rule created", content: jsonContent(z.object({ id: z.string() })) },
      400: validationResponse,
      401: unauthorized,
      403: forbidden,
    },
  });

  // --- PATCH /rules/{id} -------------------------------------------------
  registry.registerPath({
    method: "patch",
    path: "/rules/{id}",
    tags: ["rules"],
    summary: "Update an alert rule",
    security,
    request: {
      params: IdParamSchema,
      body: { required: true, content: jsonContent(UpdateRuleBodySchema) },
    },
    responses: {
      200: { description: "Updated", content: jsonContent(OkSchema) },
      400: validationResponse,
      401: unauthorized,
      403: forbidden,
      404: notFound,
    },
  });

  void bearer; // ensure component registration is retained

  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "ZorDMS Notify Service API",
      version: "1.0.0",
      description:
        "Alerts and alert-rule management for the ZorDMS platform. All REST and SSE routes require a bearer JWT.",
    },
    servers: [{ url: "/", description: "notify service root" }],
    security,
  }) as unknown as Record<string, unknown>;
}
