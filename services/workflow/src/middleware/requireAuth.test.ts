/**
 * Tests for the local requireAuth middleware (F1/F14).
 *
 * Verifies:
 * - 401 on missing Bearer token
 * - 401 on invalid/tampered token
 * - 200 on valid token — req.authUser populated from JWT claims
 * - Permissions embedded in JWT claims are surfaced on req.authUser.permissions
 */
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { signToken } from "@zordms/auth";
import { requireAuth } from "./requireAuth.js";
import { requirePermission } from "./requirePermission.js";

const SECRET = "test-secret";

const app = express();
app.use(express.json());
app.locals.deps = { config: { jwtSecret: SECRET } };

app.get(
  "/protected",
  requireAuth,
  (_req, res) => res.json({ userId: (_req as typeof _req & { authUser?: { id: number } }).authUser?.id }),
);
app.get(
  "/guarded",
  requireAuth,
  requirePermission("workflow:act"),
  (_req, res) => res.json({ ok: true }),
);

describe("requireAuth middleware (F1/F14)", () => {
  it("returns 401 when no Authorization header is present", async () => {
    const res = await request(app).get("/protected");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("returns 401 for a tampered/invalid token", async () => {
    const res = await request(app)
      .get("/protected")
      .set("Authorization", "Bearer invalid.token.here");
    expect(res.status).toBe(401);
  });

  it("returns 200 and populates req.authUser for a valid token", async () => {
    const token = signToken({ sub: 42, username: "alice" }, SECRET);
    const res = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(42);
  });

  it("populates req.authUser.permissions from the JWT permissions claim", async () => {
    const token = signToken(
      { sub: 7, username: "bob", permissions: ["workflow:act", "case:read"] } as Parameters<typeof signToken>[0],
      SECRET,
    );
    const app2 = express();
    app2.use(express.json());
    app2.locals.deps = { config: { jwtSecret: SECRET } };
    app2.get("/perms", requireAuth, (req, res) => {
      res.json({ permissions: (req as typeof req & { authUser?: { permissions: string[] } }).authUser?.permissions });
    });
    const res = await request(app2)
      .get("/perms")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.permissions).toContain("workflow:act");
    expect(res.body.permissions).toContain("case:read");
  });

  it("returns 403 when authenticated user lacks the required permission", async () => {
    const token = signToken(
      { sub: 9, username: "charlie", permissions: [] } as Parameters<typeof signToken>[0],
      SECRET,
    );
    const res = await request(app)
      .get("/guarded")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
  });

  it("returns 200 when authenticated user has the required permission", async () => {
    const token = signToken(
      { sub: 10, username: "dana", permissions: ["workflow:act"] } as Parameters<typeof signToken>[0],
      SECRET,
    );
    const res = await request(app)
      .get("/guarded")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
