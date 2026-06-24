import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { signToken } from "./tokens.js";
import {
  requireAuth,
  requirePermission,
  asyncHandler,
  errorHandler,
  makeViewer,
  type AuthUser,
} from "./middleware.js";

// ---------------------------------------------------------------------------
// Minimal mocks for Express req / res / next
// ---------------------------------------------------------------------------

function makeReq(overrides: Partial<Request> = {}): Request {
  const req: Partial<Request> = {
    headers: {},
    app: {
      locals: { deps: { config: { jwtSecret: "test-secret" } } },
    } as unknown as Request["app"],
    ...overrides,
  };
  return req as Request;
}

function makeRes() {
  const body: { status?: number; json?: unknown } = {};
  const res = {
    _body: body,
    status(code: number) {
      body.status = code;
      return res;
    },
    json(data: unknown) {
      body.json = data;
      return res;
    },
  };
  return res as unknown as Response & { _body: typeof body };
}

const SECRET = "test-secret";

// ---------------------------------------------------------------------------
// requireAuth
// ---------------------------------------------------------------------------

describe("requireAuth", () => {
  it("sets req.authUser from a valid JWT with permissions", () => {
    const token = signToken(
      { sub: 42, username: "alice", permissions: ["x"], roles: ["viewer"] },
      SECRET,
    );
    const req = makeReq({
      headers: { authorization: `Bearer ${token}` },
    });
    const res = makeRes();
    const next = vi.fn();

    requireAuth(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    expect(req.authUser).toBeDefined();
    expect(req.authUser?.id).toBe(42);
    expect(req.authUser?.username).toBe("alice");
    expect(req.authUser?.permissions).toEqual(["x"]);
    expect(req.authUser?.roles).toEqual(["viewer"]);
  });

  it("returns 401 when Authorization header is missing", () => {
    const req = makeReq({ headers: {} });
    const res = makeRes();
    const next = vi.fn();

    requireAuth(req, res, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res._body.status).toBe(401);
    expect(res._body.json).toEqual({ error: "unauthorized" });
  });

  it("returns 401 when token is signed with wrong secret", () => {
    const token = signToken({ sub: 1, username: "bob" }, "wrong-secret");
    const req = makeReq({
      headers: { authorization: `Bearer ${token}` },
    });
    const res = makeRes();
    const next = vi.fn();

    requireAuth(req, res, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res._body.status).toBe(401);
  });

  it("returns 401 for a malformed token string", () => {
    const req = makeReq({
      headers: { authorization: "Bearer not.a.token" },
    });
    const res = makeRes();
    const next = vi.fn();

    requireAuth(req, res, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res._body.status).toBe(401);
  });

  it("populates branch and region from claims", () => {
    const token = signToken(
      { sub: 5, username: "carol", branch: "HQ", region: "NORTH" },
      SECRET,
    );
    const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
    const res = makeRes();
    const next = vi.fn();

    requireAuth(req, res, next as unknown as NextFunction);

    expect(req.authUser?.branch).toBe("HQ");
    expect(req.authUser?.region).toBe("NORTH");
  });
});

// ---------------------------------------------------------------------------
// requirePermission
// ---------------------------------------------------------------------------

describe("requirePermission", () => {
  function makeAuthedReq(permissions: string[]): Request {
    const authUser: AuthUser = {
      id: 1,
      username: "alice",
      roles: [],
      permissions,
    };
    return makeReq({ authUser } as unknown as Partial<Request>);
  }

  it("calls next when user has the required permission", () => {
    const req = makeAuthedReq(["docs:read"]);
    const res = makeRes();
    const next = vi.fn();

    requirePermission("docs:read")(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    expect(res._body.status).toBeUndefined();
  });

  it("returns 403 when user lacks the required permission", () => {
    const req = makeAuthedReq(["docs:read"]);
    const res = makeRes();
    const next = vi.fn();

    requirePermission("admin:write")(
      req,
      res,
      next as unknown as NextFunction,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res._body.status).toBe(403);
    expect(res._body.json).toEqual({
      error: "forbidden",
      required: "admin:write",
    });
  });

  it("returns 401 when req.authUser is not set", () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    requirePermission("docs:read")(req, res, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res._body.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// asyncHandler
// ---------------------------------------------------------------------------

describe("asyncHandler", () => {
  it("calls next(err) when the async handler throws", async () => {
    const boom = new Error("async boom");
    const handler = asyncHandler(async () => {
      throw boom;
    });
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    handler(req, res, next as unknown as NextFunction);

    // Let microtasks flush
    await Promise.resolve();
    expect(next).toHaveBeenCalledWith(boom);
  });
});

// ---------------------------------------------------------------------------
// errorHandler
// ---------------------------------------------------------------------------

describe("errorHandler", () => {
  it("returns 500 with internal_error and no stack leak", () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    errorHandler(
      new Error("db crashed"),
      req,
      res,
      next as unknown as NextFunction,
    );

    expect(res._body.status).toBe(500);
    expect(res._body.json).toEqual({ error: "internal_error" });
  });
});

// ---------------------------------------------------------------------------
// makeViewer
// ---------------------------------------------------------------------------

describe("makeViewer", () => {
  it("returns branch from authUser and canCrossBranch true when perm present", () => {
    const req = makeReq({
      authUser: {
        id: 1,
        username: "u",
        roles: [],
        permissions: ["crossbranch:read"],
        branch: "BRANCH1",
      },
    } as unknown as Partial<Request>);

    const v = makeViewer(req);
    expect(v.branch).toBe("BRANCH1");
    expect(v.canCrossBranch).toBe(true);
  });

  it("returns canCrossBranch false when perm absent", () => {
    const req = makeReq({
      authUser: {
        id: 1,
        username: "u",
        roles: [],
        permissions: ["docs:read"],
        branch: "B2",
      },
    } as unknown as Partial<Request>);

    const v = makeViewer(req);
    expect(v.canCrossBranch).toBe(false);
  });

  it("returns canCrossBranch false when authUser absent (fail-closed)", () => {
    const req = makeReq();
    const v = makeViewer(req);
    expect(v.canCrossBranch).toBe(false);
    expect(v.branch).toBeUndefined();
  });
});
