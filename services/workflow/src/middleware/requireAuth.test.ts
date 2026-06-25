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
import { signToken, requireAuth, requirePermission } from "@zordms/auth";

const SECRET = "test-secret";

const app = express();
app.use(express.json());
app.locals.deps = { config: { jwtSecret: SECRET } };

app.get(
  "/protected",
  requireAuth,
  (_req, res) => res.json({ userId: (_req as typeof _req & { authUser?: { id: string } }).authUser?.id }),
);
app.get(
  "/guarded",
  requireAuth,
  requirePermission("workflow:act"),
  (_req, res) => res.json({ ok: true }),
);

// A UUID string used as the sub in these tests
const ALICE_ID = "01910000-0000-7000-0000-000000000042";

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
    const token = signToken({ sub: ALICE_ID, username: "alice" }, SECRET);
    const res = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(ALICE_ID);
  });

  it("populates req.authUser.permissions from the JWT permissions claim", async () => {
    const token = signToken(
      { sub: "01910000-0000-7000-0000-000000000007", username: "bob", permissions: ["workflow:act", "case:read"] } as Parameters<typeof signToken>[0],
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
      { sub: "01910000-0000-7000-0000-000000000009", username: "charlie", permissions: [] } as Parameters<typeof signToken>[0],
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
      { sub: "01910000-0000-7000-0000-000000000010", username: "dana", permissions: ["workflow:act"] } as Parameters<typeof signToken>[0],
      SECRET,
    );
    const res = await request(app)
      .get("/guarded")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
