import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
  LoginBodySchema,
  LoginResponseSchema,
  CreateUserBodySchema,
  SetUserRolesBodySchema,
  AuthzCheckBodySchema,
  AuthzCheckResponseSchema,
  ValidationErrorSchema,
  ErrorSchema,
  AuthUserSchema,
} from "./schemas.js";

/**
 * Builds the OpenAPI 3.1 document for the gateway service from the same zod
 * schemas used for runtime boundary validation, so the contract never drifts
 * from the implementation.
 */
export function buildOpenApiDocument(): Record<string, unknown> {
  const registry = new OpenAPIRegistry();

  // Security schemes -------------------------------------------------------
  const bearerAuth = registry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "End-user JWT issued by POST /auth/login.",
  });

  const internalToken = registry.registerComponent(
    "securitySchemes",
    "internalToken",
    {
      type: "apiKey",
      in: "header",
      name: "x-internal-token",
      description:
        "Shared internal service token for service-to-service / inbound integration calls.",
    },
  );

  registry.registerComponent("securitySchemes", "hmacSignature", {
    type: "apiKey",
    in: "header",
    name: "x-signature",
    description:
      "HMAC-SHA256 signature over the raw request body for inbound integration callbacks (verified alongside x-internal-token).",
  });

  const validationError = {
    description: "Request failed boundary validation.",
    content: { "application/json": { schema: ValidationErrorSchema } },
  };
  const unauthorized = {
    description: "Missing or invalid credentials.",
    content: { "application/json": { schema: ErrorSchema } },
  };

  // /auth/login ------------------------------------------------------------
  registry.registerPath({
    method: "post",
    path: "/auth/login",
    summary: "Authenticate a user and issue a JWT",
    tags: ["auth"],
    request: {
      body: {
        content: { "application/json": { schema: LoginBodySchema } },
      },
    },
    responses: {
      200: {
        description: "Login succeeded.",
        content: { "application/json": { schema: LoginResponseSchema } },
      },
      400: validationError,
      401: unauthorized,
      403: {
        description: "Account locked.",
        content: { "application/json": { schema: ErrorSchema } },
      },
    },
  });

  // /auth/me ---------------------------------------------------------------
  registry.registerPath({
    method: "get",
    path: "/auth/me",
    summary: "Return the authenticated user",
    tags: ["auth"],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: {
        description: "The current authenticated user.",
        content: {
          "application/json": {
            schema: z.object({ user: AuthUserSchema }),
          },
        },
      },
      401: unauthorized,
    },
  });

  // /users (list) ----------------------------------------------------------
  registry.registerPath({
    method: "get",
    path: "/users",
    summary: "List users",
    tags: ["users"],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: {
        description: "List of users.",
        content: {
          "application/json": {
            schema: z.object({ users: z.array(AuthUserSchema.partial()) }),
          },
        },
      },
      401: unauthorized,
      403: { description: "Missing user:read permission." },
    },
  });

  // /users (create) --------------------------------------------------------
  registry.registerPath({
    method: "post",
    path: "/users",
    summary: "Create a user",
    tags: ["users"],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: { content: { "application/json": { schema: CreateUserBodySchema } } },
    },
    responses: {
      201: {
        description: "User created.",
        content: {
          "application/json": {
            schema: z.object({
              user: z.object({
                id: z.string(),
                username: z.string(),
                roles: z.array(z.string()),
              }),
            }),
          },
        },
      },
      400: validationError,
      401: unauthorized,
      403: { description: "Missing user:create permission." },
      409: {
        description: "Username already taken.",
        content: { "application/json": { schema: ErrorSchema } },
      },
    },
  });

  // /users/:id/roles -------------------------------------------------------
  registry.registerPath({
    method: "post",
    path: "/users/{id}/roles",
    summary: "Replace a user's roles",
    tags: ["users"],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { "application/json": { schema: SetUserRolesBodySchema } } },
    },
    responses: {
      200: {
        description: "Roles updated.",
        content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
      },
      400: validationError,
      401: unauthorized,
      403: { description: "Missing role:assign permission." },
    },
  });

  // /users/:id/lock --------------------------------------------------------
  registry.registerPath({
    method: "post",
    path: "/users/{id}/lock",
    summary: "Toggle a user's locked status",
    tags: ["users"],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: "Lock status toggled.",
        content: {
          "application/json": {
            schema: z.object({ ok: z.boolean(), status: z.string() }),
          },
        },
      },
      400: validationError,
      401: unauthorized,
      403: { description: "Missing user:update permission." },
      404: {
        description: "User not found.",
        content: { "application/json": { schema: ErrorSchema } },
      },
    },
  });

  // /authz/check -----------------------------------------------------------
  registry.registerPath({
    method: "post",
    path: "/authz/check",
    summary: "Check whether a user holds the given permissions",
    description:
      "Service-to-service permission check. Requires the internal service token (and an HMAC signature for inbound integration callers).",
    tags: ["authz"],
    security: [{ [internalToken.name]: [] }],
    request: {
      body: { content: { "application/json": { schema: AuthzCheckBodySchema } } },
    },
    responses: {
      200: {
        description: "Permission decision.",
        content: { "application/json": { schema: AuthzCheckResponseSchema } },
      },
      400: validationError,
      401: unauthorized,
    },
  });

  // /health ----------------------------------------------------------------
  registry.registerPath({
    method: "get",
    path: "/health",
    summary: "Liveness probe",
    tags: ["ops"],
    responses: {
      200: {
        description: "Service is up.",
        content: {
          "application/json": { schema: z.object({ status: z.string() }) },
        },
      },
    },
  });

  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "ZorDMS Gateway API",
      version: "1.0.0",
      description:
        "Authentication, user management and authorization gateway for ZorDMS.",
    },
    servers: [{ url: "/" }],
    security: [{ bearerAuth: [] }],
  }) as unknown as Record<string, unknown>;
}
